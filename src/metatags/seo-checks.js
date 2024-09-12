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
  DESCRIPTION,
  TITLE,
  H1,
  TAG_LENGTHS,
  HIGH,
  MODERATE, NON_UNIQUE,
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
   * Adds an entry to the detected tags array.
   * @param {string} pageUrl - The URL of the page.
   * @param {string} tagName - The name of the tag (e.g., 'title', 'description', 'h1').
   * @param {string} tagContent - The content of the tag.
   * @param {string} seoImpact - The impact level of the issue (e.g., 'High', 'Moderate').
   * @param {string} seoOpportunityText - The text describing the SEO opportunity or issue.
   */
  addDetectedTagEntry(pageUrl, tagName, tagContent, seoImpact, seoOpportunityText) {
    this.detectedTags[tagName].push({
      pageUrl,
      tagName,
      tagContent,
      seoImpact,
      seoOpportunityText,
    });
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
        this.addDetectedTagEntry(
          url,
          tagName,
          '',
          HIGH,
          `The ${tagName} tag on this page is missing. It's recommended to have a ${tagName} tag on each page.`,
        );
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
    [TITLE, DESCRIPTION].forEach((tagName) => {
      if (pageTags[tagName]?.length > TAG_LENGTHS[tagName].maxLength
          || pageTags[tagName]?.length < TAG_LENGTHS[tagName].minLength) {
        this.addDetectedTagEntry(
          url,
          tagName,
          pageTags[tagName],
          MODERATE,
          SeoChecks.createLengthCheckText(tagName, pageTags[tagName]),
        );
      }
    });

    if (Array.isArray(pageTags[H1]) && pageTags[H1][0]?.length > TAG_LENGTHS[H1].maxLength) {
      this.addDetectedTagEntry(
        url,
        H1,
        pageTags[H1][0],
        MODERATE,
        SeoChecks.createLengthCheckText(H1, pageTags[H1][0]),
      );
    }
  }

  /**
   * Checks if there are more than one H1 tags and adds to detected tags array if found lacking.
   * @param {string} url - The URL of the page.
   * @param {object} pageTags - An object containing the tags of the page.
   */
  checkForH1Count(url, pageTags) {
    if (Array.isArray(pageTags[H1]) && pageTags[H1]?.length > 1) {
      this.addDetectedTagEntry(
        url,
        H1,
        JSON.stringify(pageTags[H1]),
        MODERATE,
        `There are ${pageTags[H1].length} H1 tags on this page, which is more than the recommended count of 1.`,
      );
    }
  }

  /**
   * Checks for tag uniqueness and adds to detected tags array if found lacking.
   * @param {object} pageTags - An object containing the tags of the page.
   * @param {string} url - The URL of the page.
   */
  checkForUniqueness(url, pageTags) {
    const tags = {
      [TITLE]: pageTags[TITLE],
      [DESCRIPTION]: pageTags[DESCRIPTION],
      [H1]: Array.isArray(pageTags[H1]) ? pageTags[H1] : [],
    };
    [TITLE, DESCRIPTION].forEach((tagName) => {
      const tagContent = tags[tagName];
      if (tagContent && this.allTags[tagName][tagContent.toLowerCase()]) {
        this.addDetectedTagEntry(
          url,
          tagName,
          tagContent,
          HIGH,
          `The ${tagName} tag on this page is identical to the one on ${this.allTags[tagName][tagContent.toLowerCase()]}. `
          + `It's recommended to have unique ${tagName} tags for each page.`,
        );
      }
      this.allTags[tagName][tagContent?.toLowerCase()] = url;
    });
    tags[H1].forEach((tag) => {
      this.allTags[H1][tag] ??= { count: 0, urls: [] };
      this.allTags[H1][tag].urls.push(url);
      this.allTags[H1][tag].count += 1;

      if (this.allTags[H1][tag].count > 1) {
        this.detectedTags[H1][NON_UNIQUE] ??= {};
        this.detectedTags[H1][NON_UNIQUE][tag] = { ...this.allTags[H1][tag] };
      }
    });
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
    this.checkForUniqueness(url, pageTags);
  }

  /**
   * Gets the detected tags for the site.
   * @returns {object} - The detected tags object.
   */
  getDetectedTags() {
    return this.detectedTags;
  }
}

export default SeoChecks;
