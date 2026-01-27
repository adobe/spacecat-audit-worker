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

/**
 * Custom error class for bot protection blocking
 */
export class BotProtectionError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'BotProtectionError';
    this.botProtection = options.botProtection || {};
    this.siteUrl = options.siteUrl;
    this.url = options.url;
  }
}

/**
 * Checks if scrape results indicate bot protection is blocking
 * @param {Object} scrapeResult - Scrape result from S3 (scrape.json content)
 * @param {Object} log - Logger instance
 * @returns {Object|null} Bot protection details if blocked, null otherwise
 */
export function checkBotProtectionInScrapeResult(scrapeResult, log) {
  if (!scrapeResult) {
    return null;
  }

  // Check if botProtection field exists and indicates blocking
  const { botProtection } = scrapeResult;

  if (!botProtection) {
    return null;
  }

  const isBlocked = botProtection.blocked === true
    || (botProtection.crawlable !== undefined && botProtection.crawlable === false);

  if (isBlocked) {
    log.warn(`Bot protection detected in scrape: type=${botProtection.type}, confidence=${(botProtection.confidence * 100).toFixed(0)}%`);

    return {
      detected: botProtection.detected !== false,
      type: botProtection.type || 'unknown',
      blocked: true,
      confidence: botProtection.confidence || 0.5,
      reason: botProtection.reason,
      details: botProtection.details,
    };
  }

  if (botProtection.detected && botProtection.type && botProtection.type.includes('-allowed')) {
    log.info(`Bot protection infrastructure present but bypassed: ${botProtection.type}`);
  }

  return null;
}

/**
 * Validates scrape results and throws if bot protection is blocking
 * @param {Object} scrapeResult - Scrape result from S3
 * @param {string} url - URL being scraped
 * @param {Object} log - Logger instance
 * @throws {BotProtectionError} If bot protection is blocking
 */
export function validateScrapeForBotProtection(scrapeResult, url, log) {
  const botProtection = checkBotProtectionInScrapeResult(scrapeResult, log);

  if (botProtection && botProtection.blocked) {
    log.error(`Bot protection blocking scrape for ${url}: ${botProtection.type}`);

    throw new BotProtectionError(
      `Bot protection (${botProtection.type}) is blocking access to ${url}`,
      {
        botProtection,
        url,
        siteUrl: url,
      },
    );
  }
}
