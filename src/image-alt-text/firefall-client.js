/*
 * Copyright 2024 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

import { createUrl } from '@adobe/fetch';
import { ImsClient } from '@adobe/spacecat-shared-ims-client';
import { hasText, isObject, isValidUrl } from '@adobe/spacecat-shared-utils';

import { fetch as httpFetch } from '../utils.js';

const USER_ROLE_IMAGE_URL_TYPE = 'image_url';
const USER_ROLE_TEXT_TYPE = 'text';
const SYSTEM_ROLE = 'system';
const USER_ROLE = 'user';
const AZURE_CHAT_OPENAI_LLM_TYPE = 'azure_chat_openai';
const JSON_OBJECT_RESPONSE_FORMAT = 'json_object';

function validateCapabilityExecutionResponse(response) {
  return !(!isObject(response)
    || !Array.isArray(response.generations)
    || response.generations.length === 0
    || !Array.isArray(response.generations[0])
    || !isObject(response.generations[0][0])
    || !hasText(response.generations[0][0].text));
}

function validateChatCompletionResponse(response) {
  return isObject(response)
    && Array.isArray(response?.choices)
    && response.choices.length > 0
    && response.choices[0]?.message;
}

function isBase64UrlImage(base64String) {
  return base64String.startsWith('data:image') && base64String.endsWith('=') && base64String.includes('base64');
}

export default class FirefallClient {
  static createFrom(context) {
    const { log = console } = context;
    const imsClient = ImsClient.createFrom(context);

    const {
      FIREFALL_API_ENDPOINT: apiEndpoint,
      IMS_CLIENT_ID: imsClientId,
      FIREFALL_IMS_ORG_ID: firefallImsOrgId,
      FIREFALL_API_KEY: apiKey,
      FIREFALL_API_POLL_INTERVAL: pollInterval = 2000,
      FIREFALL_API_CAPABILITY_NAME: capabilityName = 'gpt4_32k_completions_capability',
    } = context.env;

    if (!isValidUrl(apiEndpoint)) {
      throw new Error('Missing Firefall API endpoint');
    }

    if (!hasText(apiKey)) {
      throw new Error('Missing Firefall API key');
    }

    return new FirefallClient({
      apiEndpoint,
      apiKey,
      capabilityName,
      imsClient,
      imsOrg: firefallImsOrgId || imsClientId,
      pollInterval,
    }, log);
  }

  /**
   * Creates a new Firefall client
   *
   * @param {Object} config - The configuration object.
   * @param {string} config.apiEndpoint - The API endpoint for Firefall.
   * @param {string} config.apiKey - The API Key for Firefall.
   * @param {string} config.capabilityName - The capability name for Firefall.
   * @param {ImsClient} config.imsClient - The IMS Client.
   * @param {string} config.imsOrg - The IMS Org for Firefall.
   * @param {number} config.pollInterval - The interval to poll for job status.
   * @param {Object} log - The Logger.
   * @returns {FirefallClient} - the Firefall client.
   */
  constructor(config, log) {
    this.config = config;
    this.log = log;
    this.imsClient = config.imsClient;
    this.apiAuth = null;
  }

  async #getApiAuth() {
    if (!this.apiAuth) {
      this.apiAuth = (await this.imsClient.getServiceAccessToken()).access_token;
    }
    return this.apiAuth;
  }

  #logDuration(message, startTime) {
    const endTime = process.hrtime.bigint();
    const duration = (endTime - startTime) / BigInt(1e6);
    this.log.debug(`${message}: took ${duration}ms`);
  }

  /**
   * Submit a prompt to the Firefall API.
   * @param body The body of the request.
   * @param path The Firefall API path.
   * @returns {Promise<unknown>}
   */
  async #submitPrompt(body, path) {
    const apiAuth = await this.#getApiAuth();

    const url = createUrl(`${this.config.apiEndpoint}${path}`);
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiAuth}`,
      'x-api-key': this.config.apiKey,
      'x-gw-ims-org-id': this.config.imsOrg,
    };

    this.log.info(`URL: ${url}, Headers: ${JSON.stringify(headers)}`);
    this.log.debug('called with:', headers, body);

    const response = await httpFetch(url, {
      method: 'POST',
      headers,
      body,
    });

    if (!response.ok) {
      this.log.debug('response:', response);
      throw new Error(`Job submission failed with status code ${response.status}`);
    }

    return response.json();
  }

  /* eslint-disable no-await-in-loop */
  async #pollJobStatus(jobId, path) {
    const apiAuth = await this.#getApiAuth();

    let jobStatusResponse;
    do {
      await new Promise(
        (resolve) => { setTimeout(resolve, this.config.pollInterval); },
      ); // Wait for 2 seconds before polling

      const url = `${this.config.apiEndpoint}${path}/${jobId}`;
      const headers = {
        Authorization: `Bearer ${apiAuth}`,
        'x-api-key': this.config.apiKey,
        'x-gw-ims-org-id': this.config.imsOrg,
      };

      this.log.info(`URL: ${url}, Headers: ${JSON.stringify(headers)}`);

      const response = await httpFetch(
        createUrl(url),
        {
          method: 'GET',
          headers,
        },
      );

      if (!response.ok) {
        throw new Error(`Job polling failed with status code ${response.status}`);
      }

      jobStatusResponse = await response.json();
    } while (jobStatusResponse.status === 'PROCESSING' || jobStatusResponse.status === 'WAITING');

    if (jobStatusResponse.status !== 'SUCCEEDED') {
      throw new Error(`Job did not succeed, status: ${jobStatusResponse.status}.\n${JSON.stringify(jobStatusResponse, null, 2)}`);
    }

    return jobStatusResponse;
  }

  /**
   * Fetches data from Firefall Chat Completion API.
   * @param prompt The text prompt to provide to Firefall
   * @param options The options for the call, with optional properties:
   *          - imageUrls: An array of URLs of the images to provide to Firefall
   *          - model: LLM Model to use (default: gpt-4-turbo).  Use 'gpt-4-vision' with images.
   *          - responseFormat: The response format to request from Firefall (accepts: json_object)
   * @returns {Object} - AI response
   */
  async fetchChatCompletion(prompt, options = {}) {
    const {
      imageUrls,
      responseFormat,
      model: llmModel = 'gpt-4-turbo',
    } = options || {};
    const hasImageUrls = imageUrls && imageUrls.length > 0;

    const getBody = () => {
      const userRole = {
        role: USER_ROLE,
        content: [
          {
            type: USER_ROLE_TEXT_TYPE,
            text: prompt,
          },
        ],
      };

      if (hasImageUrls) {
        imageUrls
          .filter((iu) => isValidUrl(iu) || isBase64UrlImage(iu))
          .forEach((imageUrl) => {
            userRole.content.push({
              type: USER_ROLE_IMAGE_URL_TYPE,
              image_url: {
                url: imageUrl,
              },
            });
          });
      }

      const body = {
        llm_metadata: {
          model_name: llmModel,
          llm_type: AZURE_CHAT_OPENAI_LLM_TYPE,
        },
        messages: [
          userRole,
        ],
      };
      if (responseFormat === JSON_OBJECT_RESPONSE_FORMAT) {
        body.response_format = {
          type: JSON_OBJECT_RESPONSE_FORMAT,
        };
        body.messages.push({
          role: SYSTEM_ROLE,
          content: 'You are a helpful assistant designed to output JSON.',
        });
      }

      return body;
    };

    // Validate inputs
    if (!hasText(prompt)) {
      throw new Error('Invalid prompt received');
    }
    if (hasImageUrls && !Array.isArray(imageUrls)) {
      throw new Error('imageUrls must be an array.');
    }

    let chatSubmissionResponse;
    try {
      const startTime = process.hrtime.bigint();
      const body = getBody();

      chatSubmissionResponse = await this.#submitPrompt(JSON.stringify(body), '/v2/chat/completions');
      this.#logDuration('Firefall API Chat Completion call', startTime);
    } catch (error) {
      this.log.error('Error while fetching data from Firefall chat API: ', error.message);
      throw error;
    }

    if (!validateChatCompletionResponse(chatSubmissionResponse)) {
      this.log.error(
        'Could not obtain data from Firefall: Invalid response format.',
      );
      throw new Error('Invalid response format.');
    }
    if (!chatSubmissionResponse.choices.some((ch) => hasText(ch?.message?.content))) {
      throw new Error('Prompt completed but no output was found.');
    }

    return chatSubmissionResponse;
  }

  /**
   * Fetches data from Firefall API.
   * @param prompt The text prompt to provide to Firefall
   * @returns {string} - AI response
   */
  async fetchCapabilityExecution(prompt) {
    if (!hasText(prompt)) {
      throw new Error('Invalid prompt received');
    }

    try {
      const startTime = process.hrtime.bigint();

      const body = JSON.stringify({
        input: prompt,
        capability_name: this.config.capabilityName,
      });
      const path = '/v2/capability_execution/job';

      const jobSubmissionResponse = await this.#submitPrompt(body, path);
      const jobStatusResponse = await this.#pollJobStatus(jobSubmissionResponse.job_id, path);
      this.#logDuration('Firefall API Capability Execution call', startTime);

      const { output } = jobStatusResponse;
      if (!output || !output.capability_response) {
        throw new Error('Job completed but no output was found');
      }

      if (!validateCapabilityExecutionResponse(output.capability_response)) {
        this.log.error('Could not obtain data from Firefall: Invalid response format.');
        throw new Error('Invalid response format.');
      }

      const result = output.capability_response.generations[0][0];

      this.log.info(`Generation Info: ${JSON.stringify(result.generation_info)}`);
      this.log.info(`LLM Info: ${JSON.stringify(output.capability_response.llm_output)}`);

      return result.text;
    } catch (error) {
      this.log.error('Error while fetching data from Firefall Capability Execution API: ', error.message);
      throw error;
    }
  }

  /**
   * @deprecated since version 1.2.19. Use fetchCapabilityExecution instead.
   */
  async fetch(prompt) {
    return this.fetchCapabilityExecution(prompt);
  }
}
