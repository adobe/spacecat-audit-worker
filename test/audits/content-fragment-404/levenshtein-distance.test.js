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

/* eslint-env mocha */
import { expect } from 'chai';
import { LevenshteinDistance } from '../../../src/content-fragment-404/utils/levenshtein-distance.js';
import {
  DISTANCE_SINGLE_CHAR,
  DISTANCE_TWO_CHARS,
  DISTANCE_THREE_CHARS,
  DISTANCE_FOUR_CHARS,
  STRING_LENGTH_HELLO,
  TEST_PATH_EN_US_IMAGES_PHOTO_JPG,
  TEST_PATH_EN_US_IMAGES_PHOTO_PNG,
  TEST_PATH_FR_FR_IMAGES_PHOTO_JPG,
} from './test-constants.js';

describe('LevenshteinDistance', () => {
  describe('calculate', () => {
    it('should throw error for null source', () => {
      expect(() => LevenshteinDistance.calculate(null, 'target')).to.throw('Strings cannot be null');
    });

    it('should throw error for null target', () => {
      expect(() => LevenshteinDistance.calculate('source', null)).to.throw('Strings cannot be null');
    });

    it('should return 0 for identical strings', () => {
      expect(LevenshteinDistance.calculate('hello', 'hello')).to.equal(0);
    });

    it('should return target length for empty source', () => {
      expect(LevenshteinDistance.calculate('', 'hello')).to.equal(STRING_LENGTH_HELLO);
    });

    it('should return source length for empty target', () => {
      expect(LevenshteinDistance.calculate('hello', '')).to.equal(STRING_LENGTH_HELLO);
    });

    it('should return 0 for both empty strings', () => {
      expect(LevenshteinDistance.calculate('', '')).to.equal(0);
    });

    it('should calculate distance for single character difference', () => {
      expect(LevenshteinDistance.calculate('hello', 'helo')).to.equal(DISTANCE_SINGLE_CHAR);
      expect(LevenshteinDistance.calculate('hello', 'hallo')).to.equal(DISTANCE_SINGLE_CHAR);
      expect(LevenshteinDistance.calculate('hello', 'hell')).to.equal(DISTANCE_SINGLE_CHAR);
      expect(LevenshteinDistance.calculate('hello', 'helloo')).to.equal(DISTANCE_SINGLE_CHAR);
    });

    it('should calculate distance for multiple character differences', () => {
      expect(LevenshteinDistance.calculate('hello', 'world')).to.equal(DISTANCE_FOUR_CHARS);
      expect(LevenshteinDistance.calculate('kitten', 'sitting')).to.equal(DISTANCE_THREE_CHARS);
      expect(LevenshteinDistance.calculate('saturday', 'sunday')).to.equal(DISTANCE_THREE_CHARS);
    });

    it('should handle case differences', () => {
      expect(LevenshteinDistance.calculate('Hello', 'hello')).to.equal(DISTANCE_SINGLE_CHAR);
      expect(LevenshteinDistance.calculate('HELLO', 'hello')).to.equal(STRING_LENGTH_HELLO);
    });

    it('should handle special characters', () => {
      expect(LevenshteinDistance.calculate('hello-world', 'hello_world')).to.equal(DISTANCE_SINGLE_CHAR);
      expect(LevenshteinDistance.calculate('test@example.com', 'test.example.com')).to.equal(DISTANCE_SINGLE_CHAR);
    });

    it('should handle numbers', () => {
      expect(LevenshteinDistance.calculate('12345', '12346')).to.equal(DISTANCE_SINGLE_CHAR);
      expect(LevenshteinDistance.calculate('12345', '1234')).to.equal(DISTANCE_SINGLE_CHAR);
      expect(LevenshteinDistance.calculate('12345', '123456')).to.equal(DISTANCE_SINGLE_CHAR);
    });

    it('should handle mixed content', () => {
      expect(LevenshteinDistance.calculate('test123', 'test124')).to.equal(DISTANCE_SINGLE_CHAR);
      expect(LevenshteinDistance.calculate('user@domain.com', 'user@domain.org')).to.equal(DISTANCE_THREE_CHARS);
    });

    it('should handle very long strings', () => {
      const longString1 = 'a'.repeat(100);
      const longString2 = `${'a'.repeat(99)}b`;
      expect(LevenshteinDistance.calculate(longString1, longString2)).to.equal(DISTANCE_SINGLE_CHAR);
    });

    it('should handle path-like strings', () => {
      expect(LevenshteinDistance.calculate(TEST_PATH_EN_US_IMAGES_PHOTO_JPG, TEST_PATH_EN_US_IMAGES_PHOTO_PNG)).to.equal(DISTANCE_TWO_CHARS);
      expect(LevenshteinDistance.calculate(TEST_PATH_EN_US_IMAGES_PHOTO_JPG, TEST_PATH_FR_FR_IMAGES_PHOTO_JPG)).to.equal(DISTANCE_FOUR_CHARS);
    });

    it('should handle locale variations', () => {
      expect(LevenshteinDistance.calculate('en-US', 'en-GB')).to.equal(DISTANCE_TWO_CHARS);
      expect(LevenshteinDistance.calculate('fr-FR', 'fr-CA')).to.equal(DISTANCE_TWO_CHARS);
      expect(LevenshteinDistance.calculate('de-DE', 'de-AT')).to.equal(DISTANCE_TWO_CHARS);
    });

    it('should handle complex transformations', () => {
      expect(LevenshteinDistance.calculate('kitten', 'sitting')).to.equal(DISTANCE_THREE_CHARS);
      expect(LevenshteinDistance.calculate('saturday', 'sunday')).to.equal(DISTANCE_THREE_CHARS);
    });
  });
});
