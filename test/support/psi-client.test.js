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

import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import nock from 'nock';
import sinon from 'sinon';

import PSIClient from '../../src/support/psi-client.js';

chai.use(chaiAsPromised);

const { expect } = chai;

describe('PSIClient', () => {
  let client;
  let logMock;
  const config = {
    apiKey: 'testApiKey',
    apiBaseUrl: 'https://example.com',
    environment: 'dev',
  };

  beforeEach(() => {
    logMock = { info: sinon.spy(), error: sinon.spy() };
    client = PSIClient(config, logMock);
  });

  afterEach(() => {
    sinon.restore();
    nock.cleanAll();
  });

  describe('PSI Function', () => {
    it('throws error when api base url is missing', () => {
      expect(() => PSIClient({})).to.throw('Invalid PSI API Base URL: undefined');
    });
  });

  describe('formatURL', () => {
    it('formats HTTP URL to HTTPS', () => {
      const result = client.formatURL('http://testsite.com');
      expect(result).to.equal('https://testsite.com');
    });

    it('keeps HTTPS URL unchanged', () => {
      const result = client.formatURL('https://testsite.com');
      expect(result).to.equal('https://testsite.com');
    });
  });

  describe('getPSIApiUrl', () => {
    it('builds PSI API URL correctly', () => {
      const url = client.getPSIApiUrl('testsite.com', 'mobile');
      expect(url).to.include('https://example.com');
      expect(url).to.include('testsite.com');
      expect(url).to.include('mobile');
    });

    it('defaults to mobile strategy if an unknown strategy is given', () => {
      const url = client.getPSIApiUrl('testsite.com', 'unknown');
      expect(url).to.include('mobile');
    });

    // Additional cases can be tested here...
  });

  describe('performPSICheck', () => {
    it('fetches PSI data successfully', async () => {
      nock('https://example.com')
        .get('/')
        .matchHeader('x-source', 'spacecat-dev')
        .query(true)
        .reply(200, { lighthouseResult: { score: 0.9 } });

      const result = await client.performPSICheck('testsite.com', 'mobile');
      expect(result).to.deep.equal(
        {
          fullAuditRef: 'https://example.com/?url=https%3A%2F%2Ftestsite.com&strategy=mobile&key=testApiKey',
          lighthouseResult: {
            score: 0.9,
          },
        },
      );
    });

    it('logs an error and throws on fetch failure', async () => {
      nock('https://example.com')
        .get('/')
        .query(true)
        .replyWithError('Network error');

      try {
        await client.performPSICheck('testsite.com', 'mobile');
        expect.fail('Should have thrown an error');
      } catch (e) {
        expect(logMock.error.called).to.be.true;
      }
    });
  });

  describe('runAudit', () => {
    it('performs and logs an audit', async () => {
      // follow redirects request
      nock('https://testsite.com')
        .get('/')
        .query(true)
        .reply(200);

      // psi api request
      nock('https://example.com')
        .get('/')
        .query(true)
        .reply(200, { lighthouseResult: { score: 0.8 } });

      const result = await client.runAudit('testsite.com', 'mobile');
      expect(result).to.deep.equal(
        {
          finalUrl: 'https://testsite.com/',
          fullAuditRef: 'https://example.com/?url=https%3A%2F%2Ftestsite.com%2F&strategy=mobile&key=testApiKey',
          lighthouseResult: {
            score: 0.8,
          },
        },
      );
      expect(logMock.info.called).to.be.true;
    });

    it('throws an error if no lighthouse data is returned', async () => {
      // follow redirects request
      nock('https://testsite.com')
        .get('/')
        .query(true)
        .reply(200);

      // psi api request
      nock('https://example.com')
        .get('/')
        .query(true)
        .reply(200, {});

      await expect(client.runAudit('testsite.com', 'mobile')).to.be.rejectedWith('Invalid PSI data');
    });
  });

  describe('followRedirects', () => {
    afterEach(() => {
      nock.cleanAll();
    });

    it('returns the same URL if there is no redirect', async () => {
      const url = 'https://no-redirect.com';
      nock(url)
        .get('/')
        .reply(200, undefined, { 'Content-Type': 'application/json' });

      const result = await client.followRedirects(url);
      expect(result).to.equal(`${url}/`);
    });

    it('returns the original URL on error', async () => {
      const url = 'https://error.com';
      nock(url)
        .get('/')
        .replyWithError('Network error');

      const result = await client.followRedirects(url);
      expect(result).to.equal(url);
      expect(logMock.error.called).to.be.true;
    });

    it('returns the original URL when there is no redirect', async () => {
      const url = 'https://no-redirect.com';
      nock(url)
        .get('/')
        .reply(200, undefined, { 'Content-Type': 'application/json' });

      const result = await client.followRedirects(url);
      expect(result).to.equal(`${url}/`);
    });
  });
});
