/*
 * Copyright 2026 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

import { parquetWriteBuffer } from 'hyparquet-writer';
import { PutObjectCommand } from '@aws-sdk/client-s3';

/**
 * Maps DRS prompt fields to the llmo-prompts-ahrefs parquet schema.
 *
 * DRS fields: prompt, region, category, topic, base_url
 * Parquet schema: prompt, region, category, topic, url, keyword,
 *                 keywordImportTime, volume, volumeImportTime, source
 *
 * @param {Array<object>} drsPrompts - Raw prompts from DRS
 * @returns {Array<object>} Prompts mapped to parquet schema
 */
export function mapDrsPromptsToSchema(drsPrompts) {
  const now = Date.now();
  return drsPrompts.map((p) => ({
    prompt: p.prompt || '',
    region: p.region || '',
    category: p.category || '',
    topic: p.topic || '',
    url: p.base_url || '',
    keyword: '',
    keywordImportTime: now,
    volume: 0,
    volumeImportTime: now,
    source: 'drs',
  }));
}

/**
 * Converts row-based objects to column-based format for hyparquet-writer.
 *
 * @param {Array<object>} objects - Array of row objects
 * @returns {Array<object>} Column definitions with name, type, data
 */
/* c8 ignore start */
function objectsToColumnData(objects) {
  if (!objects || objects.length === 0) {
    return [];
  }

  const keys = Object.keys(objects[0]);
  const columnData = {};

  keys.forEach((key) => {
    const sampleValue = objects[0][key];
    let type = 'STRING';

    if (typeof sampleValue === 'number') {
      type = Number.isInteger(sampleValue) ? 'INT32' : 'DOUBLE';
    }

    columnData[key] = {
      data: [],
      name: key,
      type,
    };
  });

  objects.forEach((obj) => {
    keys.forEach((key) => {
      columnData[key].data.push(obj[key]);
    });
  });

  return Object.values(columnData);
  /* c8 ignore end */
}

/**
 * Writes DRS prompts as both JSON and parquet to S3.
 *
 * JSON path:    metrics/{siteId}/llmo-prompts-drs/date={date}/job={jobId}/data.json
 * Parquet path: metrics/{siteId}/llmo-prompts-drs/date={date}/job={jobId}/data.parquet
 *
 * @param {object} params
 * @param {Array<object>} params.drsPrompts - Raw prompts from DRS
 * @param {string} params.siteId - Site identifier
 * @param {string} params.jobId - DRS job identifier
 * @param {string} params.bucket - S3 bucket name
 * @param {import('@aws-sdk/client-s3').S3Client} params.s3Client - AWS S3 client
 * @param {object} params.log - Logger instance
 * @returns {Promise<{jsonKey: string, parquetKey: string}>}
 */
export async function writeDrsPromptsToS3({
  drsPrompts,
  siteId,
  jobId,
  bucket,
  s3Client,
  log,
}) {
  const dateStr = new Date().toISOString().split('T')[0];
  const basePath = `metrics/${siteId}/llmo-prompts-drs/date=${dateStr}/job=${jobId}`;
  const jsonKey = `${basePath}/data.json`;
  const parquetKey = `${basePath}/data.parquet`;

  // Write JSON
  log.info(`Writing ${drsPrompts.length} DRS prompts as JSON to ${jsonKey}`);
  await s3Client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: jsonKey,
    Body: JSON.stringify(drsPrompts),
    ContentType: 'application/json',
  }));

  // Map to parquet schema and write parquet
  const mappedPrompts = mapDrsPromptsToSchema(drsPrompts);
  const columnData = objectsToColumnData(mappedPrompts);

  if (columnData.length > 0) {
    log.info(`Writing ${mappedPrompts.length} DRS prompts as parquet to ${parquetKey}`);
    const parquetBuffer = parquetWriteBuffer({ columnData });
    await s3Client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: parquetKey,
      Body: parquetBuffer,
      ContentType: 'application/octet-stream',
    }));
  } else {
    log.warn('No prompts to write to parquet — skipping parquet file');
  }

  return { jsonKey, parquetKey };
}
