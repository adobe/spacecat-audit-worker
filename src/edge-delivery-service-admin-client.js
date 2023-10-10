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
const BASE_URL = 'https://www.hlx.live/';
/**
 * Retrieve the status of the admin endpoint.
 * @returns {Promise<string>} - The lastModification property.
 * @throws {Error} - Throws an error if there's a network issue or some other error while fetching data.
 */
function EdgeDeliveryServiceAdminClient() {
  const getLastModification = async () => {
    try {
      const response = await fetch(`${BASE_URL}docs/status.json`);
      if (!response.ok) {
        throw new Error(`Failed to fetch status: ${response.statusText}`);
      }
      const data = await response.json();
      if (!data || !data.lastModification) {
        throw new Error('lastModification property not found in response data');
      }
      return data.lastModification;
    } catch (error) {
      console.error('Error fetching lastModification:', error);
      throw error;
    }
  };
}

module.exports = EdgeDeliveryServiceAdminClient;
