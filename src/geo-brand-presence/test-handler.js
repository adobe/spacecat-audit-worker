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

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
} from 'fs';
import path from 'path';
import { getSuggestionValue } from './guidance-geo-brand-presence-handler.js';

const jsonData = JSON.parse(readFileSync('./src/geo-brand-presence/mounjaro.json', 'utf8'));
const { suggestions } = jsonData;

const result = getSuggestionValue(suggestions, 'guidance:geo-faq');

const outputDir = './src/geo-brand-presence/output';
if (!existsSync(outputDir)) {
  mkdirSync(outputDir, { recursive: true });
}

// Write result to markdown file
const outputPath = path.join(outputDir, 'mounjaro-faq-format-result.md');
writeFileSync(outputPath, result, 'utf8');
console.log(`Result saved to: ${outputPath}`);
