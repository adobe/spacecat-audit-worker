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
import sinon from 'sinon';
import esmock from 'esmock';

describe('SSR Meta Validator', () => {
  let validateMetaTagsViaSSR;
  let fetchStub;
  let logStub;

  beforeEach(async () => {
    logStub = {
      debug: sinon.stub(),
      info: sinon.stub(),
      warn: sinon.stub(),
      error: sinon.stub(),
    };

    fetchStub = sinon.stub();
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('validateMetaTagsViaSSR', () => {
    it('validates meta tags successfully', async () => {
      const html = '<html><head><title>Page Title</title>'
        + '<meta name="description" content="Page description"></head>'
        + '<body><h1>Heading 1</h1></body></html>';

      fetchStub.resolves({
        ok: true,
        status: 200,
        text: sinon.stub().resolves(html),
      });

      const module = await esmock('../../src/metatags/ssr-meta-validator.js', {
        '@adobe/fetch': {
          context: () => ({ fetch: fetchStub }),
        },
      });

      validateMetaTagsViaSSR = module.validateMetaTagsViaSSR;

      const result = await validateMetaTagsViaSSR('https://example.com/page', logStub);

      expect(result).to.deep.equal({
        title: 'Page Title',
        description: 'Page description',
        h1: ['Heading 1'],
      });
    });

    it('detects bot protection on 403 with Cloudflare headers', async () => {
      const challengeHtml = '<html><head><title>Just a moment...</title></head>'
        + '<body>Checking your browser...</body></html>';

      // Create a proper Headers-like object
      const mockHeaders = {
        'cf-ray': '123456789-CDG',
        server: 'cloudflare',
      };

      fetchStub.resolves({
        ok: false,
        status: 403,
        headers: mockHeaders,
        text: sinon.stub().resolves(challengeHtml),
      });

      const module = await esmock('../../src/metatags/ssr-meta-validator.js', {
        '@adobe/fetch': {
          context: () => ({ fetch: fetchStub }),
        },
      });

      validateMetaTagsViaSSR = module.validateMetaTagsViaSSR;

      const result = await validateMetaTagsViaSSR('https://example.com/page', logStub);

      expect(result).to.be.null;
      expect(logStub.error.callCount).to.equal(1);
      expect(logStub.error.firstCall.args[0]).to.include('blocked by');
      expect(logStub.error.firstCall.args[0]).to.include('cloudflare');
    });

    it('handles non-403 errors', async () => {
      fetchStub.resolves({
        ok: false,
        status: 500,
        text: sinon.stub().resolves('<html></html>'),
      });

      const module = await esmock('../../src/metatags/ssr-meta-validator.js', {
        '@adobe/fetch': {
          context: () => ({ fetch: fetchStub }),
        },
      });

      validateMetaTagsViaSSR = module.validateMetaTagsViaSSR;

      const result = await validateMetaTagsViaSSR('https://example.com/page', logStub);

      expect(result).to.be.null;
      expect(logStub.warn.called).to.be.true;
      expect(logStub.warn.firstCall.args[0]).to.include('500');
    });

    it('handles multiple h1 tags', async () => {
      const html = '<html><head><title>Page Title</title></head>'
        + '<body><h1>First Heading</h1><h1>Second Heading</h1></body></html>';

      fetchStub.resolves({
        ok: true,
        status: 200,
        text: sinon.stub().resolves(html),
      });

      const module = await esmock('../../src/metatags/ssr-meta-validator.js', {
        '@adobe/fetch': {
          context: () => ({ fetch: fetchStub }),
        },
      });

      validateMetaTagsViaSSR = module.validateMetaTagsViaSSR;

      const result = await validateMetaTagsViaSSR('https://example.com/page', logStub);

      expect(result.h1).to.deep.equal(['First Heading', 'Second Heading']);
    });

    it('returns null for missing tags', async () => {
      const html = '<html><head></head><body></body></html>';

      fetchStub.resolves({
        ok: true,
        status: 200,
        text: sinon.stub().resolves(html),
      });

      const module = await esmock('../../src/metatags/ssr-meta-validator.js', {
        '@adobe/fetch': {
          context: () => ({ fetch: fetchStub }),
        },
      });

      validateMetaTagsViaSSR = module.validateMetaTagsViaSSR;

      const result = await validateMetaTagsViaSSR('https://example.com/page', logStub);

      expect(result).to.deep.equal({
        title: null,
        description: null,
        h1: null,
      });
    });

    it('handles empty h1 tags', async () => {
      const html = '<html><head><title>Page Title</title></head>'
        + '<body><h1></h1><h1>   </h1><h1>Valid Heading</h1></body></html>';

      fetchStub.resolves({
        ok: true,
        status: 200,
        text: sinon.stub().resolves(html),
      });

      const module = await esmock('../../src/metatags/ssr-meta-validator.js', {
        '@adobe/fetch': {
          context: () => ({ fetch: fetchStub }),
        },
      });

      validateMetaTagsViaSSR = module.validateMetaTagsViaSSR;

      const result = await validateMetaTagsViaSSR('https://example.com/page', logStub);

      expect(result.h1).to.deep.equal(['Valid Heading']);
    });

    it('handles fetch errors', async () => {
      fetchStub.rejects(new Error('Network error'));

      const module = await esmock('../../src/metatags/ssr-meta-validator.js', {
        '@adobe/fetch': {
          context: () => ({ fetch: fetchStub }),
        },
      });

      validateMetaTagsViaSSR = module.validateMetaTagsViaSSR;

      const result = await validateMetaTagsViaSSR('https://example.com/page', logStub);

      expect(result).to.be.null;
      expect(logStub.warn.called).to.be.true;
      expect(logStub.warn.firstCall.args[0]).to.include('Network error');
    });

    it('handles 403 without bot protection patterns', async () => {
      const html = '<html><body>Forbidden</body></html>';

      fetchStub.resolves({
        ok: false,
        status: 403,
        headers: {},
        text: sinon.stub().resolves(html),
      });

      const module = await esmock('../../src/metatags/ssr-meta-validator.js', {
        '@adobe/fetch': {
          context: () => ({ fetch: fetchStub }),
        },
      });

      validateMetaTagsViaSSR = module.validateMetaTagsViaSSR;

      const result = await validateMetaTagsViaSSR('https://example.com/page', logStub);

      expect(result).to.be.null;
      expect(logStub.warn.called).to.be.true;
      expect(logStub.warn.firstCall.args[0]).to.include('403');
    });

    it('handles bot detection errors gracefully', async () => {
      fetchStub.resolves({
        ok: false,
        status: 403,
        headers: {},
        text: sinon.stub().rejects(new Error('Text parsing error')),
      });

      const module = await esmock('../../src/metatags/ssr-meta-validator.js', {
        '@adobe/fetch': {
          context: () => ({ fetch: fetchStub }),
        },
      });

      validateMetaTagsViaSSR = module.validateMetaTagsViaSSR;

      const result = await validateMetaTagsViaSSR('https://example.com/page', logStub);

      expect(result).to.be.null;
      expect(logStub.warn.called).to.be.true;
      expect(logStub.warn.firstCall.args[0]).to.include('bot detection failed');
    });
  });

  describe('validateDetectedIssues', () => {
    let validateDetectedIssues;

    beforeEach(async () => {
      const html = '<html><head><title>Page Title</title>'
        + '<meta name="description" content="Page description"></head>'
        + '<body><h1>Heading 1</h1></body></html>';

      fetchStub.resolves({
        ok: true,
        status: 200,
        text: sinon.stub().resolves(html),
      });

      const module = await esmock('../../src/metatags/ssr-meta-validator.js', {
        '@adobe/fetch': {
          context: () => ({ fetch: fetchStub }),
        },
      });

      validateDetectedIssues = module.validateDetectedIssues;
    });

    it('returns empty object when no issues detected', async () => {
      const detectedTags = {};
      const result = await validateDetectedIssues(detectedTags, 'https://example.com', logStub);
      expect(result).to.deep.equal({});
    });

    it('removes false positives for missing title', async () => {
      const detectedTags = {
        '/page': {
          title: { issue: 'Missing title tag' },
        },
      };

      const result = await validateDetectedIssues(detectedTags, 'https://example.com', logStub);

      expect(result).to.deep.equal({});
      expect(logStub.info.calledWith(sinon.match(/False positive detected for title/))).to.be.true;
    });

    it('removes false positives for missing description', async () => {
      const detectedTags = {
        '/page': {
          description: { issue: 'Missing description meta tag' },
        },
      };

      const result = await validateDetectedIssues(detectedTags, 'https://example.com', logStub);

      expect(result).to.deep.equal({});
      expect(logStub.info.calledWith(sinon.match(/False positive detected for description/))).to.be.true;
    });

    it('removes false positives for missing h1', async () => {
      const detectedTags = {
        '/page': {
          h1: { issue: 'Missing h1 tag' },
        },
      };

      const result = await validateDetectedIssues(detectedTags, 'https://example.com', logStub);

      expect(result).to.deep.equal({});
      expect(logStub.info.calledWith(sinon.match(/False positive detected for h1/))).to.be.true;
    });

    it('keeps real issues that are not false positives', async () => {
      fetchStub.resolves({
        ok: true,
        status: 200,
        text: sinon.stub().resolves('<html><body></body></html>'),
      });

      const detectedTags = {
        '/page': {
          title: { issue: 'Missing title tag' },
        },
      };

      const result = await validateDetectedIssues(detectedTags, 'https://example.com', logStub);

      expect(result).to.deep.equal(detectedTags);
    });

    it('keeps non-missing issues', async () => {
      const detectedTags = {
        '/page': {
          title: { issue: 'Title too long' },
        },
      };

      const result = await validateDetectedIssues(detectedTags, 'https://example.com', logStub);

      expect(result).to.deep.equal(detectedTags);
      expect(fetchStub.called).to.be.false;
    });

    it('processes multiple endpoints', async () => {
      const detectedTags = {
        '/page1': {
          title: { issue: 'Missing title tag' },
        },
        '/page2': {
          description: { issue: 'Missing description meta tag' },
        },
      };

      const result = await validateDetectedIssues(detectedTags, 'https://example.com', logStub);

      expect(result).to.deep.equal({});
      // 2 false positives + 1 summary log = 3 info logs
      expect(logStub.info.callCount).to.equal(3);
    });

    it('removes endpoint when all issues are false positives', async () => {
      const detectedTags = {
        '/page': {
          title: { issue: 'Missing title tag' },
          description: { issue: 'Missing description meta tag' },
        },
      };

      const result = await validateDetectedIssues(detectedTags, 'https://example.com', logStub);

      expect(result).to.deep.equal({});
    });

    it('keeps endpoint when some issues remain', async () => {
      const detectedTags = {
        '/page': {
          title: { issue: 'Missing title tag' },
          description: { issue: 'Description too short' },
        },
      };

      const result = await validateDetectedIssues(detectedTags, 'https://example.com', logStub);

      expect(result).to.deep.equal({
        '/page': {
          description: { issue: 'Description too short' },
        },
      });
    });

    it('handles SSR validation failure gracefully', async () => {
      fetchStub.rejects(new Error('Network error'));

      const detectedTags = {
        '/page': {
          title: { issue: 'Missing title tag' },
        },
      };

      const result = await validateDetectedIssues(detectedTags, 'https://example.com', logStub);

      expect(result).to.deep.equal(detectedTags);
    });
  });
});
