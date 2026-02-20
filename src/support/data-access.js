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

import dataAccessV2 from '@adobe/spacecat-shared-data-access-v2';
import dataAccessV3 from '@adobe/spacecat-shared-data-access';

/* c8 ignore start */
export default function dataAccess(fn) {
  return async (request, context) => {
    const { env } = context;
    if (env.DATA_SERVICE_PROVIDER === 'postgres') {
      if (!env.POSTGREST_URL) {
        throw new Error(
          'DATA_SERVICE_PROVIDER is set to "postgres" but POSTGREST_URL is not configured',
        );
      }
      return dataAccessV3(fn)(request, context);
    }
    return dataAccessV2(fn)(request, context);
  };
}
/* c8 ignore stop */
