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

const DEFAULT_SPLUNK_CLIENT_MODULE = '@adobe/spacecat-shared-splunk-client';
const SPLUNK_CLIENT_MODULE_ENV = 'SPACECAT_SPLUNK_CLIENT_MODULE';

export async function loadSplunkClientClass() {
  const moduleName = process.env[SPLUNK_CLIENT_MODULE_ENV] || DEFAULT_SPLUNK_CLIENT_MODULE;
  try {
    const module = await import(moduleName);
    return module.default;
  } catch (error) {
    throw new Error(`Failed to load Splunk client module (${moduleName}): ${error.message}`);
  }
}

export async function createSplunkClient(context) {
  const SplunkAPIClient = await loadSplunkClientClass();
  return SplunkAPIClient.createFrom(context);
}
