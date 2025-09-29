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

export class LanguageTree {
  // 2-letter country code language groups
  static COUNTRY_CODE_GROUPS = {
    FR: ['FR', 'MC'],
    DE: ['DE', 'AT', 'LI'],
    US: ['US', 'GB', 'CA', 'AU', 'NZ', 'IE'],
    ES: ['ES', 'MX', 'AR', 'CO', 'PE', 'VE'],
    IT: ['IT', 'SM', 'VA'],
    CN: ['CN', 'TW', 'HK', 'MO', 'SG'],
    RU: ['RU', 'BY', 'KZ', 'KG', 'TJ', 'UZ'],
  };

  // 5-letter locale code language groups
  static LOCALE_CODE_GROUPS = {
    'fr-FR': ['fr-FR', 'ca-FR', 'fr-CA', 'fr-BE', 'fr-CH'],
    'de-DE': ['de-DE', 'de-AT', 'de-CH', 'de-LU'],
    'en-US': ['en-US', 'en-GB', 'en-CA', 'en-AU', 'en-NZ'],
    'es-ES': ['es-ES', 'es-MX', 'es-AR', 'es-CO'],
    'it-IT': ['it-IT', 'it-CH'],
    'zh-CN': ['zh-CN', 'zh-TW', 'zh-HK', 'zh-MO'],
    'ru-RU': ['ru-RU', 'ru-BY', 'ru-KZ'],
  };

  // Reverse mappings
  static COUNTRY_TO_ROOT = {};

  static LOCALE_TO_ROOT = {};

  static {
    // Build reverse mappings
    LanguageTree.buildReverseMappings();
  }

  static buildReverseMappings() {
    // Build country to root mappings
    for (const [root, children] of Object.entries(LanguageTree.COUNTRY_CODE_GROUPS)) {
      for (const child of children) {
        LanguageTree.COUNTRY_TO_ROOT[child] = root;
      }
    }

    // Build locale to root mappings
    for (const [root, children] of Object.entries(LanguageTree.LOCALE_CODE_GROUPS)) {
      for (const child of children) {
        LanguageTree.LOCALE_TO_ROOT[child] = root;
      }
    }
  }

  static findSimilarLanguageRoots(locale) {
    if (!locale || locale.length === 0) {
      return [];
    }

    const similarRoots = [];

    // Generate case variations
    const caseVariations = LanguageTree.generateCaseVariations(locale);
    similarRoots.push(...caseVariations);

    // Always add English as default fallback
    similarRoots.push(...LanguageTree.findEnglishFallbacks());

    // Find root for locale and add siblings
    const languageRoot = LanguageTree.findRootForLocale(locale);
    if (languageRoot) {
      const siblings = LanguageTree.LOCALE_CODE_GROUPS[languageRoot]
                      || LanguageTree.COUNTRY_CODE_GROUPS[languageRoot]
                      || [];

      similarRoots.push(...siblings);

      // Don't include itself
      const index = similarRoots.indexOf(locale);
      if (index > -1) {
        similarRoots.splice(index, 1);
      }
    }

    return similarRoots;
  }

  static generateCaseVariations(locale) {
    const variations = [];

    if (!locale || locale.length === 0) {
      return variations;
    }

    if (locale.length === 2) {
      variations.push(locale.toLowerCase());
      variations.push(locale.toUpperCase());
    }

    if (locale.length === 5 && (locale.includes('-') || locale.includes('_'))) {
      const parts = locale.split(/[-_]/);
      if (parts.length === 2) {
        const language = parts[0];
        const country = parts[1];

        // Generate different case combinations with hyphens
        variations.push(`${language.toLowerCase()}-${country.toLowerCase()}`);
        variations.push(`${language.toLowerCase()}-${country.toUpperCase()}`);
        variations.push(`${language.toUpperCase()}-${country.toLowerCase()}`);
        variations.push(`${language.toUpperCase()}-${country.toUpperCase()}`);

        // Generate different case combinations with underscores
        variations.push(`${language.toLowerCase()}_${country.toLowerCase()}`);
        variations.push(`${language.toLowerCase()}_${country.toUpperCase()}`);
        variations.push(`${language.toUpperCase()}_${country.toLowerCase()}`);
        variations.push(`${language.toUpperCase()}_${country.toUpperCase()}`);
      }
    }

    // Remove itself from variations
    const index = variations.indexOf(locale);
    if (index > -1) {
      variations.splice(index, 1);
    }

    return variations;
  }

  static findRootForLocale(locale) {
    if (!locale || locale.length === 0) {
      return null;
    }

    const root2 = LanguageTree.COUNTRY_TO_ROOT[locale];
    if (root2) {
      return root2;
    }

    const root5 = LanguageTree.LOCALE_TO_ROOT[locale];
    if (root5) {
      return root5;
    }

    // If not found, the locale might be a root itself
    if (LanguageTree.COUNTRY_CODE_GROUPS[locale] || LanguageTree.LOCALE_CODE_GROUPS[locale]) {
      return locale;
    }

    return null;
  }

  static findEnglishFallbacks() {
    return [
      'us', 'US', 'en-us', 'en_us', 'en-US', 'en_US',
      'gb', 'GB', 'en-gb', 'en_gb', 'en-GB', 'en_GB',
    ];
  }
}
