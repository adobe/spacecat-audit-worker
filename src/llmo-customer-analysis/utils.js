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
 * Checks if all changes in categories and topics are AI-origin only
 */
function checkAICategorizationOnly(changes, oldConfig, newConfig) {
  if (!changes.categories && !changes.topics) return false;

  // If there are other types of changes, not AI-only
  const changeKeys = Object.keys(changes);
  const hasOtherChanges = changeKeys.some((key) => key !== 'categories' && key !== 'topics');
  if (hasOtherChanges) return false;

  const oldTopics = oldConfig?.topics || {};
  const newTopics = newConfig?.topics || {};
  const oldAiTopics = oldConfig?.ai_topics || {};
  const newAiTopics = newConfig?.ai_topics || {};

  // Check new categories have topics with AI prompts
  if (changes.categories) {
    const newCategoryIds = Object.keys(changes.categories);
    const topicsForNewCategories = [
      ...Object.values(newTopics).filter((t) => newCategoryIds.includes(t.category)),
      ...Object.values(newAiTopics).filter((t) => newCategoryIds.includes(t.category)),
    ];

    if (topicsForNewCategories.length === 0) return false;

    for (const topic of topicsForNewCategories) {
      const prompts = topic.prompts || [];
      if (prompts.length === 0) return false;
      if (prompts.some((p) => p.origin?.toLowerCase() !== 'ai')) return false;
    }
  }

  // Check changed topics have only AI prompts
  if (changes.topics) {
    for (const topicId of Object.keys(changes.topics)) {
      const newTopic = newTopics[topicId] || newAiTopics[topicId];
      const oldTopic = oldTopics[topicId] || oldAiTopics[topicId];
      const newPrompts = newTopic?.prompts || [];
      const oldPrompts = oldTopic?.prompts || [];

      if (!oldTopic && newPrompts.length === 0) return false;

      const oldPromptTexts = new Set(oldPrompts.map((p) => p.prompt));
      const addedPrompts = newPrompts.filter((p) => !oldPromptTexts.has(p.prompt));

      if (addedPrompts.length > 0 && addedPrompts.some((p) => p.origin?.toLowerCase() !== 'ai')) {
        return false;
      }
    }
  }

  return true;
}

export function compareConfigs(oldConfig, newConfig) {
  const changes = {};
  // Treat null/undefined oldConfig as empty config
  const safeOldConfig = oldConfig || {};
  const safeNewConfig = newConfig || {};

  const entitiesChanges = compareRecords(
    safeOldConfig.entities || {},
    safeNewConfig.entities || {},
  );
  if (entitiesChanges) {
    changes.entities = entitiesChanges;
  }

  const categoriesChanges = compareRecords(
    safeOldConfig.categories || {},
    safeNewConfig.categories || {},
  );
  if (categoriesChanges) {
    changes.categories = categoriesChanges;
  }

  const topicsChanges = compareRecords(
    safeOldConfig.topics || {},
    safeNewConfig.topics || {},
  );
  if (topicsChanges) {
    changes.topics = topicsChanges;
  }

  const brandsAliasesChanges = compareArrays(
    safeOldConfig.brands?.aliases || [],
    safeNewConfig.brands?.aliases || [],
  );
  if (brandsAliasesChanges) {
    changes.brands = {
      aliases: brandsAliasesChanges,
    };
  }

  const competitorsChanges = compareArrays(
    safeOldConfig.competitors?.competitors || [],
    safeNewConfig.competitors?.competitors || [],
  );
  if (competitorsChanges) {
    changes.competitors = {
      competitors: competitorsChanges,
    };
  }

  const cdnBucketConfigChanges = compareRecords(
    safeOldConfig.cdnBucketConfig || {},
    safeNewConfig.cdnBucketConfig || {},
  );
  if (cdnBucketConfigChanges) {
    changes.cdnBucketConfig = cdnBucketConfigChanges;
  }
  // Add metadata about AI-only changes
  if (Object.keys(changes).length > 0 && oldConfig) {
    changes.metadata = {
      isAICategorizationOnly: checkAICategorizationOnly(changes, safeOldConfig, safeNewConfig),
    };
  }

  return changes;
}
/* c8 ignore end */
