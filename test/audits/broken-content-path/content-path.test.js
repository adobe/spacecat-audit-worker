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
import { ContentPath, ContentStatus } from '../../../src/broken-content-path/domain/content/content-path.js';

describe('ContentPath', () => {
  describe('ContentStatus enum', () => {
    it('should have all expected content statuses', () => {
      expect(ContentStatus.PUBLISHED).to.equal('PUBLISHED');
      expect(ContentStatus.MODIFIED).to.equal('MODIFIED');
      expect(ContentStatus.DRAFT).to.equal('DRAFT');
      expect(ContentStatus.ARCHIVED).to.equal('ARCHIVED');
      expect(ContentStatus.DELETED).to.equal('DELETED');
      expect(ContentStatus.UNKNOWN).to.equal('UNKNOWN');
    });

    it('should contain exactly 6 status values', () => {
      const statusValues = Object.values(ContentStatus);
      expect(statusValues).to.have.lengthOf(6);
      expect(statusValues).to.include.members([
        'PUBLISHED', 'MODIFIED', 'DRAFT', 'ARCHIVED', 'DELETED', 'UNKNOWN',
      ]);
    });
  });

  describe('constructor', () => {
    it('should create a content path with all parameters', () => {
      const path = '/content/dam/test/image.jpg';
      const status = ContentStatus.PUBLISHED;
      const locale = { code: 'en-us', toJSON: () => ({ code: 'en-us' }) };

      const contentPath = new ContentPath(path, status, locale);

      expect(contentPath.path).to.equal(path);
      expect(contentPath.status).to.equal(status);
      expect(contentPath.locale).to.equal(locale);
    });

    it('should create a content path with null parameters', () => {
      const contentPath = new ContentPath(null, null, null);

      expect(contentPath.path).to.be.null;
      expect(contentPath.status).to.be.null;
      expect(contentPath.locale).to.be.null;
    });

    it('should create a content path with undefined parameters', () => {
      const contentPath = new ContentPath(undefined, undefined, undefined);

      expect(contentPath.path).to.be.undefined;
      expect(contentPath.status).to.be.undefined;
      expect(contentPath.locale).to.be.undefined;
    });

    it('should create a content path with empty string path', () => {
      const contentPath = new ContentPath('', ContentStatus.DRAFT, null);

      expect(contentPath.path).to.equal('');
      expect(contentPath.status).to.equal(ContentStatus.DRAFT);
      expect(contentPath.locale).to.be.null;
    });

    it('should create a content path with simple locale object', () => {
      const path = '/content/dam/test/image.jpg';
      const status = ContentStatus.PUBLISHED;
      const locale = { code: 'fr-fr' };

      const contentPath = new ContentPath(path, status, locale);

      expect(contentPath.path).to.equal(path);
      expect(contentPath.status).to.equal(status);
      expect(contentPath.locale).to.equal(locale);
    });
  });

  describe('isValid', () => {
    it('should return true for valid non-empty path', () => {
      const contentPath = new ContentPath('/content/dam/test/image.jpg', ContentStatus.PUBLISHED, null);
      expect(contentPath.isValid()).to.be.true;
    });

    it('should return true for path with spaces', () => {
      const contentPath = new ContentPath('/content/dam/test/image with spaces.jpg', ContentStatus.DRAFT, null);
      expect(contentPath.isValid()).to.be.true;
    });

    it('should return true for path with special characters', () => {
      const contentPath = new ContentPath('/content/dam/test/image-file_name.jpg', ContentStatus.MODIFIED, null);
      expect(contentPath.isValid()).to.be.true;
    });

    it('should return false for null path', () => {
      const contentPath = new ContentPath(null, ContentStatus.PUBLISHED, null);
      expect(contentPath.isValid()).to.be.false;
    });

    it('should return false for undefined path', () => {
      const contentPath = new ContentPath(undefined, ContentStatus.PUBLISHED, null);
      expect(contentPath.isValid()).to.be.false;
    });

    it('should return false for empty string path', () => {
      const contentPath = new ContentPath('', ContentStatus.PUBLISHED, null);
      expect(contentPath.isValid()).to.be.false;
    });

    it('should return false for whitespace-only path', () => {
      const contentPath = new ContentPath('   ', ContentStatus.PUBLISHED, null);
      expect(contentPath.isValid()).to.be.false;
    });

    it('should return false for tab and newline whitespace', () => {
      const contentPath = new ContentPath('\t\n\r ', ContentStatus.PUBLISHED, null);
      expect(contentPath.isValid()).to.be.false;
    });

    it('should return true for path with leading/trailing spaces but content', () => {
      const contentPath = new ContentPath('  /content/dam/test/image.jpg  ', ContentStatus.PUBLISHED, null);
      expect(contentPath.isValid()).to.be.true;
    });

    it('should not be affected by status or locale values', () => {
      const validPath = '/content/dam/test/image.jpg';

      const contentPath1 = new ContentPath(validPath, null, null);
      const contentPath2 = new ContentPath(validPath, undefined, undefined);
      const contentPath3 = new ContentPath(validPath, ContentStatus.DELETED, { invalid: true });

      expect(contentPath1.isValid()).to.be.true;
      expect(contentPath2.isValid()).to.be.true;
      expect(contentPath3.isValid()).to.be.true;
    });

    it('should return false for non-string path types', () => {
      const numberPath = new ContentPath(123, ContentStatus.PUBLISHED, null);
      const booleanPath = new ContentPath(true, ContentStatus.PUBLISHED, null);
      const objectPath = new ContentPath({}, ContentStatus.PUBLISHED, null);
      const arrayPath = new ContentPath([], ContentStatus.PUBLISHED, null);

      expect(numberPath.isValid()).to.be.false;
      expect(booleanPath.isValid()).to.be.false;
      expect(objectPath.isValid()).to.be.false;
      expect(arrayPath.isValid()).to.be.false;
    });
  });

  describe('isPublished', () => {
    it('should return true when status is PUBLISHED', () => {
      const contentPath = new ContentPath('/content/dam/test/image.jpg', ContentStatus.PUBLISHED, null);
      expect(contentPath.isPublished()).to.be.true;
    });

    it('should return false when status is MODIFIED', () => {
      const contentPath = new ContentPath('/content/dam/test/image.jpg', ContentStatus.MODIFIED, null);
      expect(contentPath.isPublished()).to.be.false;
    });

    it('should return false when status is DRAFT', () => {
      const contentPath = new ContentPath('/content/dam/test/image.jpg', ContentStatus.DRAFT, null);
      expect(contentPath.isPublished()).to.be.false;
    });

    it('should return false when status is ARCHIVED', () => {
      const contentPath = new ContentPath('/content/dam/test/image.jpg', ContentStatus.ARCHIVED, null);
      expect(contentPath.isPublished()).to.be.false;
    });

    it('should return false when status is DELETED', () => {
      const contentPath = new ContentPath('/content/dam/test/image.jpg', ContentStatus.DELETED, null);
      expect(contentPath.isPublished()).to.be.false;
    });

    it('should return false when status is UNKNOWN', () => {
      const contentPath = new ContentPath('/content/dam/test/image.jpg', ContentStatus.UNKNOWN, null);
      expect(contentPath.isPublished()).to.be.false;
    });

    it('should return false when status is null', () => {
      const contentPath = new ContentPath('/content/dam/test/image.jpg', null, null);
      expect(contentPath.isPublished()).to.be.false;
    });

    it('should return false when status is undefined', () => {
      const contentPath = new ContentPath('/content/dam/test/image.jpg', undefined, null);
      expect(contentPath.isPublished()).to.be.false;
    });

    it('should return false when status is an invalid string', () => {
      const contentPath = new ContentPath('/content/dam/test/image.jpg', 'INVALID_STATUS', null);
      expect(contentPath.isPublished()).to.be.false;
    });

    it('should use strict equality comparison', () => {
      const contentPath = new ContentPath('/content/dam/test/image.jpg', 'published', null);
      expect(contentPath.isPublished()).to.be.false; // Case sensitive
    });

    it('should not be affected by path or locale values', () => {
      const publishedPath1 = new ContentPath(null, ContentStatus.PUBLISHED, null);
      const publishedPath2 = new ContentPath('', ContentStatus.PUBLISHED, undefined);
      const publishedPath3 = new ContentPath('/valid/path', ContentStatus.PUBLISHED, { invalid: 'locale' });

      expect(publishedPath1.isPublished()).to.be.true;
      expect(publishedPath2.isPublished()).to.be.true;
      expect(publishedPath3.isPublished()).to.be.true;
    });
  });

  describe('toJSON', () => {
    it('should serialize a complete content path with locale having toJSON method', () => {
      const path = '/content/dam/test/image.jpg';
      const status = ContentStatus.PUBLISHED;
      const locale = {
        code: 'en-us',
        name: 'English (US)',
        toJSON: () => ({ code: 'en-us', name: 'English (US)' }),
      };

      const contentPath = new ContentPath(path, status, locale);
      const json = contentPath.toJSON();

      expect(json).to.deep.equal({
        path,
        status,
        locale: { code: 'en-us', name: 'English (US)' },
      });
    });

    it('should serialize a content path with locale without toJSON method', () => {
      const path = '/content/dam/test/image.jpg';
      const status = ContentStatus.DRAFT;
      const locale = { code: 'fr-fr', name: 'French (France)' };

      const contentPath = new ContentPath(path, status, locale);
      const json = contentPath.toJSON();

      expect(json).to.deep.equal({
        path,
        status,
        locale: { code: 'fr-fr', name: 'French (France)' },
      });
    });

    it('should serialize a content path with null locale', () => {
      const path = '/content/dam/test/image.jpg';
      const status = ContentStatus.MODIFIED;

      const contentPath = new ContentPath(path, status, null);
      const json = contentPath.toJSON();

      expect(json).to.deep.equal({
        path,
        status,
        locale: null,
      });
    });

    it('should serialize a content path with undefined locale', () => {
      const path = '/content/dam/test/image.jpg';
      const status = ContentStatus.ARCHIVED;

      const contentPath = new ContentPath(path, status, undefined);
      const json = contentPath.toJSON();

      expect(json).to.deep.equal({
        path,
        status,
        locale: undefined,
      });
    });

    it('should serialize a content path with all null values', () => {
      const contentPath = new ContentPath(null, null, null);
      const json = contentPath.toJSON();

      expect(json).to.deep.equal({
        path: null,
        status: null,
        locale: null,
      });
    });

    it('should serialize a content path with all undefined values', () => {
      const contentPath = new ContentPath(undefined, undefined, undefined);
      const json = contentPath.toJSON();

      expect(json).to.deep.equal({
        path: undefined,
        status: undefined,
        locale: undefined,
      });
    });

    it('should handle locale with toJSON method that returns null', () => {
      const path = '/content/dam/test/image.jpg';
      const status = ContentStatus.DELETED;
      const locale = {
        code: 'invalid',
        toJSON: () => null,
      };

      const contentPath = new ContentPath(path, status, locale);
      const json = contentPath.toJSON();

      expect(json).to.deep.equal({
        path,
        status,
        locale: { code: 'invalid', toJSON: locale.toJSON },
      });
    });

    it('should handle locale with toJSON method that returns undefined', () => {
      const path = '/content/dam/test/image.jpg';
      const status = ContentStatus.UNKNOWN;
      const locale = {
        code: 'test',
        toJSON: () => undefined,
      };

      const contentPath = new ContentPath(path, status, locale);
      const json = contentPath.toJSON();

      expect(json).to.deep.equal({
        path,
        status,
        locale: { code: 'test', toJSON: locale.toJSON },
      });
    });

    it('should handle primitive locale values', () => {
      const path = '/content/dam/test/image.jpg';
      const status = ContentStatus.PUBLISHED;

      const contentPath1 = new ContentPath(path, status, 'en-us');
      const contentPath2 = new ContentPath(path, status, 123);
      const contentPath3 = new ContentPath(path, status, true);

      expect(contentPath1.toJSON().locale).to.equal('en-us');
      expect(contentPath2.toJSON().locale).to.equal(123);
      expect(contentPath3.toJSON().locale).to.equal(true);
    });
  });

  describe('integration scenarios', () => {
    it('should work with JSON.stringify', () => {
      const contentPath = new ContentPath(
        '/content/dam/test/image.jpg',
        ContentStatus.PUBLISHED,
        { code: 'en-us', toJSON: () => ({ code: 'en-us' }) },
      );

      const jsonString = JSON.stringify(contentPath);
      const parsed = JSON.parse(jsonString);

      expect(parsed).to.deep.equal({
        path: '/content/dam/test/image.jpg',
        status: ContentStatus.PUBLISHED,
        locale: { code: 'en-us' },
      });
    });

    it('should handle all content statuses consistently', () => {
      const path = '/content/dam/test/image.jpg';
      const locale = { code: 'en-us' };

      const statuses = [
        ContentStatus.PUBLISHED,
        ContentStatus.MODIFIED,
        ContentStatus.DRAFT,
        ContentStatus.ARCHIVED,
        ContentStatus.DELETED,
        ContentStatus.UNKNOWN,
      ];

      statuses.forEach((status) => {
        const contentPath = new ContentPath(path, status, locale);

        expect(contentPath.isValid()).to.be.true;
        expect(contentPath.isPublished()).to.equal(status === ContentStatus.PUBLISHED);

        const json = contentPath.toJSON();
        expect(json.path).to.equal(path);
        expect(json.status).to.equal(status);
        expect(json.locale).to.equal(locale);
      });
    });

    it('should handle complex locale objects with nested properties', () => {
      const complexLocale = {
        code: 'en-us',
        name: 'English (US)',
        region: 'North America',
        metadata: {
          currency: 'USD',
          timezone: 'PST',
        },
        toJSON: function toJSON() {
          return {
            code: this.code,
            name: this.name,
            region: this.region,
          };
        },
      };

      const contentPath = new ContentPath('/content/dam/test/image.jpg', ContentStatus.PUBLISHED, complexLocale);
      const json = contentPath.toJSON();

      expect(json.locale).to.deep.equal({
        code: 'en-us',
        name: 'English (US)',
        region: 'North America',
      });
    });

    it('should be immutable after creation', () => {
      const originalPath = '/content/dam/test/image.jpg';
      const originalStatus = ContentStatus.PUBLISHED;
      const originalLocale = { code: 'en-us' };

      const contentPath = new ContentPath(originalPath, originalStatus, originalLocale);

      // Modify properties
      contentPath.path = '/modified/path';
      contentPath.status = ContentStatus.DRAFT;
      contentPath.locale = { code: 'fr-fr' };

      // Properties should be modified (JavaScript objects are mutable)
      expect(contentPath.path).to.equal('/modified/path');
      expect(contentPath.status).to.equal(ContentStatus.DRAFT);
      expect(contentPath.locale.code).to.equal('fr-fr');

      // But creating a new instance should work with original values
      const newContentPath = new ContentPath(originalPath, originalStatus, originalLocale);
      expect(newContentPath.path).to.equal(originalPath);
      expect(newContentPath.status).to.equal(originalStatus);
      expect(newContentPath.locale.code).to.equal('en-us');
    });

    it('should handle edge cases in path validation', () => {
      const edgeCases = [
        { path: '/', expected: true },
        { path: '/content', expected: true },
        { path: '/content/dam', expected: true },
        { path: '/content/dam/', expected: true },
        { path: 'relative/path', expected: true },
        { path: '   /content/dam/test   ', expected: true }, // Trimmed to non-empty
        { path: '\n\t\r', expected: false }, // Only whitespace
      ];

      edgeCases.forEach(({ path, expected }) => {
        const contentPath = new ContentPath(path, ContentStatus.PUBLISHED, null);
        expect(contentPath.isValid()).to.equal(expected, `Path "${path}" should be ${expected ? 'valid' : 'invalid'}`);
      });
    });
  });
});
