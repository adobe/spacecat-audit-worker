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
  DESCRIPTION, TITLE, H1, TAG_LENGTHS, ISSUE, ISSUE_DETAILS, SEO_IMPACT, HIGH,
  SEO_RECOMMENDATION, SHOULD_BE_PRESENT, TITLE_LENGTH_SUGGESTION,
  DESCRIPTION_LENGTH_SUGGESTION, H1_LENGTH_SUGGESTION, MODERATE,
  ONE_H1_ON_A_PAGE, UNIQUE_ACROSS_PAGES, DUPLICATES, MULTIPLE_H1_ON_PAGE,
} from './constants.js';

class SeoChecks {
  constructor(log) {
    this.log = log;
    this.detectedTags = {};
    this.allTags = {
      [TITLE]: {},
      [DESCRIPTION]: {},
      [H1]: {},
    };
  }

  /**
   * Capitalises the first character of a given string
   * @param str
   * @returns {string}
   */
  static capitalizeFirstLetter(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
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
        const capitalisedTagName = SeoChecks.capitalizeFirstLetter(tagName);
        this.detectedTags[url] ??= {};
        this.detectedTags[url][tagName] = {
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
   * @param {string} url - The URL of the page.
   * @param {object} pageTags - An object containing the tags of the page.
   */
  checkForTagsLength(url, pageTags) {
    const getLengthSuggestion = (tagName) => {
      if (TITLE === tagName.toLowerCase()) {
        return TITLE_LENGTH_SUGGESTION;
      } else if (DESCRIPTION === tagName.toLowerCase()) {
        return DESCRIPTION_LENGTH_SUGGESTION;
      }
      return H1_LENGTH_SUGGESTION;
    };

    const checkTag = (tagName, tagContent) => {
      const capitalizedTagName = SeoChecks.capitalizeFirstLetter(tagName);
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
        issueDetails = `${TAG_LENGTHS[tagName].idealMinLength - tagContent.length} chars below limit`;
        issueImpact = MODERATE;
        recommendation = getLengthSuggestion(tagName);
      }
      if (issue) {
        this.detectedTags[url] ??= {};
        this.detectedTags[url][tagName] ??= { tagContent };
        Object.assign(this.detectedTags[url][tagName], {
          [SEO_IMPACT]: issueImpact,
          [ISSUE]: issue,
          [ISSUE_DETAILS]: issueDetails,
          [SEO_RECOMMENDATION]: recommendation,
        });
      }
    };
    checkTag(TITLE, pageTags[TITLE]);
    checkTag(DESCRIPTION, pageTags[DESCRIPTION]);
    checkTag(H1, (pageTags[H1] && pageTags[H1][0]) ? pageTags[H1][0] : null);
  }

  /**
   * Checks if there are more than one H1 tags and adds to detected tags array if found lacking.
   * @param {string} url - The URL of the page.
   * @param {object} pageTags - An object containing the tags of the page.
   */
  checkForH1Count(url, pageTags) {
    if (pageTags[H1]?.length > 1) {
      this.detectedTags[url] ??= {};
      this.detectedTags[url][H1] = {
        tagContent: JSON.stringify(pageTags[H1]),
        [SEO_IMPACT]: MODERATE,
        [ISSUE]: MULTIPLE_H1_ON_PAGE,
        [ISSUE_DETAILS]: `${pageTags[H1].length} H1 detected`,
        [SEO_RECOMMENDATION]: ONE_H1_ON_A_PAGE,
      };
    }
  }

  /**
   * Checks for tag uniqueness and adds to detected tags array if found lacking.
   */
  checkForUniqueness() {
    [TITLE, DESCRIPTION, H1].forEach((tagName) => {
      Object.values(this.allTags[tagName]).forEach((value) => {
        if (value?.pageUrls?.size > 1) {
          const capitalisedTagName = SeoChecks.capitalizeFirstLetter(tagName);
          const pageUrls = [...value.pageUrls];
          pageUrls.forEach((url, index) => {
            this.detectedTags[url] ??= {};
            this.detectedTags[url][tagName] = {
              tagContent: value.tagContent,
              [SEO_IMPACT]: HIGH,
              [ISSUE]: `Duplicate ${capitalisedTagName}`,
              [ISSUE_DETAILS]: `${pageUrls.length} pages share same ${tagName}`,
              [SEO_RECOMMENDATION]: UNIQUE_ACROSS_PAGES,
              [DUPLICATES]: [
                ...pageUrls.slice(0, index),
                ...pageUrls.slice(index + 1),
              ],
            };
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
    this.checkForH1Count(url, pageTags);
    this.checkForMissingTags(url, pageTags);
    this.checkForTagsLength(url, pageTags);
    // store tag data in all tags object to be used in later checks like uniqueness
    this.addToAllTags(url, TITLE, pageTags[TITLE]);
    this.addToAllTags(url, DESCRIPTION, pageTags[DESCRIPTION]);
    pageTags[H1].forEach((tagContent) => this.addToAllTags(url, H1, tagContent));
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
}

export default SeoChecks;
