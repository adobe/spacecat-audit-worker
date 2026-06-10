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

// The workbook filename inside `{dataFolder}/strategic-recommendations-template/`.
// HLX strips the `.xlsx` and publishes `strategic-recommendations.json`.
export const WORKBOOK_FILENAME = 'strategic-recommendations.xlsx';

// The fully-populated worksheet this handler owns. The other two `shared-*`
// worksheets (Citation Attempt, Synthetic Personas) and any non-shared sheets
// (Notes) are byte-preserved — we never touch them.
export const SEMRUSH_SHEET = 'shared-Semrush';

// Canonical column order for `shared-Semrush`, matching the reference template
// strategic_recommendations_template.xlsx and the row schema property order.
// `prompt_id` is reserved (nullable, emitted null in v1) and is NOT a workbook
// column in v1 — the template has no such column.
export const SEMRUSH_COLUMNS = [
  'tag',
  'strategy',
  'strategy_reasoning',
  'topic_id',
  'topic',
  'volume',
  'adobe_mentions',
  'competitor_1',
  'competitor_1_mentions',
  'competitor_2',
  'competitor_2_mentions',
  'competitor_3',
  'competitor_3_mentions',
  'category',
  'prompt',
  'deleted',
];
