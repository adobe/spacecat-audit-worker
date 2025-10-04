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

import { hasText } from '@adobe/spacecat-shared-utils';
import {
  DESCRIPTION, TITLE, H1, SKU, IMAGE, ISSUE, ISSUE_DETAILS, SEO_IMPACT, HIGH, SEO_RECOMMENDATION,
  MODERATE, MULTIPLE_H1_ON_PAGE, ONE_H1_ON_A_PAGE, TAG_LENGTHS, SHOULD_BE_PRESENT,
  TITLE_LENGTH_SUGGESTION, DESCRIPTION_LENGTH_SUGGESTION, H1_LENGTH_SUGGESTION, UNIQUE_ACROSS_PAGES,
} from './constants.js';

class ProductSeoChecks {
  constructor(log) {
    this.log = log;
    this.detectedTags = {};
    this.allTags = {
      [TITLE]: {},
      [DESCRIPTION]: {},
      [H1]: {},
      [SKU]: {},
      [IMAGE]: {},
    };
    this.healthyTags = {
      [TITLE]: [],
      [DESCRIPTION]: [],
      [H1]: [],
      [SKU]: [],
      [IMAGE]: [],
    };
  }

  /**
   * Capitalises the first character of a given string
   * @param str
   * @returns {string}
   */
  static capitalizeFirstLetter(str) {
    return hasText(str)
      ? str.charAt(0).toUpperCase() + str.slice(1) : str;
  }

  /**
   * Check if a page has product-specific meta tags (SKU is mandatory)
   * @param {object} pageTags - An object containing the tags of the page
   * @returns {boolean} - True if page has SKU meta tag
   */
  static hasProductTags(pageTags) {
    const hasSku = hasText(pageTags[SKU]);
    // SKU is now mandatory for product pages
    return hasSku;
  }

  /**
   * Extract product meta tags from page tags
   * @param {object} pageTags - An object containing the tags of the page
   * @returns {object} - Object with extracted product tags
   */
  static extractProductTags(pageTags) {
    const productTags = {};

    // Extract SKU
    if (hasText(pageTags[SKU])) {
      productTags[SKU] = pageTags[SKU];
    }

    // Extract image (priority order)
    const imageSelectors = ['og:image', 'twitter:image', 'product:image', 'image'];
    for (const selector of imageSelectors) {
      if (hasText(pageTags[selector])) {
        productTags[IMAGE] = pageTags[selector];
        break;
      }
    }

    return productTags;
  }

  /**
   * Checks for missing tags on the page and adds to detected tags array if found lacking.
   * @param {string} urlPath - The URL of the page.
   * @param {object} pageTags - An object containing the tags of the page.
   */
  checkForMissingTags(urlPath, pageTags) {
    [TITLE, DESCRIPTION, H1].forEach((tagName) => {
      if (pageTags[tagName] === undefined
        || (Array.isArray(pageTags[tagName]) && pageTags[tagName].length === 0)) {
        const capitalisedTagName = ProductSeoChecks.capitalizeFirstLetter(tagName);
        this.detectedTags[urlPath] ??= {};
        this.detectedTags[urlPath][tagName] = {
          [SEO_IMPACT]: HIGH,
          [ISSUE]: `Missing ${capitalisedTagName}`,
          [ISSUE_DETAILS]: `${capitalisedTagName} tag is missing`,
          [SEO_RECOMMENDATION]: SHOULD_BE_PRESENT,
        };
      }
    });
  }

  /**
   * Checks if tag lengths are within recommended limits
   * and adds to detected tags array if found lacking.
   * @param {string} urlPath - The URL of the page.
   * @param {object} pageTags - An object containing the tags of the page.
   */
  checkForTagsLength(urlPath, pageTags) {
    const getLengthSuggestion = (tagName) => {
      if (TITLE === tagName.toLowerCase()) {
        return TITLE_LENGTH_SUGGESTION;
      } else if (DESCRIPTION === tagName.toLowerCase()) {
        return DESCRIPTION_LENGTH_SUGGESTION;
      }
      return H1_LENGTH_SUGGESTION;
    };

    const checkTag = (tagName, tagContent) => {
      const capitalizedTagName = ProductSeoChecks.capitalizeFirstLetter(tagName);
      let issueDetails;
      let issueImpact;
      let issue;
      let recommendation;

      if (tagContent === '') {
        issue = `Empty ${capitalizedTagName}`;
        issueDetails = `${capitalizedTagName} tag is empty`;
        issueImpact = HIGH;
        recommendation = getLengthSuggestion(tagName);
      } else if (tagContent?.length > TAG_LENGTHS[tagName].maxLength) {
        issue = `${capitalizedTagName} too long`;
        issueDetails = `${tagContent.length - TAG_LENGTHS[tagName].idealMaxLength} chars over limit`;
        issueImpact = MODERATE;
        recommendation = getLengthSuggestion(tagName);
      } else if (tagContent?.length < TAG_LENGTHS[tagName].minLength) {
        issue = `${capitalizedTagName} too short`;
        issueDetails = `${TAG_LENGTHS[tagName].idealMinLength - tagContent.length} chars under limit`;
        issueImpact = MODERATE;
        recommendation = getLengthSuggestion(tagName);
      } else {
        // Tag is healthy, add to healthy tags
        this.healthyTags[tagName].push({
          url: urlPath,
          tagContent,
        });
        return;
      }

      this.detectedTags[urlPath] ??= {};
      this.detectedTags[urlPath][tagName] = {
        [SEO_IMPACT]: issueImpact,
        [ISSUE]: issue,
        [ISSUE_DETAILS]: issueDetails,
        [SEO_RECOMMENDATION]: recommendation,
        tagContent,
      };
    };

    // Store checkTag as instance method for testing
    this.checkTag = (tagName, tagContent) => checkTag(tagName, tagContent);

    // Check standard tags
    [TITLE, DESCRIPTION].forEach((tagName) => {
      if (hasText(pageTags[tagName])) {
        checkTag(tagName, pageTags[tagName]);
      }
    });

    // Check H1 tags (can be multiple)
    if (Array.isArray(pageTags[H1]) && pageTags[H1].length > 0) {
      pageTags[H1].forEach((h1Content) => {
        if (hasText(h1Content)) {
          checkTag(H1, h1Content);
        }
      });
    }
  }

  /**
   * Checks for multiple H1 tags on the page and adds to detected tags array if found.
   * @param {string} urlPath - The URL of the page.
   * @param {object} pageTags - An object containing the tags of the page.
   */
  checkForMultipleH1Tags(urlPath, pageTags) {
    if (Array.isArray(pageTags[H1]) && pageTags[H1].length > 1) {
      this.detectedTags[urlPath] ??= {};
      this.detectedTags[urlPath][H1] = {
        [SEO_IMPACT]: HIGH,
        [ISSUE]: MULTIPLE_H1_ON_PAGE,
        [ISSUE_DETAILS]: `${pageTags[H1].length} H1 tags found`,
        [SEO_RECOMMENDATION]: ONE_H1_ON_A_PAGE,
        tagContent: pageTags[H1].join(', '),
      };
    }
  }

  /**
   * Adds tag data entry to all Tags Object
   * @param urlPath
   * @param tagName
   * @param tagContent
   */
  addToAllTags(urlPath, tagName, tagContent) {
    if (!tagContent) {
      return;
    }
    const tagContentLowerCase = tagContent.toLowerCase();
    this.allTags[tagName][tagContentLowerCase] ??= {
      pageUrls: new Set(),
      tagContent,
    };
    this.allTags[tagName][tagContentLowerCase].pageUrls.add(urlPath);
  }

  /**
   * Stores all tags for duplicate checking
   * @param {string} urlPath - The URL of the page.
   * @param {object} pageTags - An object containing the tags of the page.
   */
  storeAllTags(urlPath, pageTags) {
    [TITLE, DESCRIPTION, H1].forEach((tagName) => {
      // Handle both string and array cases
      if (
        hasText(pageTags[tagName])
        || (Array.isArray(pageTags[tagName]) && pageTags[tagName].length > 0)
      ) {
        const tagContent = Array.isArray(pageTags[tagName])
          ? pageTags[tagName].join(' ') : pageTags[tagName];
        this.addToAllTags(urlPath, tagName, tagContent);
      }
    });
  }

  /**
   * Performs all SEO checks for a given page
   * @param {string} urlPath - The URL of the page.
   * @param {object} pageTags - An object containing the tags of the page.
   */
  performChecks(urlPath, pageTags) {
    // Skip pages that don't have product tags (SKU or image)
    if (!ProductSeoChecks.hasProductTags(pageTags)) {
      this.log.info(`[PRODUCT-METATAGS] Skipping page ${urlPath} - no product tags found`);
      return;
    }

    this.log.info(`[PRODUCT-METATAGS] Processing product page ${urlPath} - has product tags`);

    this.checkForMissingTags(urlPath, pageTags);
    this.checkForTagsLength(urlPath, pageTags);
    this.checkForMultipleH1Tags(urlPath, pageTags);
    this.storeAllTags(urlPath, pageTags);
  }

  /**
   * Performs final checks for duplicate tags across all pages
   */
  finalChecks() {
    [TITLE, DESCRIPTION, H1].forEach((tagName) => {
      Object.values(this.allTags[tagName]).forEach((value) => {
        if (value?.pageUrls?.size > 1) {
          const capitalisedTagName = ProductSeoChecks.capitalizeFirstLetter(tagName);
          const pageUrls = [...value.pageUrls];
          pageUrls.forEach((url) => {
            this.detectedTags[url] ??= {};
            this.detectedTags[url][tagName] = {
              tagContent: value.tagContent,
              [SEO_IMPACT]: MODERATE,
              [ISSUE]: `Duplicate ${capitalisedTagName}`,
              [ISSUE_DETAILS]: `${pageUrls.length} pages share same ${tagName}`,
              [SEO_RECOMMENDATION]: UNIQUE_ACROSS_PAGES,
              duplicateUrls: pageUrls.filter((u) => u !== url),
            };
          });
        }
      });
    });
  }

  /**
   * Returns the detected tags with issues
   * @returns {object} - Object containing detected tags with issues
   */
  getDetectedTags() {
    return this.detectedTags;
  }

  /**
   * Returns a sample of healthy tags for AI suggestion generation
   * @returns {object} - Object containing healthy tags
   */
  getFewHealthyTags() {
    const fewHealthyTags = {};
    Object.entries(this.healthyTags).forEach(([tagName, tags]) => {
      if (tags.length > 0) {
        // Return up to 3 healthy examples
        fewHealthyTags[tagName] = tags.slice(0, 3);
      }
    });
    return fewHealthyTags;
  }
}

export default ProductSeoChecks;
