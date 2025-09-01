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
export class LevenshteinDistance {
  static calculate(source, target) {
    if (source === null || target === null) {
      throw new Error('Strings cannot be null');
    }

    const sourceLength = source.length;
    const targetLength = target.length;

    if (sourceLength === 0) return targetLength;
    if (targetLength === 0) return sourceLength;

    const distance = Array.from(
      { length: sourceLength + 1 },
      () => Array(targetLength + 1).fill(0),
    );

    for (let i = 0; i <= sourceLength; i += 1) {
      distance[i][0] = i;
    }

    for (let j = 0; j <= targetLength; j += 1) {
      distance[0][j] = j;
    }

    for (let i = 1; i <= sourceLength; i += 1) {
      for (let j = 1; j <= targetLength; j += 1) {
        if (source.charAt(i - 1) === target.charAt(j - 1)) {
          distance[i][j] = distance[i - 1][j - 1];
        } else {
          distance[i][j] = Math.min(
            distance[i - 1][j - 1] + 1,
            Math.min(
              distance[i - 1][j] + 1,
              distance[i][j - 1] + 1,
            ),
          );
        }
      }
    }

    return distance[sourceLength][targetLength];
  }
}
