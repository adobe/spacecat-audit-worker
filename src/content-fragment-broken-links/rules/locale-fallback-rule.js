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

import { BaseRule } from './base-rule.js';
import { Suggestion } from '../domain/suggestion/suggestion.js';
import { Locale } from '../domain/language/locale.js';
import { LanguageTree } from '../domain/language/language-tree.js';
import { PathUtils } from '../utils/path-utils.js';

export class LocaleFallbackRule extends BaseRule {
  constructor(context, aemAuthorClient) {
    super(context, 2, aemAuthorClient); // Second priority
  }

  async applyRule(brokenPath) {
    const { log } = this.context;
    log.debug(`Applying LocaleFallbackRule to path: ${brokenPath}`);

    const detectedLocale = Locale.fromPath(brokenPath);
    if (!detectedLocale) {
      if (!PathUtils.hasDoubleSlashes(brokenPath)) {
        return null;
      }

      log.info('Double slash detected');

      // Check if there's a double slash that might indicate missing locale
      const localeSuggestion = await this.tryLocaleInsertion(brokenPath);
      return localeSuggestion;
    }

    log.debug(`Detected locale: ${detectedLocale.getCode()} in path: ${brokenPath}`);

    const similarRoots = LanguageTree.findSimilarLanguageRoots(detectedLocale.getCode());
    for (const similarRoot of similarRoots) {
      const suggestedPath = detectedLocale.replaceInPath(brokenPath, similarRoot);
      log.debug(`Trying locale fallback: ${detectedLocale.getCode()} -> ${similarRoot}`);

      // eslint-disable-next-line no-await-in-loop
      if (await this.getAemAuthorClient().isAvailable(suggestedPath)) {
        log.info(`Found locale fallback for ${brokenPath}: ${detectedLocale.getCode()} -> ${similarRoot}`);
        return Suggestion.locale(brokenPath, suggestedPath);
      }
    }

    return null;
  }

  /**
   * Try to fix double slashes by inserting English fallback locales
   * @param {string} brokenPath - The path with double slashes
   * @returns {Promise<Suggestion|null>} - Locale suggestion if found, null otherwise
   */
  async tryLocaleInsertion(brokenPath) {
    const { log } = this.context;

    // Get all English fallback locales from LanguageTree
    const englishLocales = LanguageTree.findEnglishFallbacks();

    // Try inserting each English locale at the first double slash position
    for (const localeCode of englishLocales) {
      // Replace the first occurrence of // with /locale/
      const localePath = brokenPath.replace('//', `/${localeCode}/`);

      log.debug(`Trying locale insertion: ${brokenPath} -> ${localePath}`);

      // eslint-disable-next-line no-await-in-loop
      if (await this.getAemAuthorClient().isAvailable(localePath)) {
        log.info(`Found content with locale insertion: ${brokenPath} -> ${localePath}`);
        return Suggestion.locale(brokenPath, localePath);
      }
    }

    return null;
  }
}
