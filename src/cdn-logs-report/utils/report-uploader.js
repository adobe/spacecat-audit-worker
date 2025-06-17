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

import { PutObjectCommand } from '@aws-sdk/client-s3';

async function saveExcelToS3(buffer, bucket, key, s3Client, log) {
  log.info(`Saving Excel report to S3: s3://${bucket}/${key}`);
  await s3Client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: buffer,
    ContentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ContentDisposition: `attachment; filename="${key.split('/').pop()}"`,
  }));

  log.info(`Excel report successfully uploaded to S3: s3://${bucket}/${key}`);
}

// eslint-disable-next-line no-unused-vars, @typescript-eslint/no-unused-vars
async function publishToAdminHlx(filename, log) {
  try {
    const org = 'vivesing';
    const site = 'elmo-ui-data';
    const ref = 'main';
    const path = `3-experience-success/elmo/elmo-ui-data/bulk/${filename}`;

    const publishUrl = `https://admin.hlx.page/live/${org}/${site}/${ref}/${path}`;
    log.info(`Publishing Excel report via admin API: ${publishUrl}`);

    const response = await fetch(publishUrl, {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ADMIN_HLX_API_KEY,
        'Content-Type': 'application/json',
      },
    });

    if (response.ok) {
      log.info('Excel report successfully published to admin.hlx.page');
    } else {
      log.warn(`Failed to publish via admin.hlx.page: ${response.status} ${response.statusText}`);
    }
  } catch (publishError) {
    log.error(`Failed to publish via admin.hlx.page: ${publishError.message}`);
  }
}

async function uploadToSharePoint(buffer, filename, sharepointClient, log) {
  try {
    const documentPath = `/sites/spacecat-test/test/${filename}`;
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
  bucket,
  key,
  s3Client,
  log,
  sharepointClient,
  filename,
}) {
  try {
    const buffer = await workbook.xlsx.writeBuffer();
    await saveExcelToS3(buffer, bucket, key, s3Client, log);

    if (sharepointClient) {
      await uploadToSharePoint(buffer, filename, sharepointClient, log);
      // TODO: Uncomment this when we have a proper api key and path to publish to admin.hlx.page
      // await publishToAdminHlx(filename, log);
    }
  } catch (error) {
    log.error(`Failed to save Excel report: ${error.message}`);
    throw error;
  }
}
