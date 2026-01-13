/*
 * Copyright 2025 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

import { ok, internalServerError } from '@adobe/spacecat-shared-http-utils';
import { createLLMOSharepointClient, publishToAdminHlx } from '../utils/report-uploader.js';

const AUDIT_NAME = 'FRESCOPA_DATA_GENERATION';
const DATA_FOLDER = 'frescopa.coffee';
const QUERY_INDEX_URL = 'https://main--project-elmo-ui-data--adobe.aem.live/frescopa.coffee/query-index.json';

// File configurations for each report type
const FILE_CONFIGS = [
  {
    type: 'agentic-traffic',
    destinationFolder: 'agentic-traffic',
    filePrefix: 'agentictraffic',
  },
  {
    type: 'brand-presence',
    destinationFolder: 'brand-presence',
    filePrefix: 'brandpresence-all',
  },
  {
    type: 'referral-traffic',
    destinationFolder: 'referral-traffic',
    filePrefix: 'referral-traffic',
  },
];

/**
 * Regex pattern to extract week identifier from filename.
 * Matches patterns like: agentictraffic-w02-2026.json or brandpresence-all-w03-2026.json
 */
const WEEK_PATTERN = /-(w\d{2}-\d{4})\.json$/;

/**
 * Parses a week identifier (e.g., "w03-2026") into a comparable value.
 * @param {string} weekId - The week identifier
 * @returns {{ week: number, year: number } | null} Parsed week and year, or null if invalid
 */
function parseWeekIdentifier(weekId) {
  const regex = /^w(\d{2})-(\d{4})$/;
  const match = regex.exec(weekId);
  return {
    week: Number.parseInt(match[1], 10),
    year: Number.parseInt(match[2], 10),
  };
}

/**
 * Compares two week identifiers and returns which is more recent.
 * @param {string} a - First week identifier
 * @param {string} b - Second week identifier
 * @returns {number} Positive if a > b, negative if a < b, 0 if equal
 */
function compareWeekIdentifiers(a, b) {
  const parsedA = parseWeekIdentifier(a);
  const parsedB = parseWeekIdentifier(b);

  // Compare by year first, then by week
  if (parsedA.year !== parsedB.year) {
    return parsedA.year - parsedB.year;
  }
  return parsedA.week - parsedB.week;
}

/**
 * Fetches the query-index.json to get the list of all Frescopa files.
 * @param {object} log - Logger instance
 * @returns {Promise<Array<{ path: string, lastModified: string }>>} Array of file entries
 */
async function fetchQueryIndex(log) {
  log.info(`%s: Fetching query index from ${QUERY_INDEX_URL}`, AUDIT_NAME);

  const response = await fetch(QUERY_INDEX_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch query index: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return data.data || [];
}

/**
 * Finds the most recent file for a given file prefix from the query index.
 * @param {Array<{ path: string, lastModified: string }>} files - Array of file entries
 * @param {string} filePrefix -
 * The file prefix to match (e.g., "agentictraffic", "brandpresence-all", "referral-traffic")
 * @param {object} log - Logger instance
 * @returns {{ path: string, weekIdentifier: string } | null} The most recent file info, or null
 */
function findMostRecentFile(files, filePrefix, log) {
  // Filter files that match the prefix pattern
  const matchingFiles = files
    .filter((file) => {
      const filename = file.path.split('/').pop();
      return filename.startsWith(filePrefix) && WEEK_PATTERN.test(filename);
    })
    .map((file) => {
      const filename = file.path.split('/').pop();
      const weekMatch = WEEK_PATTERN.exec(filename);
      return {
        path: file.path,
        weekIdentifier: weekMatch[1],
      };
    })
    .filter((file) => file.weekIdentifier !== null);

  if (matchingFiles.length === 0) {
    log.warn(`%s: No files found matching prefix "${filePrefix}"`, AUDIT_NAME);
    return null;
  }

  // Sort by week identifier (most recent first)
  matchingFiles.sort((a, b) => compareWeekIdentifiers(b.weekIdentifier, a.weekIdentifier));

  const mostRecent = matchingFiles[0];
  log.info(
    `%s: Found most recent file for "${filePrefix}": ${mostRecent.path} (${mostRecent.weekIdentifier})`,
    AUDIT_NAME,
  );

  return mostRecent;
}

/**
 * Gets the template file path (xlsx) from a json file path.
 * @param {string} jsonPath -
 * The path to the JSON file (e.g., "/frescopa.coffee/brand-presence/file.json")
 * @returns {string} The SharePoint path to the xlsx file
 */
function getTemplateXlsxPath(jsonPath) {
  // Convert JSON path to xlsx path and add SharePoint prefix
  const xlsxPath = jsonPath.replace(/\.json$/, '.xlsx');
  return `/sites/elmo-ui-data${xlsxPath}`;
}

/**
 * Calculates the ISO week number for a given date.
 * ISO weeks start on Monday and the first week contains January 4th.
 * @param {Date} date - The date to calculate the week for
 * @returns {number} The ISO week number (1-53)
 */
function getISOWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  // Set to nearest Thursday: current date + 4 - current day number
  // Make Sunday's day number 7
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  // Get first day of year
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  // Calculate full weeks to nearest Thursday
  const weekNumber = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return weekNumber;
}

/**
 * Calculates the ISO year for the week (may differ from calendar year at year boundaries).
 * @param {Date} date - The date to calculate the week-year for
 * @returns {number} The ISO week-year
 */
function getISOWeekYear(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  return d.getUTCFullYear();
}

/**
 * Generates the week identifier in the format wXX-YYYY.
 * @param {Date} [date] - The date to generate the identifier for (defaults to current date)
 * @returns {string} The week identifier (e.g., "w03-2026")
 */
function generateWeekIdentifier(date = new Date()) {
  const weekNumber = getISOWeekNumber(date);
  const year = getISOWeekYear(date);
  return `w${String(weekNumber).padStart(2, '0')}-${year}`;
}

/**
 * Main handler for Frescopa data generation job.
 * This job runs weekly (typically on Monday) and creates Excel files
 * for agentic-traffic, brand-presence, and referral-traffic.
 *
 * @param {object} message - The SQS message
 * @param {object} context - The execution context
 * @returns {Promise<Response>} The response
 */
async function run(message, context) {
  const { log } = context;
  const startTime = Date.now();

  // Allow week identifier to be passed in auditContext, otherwise calculate it
  const weekIdentifier = message.auditContext?.weekIdentifier || generateWeekIdentifier();

  log.info(`%s: Starting Frescopa data generation for week ${weekIdentifier}`, AUDIT_NAME);

  try {
    // Fetch the query index to discover existing files
    const queryIndexFiles = await fetchQueryIndex(log);
    log.info(`%s: Found ${queryIndexFiles.length} files in query index`, AUDIT_NAME);

    const sharepointClient = await createLLMOSharepointClient(context);

    const results = [];
    const errors = [];

    // Process each file configuration
    for (const config of FILE_CONFIGS) {
      const { destinationFolder, filePrefix } = config;
      const newFileName = `${filePrefix}-${weekIdentifier}.xlsx`;
      const destinationFolderPath = `${DATA_FOLDER}/${destinationFolder}`;
      const destinationFilePath = `/${destinationFolderPath}/${newFileName}`;

      try {
        log.info(`%s: Processing ${newFileName}...`, AUDIT_NAME);

        // Find the most recent file of this type to use as template
        const templateInfo = findMostRecentFile(queryIndexFiles, filePrefix, log);

        if (!templateInfo) {
          const errorMsg = `No template file found for type "${filePrefix}"`;
          log.error(`%s: ${errorMsg}. Skipping ${newFileName}.`, AUDIT_NAME);
          errors.push({ file: newFileName, error: errorMsg });
          // eslint-disable-next-line no-continue
          continue;
        }

        // Check if we're trying to create a file for the same week as the template
        if (templateInfo.weekIdentifier === weekIdentifier) {
          log.info(
            `%s: File for ${weekIdentifier} already exists (${templateInfo.path}). Skipping.`,
            AUDIT_NAME,
          );
          results.push({
            fileName: newFileName,
            folder: destinationFolder,
            status: 'skipped',
            reason: 'already exists',
          });
          // eslint-disable-next-line no-continue
          continue;
        }

        // Check if destination folder exists
        const folder = sharepointClient.getDocument(`/sites/elmo-ui-data/${destinationFolderPath}/`);
        // eslint-disable-next-line no-await-in-loop
        const folderExists = await folder.exists();

        if (!folderExists) {
          const errorMsg = `Folder ${destinationFolderPath} does not exist`;
          log.error(`%s: ${errorMsg}. Skipping ${newFileName}.`, AUDIT_NAME);
          errors.push({ file: newFileName, error: errorMsg });
          // eslint-disable-next-line no-continue
          continue;
        }

        // Check if the new file already exists in SharePoint
        const newFile = sharepointClient.getDocument(`/sites/elmo-ui-data/${destinationFolderPath}/${newFileName}`);
        // eslint-disable-next-line no-await-in-loop
        const fileExists = await newFile.exists();

        if (fileExists) {
          log.info(`%s: File ${newFileName} already exists in ${destinationFolder}. Skipping.`, AUDIT_NAME);
          results.push({
            fileName: newFileName,
            folder: destinationFolder,
            status: 'skipped',
            reason: 'already exists',
          });
          // eslint-disable-next-line no-continue
          continue;
        }

        // Get the template xlsx path and copy it to the new destination
        const templateXlsxPath = getTemplateXlsxPath(templateInfo.path);
        log.info(`%s: Using template: ${templateXlsxPath}`, AUDIT_NAME);

        const templateFile = sharepointClient.getDocument(templateXlsxPath);
        // eslint-disable-next-line no-await-in-loop
        await templateFile.copy(destinationFilePath);

        log.info(`%s: Created file ${newFileName} in ${destinationFolderPath}`, AUDIT_NAME);

        // Publish the file
        // eslint-disable-next-line no-await-in-loop
        await publishToAdminHlx(newFileName, destinationFolderPath, log);

        results.push({
          fileName: newFileName,
          folder: destinationFolder,
          status: 'created',
          template: templateInfo.path,
          templateWeek: templateInfo.weekIdentifier,
          live: `https://main--project-elmo-ui-data--adobe.aem.live/${destinationFolderPath}/${filePrefix}-${weekIdentifier}.json`,
        });
      } catch (fileError) {
        log.error(`%s: Error processing ${newFileName}: ${fileError.message}`, AUDIT_NAME, fileError);
        errors.push({ file: newFileName, error: fileError.message });
      }
    }

    const duration = Date.now() - startTime;
    const successCount = results.filter((r) => r.status === 'created').length;
    const skippedCount = results.filter((r) => r.status === 'skipped').length;

    log.info(
      `%s: Frescopa data generation completed for week ${weekIdentifier} in ${duration}ms. `
      + `Created: ${successCount}, Skipped: ${skippedCount}, Errors: ${errors.length}`,
      AUDIT_NAME,
    );

    return ok({
      weekIdentifier,
      results,
      errors,
      duration,
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    log.error(`%s: Failed to generate Frescopa data for week ${weekIdentifier} after ${duration}ms`, AUDIT_NAME, error);
    return internalServerError(`Frescopa data generation failed: ${error.message}`);
  }
}

export default { run };
