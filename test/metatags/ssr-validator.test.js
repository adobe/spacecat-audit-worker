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
import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import esmock from 'esmock';

use(sinonChai);
use(chaiAsPromised);

describe('SSR Meta Validator', () => {
  let validateMetaTagsViaSSR;
  let validateDetectedIssues;
  let fetchStub;
  let log;

  beforeEach(async () => {
    log = {
      debug: sinon.stub(),
      info: sinon.stub(),
      warn: sinon.stub(),
      error: sinon.stub(),
    };

    fetchStub = sinon.stub();

    const ssrValidator = await esmock('../../src/metatags/ssr-meta-validator.js', {
      '@adobe/fetch': {
        context: () => ({ fetch: fetchStub }),
      },
      '@adobe/spacecat-shared-utils': {
        hasText: (text) => text && text.length > 0,
      },
    });

    validateMetaTagsViaSSR = ssrValidator.validateMetaTagsViaSSR;
    validateDetectedIssues = ssrValidator.validateDetectedIssues;
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('validateMetaTagsViaSSR', () => {
    it('should successfully validate meta tags from SSR content', async () => {
      const html = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Test Page Title</title>
            <meta name="description" content="This is a test description">
          </head>
          <body>
            <h1>Main Heading</h1>
            <h1>Second Heading</h1>
          </body>
        </html>
      `;

      fetchStub.resolves({
        ok: true,
        status: 200,
        text: async () => html,
      });

      const result = await validateMetaTagsViaSSR('https://example.com', log);

      expect(result).to.deep.equal({
        title: 'Test Page Title',
        description: 'This is a test description',
        h1: ['Main Heading', 'Second Heading'],
      });

      expect(log.debug).to.have.been.calledWith('Validating meta tags via SSR for: https://example.com');
      expect(log.debug).to.have.been.calledWith(sinon.match(/SSR validation result for https:\/\/example\.com/));
    });

    it('should return null values for missing meta tags', async () => {
      const html = `
        <!DOCTYPE html>
        <html>
          <head>
            <title></title>
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

      const result = await validateMetaTagsViaSSR('https://example.com', log);

      expect(result).to.deep.equal({
        title: null,
        description: null,
        h1: null,
      });
    });

    it('should handle HTML with no meta tags at all', async () => {
      const html = `
        <!DOCTYPE html>
        <html>
          <body>
            <p>Content without meta tags</p>
          </body>
        </html>
      `;

      fetchStub.resolves({
        ok: true,
        status: 200,
        text: async () => html,
      });

      const result = await validateMetaTagsViaSSR('https://example.com', log);

      expect(result).to.deep.equal({
        title: null,
        description: null,
        h1: null,
      });
    });

    it('should filter out empty h1 tags', async () => {
      const html = `
        <!DOCTYPE html>
        <html>
          <body>
            <h1>Valid Heading</h1>
            <h1>   </h1>
            <h1></h1>
            <h1>Another Valid Heading</h1>
          </body>
        </html>
      `;

      fetchStub.resolves({
        ok: true,
        status: 200,
        text: async () => html,
      });

      const result = await validateMetaTagsViaSSR('https://example.com', log);

      expect(result.h1).to.deep.equal(['Valid Heading', 'Another Valid Heading']);
    });

    it('should handle 403 error', async () => {
      fetchStub.resolves({
        ok: false,
        status: 403,
      });

      const result = await validateMetaTagsViaSSR('https://example.com', log);

      expect(result).to.be.null;
      expect(log.warn).to.have.been.calledWith('SSR validation failed with status 403 for https://example.com');
    });

    it('should handle non-403 HTTP errors', async () => {
      fetchStub.resolves({
        ok: false,
        status: 500,
      });

      const result = await validateMetaTagsViaSSR('https://example.com', log);

      expect(result).to.be.null;
      expect(log.warn).to.have.been.calledWith('SSR validation failed with status 500 for https://example.com');
    });

    it('should handle 404 errors', async () => {
      fetchStub.resolves({
        ok: false,
        status: 404,
      });

      const result = await validateMetaTagsViaSSR('https://example.com', log);

      expect(result).to.be.null;
      expect(log.warn).to.have.been.calledWith('SSR validation failed with status 404 for https://example.com');
    });

    it('should handle network errors', async () => {
      fetchStub.rejects(new Error('Network connection failed'));

      const result = await validateMetaTagsViaSSR('https://example.com', log);

      expect(result).to.be.null;
      expect(log.warn).to.have.been.calledWith('Error during SSR validation for https://example.com: Network connection failed');
    });

    it('should handle timeout errors', async () => {
      fetchStub.rejects(new Error('Request timeout'));

      const result = await validateMetaTagsViaSSR('https://example.com', log);

      expect(result).to.be.null;
      expect(log.warn).to.have.been.calledWith('Error during SSR validation for https://example.com: Request timeout');
    });
  });

  describe('validateDetectedIssues', () => {
    it('should return unchanged tags when no endpoints detected', async () => {
      const detectedTags = {};

      const result = await validateDetectedIssues(detectedTags, 'https://example.com', log);

      expect(result).to.deep.equal({});
      expect(fetchStub).not.to.have.been.called;
    });

    it('should remove false positives for missing tags found in SSR', async () => {
      const detectedTags = {
        '/page1': {
          title: { issue: 'Missing title tag' },
          description: { issue: 'Missing description' },
        },
        '/page2': {
          h1: { issue: 'Missing h1' },
        },
      };

      const html1 = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Page 1 Title</title>
            <meta name="description" content="Page 1 description">
          </head>
        </html>
      `;

      const html2 = `
        <!DOCTYPE html>
        <html>
          <body>
            <h1>Page 2 Heading</h1>
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
      expect(log.info).to.have.been.calledWith('False positive detected for title on /page1 - tag exists in SSR');
      expect(log.info).to.have.been.calledWith('False positive detected for description on /page1 - tag exists in SSR');
      expect(log.info).to.have.been.calledWith('False positive detected for h1 on /page2 - tag exists in SSR');
      expect(log.info).to.have.been.calledWith('SSR validation complete. Removed 3 false positives from 2 endpoints');
    });

    it('should keep real issues when not found in SSR', async () => {
      const detectedTags = {
        '/page1': {
          title: { issue: 'Missing title tag' },
          description: { issue: 'Missing description' },
        },
      };

      const html = `
        <!DOCTYPE html>
        <html>
          <head>
            <title></title>
          </head>
        </html>
      `;

      fetchStub.resolves({
        ok: true,
        status: 200,
        text: async () => html,
      });

      const result = await validateDetectedIssues(detectedTags, 'https://example.com', log);

      expect(result).to.deep.equal({
        '/page1': {
          title: { issue: 'Missing title tag' },
          description: { issue: 'Missing description' },
        },
      });
      expect(log.info).to.have.been.calledWith('SSR validation complete. Removed 0 false positives from 1 endpoints');
    });

    it('should only validate endpoints with missing issues', async () => {
      const detectedTags = {
        '/page1': {
          title: { issue: 'Title too long' },
          description: { issue: 'Description too short' },
        },
        '/page2': {
          title: { issue: 'Missing title tag' },
        },
      };

      const html = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Page Title</title>
          </head>
        </html>
      `;

      fetchStub.resolves({
        ok: true,
        status: 200,
        text: async () => html,
      });

      const result = await validateDetectedIssues(detectedTags, 'https://example.com', log);

      // Only /page2 should be validated (has missing issue)
      expect(fetchStub).to.have.been.calledOnce;
      expect(result['/page1']).to.exist;
      expect(result['/page2']).to.not.exist;
    });

    it('should handle partial false positives', async () => {
      const detectedTags = {
        '/page1': {
          title: { issue: 'Missing title tag' },
          description: { issue: 'Missing description' },
          h1: { issue: 'Missing h1' },
        },
      };

      const html = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Found Title</title>
          </head>
        </html>
      `;

      fetchStub.resolves({
        ok: true,
        status: 200,
        text: async () => html,
      });

      const result = await validateDetectedIssues(detectedTags, 'https://example.com', log);

      expect(result).to.deep.equal({
        '/page1': {
          description: { issue: 'Missing description' },
          h1: { issue: 'Missing h1' },
        },
      });
      expect(log.info).to.have.been.calledWith('False positive detected for title on /page1 - tag exists in SSR');
      expect(log.info).to.have.been.calledWith('SSR validation complete. Removed 1 false positives from 1 endpoints');
    });

    it('should handle SSR validation failures gracefully', async () => {
      const detectedTags = {
        '/page1': {
          title: { issue: 'Missing title tag' },
        },
        '/page2': {
          description: { issue: 'Missing description' },
        },
      };

      fetchStub.onFirstCall().rejects(new Error('Network error'));
      fetchStub.onSecondCall().resolves({
        ok: true,
        status: 200,
        text: async () => '<html><head><meta name="description" content="Found"></head></html>',
      });

      const result = await validateDetectedIssues(detectedTags, 'https://example.com', log);

      // First page should remain (validation failed)
      // Second page should be removed (false positive)
      expect(result).to.deep.equal({
        '/page1': {
          title: { issue: 'Missing title tag' },
        },
      });
      expect(log.info).to.have.been.calledWith('False positive detected for description on /page2 - tag exists in SSR');
    });

    it('should skip validation for non-missing issues', async () => {
      const detectedTags = {
        '/page1': {
          title: { issue: 'Title is too long (200 characters)' },
          description: { issue: 'Description is empty' },
        },
      };

      const result = await validateDetectedIssues(detectedTags, 'https://example.com', log);

      expect(result).to.deep.equal(detectedTags);
      expect(fetchStub).not.to.have.been.called;
    });

    it('should handle multiple endpoints with mixed results', async () => {
      const detectedTags = {
        '/page1': {
          title: { issue: 'Missing title tag' },
        },
        '/page2': {
          description: { issue: 'Missing description' },
        },
        '/page3': {
          h1: { issue: 'Missing h1' },
        },
      };

      fetchStub.onCall(0).resolves({
        ok: true,
        status: 200,
        text: async () => '<html><head><title>Found</title></head></html>',
      });

      fetchStub.onCall(1).resolves({
        ok: false,
        status: 500,
      });

      fetchStub.onCall(2).resolves({
        ok: true,
        status: 200,
        text: async () => '<html><body></body></html>',
      });

      const result = await validateDetectedIssues(detectedTags, 'https://example.com', log);

      expect(result).to.deep.equal({
        '/page2': {
          description: { issue: 'Missing description' },
        },
        '/page3': {
          h1: { issue: 'Missing h1' },
        },
      });
      expect(log.info).to.have.been.calledWith('SSR validation complete. Removed 1 false positives from 3 endpoints');
    });
  });
});
