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
import { Suggestion, SuggestionType } from '../../../src/content-fragment-broken-links/domain/suggestion/suggestion.js';

describe('Suggestion', () => {
  describe('SuggestionType enum', () => {
    it('should have all expected suggestion types', () => {
      expect(SuggestionType.PUBLISH).to.equal('PUBLISH');
      expect(SuggestionType.LOCALE).to.equal('LOCALE');
      expect(SuggestionType.SIMILAR).to.equal('SIMILAR');
      expect(SuggestionType.NOT_FOUND).to.equal('NOT_FOUND');
    });
  });

  describe('constructor', () => {
    it('should create a suggestion with all parameters', () => {
      const requestedPath = '/content/dam/test/broken.jpg';
      const suggestedPath = '/content/dam/test/fixed.jpg';
      const type = SuggestionType.SIMILAR;
      const reason = 'Test reason';

      const suggestion = new Suggestion(requestedPath, suggestedPath, type, reason);

      expect(suggestion.requestedPath).to.equal(requestedPath);
      expect(suggestion.suggestedPath).to.equal(suggestedPath);
      expect(suggestion.type).to.equal(type);
      expect(suggestion.reason).to.equal(reason);
    });

    it('should create a suggestion with null suggestedPath', () => {
      const requestedPath = '/content/dam/test/broken.jpg';
      const type = SuggestionType.NOT_FOUND;
      const reason = 'Content not found';

      const suggestion = new Suggestion(requestedPath, null, type, reason);

      expect(suggestion.requestedPath).to.equal(requestedPath);
      expect(suggestion.suggestedPath).to.be.null;
      expect(suggestion.type).to.equal(type);
      expect(suggestion.reason).to.equal(reason);
    });

    it('should create a suggestion with undefined parameters', () => {
      const suggestion = new Suggestion(undefined, undefined, undefined, undefined);

      expect(suggestion.requestedPath).to.be.undefined;
      expect(suggestion.suggestedPath).to.be.undefined;
      expect(suggestion.type).to.be.undefined;
      expect(suggestion.reason).to.be.undefined;
    });

    it('should create a suggestion with empty string parameters', () => {
      const suggestion = new Suggestion('', '', '', '');

      expect(suggestion.requestedPath).to.equal('');
      expect(suggestion.suggestedPath).to.equal('');
      expect(suggestion.type).to.equal('');
      expect(suggestion.reason).to.equal('');
    });
  });

  describe('static factory methods', () => {
    describe('publish', () => {
      it('should create a PUBLISH suggestion with default parameters', () => {
        const requestedPath = '/content/dam/test/image.jpg';
        const suggestion = Suggestion.publish(requestedPath);

        expect(suggestion.requestedPath).to.equal(requestedPath);
        expect(suggestion.suggestedPath).to.be.null;
        expect(suggestion.type).to.equal(SuggestionType.PUBLISH);
        expect(suggestion.reason).to.equal('Content exists on Author');
      });

      it('should create a PUBLISH suggestion with custom suggestedPath', () => {
        const requestedPath = '/content/dam/test/image.jpg';
        const suggestedPath = '/content/dam/test/published-image.jpg';
        const suggestion = Suggestion.publish(requestedPath, suggestedPath);

        expect(suggestion.requestedPath).to.equal(requestedPath);
        expect(suggestion.suggestedPath).to.equal(suggestedPath);
        expect(suggestion.type).to.equal(SuggestionType.PUBLISH);
        expect(suggestion.reason).to.equal('Content exists on Author');
      });

      it('should create a PUBLISH suggestion with custom reason', () => {
        const requestedPath = '/content/dam/test/image.jpg';
        const customReason = 'Custom publish reason';
        const suggestion = Suggestion.publish(requestedPath, null, customReason);

        expect(suggestion.requestedPath).to.equal(requestedPath);
        expect(suggestion.suggestedPath).to.be.null;
        expect(suggestion.type).to.equal(SuggestionType.PUBLISH);
        expect(suggestion.reason).to.equal(customReason);
      });

      it('should create a PUBLISH suggestion with all custom parameters', () => {
        const requestedPath = '/content/dam/test/image.jpg';
        const suggestedPath = '/content/dam/test/published-image.jpg';
        const customReason = 'Available for publishing';
        const suggestion = Suggestion.publish(requestedPath, suggestedPath, customReason);

        expect(suggestion.requestedPath).to.equal(requestedPath);
        expect(suggestion.suggestedPath).to.equal(suggestedPath);
        expect(suggestion.type).to.equal(SuggestionType.PUBLISH);
        expect(suggestion.reason).to.equal(customReason);
      });
    });

    describe('locale', () => {
      it('should create a LOCALE suggestion with default reason', () => {
        const requestedPath = '/content/dam/fr-fr/test/image.jpg';
        const suggestedPath = '/content/dam/en-us/test/image.jpg';
        const suggestion = Suggestion.locale(requestedPath, suggestedPath);

        expect(suggestion.requestedPath).to.equal(requestedPath);
        expect(suggestion.suggestedPath).to.equal(suggestedPath);
        expect(suggestion.type).to.equal(SuggestionType.LOCALE);
        expect(suggestion.reason).to.equal('Locale fallback detected');
      });

      it('should create a LOCALE suggestion with custom reason', () => {
        const requestedPath = '/content/dam/de-de/test/image.jpg';
        const suggestedPath = '/content/dam/en-us/test/image.jpg';
        const customReason = 'German locale not available, fallback to English';
        const suggestion = Suggestion.locale(requestedPath, suggestedPath, customReason);

        expect(suggestion.requestedPath).to.equal(requestedPath);
        expect(suggestion.suggestedPath).to.equal(suggestedPath);
        expect(suggestion.type).to.equal(SuggestionType.LOCALE);
        expect(suggestion.reason).to.equal(customReason);
      });

      it('should handle null suggestedPath', () => {
        const requestedPath = '/content/dam/fr-fr/test/image.jpg';
        const suggestion = Suggestion.locale(requestedPath, null);

        expect(suggestion.requestedPath).to.equal(requestedPath);
        expect(suggestion.suggestedPath).to.be.null;
        expect(suggestion.type).to.equal(SuggestionType.LOCALE);
        expect(suggestion.reason).to.equal('Locale fallback detected');
      });
    });

    describe('similar', () => {
      it('should create a SIMILAR suggestion with default reason', () => {
        const requestedPath = '/content/dam/test/imag.jpg';
        const suggestedPath = '/content/dam/test/image.jpg';
        const suggestion = Suggestion.similar(requestedPath, suggestedPath);

        expect(suggestion.requestedPath).to.equal(requestedPath);
        expect(suggestion.suggestedPath).to.equal(suggestedPath);
        expect(suggestion.type).to.equal(SuggestionType.SIMILAR);
        expect(suggestion.reason).to.equal('Similar path found');
      });

      it('should create a SIMILAR suggestion with custom reason', () => {
        const requestedPath = '/content/dam/test/photo.jpg';
        const suggestedPath = '/content/dam/test/photos.jpg';
        const customReason = 'Levenshtein distance: 1';
        const suggestion = Suggestion.similar(requestedPath, suggestedPath, customReason);

        expect(suggestion.requestedPath).to.equal(requestedPath);
        expect(suggestion.suggestedPath).to.equal(suggestedPath);
        expect(suggestion.type).to.equal(SuggestionType.SIMILAR);
        expect(suggestion.reason).to.equal(customReason);
      });

      it('should handle null suggestedPath', () => {
        const requestedPath = '/content/dam/test/broken.jpg';
        const suggestion = Suggestion.similar(requestedPath, null);

        expect(suggestion.requestedPath).to.equal(requestedPath);
        expect(suggestion.suggestedPath).to.be.null;
        expect(suggestion.type).to.equal(SuggestionType.SIMILAR);
        expect(suggestion.reason).to.equal('Similar path found');
      });
    });

    describe('notFound', () => {
      it('should create a NOT_FOUND suggestion with default reason', () => {
        const requestedPath = '/content/dam/test/missing.jpg';
        const suggestion = Suggestion.notFound(requestedPath);

        expect(suggestion.requestedPath).to.equal(requestedPath);
        expect(suggestion.suggestedPath).to.be.null;
        expect(suggestion.type).to.equal(SuggestionType.NOT_FOUND);
        expect(suggestion.reason).to.equal('Not found');
      });

      it('should create a NOT_FOUND suggestion with custom reason', () => {
        const requestedPath = '/content/dam/test/deleted.jpg';
        const customReason = 'Content was deleted and no alternatives found';
        const suggestion = Suggestion.notFound(requestedPath, customReason);

        expect(suggestion.requestedPath).to.equal(requestedPath);
        expect(suggestion.suggestedPath).to.be.null;
        expect(suggestion.type).to.equal(SuggestionType.NOT_FOUND);
        expect(suggestion.reason).to.equal(customReason);
      });

      it('should handle empty string requestedPath', () => {
        const suggestion = Suggestion.notFound('');

        expect(suggestion.requestedPath).to.equal('');
        expect(suggestion.suggestedPath).to.be.null;
        expect(suggestion.type).to.equal(SuggestionType.NOT_FOUND);
        expect(suggestion.reason).to.equal('Not found');
      });

      it('should handle null requestedPath', () => {
        const suggestion = Suggestion.notFound(null);

        expect(suggestion.requestedPath).to.be.null;
        expect(suggestion.suggestedPath).to.be.null;
        expect(suggestion.type).to.equal(SuggestionType.NOT_FOUND);
        expect(suggestion.reason).to.equal('Not found');
      });
    });
  });

  describe('toJSON', () => {
    it('should serialize a complete suggestion to JSON', () => {
      const requestedPath = '/content/dam/test/broken.jpg';
      const suggestedPath = '/content/dam/test/fixed.jpg';
      const type = SuggestionType.SIMILAR;
      const reason = 'Similar path found';

      const suggestion = new Suggestion(requestedPath, suggestedPath, type, reason);
      const json = suggestion.toJSON();

      expect(json).to.deep.equal({
        requestedPath,
        suggestedPath,
        type,
        reason,
      });
    });

    it('should serialize a suggestion with null suggestedPath', () => {
      const requestedPath = '/content/dam/test/missing.jpg';
      const type = SuggestionType.NOT_FOUND;
      const reason = 'Content not found';

      const suggestion = new Suggestion(requestedPath, null, type, reason);
      const json = suggestion.toJSON();

      expect(json).to.deep.equal({
        requestedPath,
        suggestedPath: null,
        type,
        reason,
      });
    });

    it('should serialize a PUBLISH suggestion created via factory method', () => {
      const requestedPath = '/content/dam/test/image.jpg';
      const suggestion = Suggestion.publish(requestedPath);
      const json = suggestion.toJSON();

      expect(json).to.deep.equal({
        requestedPath,
        suggestedPath: null,
        type: SuggestionType.PUBLISH,
        reason: 'Content exists on Author',
      });
    });

    it('should serialize a LOCALE suggestion created via factory method', () => {
      const requestedPath = '/content/dam/fr-fr/test/image.jpg';
      const suggestedPath = '/content/dam/en-us/test/image.jpg';
      const suggestion = Suggestion.locale(requestedPath, suggestedPath);
      const json = suggestion.toJSON();

      expect(json).to.deep.equal({
        requestedPath,
        suggestedPath,
        type: SuggestionType.LOCALE,
        reason: 'Locale fallback detected',
      });
    });

    it('should serialize a SIMILAR suggestion created via factory method', () => {
      const requestedPath = '/content/dam/test/imag.jpg';
      const suggestedPath = '/content/dam/test/image.jpg';
      const suggestion = Suggestion.similar(requestedPath, suggestedPath);
      const json = suggestion.toJSON();

      expect(json).to.deep.equal({
        requestedPath,
        suggestedPath,
        type: SuggestionType.SIMILAR,
        reason: 'Similar path found',
      });
    });

    it('should serialize a NOT_FOUND suggestion created via factory method', () => {
      const requestedPath = '/content/dam/test/missing.jpg';
      const suggestion = Suggestion.notFound(requestedPath);
      const json = suggestion.toJSON();

      expect(json).to.deep.equal({
        requestedPath,
        suggestedPath: null,
        type: SuggestionType.NOT_FOUND,
        reason: 'Not found',
      });
    });

    it('should handle undefined values in toJSON', () => {
      const suggestion = new Suggestion(undefined, undefined, undefined, undefined);
      const json = suggestion.toJSON();

      expect(json).to.deep.equal({
        requestedPath: undefined,
        suggestedPath: undefined,
        type: undefined,
        reason: undefined,
      });
    });

    it('should handle empty string values in toJSON', () => {
      const suggestion = new Suggestion('', '', '', '');
      const json = suggestion.toJSON();

      expect(json).to.deep.equal({
        requestedPath: '',
        suggestedPath: '',
        type: '',
        reason: '',
      });
    });
  });

  describe('integration scenarios', () => {
    it('should work with JSON.stringify', () => {
      const suggestion = Suggestion.publish('/content/dam/test/image.jpg');
      const jsonString = JSON.stringify(suggestion);
      const parsed = JSON.parse(jsonString);

      expect(parsed).to.deep.equal({
        requestedPath: '/content/dam/test/image.jpg',
        suggestedPath: null,
        type: SuggestionType.PUBLISH,
        reason: 'Content exists on Author',
      });
    });

    it('should maintain immutability after creation', () => {
      const suggestion = Suggestion.similar('/content/dam/test/broken.jpg', '/content/dam/test/fixed.jpg');
      const originalPath = suggestion.requestedPath;
      const originalSuggested = suggestion.suggestedPath;
      const originalType = suggestion.type;
      const originalReason = suggestion.reason;

      // Attempt to modify properties
      suggestion.requestedPath = 'modified';
      suggestion.suggestedPath = 'modified';
      suggestion.type = 'modified';
      suggestion.reason = 'modified';

      expect(suggestion.requestedPath).to.equal('modified');
      expect(suggestion.suggestedPath).to.equal('modified');
      expect(suggestion.type).to.equal('modified');
      expect(suggestion.reason).to.equal('modified');

      // Create a new suggestion to verify factory methods still work
      const newSuggestion = Suggestion.similar(originalPath, originalSuggested);
      expect(newSuggestion.requestedPath).to.equal(originalPath);
      expect(newSuggestion.suggestedPath).to.equal(originalSuggested);
      expect(newSuggestion.type).to.equal(originalType);
      expect(newSuggestion.reason).to.equal(originalReason);
    });

    it('should handle complex path scenarios', () => {
      const complexPath = '/content/dam/en-us/folder with spaces/sub-folder/image%20with%20encoding.jpg';
      const suggestion = Suggestion.locale(complexPath, complexPath.replace('en-us', 'fr-fr'));

      expect(suggestion.requestedPath).to.equal(complexPath);
      expect(suggestion.suggestedPath).to.include('fr-fr');
      expect(suggestion.type).to.equal(SuggestionType.LOCALE);
    });

    it('should work with all factory methods in sequence', () => {
      const basePath = '/content/dam/test/image.jpg';

      const publishSuggestion = Suggestion.publish(basePath);
      const localeSuggestion = Suggestion.locale(basePath, basePath.replace('test', 'en-us'));
      const similarSuggestion = Suggestion.similar(basePath, basePath.replace('image', 'photo'));
      const notFoundSuggestion = Suggestion.notFound(basePath);

      expect(publishSuggestion.type).to.equal(SuggestionType.PUBLISH);
      expect(localeSuggestion.type).to.equal(SuggestionType.LOCALE);
      expect(similarSuggestion.type).to.equal(SuggestionType.SIMILAR);
      expect(notFoundSuggestion.type).to.equal(SuggestionType.NOT_FOUND);

      // All should have the same requestedPath
      expect(publishSuggestion.requestedPath).to.equal(basePath);
      expect(localeSuggestion.requestedPath).to.equal(basePath);
      expect(similarSuggestion.requestedPath).to.equal(basePath);
      expect(notFoundSuggestion.requestedPath).to.equal(basePath);
    });
  });
});
