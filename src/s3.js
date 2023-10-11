/*
 * Copyright 2023 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */
import AWS from 'aws-sdk';
import { log } from 'util';

const s3 = new AWS.S3();

function S3(config) {
  const { region, accessKeyId, secretAccessKey } = config;
  AWS.config.update({ region, accessKeyId, secretAccessKey });

  async function putObjectToS3(key, data) {
    const params = {
      Bucket: config.BUCKET_NAME,
      Key: key,
      Body: JSON.stringify(data),
      ContentType: 'application/json',
    };

    try {
      await s3.putObject(params).promise();
      log('info', `Data saved to S3 with key: ${key}`);
    } catch (error) {
      log('error', 'Error saving data to S3: ', error);
    }
  }
}

export { S3 };
