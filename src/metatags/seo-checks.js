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

import { hasText, isObject } from '@adobe/spacecat-shared-utils';
import {
  DESCRIPTION, TITLE, H1, ISSUE, ISSUE_DETAILS, SEO_IMPACT, HIGH, SEO_RECOMMENDATION,
  MODERATE, MULTIPLE_H1_ON_PAGE, ONE_H1_ON_A_PAGE, TAG_LENGTHS, SHOULD_BE_PRESENT,
  TITLE_LENGTH_SUGGESTION, DESCRIPTION_LENGTH_SUGGESTION, H1_LENGTH_SUGGESTION, UNIQUE_ACROSS_PAGES,
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
    this.healthyTags = {
      [TITLE]: [],
      [DESCRIPTION]: [],
      [H1]: [],
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
   * Checks for missing tags on the page and adds to detected tags array if found lacking.
   * @param {string} urlPath - The URL of the page.
   * @param {object} pageTags - An object containing the tags of the page.
   */
  checkForMissingTags(urlPath, pageTags) {
    [TITLE, DESCRIPTION, H1].forEach((tagName) => {
      if (pageTags[tagName] === undefined
        || (Array.isArray(pageTags[tagName]) && pageTags[tagName].length === 0)) {
        const capitalisedTagName = SeoChecks.capitalizeFirstLetter(tagName);
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
        this.detectedTags[urlPath] ??= {};
        this.detectedTags[urlPath][tagName] ??= {};
        Object.assign(this.detectedTags[urlPath][tagName], {
          [SEO_IMPACT]: issueImpact,
          [ISSUE]: issue,
          [ISSUE_DETAILS]: issueDetails,
          [SEO_RECOMMENDATION]: recommendation,
          ...(tagContent && { tagContent }),
        });
      } else {
        this.healthyTags[tagName].push(tagContent);
      }
    };
    checkTag(TITLE, pageTags[TITLE]);
    checkTag(DESCRIPTION, pageTags[DESCRIPTION]);
    checkTag(H1, (pageTags[H1] && pageTags[H1][0]) ? pageTags[H1][0] : null);
  }

  /**
   * Checks if there are more than one H1 tags and adds to detected tags array if found lacking.
   * @param {string} urlPath - The URL of the page.
   * @param {object} pageTags - An object containing the tags of the page.
   */
  checkForH1Count(urlPath, pageTags) {
    if (pageTags[H1]?.length > 1) {
      this.detectedTags[urlPath] ??= {};
      this.detectedTags[urlPath][H1] = {
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
          pageUrls.forEach((url) => {
            this.detectedTags[url] ??= {};
            this.detectedTags[url][tagName] = {
              tagContent: value.tagContent,
              [SEO_IMPACT]: HIGH,
              [ISSUE]: `Duplicate ${capitalisedTagName}`,
              [ISSUE_DETAILS]: `${pageUrls.length} pages share same ${tagName}`,
              [SEO_RECOMMENDATION]: UNIQUE_ACROSS_PAGES,
            };
          });
        }
      });
    });
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
   * Performs all SEO checks on the provided tags.
   * @param {string} urlPath - Endpoint of the URL of the page.
   * @param {object} pageTags - An object containing the tags of the page.
   */
  performChecks(urlPath, pageTags) {
    if (!hasText(urlPath) || !isObject(pageTags)) {
      return;
    }
    this.checkForMissingTags(urlPath, pageTags);
    this.checkForTagsLength(urlPath, pageTags);
    this.checkForH1Count(urlPath, pageTags);
    // store tag data in all tags object to be used in later checks like uniqueness
    this.addToAllTags(urlPath, TITLE, pageTags[TITLE]);
    this.addToAllTags(urlPath, DESCRIPTION, pageTags[DESCRIPTION]);
    pageTags[H1].forEach((tagContent) => this.addToAllTags(urlPath, H1, tagContent));
  }

  /**
   * Gets the detected tags for the site.
   * @returns {object} - The detected tags object.
   */
  getDetectedTags() {
    return this.detectedTags;
  }

  /**
   * Gets 20 healthy tags for this site, later to be used to generate brand guidelines
   * @returns {*|{[p: string]: [], "[DESCRIPTION]": *[], "[H1]": *[], "[TITLE]": *[]}}
   */
  getFewHealthyTags() {
    return {
      [TITLE]: this.healthyTags[TITLE].slice(0, 20),
      [DESCRIPTION]: this.healthyTags[DESCRIPTION].slice(0, 20),
      [H1]: this.healthyTags[H1].slice(0, 20),
    };
  }

  finalChecks() {
    this.checkForUniqueness();
  }
}

export default SeoChecks;
