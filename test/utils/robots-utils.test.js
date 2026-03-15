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

import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import esmock from 'esmock';
import robotsParser from 'robots-parser';
import {
  isDisallowedByRobots,
  filterUrlsByRobots,
} from '../../src/utils/robots-utils.js';

use(sinonChai);

describe('robots-utils', () => {
  let log;

  beforeEach(() => {
    log = {
      debug: sinon.stub(),
      info: sinon.stub(),
      warn: sinon.stub(),
      error: sinon.stub(),
    };
  });

  afterEach(() => {
    sinon.restore();
  });

  // ---------------------------------------------------------------------------
  // fetchRobotsTxt
  // ---------------------------------------------------------------------------
  describe('fetchRobotsTxt', () => {
    it('should fetch and parse robots.txt for a full URL', async () => {
      const robotsContent = 'User-agent: *\nDisallow: /private/\nAllow: /';
      const mockFetch = sinon.stub().resolves({
        text: sinon.stub().resolves(robotsContent),
      });

      const { fetchRobotsTxt: fetchRobotsTxtMocked } = await esmock(
        '../../src/utils/robots-utils.js',
        {
          '@adobe/spacecat-shared-utils': { tracingFetch: mockFetch },
        },
      );

      const result = await fetchRobotsTxtMocked('https://example.com', log);

      expect(result).to.not.be.null;
      expect(mockFetch).to.have.been.calledWith('https://example.com/robots.txt');
      expect(log.debug).to.have.been.calledWith('[robots-utils] Fetching https://example.com/robots.txt');
    });

    it('should handle a bare hostname without protocol', async () => {
      const robotsContent = 'User-agent: *\nDisallow: /';
      const mockFetch = sinon.stub().resolves({
        text: sinon.stub().resolves(robotsContent),
      });

      const { fetchRobotsTxt: fetchRobotsTxtMocked } = await esmock(
        '../../src/utils/robots-utils.js',
        {
          '@adobe/spacecat-shared-utils': { tracingFetch: mockFetch },
        },
      );

      const result = await fetchRobotsTxtMocked('example.com', log);

      expect(result).to.not.be.null;
      expect(mockFetch).to.have.been.calledWith('https://example.com/robots.txt');
    });

    it('should return null and log warn when fetch throws', async () => {
      const mockFetch = sinon.stub().rejects(new Error('network timeout'));

      const { fetchRobotsTxt: fetchRobotsTxtMocked } = await esmock(
        '../../src/utils/robots-utils.js',
        {
          '@adobe/spacecat-shared-utils': { tracingFetch: mockFetch },
        },
      );

      const result = await fetchRobotsTxtMocked('https://example.com', log);

      expect(result).to.be.null;
      expect(log.warn).to.have.been.calledWith(
        '[robots-utils] Failed to fetch/parse robots.txt for https://example.com: network timeout',
      );
    });

    it('should return a parsed robots object that correctly evaluates isAllowed', async () => {
      const robotsContent = 'User-agent: *\nDisallow: /search/\nDisallow: /private/\nAllow: /';
      const mockFetch = sinon.stub().resolves({
        text: sinon.stub().resolves(robotsContent),
      });

      const { fetchRobotsTxt: fetchRobotsTxtMocked } = await esmock(
        '../../src/utils/robots-utils.js',
        {
          '@adobe/spacecat-shared-utils': { tracingFetch: mockFetch },
        },
      );

      const robots = await fetchRobotsTxtMocked('https://example.com', log);

      expect(robots.isAllowed('https://example.com/page', '*')).to.be.true;
      expect(robots.isAllowed('https://example.com/search/query', '*')).to.be.false;
      expect(robots.isAllowed('https://example.com/private/data', '*')).to.be.false;
    });

    it('should handle wildcard patterns in Disallow directives', async () => {
      const robotsContent = 'User-agent: *\nDisallow: /search/business*\nAllow: /';
      const mockFetch = sinon.stub().resolves({
        text: sinon.stub().resolves(robotsContent),
      });

      const { fetchRobotsTxt: fetchRobotsTxtMocked } = await esmock(
        '../../src/utils/robots-utils.js',
        {
          '@adobe/spacecat-shared-utils': { tracingFetch: mockFetch },
        },
      );

      const robots = await fetchRobotsTxtMocked('https://example.com', log);

      expect(robots.isAllowed('https://example.com/search/business-listing', '*')).to.be.false;
      expect(robots.isAllowed('https://example.com/search/other', '*')).to.be.true;
      expect(robots.isAllowed('https://example.com/products', '*')).to.be.true;
    });
  });

  // ---------------------------------------------------------------------------
  // isDisallowedByRobots
  // ---------------------------------------------------------------------------
  describe('isDisallowedByRobots', () => {
    it('should return false when robots is null', () => {
      expect(isDisallowedByRobots(null, 'https://example.com/page')).to.be.false;
    });

    it('should return false for an allowed URL', () => {
      const robots = robotsParser('https://example.com/robots.txt', 'User-agent: *\nDisallow: /private/');
      expect(isDisallowedByRobots(robots, 'https://example.com/page')).to.be.false;
    });

    it('should return true for a disallowed URL', () => {
      const robots = robotsParser('https://example.com/robots.txt', 'User-agent: *\nDisallow: /private/');
      expect(isDisallowedByRobots(robots, 'https://example.com/private/secret')).to.be.true;
    });

    it('should return false (not disallowed) for a malformed/relative URL', () => {
      const robots = robotsParser('https://example.com/robots.txt', 'User-agent: *\nDisallow: /');
      // robots-parser returns undefined for URLs not matching the origin — treat as allowed
      expect(isDisallowedByRobots(robots, 'not-a-valid-url')).to.be.false;
      expect(isDisallowedByRobots(robots, 'relative/path')).to.be.false;
    });

    it('should check a specific user-agent when provided', () => {
      const robotsContent = 'User-agent: Googlebot\nDisallow: /noindex/\n\nUser-agent: *\nAllow: /';
      const robots = robotsParser('https://example.com/robots.txt', robotsContent);

      expect(isDisallowedByRobots(robots, 'https://example.com/noindex/page', 'Googlebot')).to.be.true;
      expect(isDisallowedByRobots(robots, 'https://example.com/noindex/page', '*')).to.be.false;
    });

    it('should handle wildcard Disallow patterns', () => {
      const robots = robotsParser(
        'https://example.com/robots.txt',
        'User-agent: *\nDisallow: /search/business*',
      );
      expect(isDisallowedByRobots(robots, 'https://example.com/search/business-listing')).to.be.true;
      expect(isDisallowedByRobots(robots, 'https://example.com/search/personal')).to.be.false;
    });
  });

  // ---------------------------------------------------------------------------
  // filterUrlsByRobots
  // ---------------------------------------------------------------------------
  describe('filterUrlsByRobots', () => {
    it('should return all URLs unchanged and log warn when robots is null', () => {
      const urls = ['https://example.com/page1', 'https://example.com/page2'];
      const result = filterUrlsByRobots(null, urls, log);

      expect(result).to.deep.equal(urls);
      expect(log.warn).to.have.been.calledOnceWith(
        '[robots-utils] robots.txt unavailable — skipping robots filtering',
      );
    });

    it('should return all URLs when none are disallowed', () => {
      const robots = robotsParser(
        'https://example.com/robots.txt',
        'User-agent: *\nDisallow: /private/',
      );
      const urls = ['https://example.com/page1', 'https://example.com/page2'];

      const result = filterUrlsByRobots(robots, urls, log);

      expect(result).to.deep.equal(urls);
      expect(log.info).to.not.have.been.called;
    });

    it('should filter out disallowed URLs and log which ones were excluded', () => {
      const robots = robotsParser(
        'https://example.com/robots.txt',
        'User-agent: *\nDisallow: /search/\nAllow: /',
      );
      robots.robotsUrl = 'https://example.com/robots.txt';
      const urls = [
        'https://example.com/page1',
        'https://example.com/search/query',
        'https://example.com/page2',
        'https://example.com/search/results',
      ];

      const result = filterUrlsByRobots(robots, urls, log);

      expect(result).to.deep.equal([
        'https://example.com/page1',
        'https://example.com/page2',
      ]);
      expect(log.info).to.have.been.calledWith(
        '[robots-utils] https://example.com/robots.txt: excluded 2 URL(s) disallowed by robots.txt: ["https://example.com/search/query","https://example.com/search/results"]',
      );
    });

    it('should pass through malformed URLs without filtering them', () => {
      const robots = robotsParser(
        'https://example.com/robots.txt',
        'User-agent: *\nDisallow: /search/',
      );
      const urls = [
        'https://example.com/page1',
        'not-a-valid-url',
        'another-invalid',
      ];

      const result = filterUrlsByRobots(robots, urls, log);

      expect(result).to.deep.equal(urls);
    });

    it('should respect a specific user-agent when provided', () => {
      const robots = robotsParser(
        'https://example.com/robots.txt',
        'User-agent: Googlebot\nDisallow: /noindex/\n\nUser-agent: *\nAllow: /',
      );
      const urls = [
        'https://example.com/page',
        'https://example.com/noindex/hidden',
      ];

      const forGooglebot = filterUrlsByRobots(robots, urls, log, 'Googlebot');
      const forAny = filterUrlsByRobots(robots, urls, log, '*');

      expect(forGooglebot).to.deep.equal(['https://example.com/page']);
      expect(forAny).to.deep.equal(urls);
    });

    it('should return an empty array when all URLs are disallowed', () => {
      const robots = robotsParser(
        'https://example.com/robots.txt',
        'User-agent: *\nDisallow: /',
      );
      const urls = [
        'https://example.com/page1',
        'https://example.com/page2',
      ];

      const result = filterUrlsByRobots(robots, urls, log);

      expect(result).to.be.an('array').that.is.empty;
    });
  });
});
