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
 * Also matches .xlsx files for SharePoint operations
 */
const WEEK_PATTERN = /-(w\d{2}-\d{4})\.(json|xlsx)$/;

/**
 * Minimum number of files required for sliding window operation
 */
const REQUIRED_FILE_COUNT = 5;

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
 * Calculates the target week identifier (previous week).
 * @param {Date} [date] - The date to calculate from (defaults to current date)
 * @returns {string} The target week identifier (e.g., "w02-2026")
 */
function getTargetWeekIdentifier(date = new Date()) {
  // Go back 7 days to get previous week
  const previousWeek = new Date(date);
  previousWeek.setDate(previousWeek.getDate() - 7);
  return generateWeekIdentifier(previousWeek);
}

/**
 * Gets the last N files for a given file prefix from the query index.
 * @param {Array<{ path: string, lastModified: string }>} files - Array of file entries
 * @param {string} filePrefix - The file prefix to match
 * @param {number} count - Number of most recent files to return
 * @param {object} log - Logger instance
 * @returns {Array<{ path: string, weekIdentifier: string }>} Array of most recent files
 */
function getLastNFiles(files, filePrefix, count, log) {
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
    return [];
  }

  // Sort by week identifier (most recent first)
  matchingFiles.sort((a, b) => compareWeekIdentifiers(b.weekIdentifier, a.weekIdentifier));

  // Return the last N files
  const result = matchingFiles.slice(0, count);
  log.info(
    `%s: Found ${result.length} files for "${filePrefix}" (requested ${count})`,
    AUDIT_NAME,
  );

  return result;
}

/**
 * Builds the SharePoint file path for a given file.
 * @param {string} folder - The folder name (e.g., "agentic-traffic")
 * @param {string} filePrefix - The file prefix
 * @param {string} weekIdentifier - The week identifier
 * @returns {string} The SharePoint file path
 */
function buildSharePointPath(folder, filePrefix, weekIdentifier) {
  const fileName = `${filePrefix}-${weekIdentifier}.xlsx`;
  return `/sites/elmo-ui-data/${DATA_FOLDER}/${folder}/${fileName}`;
}

/**
 * Performs the sliding window operation for a report type.
 * Takes the 5 most recent files and:
 * 1. Copies the newest file to create the target week file
 * 2. Renames each of the next 4 files to the next week number (in reverse order)
 * 3. This effectively "shifts" all files forward by one week
 *
 * @param {object} sharepointClient - The SharePoint client
 * @param {Array<{ path: string, weekIdentifier: string }>} files - The 5 files sorted newest first
 * @param {string} targetWeekId - The target week identifier to create
 * @param {object} config - The file configuration
 * @param {object} log - Logger instance
 * @returns {Promise<Array<{ fileName: string, operation: string, status: string }>>} Results
 */
async function performSlidingWindow(sharepointClient, files, targetWeekId, config, log) {
  const { destinationFolder, filePrefix } = config;
  const operations = [];

  try {
    log.info(
      `%s: Starting sliding window for ${filePrefix}, target week: ${targetWeekId}`,
      AUDIT_NAME,
    );

    // Step 1: Copy the newest file (position 0) to create target week file
    const newestFile = files[0];
    const newestPath = `/sites/elmo-ui-data${newestFile.path.replace('.json', '.xlsx')}`;
    const targetPath = buildSharePointPath(destinationFolder, filePrefix, targetWeekId);

    log.info(`%s: Copying ${newestFile.weekIdentifier} -> ${targetWeekId}`, AUDIT_NAME);
    const newestDoc = sharepointClient.getDocument(newestPath);
    await newestDoc.copy(targetPath);
    operations.push({
      fileName: `${filePrefix}-${targetWeekId}.xlsx`,
      operation: 'copy',
      status: 'success',
    });

    // Step 2: Perform moves in reverse order (oldest to newest) to avoid conflicts
    // We need to move files[4] -> files[3] week, files[3] -> files[2] week, etc.
    // Process from index 4 down to 1
    for (let i = files.length - 1; i >= 1; i -= 1) {
      const currentFile = files[i];
      const targetWeekForThisFile = files[i - 1].weekIdentifier;

      const currentPath = `/sites/elmo-ui-data${currentFile.path.replace('.json', '.xlsx')}`;
      const newPath = buildSharePointPath(destinationFolder, filePrefix, targetWeekForThisFile);

      log.info(
        `%s: Moving ${currentFile.weekIdentifier} -> ${targetWeekForThisFile}`,
        AUDIT_NAME,
      );

      const doc = sharepointClient.getDocument(currentPath);
      // eslint-disable-next-line no-await-in-loop
      await doc.move(newPath);

      operations.push({
        fileName: `${filePrefix}-${targetWeekForThisFile}.xlsx`,
        operation: 'move',
        status: 'success',
        from: currentFile.weekIdentifier,
        to: targetWeekForThisFile,
      });
    }

    log.info(`%s: Sliding window completed for ${filePrefix}`, AUDIT_NAME);
    return operations;
  } catch (error) {
    log.error(
      `%s: Error during sliding window for ${filePrefix}: ${error.message}`,
      AUDIT_NAME,
      error,
    );
    operations.push({
      fileName: `${filePrefix}-${targetWeekId}.xlsx`,
      operation: 'sliding_window',
      status: 'error',
      error: error.message,
    });
    throw error;
  }
}

/**
 * Main handler for Frescopa data generation job.
 * This job runs weekly and performs a sliding window operation:
 * - Takes the 5 most recent files for each report type
 * - Creates a new file for the target week (previous week) by copying the newest file
 * - Shifts all other files forward by one week (renames them)
 *
 * @param {object} message - The SQS message
 * @param {object} context - The execution context
 * @returns {Promise<Response>} The response
 */
async function run(message, context) {
  const { log } = context;
  const startTime = Date.now();

  // Calculate target week (previous week, or use override from auditContext)
  const targetWeekIdentifier = message.auditContext?.weekIdentifier
    || getTargetWeekIdentifier();

  log.info(
    `%s: Starting Frescopa sliding window data generation for target week ${targetWeekIdentifier}`,
    AUDIT_NAME,
  );

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

      try {
        log.info(`%s: Processing report type: ${filePrefix}`, AUDIT_NAME);

        // Get the last 5 files for this type
        const last5Files = getLastNFiles(
          queryIndexFiles,
          filePrefix,
          REQUIRED_FILE_COUNT,
          log,
        );

        // Validate we have enough files
        if (last5Files.length < REQUIRED_FILE_COUNT) {
          const errorMsg = `Insufficient files found for "${filePrefix}": `
            + `found ${last5Files.length}, required ${REQUIRED_FILE_COUNT}`;
          log.error(`%s: ${errorMsg}`, AUDIT_NAME);
          errors.push({ filePrefix, error: errorMsg });
          // eslint-disable-next-line no-continue
          continue;
        }

        // Check if the newest file matches target week (already processed)
        const newestWeek = last5Files[0].weekIdentifier;
        if (newestWeek === targetWeekIdentifier) {
          log.info(
            `%s: Target week ${targetWeekIdentifier} already exists for ${filePrefix}. Re-running sliding window.`,
            AUDIT_NAME,
          );
          // Continue with sliding window - it will replace existing files
        }

        log.info(
          `%s: Found 5 files for ${filePrefix}. Newest: ${newestWeek}, Creating: ${targetWeekIdentifier}`,
          AUDIT_NAME,
        );

        // Perform sliding window operation
        // eslint-disable-next-line no-await-in-loop
        const operations = await performSlidingWindow(
          sharepointClient,
          last5Files,
          targetWeekIdentifier,
          config,
          log,
        );

        // Publish all 5 files
        const weeksToPublish = [
          targetWeekIdentifier,
          last5Files[0].weekIdentifier,
          last5Files[1].weekIdentifier,
          last5Files[2].weekIdentifier,
          last5Files[3].weekIdentifier,
        ];

        log.info(`%s: Publishing ${weeksToPublish.length} files for ${filePrefix}`, AUDIT_NAME);

        for (const weekId of weeksToPublish) {
          const fileName = `${filePrefix}-${weekId}.xlsx`;
          const folderPath = `${DATA_FOLDER}/${destinationFolder}`;

          try {
            // eslint-disable-next-line no-await-in-loop
            await publishToAdminHlx(fileName, folderPath, log);
            log.info(`%s: Published ${fileName}`, AUDIT_NAME);
          } catch (publishError) {
            log.error(
              `%s: Failed to publish ${fileName}: ${publishError.message}`,
              AUDIT_NAME,
              publishError,
            );
            // Don't fail the whole operation if publish fails
          }
        }

        results.push({
          filePrefix,
          folder: destinationFolder,
          targetWeek: targetWeekIdentifier,
          operations,
          published: weeksToPublish,
          status: 'success',
        });
      } catch (fileError) {
        log.error(
          `%s: Error processing ${filePrefix}: ${fileError.message}`,
          AUDIT_NAME,
          fileError,
        );
        errors.push({ filePrefix, error: fileError.message });
      }
    }

    const duration = Date.now() - startTime;
    const successCount = results.filter((r) => r.status === 'success').length;

    log.info(
      `%s: Frescopa sliding window completed for target week ${targetWeekIdentifier} in ${duration}ms. `
      + `Success: ${successCount}, Errors: ${errors.length}`,
      AUDIT_NAME,
    );

    return ok({
      targetWeekIdentifier,
      results,
      errors,
      duration,
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    log.error(
      `%s: Failed to generate Frescopa data for target week ${targetWeekIdentifier} after ${duration}ms`,
      AUDIT_NAME,
      error,
    );
    return internalServerError(`Frescopa data generation failed: ${error.message}`);
  }
}

export default { run };
