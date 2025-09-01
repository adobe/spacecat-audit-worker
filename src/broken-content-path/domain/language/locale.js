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
import { LocaleType } from './locale-type.js';

export class Locale {
  static FIVE_LETTER_PATTERN = /^[a-zA-Z]{2}[-_][a-zA-Z]{2}$/;

  static TWO_LETTER_PATTERN = /^[a-zA-Z]{2}$/;

  constructor(code, type, language, country) {
    this.code = code;
    this.type = type;
    this.language = language;
    this.country = country;
  }

  static fromCode(code) {
    if (!code || code.trim().length === 0) {
      return null;
    }

    const normalizedCode = code.trim();

    // Check for 5-letter locale pattern (e.g., en-US, en_US, fr-FR, fr_FR)
    if (Locale.FIVE_LETTER_PATTERN.test(normalizedCode)) {
      const parts = normalizedCode.split(/[-_]/);
      return new Locale(
        normalizedCode,
        LocaleType.FIVE_LETTER_LOCALE,
        parts[0].toLowerCase(),
        parts[1].toUpperCase(),
      );
    }

    // Check for 2-letter country pattern (e.g., US, FR)
    if (Locale.TWO_LETTER_PATTERN.test(normalizedCode)) {
      return new Locale(
        normalizedCode,
        LocaleType.TWO_LETTER_COUNTRY,
        null, // TODO: Add language root mapping
        normalizedCode.toUpperCase(),
      );
    }

    return null;
  }

  static fromPath(path) {
    if (!path) {
      return null;
    }

    const segments = path.split('/');
    for (const segment of segments) {
      const locale = Locale.fromCode(segment);
      if (locale) {
        return locale;
      }
    }

    return null;
  }

  getCode() {
    return this.code;
  }

  getType() {
    return this.type;
  }

  getLanguage() {
    return this.language;
  }

  getCountry() {
    return this.country;
  }

  isValid() {
    return Boolean(this.code && this.code.length > 0);
  }

  replaceInPath(path, newLocale) {
    if (!path || !this.code) {
      return path;
    }

    return path.replace(`/${this.code}/`, `/${newLocale}/`);
  }

  toJSON() {
    return {
      code: this.code,
      type: this.type,
      language: this.language,
      country: this.country,
    };
  }
}
