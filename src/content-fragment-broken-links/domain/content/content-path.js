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

export const ContentStatus = {
  PUBLISHED: 'PUBLISHED',
  MODIFIED: 'MODIFIED',
  DRAFT: 'DRAFT',
  ARCHIVED: 'ARCHIVED',
  DELETED: 'DELETED',
  UNKNOWN: 'UNKNOWN',
};

export class ContentPath {
  constructor(path, status, locale) {
    this.path = path;
    this.status = status;
    this.locale = locale;
  }

  isValid() {
    return typeof this.path === 'string' && this.path.trim().length > 0;
  }

  isPublished() {
    return this.status === ContentStatus.PUBLISHED;
  }

  toJSON() {
    return {
      path: this.path,
      status: this.status,
      locale: this.locale?.toJSON?.() || this.locale,
    };
  }
}
