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

function deepEqual(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a !== typeof b) return false;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }

  if (typeof a === 'object' && typeof b === 'object') {
    const keysA = Object.keys(a).sort();
    const keysB = Object.keys(b).sort();
    if (!deepEqual(keysA, keysB)) return false;
    return keysA.every((key) => deepEqual(a[key], b[key]));
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

  return changes;
}
/**
 * Compares two arrays of prompts for equality, regardless of original order.
 * Returns true if prompt arrays have the same items.
 * @param {Array} prompts1 - First array of prompts
 * @param {Array} prompts2 - Second array of prompts
 * @returns {boolean} True if arrays contain the same prompts
 */
function arePromptArraysEqual(prompts1, prompts2) {
  if (prompts1.length !== prompts2.length) return false;

  const sortedPrompts1 = JSON.stringify(
    prompts1.sort((a, b) => a.prompt.localeCompare(b.prompt)),
  );

  const sortedPrompts2 = JSON.stringify(
    prompts2.sort((a, b) => a.prompt.localeCompare(b.prompt)),
  );

  return sortedPrompts1 === sortedPrompts2;
}

/**
 * Checks if config changes are only AI-origin categorization updates.
 * Returns true if all new/modified categories and topics contain only AI-origin prompts.
 * This is used to determine if changes were made by the brand categorization flow,
 * in which case we should skip re-triggering geo-brand-presence.
 * @param {Object} oldConfig - Previous LLMO config
 * @param {Object} newConfig - New LLMO config
 * @returns {boolean} True if changes are AI categorization only
 */
export function areChangesAICategorizationOnly(oldConfig, newConfig) {
  if (!oldConfig) return false;

  const oldCategories = oldConfig?.categories || {};
  const newCategories = newConfig?.categories || {};
  const oldTopics = oldConfig?.topics || {};
  const newTopics = newConfig?.topics || {};
  const oldAiTopics = oldConfig?.ai_topics || {};
  const newAiTopics = newConfig?.ai_topics || {};

  const newCategoryIds = Object.keys(newCategories).filter((id) => !oldCategories[id]);

  const changedTopicIds = Object.keys(newTopics).filter((id) => {
    const isNewTopic = !oldTopics[id];
    if (isNewTopic) return true;
    const oldPrompts = oldTopics[id]?.prompts || [];
    const newPrompts = newTopics[id]?.prompts || [];
    return !arePromptArraysEqual(oldPrompts, newPrompts);
  });

  const changedAiTopicIds = Object.keys(newAiTopics).filter((id) => {
    const isNewTopic = !oldTopics[id];
    if (isNewTopic) return true;
    const oldPrompts = oldAiTopics[id]?.prompts || [];
    const newPrompts = newAiTopics[id]?.prompts || [];
    return !arePromptArraysEqual(oldPrompts, newPrompts);
  });

  const noChanges = newCategoryIds.length === 0
    && changedTopicIds.length === 0
    && changedAiTopicIds.length === 0;

  if (noChanges) return false;

  const topicsReferencingNewCategories = [
    ...Object.values(newTopics).filter(
      (topic) => newCategoryIds.includes(topic.category),
    ),
    ...Object.values(newAiTopics).filter(
      (topic) => newCategoryIds.includes(topic.category),
    ),
  ];

  // If there are new categories, ensure they have topics with AI prompts
  if (newCategoryIds.length > 0) {
    if (topicsReferencingNewCategories.length === 0) {
      // New categories but no topics - not AI categorization only
      return false;
    }

    let hasAtLeastOneAIPrompt = false;
    for (const topic of topicsReferencingNewCategories) {
      const prompts = topic.prompts || [];

      if (prompts.length === 0) {
        // Topic with no prompts - not AI categorization
        return false;
      }

      const hasNonAiPrompts = prompts.some((p) => p.origin?.toLowerCase() !== 'ai');
      if (hasNonAiPrompts) return false;

      // At least one topic has AI prompts
      if (prompts.some((p) => p.origin?.toLowerCase() === 'ai')) {
        hasAtLeastOneAIPrompt = true;
      }
    }

    if (!hasAtLeastOneAIPrompt) {
      // No AI prompts found at all
      return false;
    }
  }

  // Check changed topics - ensure all new/modified prompts are AI-origin
  for (const topicId of changedTopicIds) {
    const newTopic = newTopics[topicId];
    const oldTopic = oldTopics[topicId];
    const newPrompts = newTopic?.prompts || [];
    const oldPrompts = oldTopic?.prompts || [];

    // Get prompts that are new (not in old config)
    const oldPromptTexts = new Set(oldPrompts.map((p) => p.prompt));
    const addedPrompts = newPrompts.filter((p) => !oldPromptTexts.has(p.prompt));

    // If there are added prompts but they're not AI-origin, return false
    if (addedPrompts.length > 0 && addedPrompts.some((p) => p.origin?.toLowerCase() !== 'ai')) {
      return false;
    }

    // If it's a new topic (not in old config) with no prompts or empty prompts, return false
    if (!oldTopic && newPrompts.length === 0) {
      return false;
    }
  }

  // Check changed ai_topics - ensure all new/modified prompts are AI-origin
  for (const topicId of changedAiTopicIds) {
    const newTopic = newAiTopics[topicId];
    const oldTopic = oldAiTopics[topicId];
    const newPrompts = newTopic?.prompts || [];
    const oldPrompts = oldTopic?.prompts || [];

    // Get prompts that are new (not in old config)
    const oldPromptTexts = new Set(oldPrompts.map((p) => p.prompt));
    const addedPrompts = newPrompts.filter((p) => !oldPromptTexts.has(p.prompt));

    // If there are added prompts but they're not AI-origin, return false
    if (addedPrompts.length > 0 && addedPrompts.some((p) => p.origin?.toLowerCase() !== 'ai')) {
      return false;
    }

    // If it's a new topic (not in old config) with no prompts or empty prompts, return false
    if (!oldTopic && newPrompts.length === 0) {
      return false;
    }
  }

  // All changes are AI-origin only
  return true;
}
/* c8 ignore end */
