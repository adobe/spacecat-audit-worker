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
import GithubClient from '../../src/support/github-client.js';

describe('GithubClient', () => {
  let sandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
    nock.cleanAll();
  });

  describe('createGithubApiUrl', () => {
    it('creates a basic URL', () => {
      const client = GithubClient({ baseUrl: 'https://api.github.com' });
      const url = client.createGithubApiUrl('some-org');
      expect(url).to.equal('https://api.github.com/repos/some-org?page=1&per_page=100');
    });

    it('includes repoName in the URL', () => {
      const client = GithubClient({ baseUrl: 'https://api.github.com' });
      const url = client.createGithubApiUrl('some-org', 'test');
      expect(url).to.equal('https://api.github.com/repos/some-org/test?page=1&per_page=100');
    });

    it('appends additional path to the URL', () => {
      const client = GithubClient({ baseUrl: 'https://api.github.com' });
      const url = client.createGithubApiUrl('some-org', 'test', 'commits');
      expect(url).to.equal('https://api.github.com/repos/some-org/test/commits?page=1&per_page=100');
    });

    it('includes page number in the URL', () => {
      const client = GithubClient({ baseUrl: 'https://api.github.com' });
      const url = client.createGithubApiUrl('some-org', 'test', 'commits', 5);
      expect(url).to.equal('https://api.github.com/repos/some-org/test/commits?page=5&per_page=100');
    });
  });

  describe('createGithubAuthHeaderValue', () => {
    it('throws error if credentials are missing', () => {
      const client = GithubClient({ baseUrl: 'https://api.github.com' });
      expect(() => client.createGithubAuthHeaderValue()).to.throw('GitHub credentials not provided');
    });

    it('creates a valid Basic Auth header', () => {
      const client = GithubClient({ baseUrl: 'https://api.github.com', githubId: 'id', githubSecret: 'secret' });
      const header = client.createGithubAuthHeaderValue();
      expect(header).to.equal(`Basic ${Buffer.from('id:secret').toString('base64')}`);
    });
  });

  describe('fetchGithubDiff', () => {
    it('fetches diffs from GitHub', async () => {
      const client = GithubClient({ baseUrl: 'https://api.github.com', githubId: 'id', githubSecret: 'secret' });
      const audit = {
        time: '2023-06-16T00:00:00.000Z',
      };
      const lastAuditedAt = '2023-06-15T00:00:00.000Z';
      const gitHubURL = 'https://github.com/some-org/test';

      nock('https://api.github.com')
        .get('/repos/some-org/test/commits')
        .query(true)
        .reply(200, [
          { sha: 'abc123' },
          { sha: 'def456' },
        ]);

      nock('https://api.github.com')
        .get('/repos/some-org/test/commits/abc123')
        .query(true)
        .reply(200, 'mocked-diff-data');

      nock('https://api.github.com')
        .get('/repos/some-org/test/commits/def456')
        .query(true)
        .reply(200, 'mocked-diff-data');

      const diffs = await client.fetchGithubDiff('example.com', audit.time, lastAuditedAt, gitHubURL);
      expect(diffs).to.equal('mocked-diff-data\nmocked-diff-data\n');
    });

    it('handles errors from GitHub API', async () => {
      const client = GithubClient({ baseUrl: 'https://api.github.com', githubId: 'id', githubSecret: 'secret' });
      nock('https://api.github.com').get('/repos/some-org/test/commits').query(true).replyWithError('Network Error');

      const audit = {
        time: '2023-06-16T00:00:00.000Z',
      };
      const lastAuditedAt = '2023-06-15T00:00:00.000Z';
      const gitHubURL = 'https://github.com/some-org/test';

      const result = await client.fetchGithubDiff('example.com', audit.time, lastAuditedAt, gitHubURL);
      expect(result).to.equal('');
    });

    it('handles unexpected data format from GitHub API', async () => {
      const client = GithubClient({ baseUrl: 'https://api.github.com', githubId: 'id', githubSecret: 'secret' });
      nock('https://api.github.com').get('/repos/some-org/test/commits').query(true).reply(200, null);

      const audit = {
        time: '2023-06-16T00:00:00.000Z',
      };
      const lastAuditedAt = '2023-06-15T00:00:00.000Z';
      const gitHubURL = 'https://github.com/some-org/test';

      const diffs = await client.fetchGithubDiff('example.com', audit.time, lastAuditedAt, gitHubURL);
      expect(diffs).to.equal('');
    });

    it('sets "since" to 24 hours before "until" if "lastAuditedAt" is not provided', async () => {
      const client = GithubClient({ baseUrl: 'https://api.github.com', githubId: 'id', githubSecret: 'secret' });
      const fixedFetchTime = '2023-06-16T00:00:00.000Z';
      const audit = {
        time: fixedFetchTime,
      };
      const expectedSince = new Date(new Date(fixedFetchTime) - 86400 * 1000).toISOString();

      nock('https://api.github.com')
        .get('/repos/some-org/test/commits')
        .query({ since: expectedSince, until: fixedFetchTime })
        .reply(200, []);

      const result = await client.fetchGithubDiff('example.com', audit.time, null, 'https://github.com/some-org/test');
      expect(result).to.equal('');
    });

    it('skips binary or too large diffs', async () => {
      const client = GithubClient(
        { baseUrl: 'https://api.github.com', githubId: 'id', githubSecret: 'secret' },
        console,
      );
      const mockDiffs = [
        { sha: 'commit1', data: 'Sample diff content' },
        { sha: 'commit2', data: 'Binary files differ' },
        { sha: 'commit3', data: 'Another diff content that makes the total size exceed MAX_DIFF_SIZE' },
      ];
      const audit = {
        time: '2023-06-16T00:00:00.000Z',
      };

      nock('https://api.github.com')
        .get('/repos/some-org/test/commits')
        .query(true)
        .reply(200, mockDiffs.map((diff) => ({ sha: diff.sha })));

      mockDiffs.forEach((diff) => {
        nock('https://api.github.com')
          .get(`/repos/some-org/test/commits/${diff.sha}`)
          .query(true)
          .reply(200, diff.data);
      });

      const logStub = sandbox.stub(console, 'warn');

      await client.fetchGithubDiff('example.com', audit.time, '2023-06-15T00:00:00.000Z', 'https://github.com/some-org/test');
      sinon.assert.calledWithMatch(logStub, new RegExp(`Skipping commit ${mockDiffs[1].sha}`));

      logStub.restore();
    });

    it('includes diffs that are not binary and within size limit', async () => {
      const client = GithubClient({ baseUrl: 'https://api.github.com', githubId: 'id', githubSecret: 'secret' });
      const mockDiffs = [
        { sha: 'commit1', data: 'Sample diff content' },
        { sha: 'commit2', data: 'Another valid diff content' },
      ];
      const audit = {
        time: '2023-06-16T00:00:00.000Z',
      };

      nock('https://api.github.com')
        .get('/repos/some-org/test/commits')
        .query(true)
        .reply(200, mockDiffs.map((diff) => ({ sha: diff.sha })));

      mockDiffs.forEach((diff) => {
        nock('https://api.github.com')
          .get(`/repos/some-org/test/commits/${diff.sha}`)
          .query(true)
          .reply(200, diff.data);
      });

      const result = await client.fetchGithubDiff('example.com', audit.time, '2023-06-15T00:00:00.000Z', 'https://github.com/some-org/test');
      expect(result).to.include(mockDiffs[0].data);
      expect(result).to.include(mockDiffs[1].data);
    });

    it('logs error.response.data when error has a response property', async () => {
      const client = GithubClient({ baseUrl: 'https://api.github.com', githubId: 'id', githubSecret: 'secret' });

      const errorWithResponse = {
        response: {
          data: 'Some structured error',
        },
      };

      const audit = {
        time: '2023-06-16T00:00:00.000Z',
      };

      nock('https://api.github.com')
        .get('/repos/some-org/test/commits')
        .query(true)
        .replyWithError({ message: 'Network Error', response: errorWithResponse });

      const logStub = sandbox.stub(console, 'error');

      await client.fetchGithubDiff('example.com', audit.time, '', 'https://github.com/some-org/test');
      expect(logStub.calledWithMatch('Error fetching GitHub diff data for site example.com: FetchError: Network Error')).to.be.true;

      logStub.restore();
    });

    it('logs the error directly when error does not have a response property', async () => {
      const client = GithubClient({ baseUrl: 'https://api.github.com', githubId: 'id', githubSecret: 'secret' });
      const audit = {
        time: '2023-06-16T00:00:00.000Z',
      };

      nock('https://api.github.com')
        .get('/repos/some-org/test/commits')
        .query(true)
        .replyWithError({ message: 'Generic error' });

      const logStub = sandbox.stub(console, 'error');

      await client.fetchGithubDiff('example.com', audit.time, '', 'https://github.com/some-org/test');
      expect(logStub.calledWithMatch('Error fetching GitHub diff data for site example.com: FetchError: Generic error')).to.be.true;

      logStub.restore();
    });
  });
});
