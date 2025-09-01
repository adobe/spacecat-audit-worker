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
export class BaseRule {
  constructor(context, priority = 42, aemAuthorClient = null) {
    this.context = context;
    this.priority = priority;
    this.aemAuthorClient = aemAuthorClient;
  }

  async apply(brokenPath) {
    return this.applyRule(brokenPath);
  }

  getPriority() {
    return this.priority;
  }

  getAemAuthorClient() {
    const { log } = this.context;

    if (this.aemAuthorClient) {
      return this.aemAuthorClient;
    }

    log.error('AemAuthorClient not injected');
    throw new Error('AemAuthorClient not injected');
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars, class-methods-use-this
  async applyRule(brokenPath) {
    throw new Error('Subclasses must implement applyRule()');
  }
}
