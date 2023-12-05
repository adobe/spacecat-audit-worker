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

/* eslint-env mocha */

import { expect } from 'chai';
import nock from 'nock';
import sinon from 'sinon';
import ContentClient from '../../src/support/content-client.js';

describe('ContentClient', () => {
  let contentClient;

  beforeEach(() => {
    contentClient = ContentClient();
  });

  afterEach(() => {
    sinon.restore();
    nock.cleanAll();
  });

  describe('fetchMarkdownDiff', () => {
    it('returns null if content URL is not given', async () => {
      const result = await contentClient.fetchMarkdownDiff(null, null, null);
      expect(result).to.equal(null);
    });

    it('appends "index.md" to the markdown URL if it ends with "/"', async () => {
      nock('http://example.com')
        .get('/index.md')
        .reply(200, 'Sample Markdown content');

      await contentClient.fetchMarkdownDiff('example.com', 'http://example.com/');

      expect(nock.isDone()).to.be.true;
    });

    it('appends ".md" to the markdown URL if it does not end with "/"', async () => {
      nock('http://example.com')
        .get('/some-page.md')
        .reply(200, 'Sample Markdown content');

      await contentClient.fetchMarkdownDiff('example.com', 'http://example.com/some-page');

      expect(nock.isDone()).to.be.true;
    });

    it('fetches Markdown content successfully', async () => {
      const markdownContentStub = 'Sample Markdown content';
      nock('http://example.com')
        .get('/index.md')
        .reply(200, markdownContentStub);

      const result = await contentClient.fetchMarkdownDiff('example.com', 'http://example.com');

      expect(result.markdownContent).to.equal(markdownContentStub);
      expect(result.markdownDiff).to.include(markdownContentStub);
    });

    it('returns null when repo not found', async () => {
      nock('http://example.com')
        .get('/index.md')
        .reply(404);

      const result = await contentClient.fetchMarkdownDiff('example.com', 'http://example.com');

      expect(result).to.be.null;
    });

    it('finds a difference between the latest audit and fetched Markdown content', async () => {
      const latestAudit = { markdownContent: 'Original Markdown content' };
      const markdownContentStub = 'Changed Markdown content';

      nock('http://example.com')
        .get('/index.md')
        .reply(200, markdownContentStub);

      const result = await contentClient.fetchMarkdownDiff('example.com', 'http://example.com', latestAudit);

      expect(result.markdownContent).to.equal(markdownContentStub);
      expect(result.markdownDiff).to.include('-Original Markdown content');
      expect(result.markdownDiff).to.include('+Changed Markdown content');
    });

    it('does not find a difference if latest audit and fetched Markdown content are identical', async () => {
      const latestAudit = { markdownContent: 'Sample Markdown content' };
      const markdownContentStub = 'Sample Markdown content';

      nock('http://example.com')
        .get('/index.md')
        .reply(200, markdownContentStub);

      const result = await contentClient.fetchMarkdownDiff('example.com', 'http://example.com', latestAudit);

      expect(result.markdownContent).to.equal(markdownContentStub);
      expect(result.markdownDiff).to.be.null;
    });

    it('handles 404 Not Found response gracefully', async () => {
      nock('http://example.com')
        .get('/index.md')
        .reply(404);

      const result = await contentClient.fetchMarkdownDiff('example.com', 'http://example.com');

      expect(result).to.be.null;
    });

    it('handles network errors gracefully', async () => {
      nock('http://example.com')
        .get('/index.md')
        .replyWithError('Network Error');

      const logStub = sinon.stub(console, 'error');

      await contentClient.fetchMarkdownDiff('example.com', 'http://example.com');

      expect(logStub.calledWithMatch(sinon.match.string, sinon.match.has('message', 'Network Error'))).to.be.true;
    });
  });
});
