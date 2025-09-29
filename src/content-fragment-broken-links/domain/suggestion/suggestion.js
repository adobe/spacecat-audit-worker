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

export const SuggestionType = {
  PUBLISH: 'PUBLISH',
  LOCALE: 'LOCALE',
  SIMILAR: 'SIMILAR',
  NOT_FOUND: 'NOT_FOUND',
};

export class Suggestion {
  constructor(requestedPath, suggestedPath, type, reason) {
    this.requestedPath = requestedPath;
    this.suggestedPath = suggestedPath;
    this.type = type;
    this.reason = reason;
  }

  static publish(requestedPath, suggestedPath = null, reason = 'Content exists on Author') {
    return new Suggestion(requestedPath, suggestedPath, SuggestionType.PUBLISH, reason);
  }

  static locale(requestedPath, suggestedPath, reason = 'Locale fallback detected') {
    return new Suggestion(requestedPath, suggestedPath, SuggestionType.LOCALE, reason);
  }

  static similar(requestedPath, suggestedPath, reason = 'Similar path found') {
    return new Suggestion(requestedPath, suggestedPath, SuggestionType.SIMILAR, reason);
  }

  static notFound(requestedPath, reason = 'Not found') {
    return new Suggestion(requestedPath, null, SuggestionType.NOT_FOUND, reason);
  }

  toJSON() {
    return {
      requestedPath: this.requestedPath,
      suggestedPath: this.suggestedPath,
      type: this.type,
      reason: this.reason,
    };
  }
}
