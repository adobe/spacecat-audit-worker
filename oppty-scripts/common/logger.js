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
 * Simple logger utility for consistent output across the opportunity scripts
 */

const LOG_LEVELS = {
  ERROR: 'ERROR',
  WARN: 'WARN',
  INFO: 'INFO',
  DEBUG: 'DEBUG',
};

const COLORS = {
  ERROR: '\x1b[31m', // Red
  WARN: '\x1b[33m', // Yellow
  INFO: '\x1b[36m', // Cyan
  DEBUG: '\x1b[90m', // Gray
  RESET: '\x1b[0m',
};

class Logger {
  constructor(enableDebug = false) {
    this.enableDebug = enableDebug || process.env.DEBUG === 'true';
  }

  /**
   * Format log message with timestamp and level
   * @param {string} level - Log level
   * @param {string} message - Log message
   * @param {object} [data] - Optional data to log
   * @returns {string} Formatted message
   */
  /* eslint-disable class-methods-use-this */
  formatMessage(level, message, data) {
    /* eslint-enable class-methods-use-this */
    const timestamp = new Date().toISOString();
    const color = COLORS[level] || COLORS.RESET;
    const reset = COLORS.RESET;

    let formattedMessage = `${color}[${timestamp}] [${level}]${reset} ${message}`;

    if (data) {
      formattedMessage += `\n${JSON.stringify(data, null, 2)}`;
    }

    return formattedMessage;
  }

  error(message, data) {
    /* eslint-disable-next-line no-console */
    console.error(this.formatMessage(LOG_LEVELS.ERROR, message, data));
  }

  warn(message, data) {
    /* eslint-disable-next-line no-console */
    console.warn(this.formatMessage(LOG_LEVELS.WARN, message, data));
  }

  info(message, data) {
    /* eslint-disable-next-line no-console */
    console.log(this.formatMessage(LOG_LEVELS.INFO, message, data));
  }

  debug(message, data) {
    if (this.enableDebug) {
      /* eslint-disable-next-line no-console */
      console.log(this.formatMessage(LOG_LEVELS.DEBUG, message, data));
    }
  }

  /**
   * Log a section separator for better readability
   */
  separator(title) {
    const line = '='.repeat(60);
    this.info(`\n${line}\n  ${title}\n${line}`);
  }

  /**
   * Log a summary table
   */
  summary(title, stats) {
    this.separator(title);
    Object.entries(stats).forEach(([key, value]) => {
      this.info(`  ${key}: ${value}`);
    });
  }

  /**
   * Log pages for which scrapes were not found
   * @param {string} siteId - Site UUID
   * @param {Array<string>} notFoundUrls - Array of URLs without scrapes
   */
  /* eslint-disable class-methods-use-this */
  logScrapesNotFound(siteId, notFoundUrls) {
    /* eslint-enable class-methods-use-this */
    if (!notFoundUrls || notFoundUrls.length === 0) {
      return;
    }

    /* eslint-disable-next-line no-console */
    console.log('\nscrapes not found for :');
    const uniqueUrls = [...new Set(notFoundUrls)];
    /* eslint-disable-next-line no-console */
    console.log(JSON.stringify({
      siteId,
      notFound: uniqueUrls,
      total: uniqueUrls.length,
    }, null, 2));
  }
}

/**
 * Create a new logger instance
 */
export function createLogger(enableDebug = false) {
  return new Logger(enableDebug);
}

export default createLogger;
