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
import { ParquetWriter, ParquetSchema } from '@dsnp/parquetjs';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

/**
 * Save analysis data to S3 in Parquet format
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

  let tempFileName;
  try {
    // Use UTC methods since S3 paths should be in UTC to match CDN log structure
    const year = hourProcessed.getUTCFullYear();
    const month = String(hourProcessed.getUTCMonth() + 1).padStart(2, '0');
    const day = String(hourProcessed.getUTCDate()).padStart(2, '0');
    const hour = String(hourProcessed.getUTCHours()).padStart(2, '0');

    // S3 key with customer-aware partitioning
    const customerPrefix = customerDomain ? `customer=${customerDomain}/` : '';

    // Prepare metadata
    const metadata = {
      analysisType,
      customerDomain,
      hourProcessed: hourProcessed.toISOString(),
      recordCount: Array.isArray(data) ? data.length : 0,
      generatedAt: new Date().toISOString(),
    };

    // Define Parquet schema optimized for Athena performance
    const schema = new ParquetSchema({
      analysis_type: { type: 'UTF8' },
      customer_domain: { type: 'UTF8' },
      hour_processed: { type: 'TIMESTAMP_MILLIS' },
      generated_at: { type: 'TIMESTAMP_MILLIS' },
      record_index: { type: 'INT32' },
      // Flatten common fields for fast filtering
      total_requests: { type: 'INT64', optional: true },
      success_rate: { type: 'DOUBLE', optional: true },
      agentic_requests: { type: 'INT64', optional: true },
      geo_country: { type: 'UTF8', optional: true },
      response_status: { type: 'INT64', optional: true }, // Changed from INT32 to INT64 for safety
      request_user_agent: { type: 'UTF8', optional: true },
      referer: { type: 'UTF8', optional: true },
      // Store complex data as UTF8 for flexibility
      additional_data: { type: 'UTF8', optional: true },
    });

    // Save as Parquet (optimized for Athena performance)
    const parquetKey = `${basePrefix}/${customerPrefix}year=${year}/month=${month}/day=${day}/hour=${hour}/${analysisType}.parquet`;

    // Create a temporary file to write parquet data
    tempFileName = join(tmpdir(), `parquet-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.parquet`);

    // Create ParquetWriter that writes to a temporary file
    const writer = await ParquetWriter.openFile(schema, tempFileName);

    // Helper function to safely convert BigInt to number for Parquet
    const safeToNumber = (value) => {
      if (value === null || value === undefined) return null;
      if (typeof value === 'bigint') {
        // For BigInt values, convert to number if within safe range
        // Parquet INT64 can handle values up to 2^63-1
        const num = Number(value);
        if (Number.isSafeInteger(num)) {
          return num;
        } else {
          // If BigInt is too large for safe conversion, clamp to safe integer range
          // This prevents precision loss while keeping it as a number
          return value > 0 ? Number.MAX_SAFE_INTEGER : Number.MIN_SAFE_INTEGER;
        }
      }
      if (typeof value === 'number') return value;
      if (typeof value === 'string' && !Number.isNaN(Number(value)) && value !== '') {
        const num = Number(value);
        return Number.isSafeInteger(num) ? num : null;
      }
      return null;
    };

    // Flatten data for Parquet - each data row becomes a separate record
    if (Array.isArray(data) && data.length > 0) {
      // Process all records in parallel to avoid await-in-loop
      const recordPromises = data.map((dataRow, index) => {
        const record = {
          analysis_type: metadata.analysisType,
          customer_domain: metadata.customerDomain,
          hour_processed: new Date(metadata.hourProcessed),
          generated_at: new Date(metadata.generatedAt),
          record_index: index,
          // Flatten common fields for fast filtering - convert BigInt to number
          total_requests: safeToNumber(dataRow.total_requests) || null,
          success_rate: dataRow.success_rate || null,
          agentic_requests: safeToNumber(dataRow.agentic_requests) || null,
          geo_country: dataRow.geo_country || null,
          response_status: safeToNumber(dataRow.response_status) || null,
          request_user_agent: dataRow.request_user_agent || null,
          referer: dataRow.referer || null,
          // Store complex data as string for queries that need full data
          additional_data: dataRow.total_requests ? null : JSON.stringify(dataRow),
        };

        return writer.appendRow(record);
      });

      await Promise.all(recordPromises);
    } else {
      // Even if no data, create one record for metadata
      const record = {
        analysis_type: metadata.analysisType,
        customer_domain: metadata.customerDomain,
        hour_processed: new Date(metadata.hourProcessed),
        generated_at: new Date(metadata.generatedAt),
        record_index: 0,
        total_requests: null,
        success_rate: null,
        agentic_requests: null,
        geo_country: null,
        response_status: null,
        request_user_agent: null,
        referer: null,
        additional_data: '{}',
      };

      await writer.appendRow(record);
    }

    // Close the writer to finalize the Parquet file
    await writer.close();

    // Read the parquet file into a buffer
    const parquetBuffer = await fs.readFile(tempFileName);

    // Clean up the temporary file
    await fs.unlink(tempFileName).catch(() => { }); // Ignore errors if file doesn't exist

    const putParquetCommand = new PutObjectCommand({
      Bucket: bucket,
      Key: parquetKey,
      Body: parquetBuffer,
      ContentType: 'application/octet-stream',
      Metadata: {
        analysisType,
        customerDomain,
        hour,
        recordCount: String(Array.isArray(data) ? data.length : 1),
        format: 'parquet',
      },
    });

    await s3Client.send(putParquetCommand);
    log.info(`Saved ${analysisType} as Parquet to s3://${bucket}/${parquetKey} (${Array.isArray(data) ? data.length : 1} records)`);

    return parquetKey;
  } catch (error) {
    // Clean up temporary file if it exists
    if (tempFileName) {
      await fs.unlink(tempFileName).catch(() => { }); // Ignore errors if file doesn't exist
    }
    log.error(`Failed to save ${analysisType} analysis to S3:`, error);
    throw error;
  }
}
/* c8 ignore stop */
