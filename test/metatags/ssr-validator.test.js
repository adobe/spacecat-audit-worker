/*
 * Copyright 2024 Adobe. All rights reserved.
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

describe('SSR Validator', () => {
  let validateMetaTagsViaSSR;
  let validateDetectedIssues;
  let fetchStub;
  let log;

  beforeEach(async () => {
    fetchStub = sinon.stub();
    log = {
      info: sinon.stub(),
      debug: sinon.stub(),
      warn: sinon.stub(),
      error: sinon.stub(),
    };

    const ssrValidator = await esmock('../../src/metatags/ssr-meta-validator.js', {
      '@adobe/fetch': {
        context: () => ({ fetch: fetchStub }),
      },
    });

    validateMetaTagsViaSSR = ssrValidator.validateMetaTagsViaSSR;
    validateDetectedIssues = ssrValidator.validateDetectedIssues;
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('validateMetaTagsViaSSR', () => {
    it('should successfully extract meta tags from HTML', async () => {
      const html = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Test Page Title</title>
            <meta name="description" content="Test page description">
          </head>
          <body>
            <h1>Main Heading</h1>
            <h1>Secondary Heading</h1>
          </body>
        </html>
      `;

      fetchStub.resolves({
        ok: true,
        status: 200,
        text: async () => html,
      });

      const result = await validateMetaTagsViaSSR('https://example.com/page', log);

      expect(result).to.deep.equal({
        title: 'Test Page Title',
        description: 'Test page description',
        h1: ['Main Heading', 'Secondary Heading'],
      });
      expect(log.debug.calledWith('Validating meta tags via SSR for: https://example.com/page')).to.be.true;
    });

    it('should return null for missing title', async () => {
      const html = `
        <!DOCTYPE html>
        <html>
          <head>
            <meta name="description" content="Test page description">
          </head>
          <body>
            <h1>Main Heading</h1>
          </body>
        </html>
      `;

      fetchStub.resolves({
        ok: true,
        status: 200,
        text: async () => html,
      });

      const result = await validateMetaTagsViaSSR('https://example.com/page', log);

      expect(result.title).to.be.null;
      expect(result.description).to.equal('Test page description');
      expect(result.h1).to.deep.equal(['Main Heading']);
    });

    it('should return null for missing description', async () => {
      const html = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Test Page Title</title>
          </head>
          <body>
            <h1>Main Heading</h1>
          </body>
        </html>
      `;

      fetchStub.resolves({
        ok: true,
        status: 200,
        text: async () => html,
      });

      const result = await validateMetaTagsViaSSR('https://example.com/page', log);

      expect(result.title).to.equal('Test Page Title');
      expect(result.description).to.be.null;
      expect(result.h1).to.deep.equal(['Main Heading']);
    });

    it('should return null for missing h1 tags', async () => {
      const html = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Test Page Title</title>
            <meta name="description" content="Test page description">
          </head>
          <body>
            <h2>Not an H1</h2>
          </body>
        </html>
      `;

      fetchStub.resolves({
        ok: true,
        status: 200,
        text: async () => html,
      });

      const result = await validateMetaTagsViaSSR('https://example.com/page', log);

      expect(result.title).to.equal('Test Page Title');
      expect(result.description).to.equal('Test page description');
      expect(result.h1).to.be.null;
    });

    it('should return null when fetch fails', async () => {
      fetchStub.resolves({
        ok: false,
        status: 404,
      });

      const result = await validateMetaTagsViaSSR('https://example.com/notfound', log);

      expect(result).to.be.null;
      expect(log.warn.calledWith('SSR validation failed with status 404 for https://example.com/notfound')).to.be.true;
    });

    it('should return null when fetch throws an error', async () => {
      fetchStub.rejects(new Error('Network error'));

      const result = await validateMetaTagsViaSSR('https://example.com/error', log);

      expect(result).to.be.null;
      expect(log.warn.calledWith(sinon.match('Error during SSR validation'))).to.be.true;
    });

    it('should handle empty/whitespace-only tags', async () => {
      const html = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>   </title>
            <meta name="description" content="  ">
          </head>
          <body>
            <h1>   </h1>
          </body>
        </html>
      `;

      fetchStub.resolves({
        ok: true,
        status: 200,
        text: async () => html,
      });

      const result = await validateMetaTagsViaSSR('https://example.com/empty', log);

      expect(result.title).to.be.null;
      expect(result.description).to.be.null;
      expect(result.h1).to.be.null;
    });
  });

  describe('validateDetectedIssues', () => {
    beforeEach(() => {
      // Mock the internal validateMetaTagsViaSSR calls
      sinon.stub(Date, 'now').returns(1000);
    });

    it('should remove false positives for missing tags', async () => {
      const detectedTags = {
        '/page1': {
          title: { issue: 'Missing title', tagContent: '' },
          description: { issue: 'Missing description', tagContent: '' },
        },
        '/page2': {
          h1: { issue: 'Missing h1', tagContent: '' },
        },
      };

      const html1 = `
        <html>
          <head>
            <title>Actual Title</title>
            <meta name="description" content="Actual description">
          </head>
        </html>
      `;

      const html2 = `
        <html>
          <body>
            <h1>Actual H1</h1>
          </body>
        </html>
      `;

      fetchStub.onFirstCall().resolves({
        ok: true,
        status: 200,
        text: async () => html1,
      });

      fetchStub.onSecondCall().resolves({
        ok: true,
        status: 200,
        text: async () => html2,
      });

      const result = await validateDetectedIssues(detectedTags, 'https://example.com', log);

      expect(result).to.deep.equal({});
      expect(log.info.calledWith(sinon.match('False positive detected'))).to.be.true;
    });

    it('should keep legitimate issues', async () => {
      const detectedTags = {
        '/page1': {
          title: { issue: 'Missing title', tagContent: '' },
          description: { issue: 'Too short description', tagContent: 'Short' },
        },
      };

      const html1 = `
        <html>
          <head>
            <meta name="description" content="Short">
          </head>
        </html>
      `;

      fetchStub.resolves({
        ok: true,
        status: 200,
        text: async () => html1,
      });

      const result = await validateDetectedIssues(detectedTags, 'https://example.com', log);

      // Title is still missing (not in SSR), description issue is not about missing
      expect(result['/page1'].title).to.exist;
      expect(result['/page1'].description).to.exist;
    });

    it('should skip endpoints without missing issues', async () => {
      const detectedTags = {
        '/page1': {
          title: { issue: 'Too long title', tagContent: 'Very long title' },
          description: { issue: 'Duplicate description', tagContent: 'Duplicate' },
        },
      };

      const result = await validateDetectedIssues(detectedTags, 'https://example.com', log);

      expect(result).to.deep.equal(detectedTags);
      expect(fetchStub.called).to.be.false;
    });

    it('should handle validation errors gracefully', async () => {
      const detectedTags = {
        '/page1': {
          title: { issue: 'Missing title', tagContent: '' },
        },
      };

      fetchStub.rejects(new Error('Network error'));

      const result = await validateDetectedIssues(detectedTags, 'https://example.com', log);

      // Should keep the issue if validation fails
      expect(result['/page1'].title).to.exist;
      expect(log.warn.called).to.be.true;
    });

    it('should return unchanged when no detected tags', async () => {
      const detectedTags = {};

      const result = await validateDetectedIssues(detectedTags, 'https://example.com', log);

      expect(result).to.deep.equal({});
      expect(fetchStub.called).to.be.false;
    });

    it('should partially remove false positives', async () => {
      const detectedTags = {
        '/page1': {
          title: { issue: 'Missing title', tagContent: '' },
          description: { issue: 'Missing description', tagContent: '' },
        },
      };

      // SSR only has title, not description
      const html = `
        <html>
          <head>
            <title>Actual Title</title>
          </head>
        </html>
      `;

      fetchStub.resolves({
        ok: true,
        status: 200,
        text: async () => html,
      });

      const result = await validateDetectedIssues(detectedTags, 'https://example.com', log);

      // Title should be removed (false positive), description should remain
      expect(result['/page1'].title).to.be.undefined;
      expect(result['/page1'].description).to.exist;
    });
  });
});
