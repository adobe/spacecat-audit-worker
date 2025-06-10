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
import { PutObjectCommand } from '@aws-sdk/client-s3';

/**
 * Save analysis data as Parquet to S3
 * For now, we'll save as JSON but structured for easy migration to Parquet
 */
export async function saveToS3AsParquet(options) {
  const {
    analysisType,
    data,
    hourProcessed,
    bucket,
    basePrefix = 'cdn-analysis',
    log,
    customerDomain = 'unknown',
    s3Client,
  } = options;

  try {
    const year = hourProcessed.getFullYear();
    const month = String(hourProcessed.getMonth() + 1).padStart(2, '0');
    const day = String(hourProcessed.getDate()).padStart(2, '0');
    const hour = String(hourProcessed.getHours()).padStart(2, '0');

    // S3 key with customer-aware partitioning
    const customerPrefix = customerDomain ? `customer=${customerDomain}/` : '';
    const s3Key = `${basePrefix}/${customerPrefix}year=${year}/month=${month}/day=${day}/hour=${hour}/${analysisType}.json`;

    // Prepare data for storage
    const outputData = {
      metadata: {
        analysisType,
        customerDomain,
        hourProcessed: hourProcessed.toISOString(),
        recordCount: Array.isArray(data) ? data.length : 0,
        generatedAt: new Date().toISOString(),
      },
      data: data || [],
    };

    // Save to S3
    const putCommand = new PutObjectCommand({
      Bucket: bucket,
      Key: s3Key,
      Body: JSON.stringify(outputData, null, 2),
      ContentType: 'application/json',
      Metadata: {
        analysisType,
        customerDomain,
        hour,
        recordCount: String(outputData.recordCount),
      },
    });

    await s3Client.send(putCommand);

    log.info(`Saved ${analysisType} analysis for ${customerDomain} to s3://${bucket}/${s3Key} (${outputData.recordCount} records)`);

    return s3Key;
  } catch (error) {
    log.error(`Failed to save ${analysisType} analysis to S3:`, error);
    throw error;
  }
}
/* c8 ignore stop */
