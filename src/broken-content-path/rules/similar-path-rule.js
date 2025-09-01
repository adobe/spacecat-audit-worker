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

    const parentPath = PathUtils.getParentPath(brokenPath);
    if (!parentPath) {
      log.debug(`No parent path found for: ${brokenPath}`);
      return null;
    }

    log.debug(`Getting children from parent folder: ${parentPath}`);

    // We are traversing up the hierarchy until we find a path that is available on Author
    const childrenPaths = await this.getAemAuthorClient().getChildrenFromPath(
      parentPath,
      this.context,
    );
    if (childrenPaths.length === 0) {
      log.debug(`No children paths found for parent: ${parentPath}`);
      return null;
    }

    // Use Levenshtein distance <= 1 for typos
    const similar = SimilarPathRule.findSimilarPath(brokenPath, childrenPaths, 1);
    if (similar) {
      log.info(`Found similar path for ${brokenPath}: ${similar.path}`);
      return Suggestion.similar(brokenPath, similar.path);
    }

    return null;
  }

  static findSimilarPath(brokenPath, candidatePaths, maxDistance) {
    const { log } = this.context;
    log.debug(
      `Looking for similar path to: ${brokenPath} with max distance: ${maxDistance} among ${candidatePaths.length} candidates`,
    );

    // Extract non-locale parts for comparison
    const brokenPathWithoutLocale = PathUtils.removeLocaleFromPath(brokenPath);
    log.debug(`Broken path without locale: ${brokenPathWithoutLocale}`);

    // Find the best match by comparing non-locale parts
    let closestMatch = null;
    let bestDistance = Infinity;

    for (const candidatePath of candidatePaths) {
      const candidateWithoutLocale = PathUtils.removeLocaleFromPath(candidatePath.path);
      log.debug(`Candidate path without locale: ${candidateWithoutLocale}`);

      const distance = LevenshteinDistance.calculate(
        brokenPathWithoutLocale,
        candidateWithoutLocale,
      );

      if (distance <= maxDistance && distance < bestDistance) {
        bestDistance = distance;
        closestMatch = candidatePath;
        log.debug(`Found better match: ${candidatePath.path} (distance: ${distance})`);
      }
    }

    return closestMatch;
  }
}
