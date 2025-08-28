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
 * @returns {Promise<SharepointClient>}
 */
export function createLLMOSharepointClient({ env, log }) {
  return helixContentSDK.createFrom(
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
 * @param {string} fileLocation - The path to the document in SharePoint
 * @param {SharepointClient} sharepointClient - The SharePoint client instance
 * @param {Pick<Console, 'debug' | 'info' | 'warn' | 'error'>} log - Logger instance
 * @returns {Promise<Buffer>} - The document content as a buffer
 */
export async function readFromSharePoint(filename, outputLocation, sharepointClient, log) {
  try {
    const documentPath = `/sites/elmo-ui-data/${outputLocation}/${filename}`;
    console.log('reading from sharepoint', documentPath);
    const sharepointDoc = sharepointClient.getDocument(documentPath);
    const buffer = await sharepointDoc.downloadRawDocument();
    log.info(`Document successfully downloaded from SharePoint: ${documentPath}`);
    return buffer;
  } catch (error) {
    log.error(`Failed to read from SharePoint: ${error.message}`);
    throw error;
  }
}

async function publishToAdminHlx(filename, outputLocation, log) {
  try {
    const org = 'adobe';
    const site = 'project-elmo-ui-data';
    const ref = 'main';
    const jsonFilename = `${filename.replace(/\.[^/.]+$/, '')}.json`;
    const path = `${outputLocation}/${jsonFilename}`;
    const headers = { Cookie: `auth_token=${process.env.ADMIN_HLX_API_KEY}` };

    const baseUrl = 'https://admin.hlx.page';
    const endpoints = [
      { name: 'preview', url: `${baseUrl}/preview/${org}/${site}/${ref}/${path}` },
      { name: 'live', url: `${baseUrl}/live/${org}/${site}/${ref}/${path}` },
    ];

    for (const [index, endpoint] of endpoints.entries()) {
      log.info(`Publishing Excel report via admin API (${endpoint.name}): ${endpoint.url}`);

      // eslint-disable-next-line no-await-in-loop
      const response = await fetch(endpoint.url, { method: 'POST', headers });

      if (!response.ok) {
        throw new Error(`${endpoint.name} failed: ${response.status} ${response.statusText}`);
      }

      log.info(`Excel report successfully published to ${endpoint.name}`);

      if (index === 0) {
        log.info('Waiting 2 seconds before publishing to live...');
        // eslint-disable-next-line no-await-in-loop
        await sleep(2000);
      }
    }
  } catch (publishError) {
    log.error(`Failed to publish via admin.hlx.page: ${publishError.message}`);
  }
}

export async function uploadToSharePoint(buffer, filename, outputLocation, sharepointClient, log) {
  try {
    const documentPath = `/sites/elmo-ui-data/${outputLocation}/${filename}`;
    const sharepointDoc = sharepointClient.getDocument(documentPath);
    await sharepointDoc.uploadRawDocument(buffer);
    log.info(`Excel report successfully uploaded to SharePoint: ${documentPath}`);
  } catch (error) {
    log.error(`Failed to upload to SharePoint: ${error.message}`);
    throw error;
  }
}

export async function uploadAndPublishFile(
  buffer,
  filename,
  outputLocation,
  sharepointClient,
  log,
) {
  await uploadToSharePoint(buffer, filename, outputLocation, sharepointClient, log);
  await publishToAdminHlx(filename, outputLocation, log);
}

export async function saveExcelReport({
  workbook,
  outputLocation,
  log,
  sharepointClient,
  filename,
}) {
  try {
    const buffer = await workbook.xlsx.writeBuffer();
    if (sharepointClient) {
      await uploadAndPublishFile(buffer, filename, outputLocation, sharepointClient, log);
    }
  } catch (error) {
    log.error(`Failed to save Excel report: ${error.message}`);
    throw error;
  }
}
