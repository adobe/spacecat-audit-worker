/*
 * Copyright 2024 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

import { S3Client } from '@aws-sdk/client-s3';

/**
 * Adds an S3Client instance to the context.
 *
 * @returns {function(object, UniversalContext): Promise<Response>}
 */
export function s3Client(fn) {
  return async (request, context) => {
    if (!context.s3Client) {
      context.s3Client = new S3Client();
    }
    return fn(request, context);
  };
}
