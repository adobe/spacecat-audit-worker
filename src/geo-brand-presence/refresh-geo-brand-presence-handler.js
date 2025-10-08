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

import { ok } from '@adobe/spacecat-shared-http-utils';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import ExcelJS from 'exceljs';
import { createLLMOSharepointClient, readFromSharePoint } from '../utils/report-uploader.js';

const AUDIT_NAME = 'REFRESH GEO BRAND PRESENCE';
/* c8 ignore start */

/**
 * Fetches the list of paths from the query-index SharePoint file
 * @param {Object} site - The site object to get LLMO data folder from
 * @param {Object} context - The context object containing env and log
 * @returns {Promise<Array>} Array of path strings
 */
async function fetchQueryIndexPaths(site, context) {
  const { log } = context;
  let errorMsg;
  try {
    // Get the SharePoint client
    const sharepointClient = await createLLMOSharepointClient(context);

    // Get the site's LLMO data folder
    const dataFolder = site.getConfig()?.getLlmoDataFolder?.();
    if (!dataFolder) {
      errorMsg = AUDIT_NAME + `:No LLMO data folder configured for site can't proceed with audit`;
      throw new Error(errorMsg);
    }

    log.info(`%s:Reading query-index from SharePoint: ${dataFolder}/query-index.xlsx`, AUDIT_NAME);

    // Read the query-index.xlsx file from SharePoint
    const queryIndexBuffer = await readFromSharePoint('query-index.xlsx', dataFolder, sharepointClient, log);

    // Parse the Excel file to extract paths
    const workbook = new ExcelJS.Workbook();
    // @ts-ignore - Buffer type compatibility issue with ExcelJS
    await workbook.xlsx.load(queryIndexBuffer);

    const latestPaths = [];
    const regularPaths = [];

    // Iterate through all worksheets to find path data
    workbook.worksheets.forEach((worksheet) => {
      worksheet.eachRow((row, rowNumber) => {
        // Skip header row
        if (rowNumber === 1) return;

        // Look for path-like data in the first column or any column that contains path information
        row.eachCell((cell, colNumber) => {
          const cellValue = cell.value;
          if (cellValue && typeof cellValue === 'string') {
            // Check for brand-presence/latest/ first (priority)
            if (cellValue.includes('/brand-presence/latest/')) {
              const filename = cellValue.split('/').pop();
              if (filename) {
                // Remove .json extension
                const filenameWithoutExt = filename.replace(/\.json$/i, '');
                if (!latestPaths.includes(filenameWithoutExt)) {
                  latestPaths.push(filenameWithoutExt);
                }
              }
            }
            // Then check for regular brand-presence/ (fallback)
            else if (cellValue.includes('/brand-presence/') && !cellValue.includes('/brand-presence/latest/')) {
              const filename = cellValue.split('/').pop();
              if (filename) {
                // Remove .json extension
                const filenameWithoutExt = filename.replace(/\.json$/i, '');
                if (!regularPaths.includes(filenameWithoutExt)) {
                  regularPaths.push(filenameWithoutExt);
                }
              }
            }
          }
        });
      });
    });

    // Use latest paths if available, otherwise fall back to regular paths
    const paths = latestPaths.length > 0 ? latestPaths : regularPaths;
    const sourceFolder = latestPaths.length > 0 ? 'brand-presence/latest' : 'brand-presence';
    //@todo need to make  sure that we load data starting week
    log.info(`Using files from ${sourceFolder} folder`);
    log.info(`paths found: ${paths.join(', ')}`);
    if (paths.length > 0) {
      log.info(`%s:Extracted ${paths.length} paths from query-index SharePoint file (source: ${sourceFolder})`, AUDIT_NAME);
      return paths;
    }

    throw new Error('REFRESH GEO BRAND PRESENCE: No paths found in query-index file');

  } catch (error) {
    log.error(`Failed to read query-index from SharePoint: ${error instanceof Error ? error.message : String(error)}`);
    // Fall back to mock data if SharePoint access fails
    return getFallbackPaths();
  }
}

/**
 * Returns fallback paths when SharePoint access fails
 * @returns {Array} Array of fallback path strings
 */
function getFallbackPaths() {
  return [
    'brandpresence-all-w35-2025',
    'brandpresence-all-w36-2025',
    'brandpresence-all-w37-2025',
    'brandpresence-all-w38-2025',
    'brandpresence-all-w39-2025',
    'brandpresence-all-w40-2025',
    'brandpresence-all-w41-2025',
    'brandpresence-all-w42-2025',
  ];
}

export async function refreshGeoBrandPresenceSheetsHandler(message, context) {
  const { log, dataAccess } = context;
  const {Site } = dataAccess;
  const { siteId, auditContext } = message;

  const site = await Site.findById(siteId);
  log.info('site was loaded', site);
  // fetch sheets that need to be refreshed from SharePoint
  const sheets = await fetchQueryIndexPaths(site, context);

  // save metadata for S3 to track progress

  // const audit = await createAudit({
  //   // audit data goes here
  // }, context);

  // Create S3 folder for audit tracking
  const { s3Client, env } = context;
  const bucketName = env?.S3_IMPORTER_BUCKET_NAME;

  if (bucketName && s3Client) {
    // const auditId = audit.getId();
    const auditId = 'test_ira2';
    const folderKey = `refresh_geo_brand_presence/${auditId}/metadata.json`;

    try {
      // Create a metadata file to establish the folder structure
      const files = sheets.map((sheetName) => ({
        file_name: `${sheetName}.xlsx`,
        status: 'pending',
        last_updated: null,
      }));

      const metadata = {
        audit_id: auditId,
        created_at: new Date().toISOString(),
        status: 'in_progress',
        files,
        summary: {
          total_files: files.length,
          completed: 0,
          pending: files.length,
          failed: 0,
        },
      };

      await s3Client.send(new PutObjectCommand({
        Bucket: bucketName,
        Key: folderKey,
        Body: JSON.stringify(metadata, null, 2),
        ContentType: 'application/json',
      }));

      log.info('Created S3 folder for audit %s at s3://%s/%s', auditId, bucketName, folderKey);
    } catch (error) {
      log.error('Failed to create S3 folder for audit %s: %s', auditId, error instanceof Error ? error.message : String(error));
    }
  } else {
    log.warn('S3 bucket name or client not available, skipping folder creation');
  }

  log.info('Site: %s, Audit: %s, Context:', site, {}, auditContext);

  return ok();
}
