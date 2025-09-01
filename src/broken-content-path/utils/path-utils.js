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

import { Locale } from '../domain/language/locale.js';

export class PathUtils {
  static removeLocaleFromPath(path) {
    if (!path || !path.startsWith('/content/dam/')) {
      return path;
    }

    let removedPath = path;
    // Remove trailing slash from the path
    const endsWithSlash = removedPath.endsWith('/');
    if (endsWithSlash) {
      removedPath = removedPath.slice(0, -1);
    }

    const segments = removedPath.split('/');
    const result = [];
    let hasLocale = false;

    for (const segment of segments) {
      const isLocale = segment.match(Locale.TWO_LETTER_PATTERN)
                      || segment.match(Locale.FIVE_LETTER_PATTERN);
      if (isLocale) {
        hasLocale = true;
      } else {
        result.push(segment);
      }
    }

    if (!hasLocale) {
      return endsWithSlash ? path : removedPath;
    }

    return result.join('/');
  }

  static getParentPath(path) {
    if (!path || !path.startsWith('/content/dam/')) {
      return null;
    }

    let removedPath = path;

    // Remove trailing slash from the path
    if (path.endsWith('/')) {
      removedPath = removedPath.slice(0, -1);
    }

    return removedPath.substring(0, removedPath.lastIndexOf('/'));
  }
}
