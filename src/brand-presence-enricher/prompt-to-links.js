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

import { ContentAIClient } from '../utils/content-ai.js';

/**
 * Gets the URLs by prompt from Content AI
 * @param {string} prompt - The prompt to search
 * @param {Object} site - The site object
 * @param {Object} context - The context object
 * @returns {Promise<string[]>} The URLs
 */
export async function promptToLinks(prompt, site, context) {
  const contentAIClient = new ContentAIClient(context);
  await contentAIClient.initialize();
  const response = await contentAIClient.runGenerativeSearch(prompt, site);
  if (response.status !== 200) {
    throw new Error(`Error calling API - ${response.statusText}`);
  }
  const data = await response.json();
  return data.data.urls;
}
