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
import { LevenshteinDistance } from '../utils/levenshtein-distance.js';
import { PathUtils } from '../utils/path-utils.js';

export class SimilarPathRule extends BaseRule {
  constructor(context, aemAuthorClient, pathIndex) {
    super(context, 3, aemAuthorClient); // Third priority
    this.pathIndex = pathIndex;
  }

  async applyRule(brokenPath) {
    const { log } = this.context;
    log.debug(`Applying SimilarPathRule to path: ${brokenPath}`);

    let path = brokenPath;
    const result = await this.checkDoubleSlash(brokenPath);
    if (result) {
      // If we have a suggestion, return it directly
      if (result.suggestion) {
        return result.suggestion;
      }
      // If we have a fixed path but no suggestion, continue with checks using the fixed path
      if (result.fixedPath) {
        path = result.fixedPath;
        log.debug(`Continuing similarity check with fixed path: ${path}`);
      }
    }

    const parentPath = PathUtils.getParentPath(path);
    if (!parentPath) {
      log.debug(`No parent path found for: ${path}`);
      return null;
    }

    // We are traversing up the hierarchy until we find a path that is available on Author
    const childrenPaths = await this.getAemAuthorClient().getChildrenFromPath(
      path,
      this.context,
    );
    if (childrenPaths.length === 0) {
      log.debug(`No children paths found for parent: ${path}`);
      return null;
    }

    // Use Levenshtein distance <= 1 for typos
    const similar = SimilarPathRule.findSimilarPath(path, childrenPaths, 1);
    if (similar) {
      log.info(`Found similar path for ${path}: ${similar.path}`);
      return Suggestion.similar(path, similar.path);
    }

    return null;
  }

  /**
   * Check if the broken path can be fixed by removing double slashes
   * @param {string} brokenPath - The path with potential double slashes
   * @returns {Promise<{suggestion: Suggestion|null, fixedPath: string|null}|null>}
   * Object with suggestion and fixedPath fields, null if no double slashes
   */
  async checkDoubleSlash(brokenPath) {
    const { log } = this.context;

    // Check if path contains double slashes
    if (!PathUtils.hasDoubleSlashes(brokenPath)) {
      return null;
    }

    // Remove double slashes by replacing them with single slashes
    const fixedPath = PathUtils.removeDoubleSlashes(brokenPath);

    log.debug(`Checking double slash removal: ${brokenPath} -> ${fixedPath}`);

    // Check if the fixed path exists on Author
    if (await this.getAemAuthorClient().isAvailable(fixedPath)) {
      log.info(`Found content for double-slash corrected path: ${brokenPath} -> ${fixedPath}`);
      return { suggestion: Suggestion.similar(brokenPath, fixedPath), fixedPath };
    }

    log.debug(`Fixed path not available on Author, will continue with similarity check: ${fixedPath}`);
    return { suggestion: null, fixedPath };
  }

  static findSimilarPath(brokenPath, candidatePaths, maxDistance) {
    // Extract non-locale parts for comparison
    const brokenPathWithoutLocale = PathUtils.removeLocaleFromPath(brokenPath);

    // Find the best match by comparing non-locale parts
    let closestMatch = null;
    let bestDistance = Infinity;

    for (const candidatePath of candidatePaths) {
      const candidateWithoutLocale = PathUtils.removeLocaleFromPath(candidatePath.path);

      const distance = LevenshteinDistance.calculate(
        brokenPathWithoutLocale,
        candidateWithoutLocale,
      );

      if (distance <= maxDistance && distance < bestDistance) {
        bestDistance = distance;
        closestMatch = candidatePath;
      }
    }

    return closestMatch;
  }
}
