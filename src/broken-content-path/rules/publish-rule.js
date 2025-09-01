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

export class PublishRule extends BaseRule {
  constructor(context, aemAuthorClient) {
    super(context, 1, aemAuthorClient); // Highest priority
  }

  async applyRule(brokenPath) {
    const { log } = this.context;
    log.debug(`Applying PublishRule to path: ${brokenPath}`);

    if (await this.getAemAuthorClient().isAvailable(brokenPath)) {
      log.info(`Found content on Author for path: ${brokenPath}`);
      return Suggestion.publish(brokenPath);
    }

    return null;
  }
}
