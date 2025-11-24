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
import { getLastNumberOfWeeks } from '@adobe/spacecat-shared-utils';
import { startOfISOWeek, addDays, format } from 'date-fns';
import { AzureOpenAIClient } from '@adobe/spacecat-shared-gpt-client';

function getAzureOpenAIClient(context, deploymentName) {
  const cacheKey = `azureOpenAIClient_${deploymentName}`;

  if (context[cacheKey]) {
    return context[cacheKey];
  }

  const { env, log = console } = context;

  const {
    AZURE_OPENAI_ENDPOINT: apiEndpoint,
    AZURE_OPENAI_KEY: apiKey,
    AZURE_API_VERSION: apiVersion,
  } = env;

  const config = {
    apiEndpoint,
    apiKey,
    apiVersion,
    deploymentName,
  };

  context[cacheKey] = new AzureOpenAIClient(config, log);
  return context[cacheKey];
}

export async function prompt(systemPrompt, userPrompt, context = {}, deploymentName = null) {
  try {
    const deployment = deploymentName || context.env?.AZURE_COMPLETION_DEPLOYMENT || 'gpt-4o-mini';
    const azureClient = getAzureOpenAIClient(context, deployment);

    const response = await azureClient.fetchChatCompletion(userPrompt, {
      systemPrompt,
      responseFormat: 'json_object',
    });

    return {
      content: response.choices[0].message.content,
      usage: response.usage || null,
    };
  } catch (error) {
    throw new Error(`Failed to trigger Azure LLM: ${error.message}`);
  }
}

export function getLastSunday() {
  const { year, week } = getLastNumberOfWeeks(1)[0];
  const weekStart = startOfISOWeek(new Date(year, 0, 4));
  const targetWeekStart = addDays(weekStart, (week - 1) * 7);
  const lastSunday = format(addDays(targetWeekStart, 6), 'yyyy-MM-dd');
  return lastSunday;
}

/**
 * Compares two prompt arrays for equality, treating them as sets (order-independent)
 */
function arePromptArraysEqual(prompts1, prompts2) {
  if (!Array.isArray(prompts1) || !Array.isArray(prompts2)) return false;
  if (prompts1.length !== prompts2.length) return false;

  const sorted1 = JSON.stringify(
    prompts1.sort((a, b) => a.prompt.localeCompare(b.prompt)),
  );
  const sorted2 = JSON.stringify(
    prompts2.sort((a, b) => a.prompt.localeCompare(b.prompt)),
  );

  return new Set(sorted1).isSupersetOf(new Set(sorted2));
}
function deepEqual(a, b, path = '') {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a !== typeof b) return false;
  if (path.endsWith('.prompts') && Array.isArray(a) && Array.isArray(b)) {
    return arePromptArraysEqual(a, b);
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, index) => deepEqual(item, b[index], `${path}[${index}]`));
  }

  if (typeof a === 'object' && typeof b === 'object') {
    const keysA = Object.keys(a).sort();
    const keysB = Object.keys(b).sort();
    if (!deepEqual(keysA, keysB, `${path}.keys`)) return false;
    return keysA.every((key) => deepEqual(a[key], b[key], `${path}.${key}`));
  }

  return false;
}

function compareRecords(oldRecord, newRecord) {
  const changed = {};
  let hasChanges = false;

  for (const [uuid, newItem] of Object.entries(newRecord)) {
    const oldItem = oldRecord[uuid];
    if (!oldItem || !deepEqual(oldItem, newItem)) {
      changed[uuid] = newItem;
      hasChanges = true;
    }
  }

  for (const uuid of Object.keys(oldRecord)) {
    if (!newRecord[uuid]) {
      hasChanges = true;
    }
  }

  return hasChanges ? changed : null;
}

function compareArrays(oldArray, newArray) {
  if (deepEqual(oldArray, newArray)) {
    return null;
  }
  return newArray;
}

export function areCategoryNamesDifferent(oldCategories, newCategories) {
  const oldNames = Object.values(oldCategories || {}).map((c) => c?.name).filter(Boolean).sort();
  const newNames = Object.values(newCategories || {}).map((c) => c?.name).filter(Boolean).sort();
  return oldNames.length !== newNames.length || !oldNames.every((name, i) => name === newNames[i]);
}
/**
 * Returns true if any change unrelated to AI categories or AI topics is detected
 */
function checkAICategorizationOnly(changes) {
  if (
    changes.topics
    || changes.brands
    || changes.competitors
    || changes.entities
    || changes.cdnBucketConfig
    || changes.deleted
  ) return false;

  const newHumanCategories = changes?.categories?.some((c) => c?.origin?.toLowerCase() !== 'ai');

  if (newHumanCategories) return false;

  return true;
}

export function compareConfigs(oldConfig, newConfig) {
  const changes = {};

  const entitiesChanges = compareRecords(
    oldConfig.entities || {},
    newConfig.entities || {},
  );
  if (entitiesChanges) {
    changes.entities = entitiesChanges;
  }

  const categoriesChanges = compareRecords(
    oldConfig.categories || {},
    newConfig.categories || {},
  );
  if (categoriesChanges) {
    changes.categories = categoriesChanges;
  }

  const topicsChanges = compareRecords(
    oldConfig.topics || {},
    newConfig.topics || {},
  );
  if (topicsChanges) {
    changes.topics = topicsChanges;
  }

  const brandsAliasesChanges = compareArrays(
    oldConfig.brands?.aliases || [],
    newConfig.brands?.aliases || [],
  );
  if (brandsAliasesChanges) {
    changes.brands = {
      aliases: brandsAliasesChanges,
    };
  }

  const competitorsChanges = compareArrays(
    oldConfig.competitors?.competitors || [],
    newConfig.competitors?.competitors || [],
  );
  if (competitorsChanges) {
    changes.competitors = {
      competitors: competitorsChanges,
    };
  }

  const cdnBucketConfigChanges = compareRecords(
    oldConfig.cdnBucketConfig || {},
    newConfig.cdnBucketConfig || {},
  );
  if (cdnBucketConfigChanges) {
    changes.cdnBucketConfig = cdnBucketConfigChanges;
  }
  // Add metadata about AI-only changes
  if (Object.keys(changes).length > 0 && oldConfig) {
    changes.metadata = {
      isAICategorizationOnly: checkAICategorizationOnly(changes, oldConfig, newConfig),
    };
  }

  return changes;
}
/* c8 ignore end */
