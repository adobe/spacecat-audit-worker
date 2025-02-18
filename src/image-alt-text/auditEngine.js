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

import { isNonEmptyArray, hasText } from '@adobe/spacecat-shared-utils';

export default class AuditEngine {
  constructor(log) {
    this.log = log;
    this.auditedTags = {
      imagesWithoutAltText: [],
    };
  }

  performPageAudit(pageUrl, pageTags) {
    if (!isNonEmptyArray(pageTags?.images)) {
      this.log.warn(`No images found for page ${pageUrl}`);
      return;
    }

    pageTags.images.forEach((image) => {
      if (!hasText(image.alt)) {
        this.auditedTags.imagesWithoutAltText.push({
          pageUrl,
          src: image.src,
        });
      }
    });
  }

  finalizeAudit() {
    // Log summary
    this.log.info(
      `Found ${this.auditedTags.imagesWithoutAltText.length} images without alt text`,
    );
  }

  getAuditedTags() {
    return this.auditedTags;
  }
}
