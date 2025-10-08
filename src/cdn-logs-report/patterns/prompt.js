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
