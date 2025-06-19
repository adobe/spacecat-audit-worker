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
/* c8 ignore start */
import { sleep } from '../../support/utils.js';

async function publishToAdminHlx(filename, customerName, log) {
  try {
    const org = 'adobe';
    const site = 'project-elmo-ui-data';
    const ref = 'main';
    const jsonFilename = `${filename.replace(/\.[^/.]+$/, '')}.json`;
    const path = `${customerName}/${jsonFilename}`;
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

async function uploadToSharePoint(buffer, filename, customerName, sharepointClient, log) {
  try {
    const documentPath = `/sites/elmo-ui-data/${customerName}/${filename}`;
    const sharepointDoc = sharepointClient.getDocument(documentPath);
    await sharepointDoc.uploadRawDocument(buffer);
    log.info(`Excel report successfully uploaded to SharePoint: ${documentPath}`);
  } catch (error) {
    log.error(`Failed to upload to SharePoint: ${error.message}`);
    throw error;
  }
}

export async function saveExcelReport({
  workbook,
  customerName,
  log,
  sharepointClient,
  filename,
}) {
  try {
    const buffer = await workbook.xlsx.writeBuffer();
    if (sharepointClient) {
      await uploadToSharePoint(buffer, filename, customerName, sharepointClient, log);
      await publishToAdminHlx(filename, customerName, log);
    }
  } catch (error) {
    log.error(`Failed to save Excel report: ${error.message}`);
    throw error;
  }
}

/* c8 ignore end */
