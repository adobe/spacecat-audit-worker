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

// The three `shared-*` worksheets this handler owns. All three are written on
// every run from the DRS result envelope's `sheets` map (HLX strips the
// `shared-` prefix, so the envelope keys are the un-prefixed names). The legacy
// `Notes` sheet is intentionally dropped — elmo-ui does not consume it.
export const SEMRUSH_SHEET = 'shared-Semrush';
export const CITATION_SHEET = 'shared-Citation Attempt';
export const PERSONAS_SHEET = 'shared-Synthetic Personas';

// Un-prefixed sheet names — the keys in the DRS result `sheets` map, and the
// keys HLX surfaces in the published multi-sheet JSON.
export const SEMRUSH_JSON_KEY = 'Semrush';
export const CITATION_JSON_KEY = 'Citation Attempt';
export const PERSONAS_JSON_KEY = 'Synthetic Personas';

// The legacy worksheet we now remove on every write (confirmed unconsumed by
// elmo-ui). Kept as a named constant so the drop is explicit and testable.
export const NOTES_SHEET = 'Notes';

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

// Canonical column order for `shared-Citation Attempt`, matching the property
// order of `shared-citation-row.schema.v1.json`. Eight columns map 1:1 from the
// brand's prompt-suggestions workbook; tag/strategy/strategy_reasoning are
// generated. `source_url` is the citation grouping key.
export const CITATION_COLUMNS = [
  'tag',
  'strategy',
  'strategy_reasoning',
  'prompt',
  'topic',
  'category',
  'region',
  'intent',
  'type',
  'source_url',
  'prompt_reasoning',
  'deleted',
];

// Canonical column order for `shared-Synthetic Personas`, matching the property
// order of `shared-persona-row.schema.v1.json`. Same as the citation columns
// minus `source_url`; `category` is the persona grouping key.
export const PERSONA_COLUMNS = [
  'tag',
  'strategy',
  'strategy_reasoning',
  'prompt',
  'topic',
  'category',
  'region',
  'intent',
  'type',
  'prompt_reasoning',
  'deleted',
];
