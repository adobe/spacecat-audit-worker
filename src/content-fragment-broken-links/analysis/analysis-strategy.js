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

import { PublishRule } from '../rules/publish-rule.js';
import { LocaleFallbackRule } from '../rules/locale-fallback-rule.js';
import { SimilarPathRule } from '../rules/similar-path-rule.js';
import { Suggestion, SuggestionType } from '../domain/suggestion/suggestion.js';

export class AnalysisStrategy {
  static GRAPHQL_SUFFIX = /\.cfm.*\.json$/;

  constructor(context, aemClient, pathIndex) {
    this.context = context;
    this.aemClient = aemClient;
    this.pathIndex = pathIndex;
    this.rules = [
      new PublishRule(context, this.aemClient),
      new LocaleFallbackRule(context, this.aemClient),
      new SimilarPathRule(context, this.aemClient, pathIndex),
    ].sort((a, b) => a.getPriority() - b.getPriority());
  }

  static cleanPath(path) {
    if (AnalysisStrategy.GRAPHQL_SUFFIX.test(path)) {
      return path.replace(AnalysisStrategy.GRAPHQL_SUFFIX, '');
    }
    return path;
  }

  async analyze(brokenPaths) {
    const suggestions = [];

    for (const path of brokenPaths) {
      // eslint-disable-next-line no-await-in-loop
      const suggestion = await this.analyzePath(AnalysisStrategy.cleanPath(path));
      if (suggestion) {
        suggestions.push(suggestion);
      }
    }

    // Post-process suggestions to check content status
    return this.processSuggestions(suggestions);
  }

  async analyzePath(brokenPath) {
    const { log } = this.context;
    log.info(`Analyzing broken path: ${brokenPath}`);

    for (const rule of this.rules) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const suggestion = await rule.apply(brokenPath);

        if (suggestion) {
          log.info(`Rule ${rule.constructor.name} applied to ${brokenPath}`);
          return suggestion;
        }
      } catch (error) {
        log.error(`Error applying rule ${rule.constructor.name} to ${brokenPath}: ${error.message}`);
        // Continue to next rule
      }
    }

    log.warn(`No rules applied to ${brokenPath}`);
    return Suggestion.notFound(brokenPath);
  }

  async processSuggestions(suggestions) {
    const { log } = this.context;
    log.info(`Post-processing ${suggestions.length} suggestions`);

    const processedSuggestions = [];

    for (const suggestion of suggestions) {
      if (suggestion.type !== SuggestionType.LOCALE && suggestion.type !== SuggestionType.SIMILAR) {
        processedSuggestions.push(suggestion);
        // eslint-disable-next-line no-continue
        continue;
      }

      const { suggestedPath } = suggestion;
      log.debug(`Checking content status for suggestion: ${suggestedPath} with type: ${suggestion.type}`);

      // Path must be available as it was suggested
      const contentPath = this.pathIndex.find(suggestedPath);
      const { status } = contentPath;

      if (contentPath.isPublished()) {
        processedSuggestions.push(suggestion);
        log.debug(`Kept original suggestion type for ${suggestedPath} with status: ${status}`);
        // eslint-disable-next-line no-continue
        continue;
      }

      suggestion.reason = `Content is in ${status} state. Suggest publishing.`;
      processedSuggestions.push(suggestion);
    }

    return processedSuggestions;
  }
}
