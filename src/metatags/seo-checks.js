/*
 * Copyright 2023 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

import {
  DESCRIPTION, TITLE, H1, TAG_LENGTHS, MISSING_TAGS, EMPTY_TAGS,
  LENGTH_CHECK_FAIL_TAGS, DUPLICATE_TAGS, MULTIPLE_H1_COUNT,
} from './constants.js';

class SeoChecks {
  constructor(log) {
    this.log = log;
    this.detectedTags = {
      [TITLE]: [],
      [DESCRIPTION]: [],
      [H1]: [],
    };
    this.allTags = {
      [TITLE]: {},
      [DESCRIPTION]: {},
      [H1]: {},
    };
  }

  /**
   * Creates a message for length checks.
   * @param {string} tagName - The name of the tag (e.g., 'title', 'description', 'h1').
   * @param {string} tagContent - The content of the tag.
   * @returns {string} - The message indicating the tag length issue.
   */
  static createLengthCheckText(tagName, tagContent = '') {
    let status = 'within';
    if (tagContent.length < TAG_LENGTHS[tagName].minLength) {
      status = 'below';
    } else if (tagContent.length > TAG_LENGTHS[tagName].maxLength) {
      status = 'above';
    }
    const minLength = TAG_LENGTHS[tagName].minLength ? `${TAG_LENGTHS[tagName].minLength}-` : '';
    return `The ${tagName} tag on this page has a length of ${tagContent.length} characters, which is ${status} the recommended length of ${minLength}${TAG_LENGTHS[tagName].maxLength} characters.`;
  }

  /**
   * Checks for missing tags on the page and adds to detected tags array if found lacking.
   * @param {string} url - The URL of the page.
   * @param {object} pageTags - An object containing the tags of the page.
   */
  checkForMissingTags(url, pageTags) {
    [TITLE, DESCRIPTION, H1].forEach((tagName) => {
      if (pageTags[tagName] === undefined
          || (Array.isArray(pageTags[tagName]) && pageTags[tagName].length === 0)) {
        this.detectedTags[tagName][MISSING_TAGS] ??= { pageUrls: [] };
        this.detectedTags[tagName][MISSING_TAGS].pageUrls.push(url);
      }
    });
  }

  /**
   * Checks if tag lengths are within recommended limits
   * and adds to detected tags array if found lacking.
   * @param {string} url - The URL of the page.
   * @param {object} pageTags - An object containing the tags of the page.
   */
  checkForTagsLength(url, pageTags) {
    const checkTag = (tagName, tagContent) => {
      if (tagContent === '') {
        this.detectedTags[tagName][EMPTY_TAGS] ??= { pageUrls: [] };
        this.detectedTags[tagName][EMPTY_TAGS].pageUrls.push(url);
      } else if (tagContent?.length > TAG_LENGTHS[tagName].maxLength
        || tagContent?.length < TAG_LENGTHS[tagName].minLength) {
        this.detectedTags[tagName][LENGTH_CHECK_FAIL_TAGS] ??= {};
        this.detectedTags[tagName][LENGTH_CHECK_FAIL_TAGS].url = url;
        this.detectedTags[tagName][LENGTH_CHECK_FAIL_TAGS].tagContent = tagContent;
      }
    };
    checkTag(TITLE, pageTags[TITLE]);
    checkTag(DESCRIPTION, pageTags[DESCRIPTION]);
    checkTag(H1, pageTags[H1][0]);
  }

  /**
   * Checks if there are more than one H1 tags and adds to detected tags array if found lacking.
   * @param {string} url - The URL of the page.
   * @param {object} pageTags - An object containing the tags of the page.
   */
  checkForH1Count(url, pageTags) {
    if (pageTags[H1]?.length > 1) {
      this.detectedTags[H1][MULTIPLE_H1_COUNT] ??= [];
      this.detectedTags[H1][MULTIPLE_H1_COUNT].push({
        pageUrl: url,
        tagContent: JSON.stringify(pageTags[H1]),
      });
    }
  }

  /**
   * Checks for tag uniqueness and adds to detected tags array if found lacking.
   */
  checkForUniqueness() {
    [TITLE, DESCRIPTION, H1].forEach((tagName) => {
      Object.values(this.allTags[tagName]).forEach((value) => {
        if (value?.pageUrls?.size > 1) {
          this.detectedTags[tagName][DUPLICATE_TAGS] ??= [];
          this.detectedTags[tagName][DUPLICATE_TAGS].push({
            tagContent: value.tagContent,
            pageUrls: Array.from(value.pageUrls),
          });
        }
      });
    });
  }

  /**
   * Adds tag data entry to all Tags Object
   * @param url
   * @param tagName
   * @param tagContent
   */
  addToAllTags(url, tagName, tagContent) {
    if (!tagContent) {
      return;
    }
    const tagContentLowerCase = tagContent.toLowerCase();
    this.allTags[tagName][tagContentLowerCase] ??= {
      pageUrls: new Set(),
      tagContent,
    };
    this.allTags[tagName][tagContentLowerCase].pageUrls.add(url);
  }

  /**
   * Performs all SEO checks on the provided tags.
   * @param {string} url - The URL of the page.
   * @param {object} pageTags - An object containing the tags of the page.
   */
  performChecks(url, pageTags) {
    this.checkForMissingTags(url, pageTags);
    this.checkForTagsLength(url, pageTags);
    this.checkForH1Count(url, pageTags);
    // store tag data in all tags object to be used in later checks like uniqueness
    this.addToAllTags(TITLE, pageTags[TITLE]);
    this.addToAllTags(DESCRIPTION, pageTags[DESCRIPTION]);
    pageTags[H1].forEach((tagContent) => this.addToAllTags(H1, tagContent));
  }

  /**
   * Gets the detected tags for the site.
   * @returns {object} - The detected tags object.
   */
  getDetectedTags() {
    return this.detectedTags;
  }

  finalChecks() {
    this.checkForUniqueness();
  }

  /**
   * Processes detected tags, including sorting non-unique H1 tags.
   */
  // organizeDetectedTags() {
  // }
}

export default SeoChecks;
