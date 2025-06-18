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
export function extractCustomerDomain(site) {
  const { host } = new URL(site.getBaseURL());
  return {
    host,
    hostEscaped: host.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase(),
  };
}

/**
 * Formats raw logs bucket name
 */
export function getRawLogsBucket(customerDomain) {
  return `cdn-logs-${customerDomain.replace(/[._]/g, '-')}`;
}
/* c8 ignore stop */
