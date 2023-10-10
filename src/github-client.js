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
const axios = require('axios');
const { log } = require('./util.js');

const SECONDS_IN_A_DAY = 86400; // Number of seconds in a day

function GithubClient(config) {
  const { baseUrl, githubId, githubSecret } = config;

  /**
   * Creates a URL for the GitHub API.
   *
   * @param {string} githubOrg - The name of the GitHub organization.
   * @param {string} repoName - The name of the repository (optional).
   * @param {string} path - Additional path (optional).
   * @param {number} page - The page number for pagination (optional).
   * @returns {string} The created GitHub API URL.
   */
  function createGithubApiUrl(githubOrg, repoName = '', path = '', page = 1) {
    const repoPart = repoName ? `/${repoName}` : '';
    const pathPart = path ? `/${path}` : '';

    return `${baseUrl}/repos/${githubOrg}${repoPart}${pathPart}?page=${page}&per_page=100`;
  }

  /**
   * Creates a Basic Authentication header value from a given GitHub ID and secret.
   *
   * @returns {string} - The Basic Authentication header value.
   * @throws {Error} - Throws an error if GitHub credentials are not provided.
   */
  function createGithubAuthHeaderValue() {
    if (!githubId || !githubSecret) {
      throw new Error('GitHub credentials not provided');
    }
    return `Basic ${Buffer.from(`${githubId}:${githubSecret}`).toString('base64')}`;
  }

  /**
   * Fetches the SHAs of all commits made in a GitHub repository between
   * two date-times using the GitHub API.
   *
   * @async
   * @function
   * @param {object} domain - The domain of the audited site.
   * @param {string} latestAuditTime - The end date-time in ISO format
   * (e.g. 'YYYY-MM-DDTHH:mm:ss.sssZ').
   * @param {string} lastAuditedAt - The start date-time in ISO format
   * (e.g. 'YYYY-MM-DDTHH:mm:ss.sssZ').
   * If not provided, it defaults to 24 hours before the end date-time.
   * @param {string} gitHubURL - The URL of the GitHub repository from which the SHAs will be fetched (e.g. 'https://github.com/user/repo').
   * @returns {Promise<string[]>} A promise that resolves to an array of SHAs
   * of commits between the given date-times.
   * If there's an error fetching the data, the promise resolves to an empty array.
   * @throws {Error} Will throw an error if there's a network issue
   * or some other error while fetching data from the GitHub API.
   * @example
   * fetchGithubCommitsSHA(
   *   { gitHubURL: 'https://github.com/myOrg/myRepo', lastAudited: '2023-06-15T00:00:00.000Z' },
   *   { result: { fetchTime: '2023-06-16T00:00:00.000Z' } },
   *   'yourGithubId',
   *   'yourGithubSecret'
   * ).then(SHAs => console.log(SHAs));
   */
  async function fetchGithubCommitsSHA(domain, latestAuditTime, lastAuditedAt, gitHubURL) {
    if (!gitHubURL) {
      log('info', `No github repo defined for site ${domain}. Skipping github SHA retrieval`);
      return [];
    }

    try {
      const until = new Date(latestAuditTime);
      const since = lastAuditedAt
        ? new Date(lastAuditedAt)
        : new Date(until - SECONDS_IN_A_DAY * 1000); // 24 hours before until
      const repoPath = new URL(gitHubURL).pathname.slice(1); // Removes leading '/'

      log('info', `Fetching SHAs for domain ${domain} with repo ${repoPath} between ${since.toISOString()} and ${until.toISOString()}`);

      const [githubOrg, repoName] = repoPath.split('/');

      const authHeader = createGithubAuthHeaderValue();
      const commitsUrl = createGithubApiUrl(githubOrg, repoName, 'commits');

      const response = await axios.get(commitsUrl, {
        params: {
          since: since.toISOString(),
          until: until.toISOString(),
        },
        headers: {
          Authorization: authHeader,
        },
      });

      const commitSHAs = response.data.map((commit) => commit.sha);

      log('info', `Found ${commitSHAs.length} commits for site ${domain}.`);

      return commitSHAs;
    } catch (error) {
      log('error', `Error fetching GitHub SHAs for site ${domain}:`, error.response ? error.response.data : error);
      return [];
    }
  }

  return {
    createGithubApiUrl,
    createGithubAuthHeaderValue,
    fetchGithubCommitsSHA,
  };
}

module.exports = GithubClient;
