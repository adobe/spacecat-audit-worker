/*
 * Copyright 2023 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

import { hasText, isValidUrl } from '@adobe/spacecat-shared-utils';

import { fetch } from './utils.js';

const MAX_DIFF_SIZE = 102400; // Maximum size of diff in bytes
const SECONDS_IN_A_DAY = 86400; // Number of seconds in a day

/**
 * Creates a GitHub client.
 *
 * @param {object} config - The configuration object.
 * @param {string} config.baseUrl - The base URL of the GitHub API.
 * @param {string} config.githubId - The GitHub ID.
 * @param {string} config.githubSecret - The GitHub secret.
 * @param {object} log - The logger.
 * @param {object} log - The logger.
 *
 * @return {GithubClient} - The GitHub client.
 */
function GithubClient({ baseUrl, githubId, githubSecret }, log = console) {
  log.info(`Creating GitHub client with base URL ${baseUrl} and ID ${githubId} with secret ${githubSecret}`);
  /**
   * Creates a URL for the GitHub API.
   *
   * @param {string} githubOrg - The name of the GitHub organization.
   * @param {string} repoName - The name of the repository (optional).
   * @param {string} path - Additional path (optional).
   * @param {number} page - The page number for pagination (optional).
   * @returns {string} The created GitHub API URL.
   */
  const createGithubApiUrl = (githubOrg, repoName = '', path = '', page = 1) => {
    const repoPart = repoName ? `/${repoName}` : '';
    const pathPart = path ? `/${path}` : '';

    return `${baseUrl}/repos/${githubOrg}${repoPart}${pathPart}?page=${page}&per_page=100`;
  };

  /**
   * Creates a Basic Authentication header value from a given GitHub ID and secret.
   *
   * @returns {string} - The Basic Authentication header value.
   * @throws {Error} - Throws an error if GitHub credentials are not provided.
   */
  const createGithubAuthHeaderValue = () => {
    if (!hasText(githubId) || !hasText(githubSecret)) {
      throw new Error('GitHub credentials not provided');
    }
    return `Basic ${Buffer.from(`${githubId}:${githubSecret}`).toString('base64')}`;
  };

  /**
   * Fetches and compiles the diffs of all changes made in a GitHub repository between two
   * date-times using the GitHub API.
   *
   * @async
   * @function
   * @param {object} baseURL - The baseURL of the audited site.
   * @param {string} latestAuditTime - The end date-time in ISO format
   * (e.g. 'YYYY-MM-DDTHH:mm:ss.sssZ').
   * @param {string} lastAuditedAt - The start date-time in ISO format (e.g.
   * 'YYYY-MM-DDTHH:mm:ss.sssZ'). If not provided, it defaults to 24 hours before the end date-time.
   * @param {string} gitHubURL - The URL of the GitHub repository from which the diffs will be
   * fetched (e.g. 'https://github.com/user/repo').
   * @returns {Promise<string>} A promise that resolves to a string containing the compiled
   * diffs in patch format between the given date-times. If there's an error fetching the data,
   * the promise resolves to an empty string.
   * @throws {Error} Will throw an error if there's a network issue or some other error while
   * fetching data from the GitHub API.
   * @example
   * fetchGithubDiff(
   *   { gitHubURL: 'https://github.com/myOrg/myRepo', lastAudited: '2023-06-15T00:00:00.000Z' },
   *   { result: { fetchTime: '2023-06-16T00:00:00.000Z' } },
   *   'yourGithubId',
   *   'yourGithubSecret'
   * ).then(diffs => console.log(diffs));
   */
  const fetchGithubDiff = async (baseURL, latestAuditTime, lastAuditedAt, gitHubURL) => {
    if (!isValidUrl(gitHubURL)) {
      log.info(`No github repo defined for site ${baseURL}. Skipping github diff calculation`);
      return '';
    }

    try {
      const until = new Date(latestAuditTime);
      const since = lastAuditedAt
        ? new Date(lastAuditedAt)
        : new Date(until - SECONDS_IN_A_DAY * 1000); // 24 hours before until
      const repoPath = new URL(gitHubURL).pathname.slice(1); // Removes leading '/'

      log.info(`Fetching diffs for domain ${baseURL} with repo ${repoPath} between ${since.toISOString()} and ${until.toISOString()}`);

      const [githubOrg, repoName] = repoPath.split('/');

      const authHeader = createGithubAuthHeaderValue();
      const commitsUrl = createGithubApiUrl(githubOrg, repoName, 'commits');

      const response = await fetch(commitsUrl, {
        headers: {
          Authorization: authHeader,
        },
      }).then((res) => res.json());

      const commitSHAs = response.map((commit) => commit.sha);
      let diffs = '';
      let totalSize = 0;

      log.info(`Found ${commitSHAs.length} commits for site ${baseURL}.`);

      for (const sha of commitSHAs) {
        log.info(`Fetching diff for commit ${sha} for site ${baseURL}`);

        const diffUrl = createGithubApiUrl(githubOrg, repoName, `commits/${sha}`);

        // eslint-disable-next-line no-await-in-loop
        const diffResponse = await fetch(diffUrl, {
          headers: {
            Accept: 'application/vnd.github.v3.diff',
            Authorization: authHeader,
          },
        }).then((res) => res.text());

        // Skip binary files and check the size of the diff
        if (!diffResponse.includes('Binary files differ') && (totalSize + diffResponse.length) < MAX_DIFF_SIZE) {
          diffs += `${diffResponse}\n`;
          totalSize += diffResponse.length;
          log.info(`Added commit ${sha} (${totalSize} of ${MAX_DIFF_SIZE}) to diff for site ${baseURL}.`);
        } else {
          log.warn(`Skipping commit ${sha} because it is binary or too large (${totalSize} of ${MAX_DIFF_SIZE}) for site ${baseURL}.`);
          break;
        }
      }

      return diffs;
    } catch (error) {
      log.error(`Error fetching GitHub diff data for site ${baseURL}: ${error}`);
      return '';
    }
  };

  return {
    createGithubApiUrl,
    createGithubAuthHeaderValue,
    fetchGithubDiff,
  };
}

export default GithubClient;
