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
import * as helixContentSDK from '@adobe/spacecat-helix-content-sdk';

import { sleep } from '../support/utils.js';

const SHAREPOINT_URL = 'https://adobe.sharepoint.com/:x:/r/sites/HelixProjects/Shared%20Documents/sites/elmo-ui-data';
const AUDIT_NAME = 'REPORT_UPLOADER';

/**
 * @import { SharepointClient } from '@adobe/spacecat-helix-content-sdk/src/sharepoint/client.js'
 */

/* c8 ignore start */
/**
 * @param {object} context
 * @param {object} context.env - Environment configuration object
 * @param {string} context.env.SHAREPOINT_CLIENT_ID - SharePoint client ID
 * @param {string} context.env.SHAREPOINT_CLIENT_SECRET - SharePoint client secret
 * @param {string} context.env.SHAREPOINT_AUTHORITY - SharePoint authority URL
 * @param {string} context.env.SHAREPOINT_DOMAIN_ID - SharePoint domain ID
 * @param {Pick<Console, 'debug' | 'info' | 'warn' | 'error'>} context.log - Logger instance
 * @param {object} [options] - Options for testing
 * @param {object} [options.helixContentSDK] - Custom helix content SDK for testing
 * @returns {Promise<SharepointClient>}
 */
export function createLLMOSharepointClient({ env, log }, options = {}) {
  const sdk = options.helixContentSDK || helixContentSDK;

  return sdk.createFrom(
    {
      clientId: env.SHAREPOINT_CLIENT_ID,
      clientSecret: env.SHAREPOINT_CLIENT_SECRET,
      authority: env.SHAREPOINT_AUTHORITY,
      domainId: env.SHAREPOINT_DOMAIN_ID,
    },
    { url: SHAREPOINT_URL, type: 'onedrive' },
    log,
  );
}
/* c8 ignore end */

/**
 * Downloads a document from SharePoint and returns its raw buffer
 * @param {string} filename - The path to the document in SharePoint
 * @param {SharepointClient} sharepointClient - The SharePoint client instance
 * @param {Pick<Console, 'debug' | 'info' | 'warn' | 'error'>} log - Logger instance
 * @returns {Promise<Buffer>} - The document content as a buffer
 */
export async function readFromSharePoint(filename, outputLocation, sharepointClient, log) {
  const documentPath = `/sites/elmo-ui-data/${outputLocation}/${filename}`;

  try {
    log.info(`%s: SharePoint download starting: ${documentPath}`, AUDIT_NAME);
    const startTime = Date.now();

    const sharepointDoc = sharepointClient.getDocument(documentPath);
    const buffer = await sharepointDoc.getDocumentContent();

    const duration = Date.now() - startTime;
    const fileSize = buffer.byteLength || buffer.length;
    log.info(`%s: SharePoint download successful: ${documentPath} (${fileSize} bytes in ${duration}ms)`, AUDIT_NAME);

    return buffer;
  } catch (error) {
    log.error(`%s: SharePoint download failed: ${documentPath}`, AUDIT_NAME, {
      filename,
      outputLocation,
      error: error.message,
      stack: error.stack,
      errorCode: error.code || 'UNKNOWN',
    });
    throw error;
  }
}

export async function publishToAdminHlx(filename, outputLocation, log) {
  const org = 'adobe';
  const site = 'project-elmo-ui-data';
  const ref = 'main';
  const jsonFilename = `${filename.replace(/\.[^/.]+$/, '')}.json`;
  const path = `${outputLocation}/${jsonFilename}`;

  try {
    log.info(`%s: Publishing to admin.hlx.page: ${path}`, AUDIT_NAME);
    const startTime = Date.now();

    const headers = { Cookie: `auth_token=${process.env.ADMIN_HLX_API_KEY}` };
    const baseUrl = 'https://admin.hlx.page';
    const endpoints = [
      { name: 'preview', url: `${baseUrl}/preview/${org}/${site}/${ref}/${path}` },
      { name: 'live', url: `${baseUrl}/live/${org}/${site}/${ref}/${path}` },
    ];

    for (const [index, endpoint] of endpoints.entries()) {
      log.info(`%s: Publishing to ${endpoint.name}: ${endpoint.url}`, AUDIT_NAME);
      const endpointStartTime = Date.now();

      // eslint-disable-next-line no-await-in-loop
      const response = await fetch(endpoint.url, { method: 'POST', headers });

      if (!response.ok) {
        const errorMsg = `${endpoint.name} failed: ${response.status} ${response.statusText}`;
        log.error(`%s: Publish to ${endpoint.name} failed`, AUDIT_NAME, {
          url: endpoint.url,
          status: response.status,
          statusText: response.statusText,
          path,
        });
        throw new Error(errorMsg);
      }

      const endpointDuration = Date.now() - endpointStartTime;
      log.info(`%s: Successfully published to ${endpoint.name} in ${endpointDuration}ms`, AUDIT_NAME);

      if (index === 0) {
        log.debug('%s: Waiting 2 seconds before publishing to live...', AUDIT_NAME);
        // eslint-disable-next-line no-await-in-loop
        await sleep(2000);
      }
    }

    const totalDuration = Date.now() - startTime;
    log.info(`%s: Successfully published ${path} to both preview and live in ${totalDuration}ms`, AUDIT_NAME);
  } catch (publishError) {
    log.error(`%s: Failed to publish via admin.hlx.page: ${path}`, AUDIT_NAME, {
      filename,
      outputLocation,
      error: publishError.message,
      stack: publishError.stack,
    });
  }
}

/**
 * @param {ArrayBuffer} buffer
 * @param {string} filename
 * @param {string} outputLocation
 * @param {SharepointClient} sharepointClient
 * @param {Pick<Console, 'debug' | 'info' | 'warn' | 'error'>} log
 */
export async function uploadToSharePoint(buffer, filename, outputLocation, sharepointClient, log) {
  const documentPath = `/sites/elmo-ui-data/${outputLocation}/${filename}`;
  const fileSize = buffer.byteLength || buffer.length;

  try {
    log.info(`%s: SharePoint upload starting: ${documentPath} (${fileSize} bytes)`, AUDIT_NAME);
    const startTime = Date.now();

    const sharepointDoc = sharepointClient.getDocument(documentPath);
    await sharepointDoc.uploadRawDocument(buffer);

    const duration = Date.now() - startTime;
    log.info(`%s: SharePoint upload successful: ${documentPath} (${fileSize} bytes in ${duration}ms)`, AUDIT_NAME);
  } catch (error) {
    log.error(`%s: SharePoint upload failed: ${documentPath}`, AUDIT_NAME, {
      filename,
      outputLocation,
      fileSize,
      error: error.message,
      stack: error.stack,
      errorCode: error.code || 'UNKNOWN',
    });
    throw error;
  }
}

/**
 * Uploads a file to SharePoint and publishes it via the admin.hlx.page API
 * @param {ArrayBuffer} buffer - The file content as a buffer
 * @param {string} filename - The name of the file to upload
 * @param {string} outputLocation - The SharePoint folder path where the file will be uploaded
 * @param {SharepointClient} sharepointClient - The SharePoint client instance
 * @param {Pick<Console, 'debug' | 'info' | 'warn' | 'error'>} log - Logger instance
 */
export async function uploadAndPublishFile(
  buffer,
  filename,
  outputLocation,
  sharepointClient,
  log,
) {
  const fileSize = buffer.byteLength || buffer.length;
  log.info(`%s: Starting upload and publish workflow for ${filename} to ${outputLocation} (${fileSize} bytes)`, AUDIT_NAME);
  const startTime = Date.now();

  try {
    await uploadToSharePoint(buffer, filename, outputLocation, sharepointClient, log);
    await publishToAdminHlx(filename, outputLocation, log);

    const duration = Date.now() - startTime;
    log.info(`%s: Upload and publish workflow completed for ${filename} in ${duration}ms`, AUDIT_NAME);
  } catch (error) {
    const duration = Date.now() - startTime;
    log.error(`%s: Upload and publish workflow failed for ${filename} after ${duration}ms`, AUDIT_NAME, {
      filename,
      outputLocation,
      fileSize,
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

export async function saveExcelReport({
  workbook,
  outputLocation,
  log,
  sharepointClient,
  filename,
}) {
  try {
    log.info(`%s: Generating Excel buffer for ${filename}`, AUDIT_NAME);
    const bufferStartTime = Date.now();
    const buffer = await workbook.xlsx.writeBuffer();
    const bufferDuration = Date.now() - bufferStartTime;
    const fileSize = buffer.byteLength || buffer.length;

    log.info(`%s: Excel buffer generated for ${filename} (${fileSize} bytes in ${bufferDuration}ms)`, AUDIT_NAME);

    if (sharepointClient) {
      await uploadAndPublishFile(buffer, filename, outputLocation, sharepointClient, log);
    } else {
      log.warn(`%s: No SharePoint client provided for ${filename}, skipping upload`, AUDIT_NAME);
    }
  } catch (error) {
    log.error(`%s: Failed to save Excel report: ${filename}`, AUDIT_NAME, {
      filename,
      outputLocation,
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
}
