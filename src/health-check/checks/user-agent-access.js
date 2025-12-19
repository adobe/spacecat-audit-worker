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

import { tracingFetch as fetch } from '@adobe/spacecat-shared-utils';
import { AzureOpenAIClient } from '@adobe/spacecat-shared-gpt-client';

export const SPACECAT_USER_AGENT = 'Spacecat/1.0';

// Maximum content length to send to LLM (to avoid token limits)
const MAX_CONTENT_LENGTH = 10000;

// HTTP status codes that typically indicate blocking
const BLOCKING_STATUS_CODES = [401, 403, 406, 429, 503];

// Common blocking indicators in response content
const BLOCKING_CONTENT_INDICATORS = [
  'access denied',
  'access is denied',
  'forbidden',
  'blocked',
  'captcha',
  'security check',
  'please verify',
  'are you a robot',
  'bot detected',
  'automated access',
  'cloudflare',
  'ddos protection',
  'rate limit',
  'too many requests',
];

// System prompt for LLM analysis
const LLM_ANALYSIS_SYSTEM_PROMPT = `You are a web access analyzer. Your task is to analyze HTTP response content and determine if access to a website has been blocked or restricted.

Analyze the provided content and determine if the response indicates:
- Access denial or blocking
- CAPTCHA or bot detection challenges
- Rate limiting
- Firewall or security blocks
- WAF (Web Application Firewall) blocks
- DDoS protection pages
- Any other form of automated access restriction

Return JSON with:
- isBlocked: boolean indicating if access appears to be blocked
- reason: string explaining why access is blocked (or "Access appears normal" if not blocked)

Be conservative - only mark as blocked if there are clear indicators. Normal website content, even with security-related branding (like "Powered by Cloudflare"), should not be considered blocked.

You must return a valid result.

Return a pure JSON string without markdown. Example output:
{
  "isBlocked": true,
  "reason": "Access denied by WAF - Cloudflare bot detection triggered"
}`;

/**
 * Analyzes the HTTP response using keyword matching to determine if the request was blocked.
 * This is used as a fallback when LLM is not available.
 *
 * @param {number} statusCode - The HTTP status code
 * @param {string} responseText - The response body text
 * @returns {Object} Analysis result with blocking status and indicators
 */
export function analyzeBlockingResponseWithKeywords(statusCode, responseText) {
  const indicators = [];

  const isBlockedByStatusCode = BLOCKING_STATUS_CODES.includes(statusCode);
  if (isBlockedByStatusCode) {
    indicators.push(`HTTP status code ${statusCode}`);
  }

  const lowerCaseContent = responseText.toLowerCase();
  const foundContentIndicators = BLOCKING_CONTENT_INDICATORS.filter(
    (indicator) => lowerCaseContent.includes(indicator),
  );

  if (foundContentIndicators.length > 0) {
    indicators.push(...foundContentIndicators.map((i) => `Content contains: "${i}"`));
  }

  const isBlocked = isBlockedByStatusCode || foundContentIndicators.length >= 2;

  return {
    isBlocked,
    reason: isBlocked ? indicators.join('; ') : 'No blocking indicators detected',
  };
}

/**
 * Strips markdown code block wrappers from LLM response content.
 * Handles both ```json and ``` variants.
 *
 * @param {string} content - The raw LLM response content
 * @returns {string} The cleaned content without markdown wrappers
 */
export function stripMarkdownCodeBlocks(content) {
  let cleaned = content.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '');
  cleaned = cleaned.replace(/\n?```\s*$/, '');
  return cleaned.trim();
}

/**
 * Parses and validates the LLM response for blocking analysis.
 *
 * @param {string} content - The raw LLM response content
 * @param {number} statusCode - The HTTP status code (used for validation)
 * @param {Object} log - Logger instance
 * @returns {Object|null} Parsed and validated analysis or null if invalid
 */
export function parseAndValidateLLMResponse(content, statusCode, log) {
  if (!content) {
    log.warn('Empty content received from LLM');
    return null;
  }

  try {
    const cleanedContent = stripMarkdownCodeBlocks(content);
    const analysis = JSON.parse(cleanedContent);

    // Validate required fields
    if (typeof analysis.isBlocked !== 'boolean') {
      log.warn(`Invalid isBlocked value from LLM: ${analysis.isBlocked}`);
      return null;
    }

    // Ensure reason is a string
    if (typeof analysis.reason !== 'string' || !analysis.reason.trim()) {
      analysis.reason = analysis.isBlocked ? 'Access blocked' : 'Access appears normal';
    }

    return analysis;
  } catch (error) {
    log.warn(`Failed to parse LLM response: ${error.message}`);
    return null;
  }
}

/**
 * Analyzes HTTP response content using LLM to determine if access is blocked.
 * Falls back to keyword analysis when LLM is not available.
 *
 * @param {number} statusCode - The HTTP status code
 * @param {string} responseText - The response body text
 * @param {Object} context - The context object with env and log
 * @returns {Promise<Object>} Analysis result with blocking status and indicators
 */
export async function analyzeBlockingResponse(statusCode, responseText, context) {
  const { log, env } = context;
  const isBlockedByStatusCode = BLOCKING_STATUS_CODES.includes(statusCode);

  const {
    AZURE_OPENAI_ENDPOINT: apiEndpoint,
    AZURE_OPENAI_KEY: apiKey,
    AZURE_API_VERSION: apiVersion,
    AZURE_COMPLETION_DEPLOYMENT: deploymentName,
  } = env || {};

  if (!apiEndpoint || !apiKey || !apiVersion) {
    log.warn('LLM configuration missing, using keyword analysis fallback');
    return analyzeBlockingResponseWithKeywords(statusCode, responseText);
  }

  try {
    const truncatedContent = responseText.length > MAX_CONTENT_LENGTH
      ? `${responseText.substring(0, MAX_CONTENT_LENGTH)}... [truncated]`
      : responseText;

    const userPrompt = `HTTP Status Code: ${statusCode}

Response Content:
${truncatedContent}

Analyze this response and determine if access to the website has been blocked.`;

    const config = {
      apiEndpoint, apiKey, apiVersion, deploymentName,
    };
    const azureClient = new AzureOpenAIClient(config, log);
    const response = await azureClient.fetchChatCompletion(userPrompt, {
      systemPrompt: LLM_ANALYSIS_SYSTEM_PROMPT,
      responseFormat: 'json_object',
    });

    const content = response?.choices?.[0]?.message?.content;
    const analysis = parseAndValidateLLMResponse(content, statusCode, log);

    if (!analysis) {
      log.warn('Invalid LLM response, falling back to keyword analysis');
      return analyzeBlockingResponseWithKeywords(statusCode, responseText);
    }

    const isBlocked = isBlockedByStatusCode || analysis.isBlocked;

    return {
      isBlocked,
      reason: analysis.reason,
    };
  } catch (error) {
    log.error(`LLM analysis failed, falling back to keyword analysis: ${error.message}`, error);
    return analyzeBlockingResponseWithKeywords(statusCode, responseText);
  }
}

/**
 * Performs a health check by making a request with the SpaceCat user agent
 * and analyzing the response using LLM to detect blocking.
 *
 * @param {string} url - The URL to check
 * @param {Object} context - The context object with log and env
 * @returns {Promise<Object>} Health check result
 */
export async function checkSpacecatUserAgentAccess(url, context) {
  const { log } = context;
  const urlWithScheme = url.startsWith('https://') ? url : `https://${url}`;

  try {
    const response = await fetch(urlWithScheme, {
      method: 'GET',
      headers: { 'User-Agent': SPACECAT_USER_AGENT },
      redirect: 'manual',
    });

    const responseText = await response.text();
    const analysis = await analyzeBlockingResponse(response.status, responseText, context);

    return {
      ...analysis,
    };
  } catch (error) {
    log.error(`Health check request to ${urlWithScheme} failed: ${error.message}`, error);

    return {
      isBlocked: false,
      reason: `Request failed: ${error.message}`,
    };
  }
}
