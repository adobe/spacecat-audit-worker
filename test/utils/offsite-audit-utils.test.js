/*
 * Copyright 2026 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import {
  MYSTIQUE_URLS_LIMIT,
  YOUTUBE_URL_REGEX,
  REDDIT_URL_REGEX,
  filterUrlsByRegex,
  resolveMystiqueUrlLimit,
} from '../../src/utils/offsite-audit-utils.js';

use(sinonChai);

describe('offsite-audit-utils', () => {
  let sandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('YOUTUBE_URL_REGEX', () => {
    it('should match standard youtube.com URLs', () => {
      expect(YOUTUBE_URL_REGEX.test('https://www.youtube.com/watch?v=abc123')).to.be.true;
      expect(YOUTUBE_URL_REGEX.test('https://youtube.com/watch?v=abc123')).to.be.true;
      expect(YOUTUBE_URL_REGEX.test('https://m.youtube.com/watch?v=abc123')).to.be.true;
      expect(YOUTUBE_URL_REGEX.test('https://youtu.be/abc123')).to.be.true;
    });

    it('should not match non-youtube URLs', () => {
      expect(YOUTUBE_URL_REGEX.test('https://not-youtube.example.com/video')).to.be.false;
      expect(YOUTUBE_URL_REGEX.test('https://vimeo.com/123')).to.be.false;
    });
  });

  describe('REDDIT_URL_REGEX', () => {
    it('should match valid reddit post URLs', () => {
      expect(REDDIT_URL_REGEX.test('https://www.reddit.com/r/example/comments/abc/post_title/')).to.be.true;
      expect(REDDIT_URL_REGEX.test('https://reddit.com/r/example/comments/abc/post_title/')).to.be.true;
      expect(REDDIT_URL_REGEX.test('https://www.reddit.com/user/someone/submitted/')).to.be.true;
    });

    it('should not match bare reddit.com or search URLs', () => {
      expect(REDDIT_URL_REGEX.test('https://reddit.com/search?q=foo')).to.be.false;
      expect(REDDIT_URL_REGEX.test('https://www.reddit.com/')).to.be.false;
    });
  });

  describe('filterUrlsByRegex', () => {
    it('should return only URLs matching the regex', () => {
      const urls = [
        { url: 'https://www.youtube.com/watch?v=abc', metadata: {} },
        { url: 'https://not-youtube.example.com/video', metadata: {} },
      ];
      const result = filterUrlsByRegex(urls, YOUTUBE_URL_REGEX);
      expect(result).to.have.lengthOf(1);
      expect(result[0].url).to.equal('https://www.youtube.com/watch?v=abc');
    });

    it('should return all URLs when all match', () => {
      const urls = [
        { url: 'https://www.youtube.com/watch?v=abc', metadata: {} },
        { url: 'https://youtu.be/xyz', metadata: {} },
      ];
      expect(filterUrlsByRegex(urls, YOUTUBE_URL_REGEX)).to.have.lengthOf(2);
    });

    it('should return empty array when no URLs match', () => {
      const urls = [{ url: 'https://vimeo.com/123', metadata: {} }];
      expect(filterUrlsByRegex(urls, YOUTUBE_URL_REGEX)).to.have.lengthOf(0);
    });

    it('should log info when URLs are filtered out', () => {
      const log = { info: sandbox.stub() };
      const urls = [
        { url: 'https://www.youtube.com/watch?v=abc', metadata: {} },
        { url: 'https://not-youtube.example.com/video', metadata: {} },
      ];
      filterUrlsByRegex(urls, YOUTUBE_URL_REGEX, log, '[T]');
      expect(log.info).to.have.been.calledOnce;
      expect(log.info).to.have.been.calledWithMatch(/Filtered out 1 URL/);
    });

    it('should not log when no URLs are filtered out', () => {
      const log = { info: sandbox.stub() };
      const urls = [{ url: 'https://www.youtube.com/watch?v=abc', metadata: {} }];
      filterUrlsByRegex(urls, YOUTUBE_URL_REGEX, log, '[T]');
      expect(log.info).to.not.have.been.called;
    });

    it('should use empty string prefix when logPrefix is not provided', () => {
      const log = { info: sandbox.stub() };
      const urls = [
        { url: 'https://www.youtube.com/watch?v=abc', metadata: {} },
        { url: 'https://not-youtube.example.com/video', metadata: {} },
      ];
      filterUrlsByRegex(urls, YOUTUBE_URL_REGEX, log);
      expect(log.info).to.have.been.calledWithMatch(/Filtered out 1 URL/);
    });

    it('should work without log argument', () => {
      const urls = [
        { url: 'https://www.youtube.com/watch?v=abc', metadata: {} },
        { url: 'https://not-youtube.example.com/video', metadata: {} },
      ];
      expect(() => filterUrlsByRegex(urls, YOUTUBE_URL_REGEX)).to.not.throw();
      expect(filterUrlsByRegex(urls, YOUTUBE_URL_REGEX)).to.have.lengthOf(1);
    });
  });

  describe('MYSTIQUE_URLS_LIMIT', () => {
    it('should be a positive number', () => {
      expect(MYSTIQUE_URLS_LIMIT).to.be.a('number');
      expect(MYSTIQUE_URLS_LIMIT).to.be.greaterThan(0);
    });
  });

  describe('resolveMystiqueUrlLimit', () => {
    it('returns MYSTIQUE_URLS_LIMIT when urlLimit is absent', () => {
      expect(resolveMystiqueUrlLimit({})).to.equal(MYSTIQUE_URLS_LIMIT);
      expect(resolveMystiqueUrlLimit(undefined)).to.equal(MYSTIQUE_URLS_LIMIT);
      expect(resolveMystiqueUrlLimit(null)).to.equal(MYSTIQUE_URLS_LIMIT);
    });

    it('returns integer urlLimit when valid and below cap', () => {
      expect(resolveMystiqueUrlLimit({ messageData: { urlLimit: 5 } })).to.equal(5);
      expect(resolveMystiqueUrlLimit({ messageData: { urlLimit: '12' } })).to.equal(12);
      expect(resolveMystiqueUrlLimit({ messageData: { urlLimit: 8 } })).to.equal(8);
    });

    it('returns cap when urlLimit exceeds MYSTIQUE_URLS_LIMIT', () => {
      const log = { info: sandbox.stub() };
      expect(resolveMystiqueUrlLimit(
        { messageData: { urlLimit: MYSTIQUE_URLS_LIMIT + 10 } },
        log,
        '[T]',
      )).to.equal(MYSTIQUE_URLS_LIMIT);
      expect(log.info).to.have.been.calledOnce;
    });

    it('returns default and warns when urlLimit is invalid', () => {
      const log = { warn: sandbox.stub() };
      expect(resolveMystiqueUrlLimit({ messageData: { urlLimit: 'x' } }, log, '[T]')).to.equal(MYSTIQUE_URLS_LIMIT);
      expect(resolveMystiqueUrlLimit({ messageData: { urlLimit: 1.5 } }, log, '[T]')).to.equal(MYSTIQUE_URLS_LIMIT);
      expect(log.warn).to.have.been.calledTwice;
    });
  });
});
