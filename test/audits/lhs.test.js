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
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import nock from 'nock';

import { isIsoDate } from '@adobe/spacecat-shared-utils';
import createLHSAuditRunner, {
  extractAuditScores,
  extractThirdPartySummary,
  extractTotalBlockingTime,
  getContentLastModified,
} from '../../src/lhs/lib.js';
import { MockContextBuilder } from '../shared.js';

const { expect } = chai;
chai.use(sinonChai);
chai.use(chaiAsPromised);

const message = {
  type: 'lhs-mobile',
  url: 'site-id',
};

function assertAuditData(auditData) {
  expect(auditData).to.be.an('object');
  expect(auditData.auditResult).to.be.an('object');
  expect(auditData.auditResult.finalUrl).to.equal('https://adobe.com/');
  expect(isIsoDate(auditData.auditResult.contentLastModified)).to.be.true;
  expect(auditData.auditResult.thirdPartySummary).to.be.an('array').with.lengthOf(0);
  expect(auditData.auditResult.totalBlockingTime).to.be.null;
  expect(auditData.auditResult.scores).to.deep.equal({
    performance: 0.5,
    accessibility: 0.5,
    'best-practices': 0.5,
    seo: 0.5,
  });
}

describe('LHS Audit', () => {
  let context;
  let mobileAuditRunner;
  let desktopAuditRunner;

  const site = {
    getId: () => 'some-site-id',
  };

  const sandbox = sinon.createSandbox();

  const psiResult = {
    lighthouseResult: {
      finalUrl: 'https://adobe.com/',
      categories: {
        performance: {
          score: 0.5,
        },
        accessibility: {
          score: 0.5,
        },
        'best-practices': {
          score: 0.5,
        },
        seo: {
          score: 0.5,
        },
      },
    },
  };

  beforeEach(() => {
    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        env: {
          AUDIT_RESULTS_QUEUE_URL: 'some-queue-url',
          PAGESPEED_API_BASE_URL: 'https://psi-audit-service.com',
        },
        func: {
          version: 'v1',
        },
      })
      .build(message);

    mobileAuditRunner = createLHSAuditRunner('mobile');
    desktopAuditRunner = createLHSAuditRunner('desktop');

    nock('https://adobe.com').get('/').reply(200);
    nock('https://adobe.com').head('/').reply(200);
  });

  afterEach(() => {
    nock.cleanAll();
    sinon.restore();
  });

  it('should successfully perform an audit for mobile strategy', async () => {
    nock('https://psi-audit-service.com')
      .get('/?url=https%3A%2F%2Fadobe.com%2F&strategy=mobile&serviceId=some-site-id')
      .reply(200, psiResult);

    const auditData = await mobileAuditRunner('https://adobe.com/', context, site);
    assertAuditData(auditData);
  });

  it('logs and saves error on lighthouse error', async () => {
    const errorPSIResult = {
      ...psiResult,
    };
    errorPSIResult.lighthouseResult.runtimeError = { code: 'error-code', message: 'error-message' };

    nock('https://psi-audit-service.com')
      .get('/?url=https%3A%2F%2Fadobe.com%2F&strategy=mobile&serviceId=some-site-id')
      .reply(200, errorPSIResult);

    const auditData = await mobileAuditRunner('https://adobe.com/', context, site);

    expect(context.log.error).to.have.been.calledWith(
      'Audit error for site https://adobe.com/: error-message',
      { code: 'error-code', strategy: 'mobile' },
    );
    expect(auditData.auditResult.runtimeError).to.be.an('object');
  });

  it('successfully performs an audit for desktop strategy on dev', async () => {
    context.func = {
      version: 'ci',
    };

    nock('https://psi-audit-service.com')
      .get('/?url=https%3A%2F%2Fadobe.com%2F&strategy=desktop&serviceId=some-site-id')
      .reply(200, psiResult);

    const auditData = await desktopAuditRunner('https://adobe.com/', context, site);
    assertAuditData(auditData);
  });

  it('throws error when psi api fetch fails', async () => {
    nock('https://adobe.com').get('/').reply(200);
    nock('https://psi-audit-service.com')
      .get('/?url=https%3A%2F%2Fadobe.com%2F&strategy=mobile&serviceId=some-site-id')
      .reply(405, 'Method Not Allowed');

    await expect(mobileAuditRunner('https://adobe.com/', context, site))
      .to.be.rejectedWith('HTTP error! Status: 405');
  });

  it('throws error when context is incomplete', async () => {
    context.env = {};

    await expect(mobileAuditRunner('https://adobe.com/', context, site))
      .to.be.rejectedWith('Invalid PageSpeed API base URL');
  });
});

describe('LHS Data Utils', () => {
  describe('extractAuditScores', () => {
    it('extracts audit scores correctly', () => {
      const categories = {
        performance: { score: 0.8 },
        seo: { score: 0.9 },
        accessibility: { score: 0.7 },
        'best-practices': { score: 0.6 },
      };

      const scores = extractAuditScores(categories);

      expect(scores).to.deep.equal({
        performance: 0.8,
        seo: 0.9,
        accessibility: 0.7,
        'best-practices': 0.6,
      });
    });
  });

  describe('extractTotalBlockingTime', () => {
    it('extracts total blocking time if present', () => {
      const psiAudit = {
        'total-blocking-time': { numericValue: 1234 },
      };

      const tbt = extractTotalBlockingTime(psiAudit);

      expect(tbt).to.equal(1234);
    });

    it('returns null if total blocking time is absent', () => {
      const psiAudit = {};

      const tbt = extractTotalBlockingTime(psiAudit);

      expect(tbt).to.be.null;
    });
  });

  describe('extractThirdPartySummary', () => {
    it('extracts third party summary correctly', () => {
      const psiAudit = {
        'third-party-summary': {
          details: {
            items: [
              {
                entity: 'ExampleEntity',
                blockingTime: 200,
                mainThreadTime: 1000,
                transferSize: 1024,
              },
            ],
          },
        },
      };

      const summary = extractThirdPartySummary(psiAudit);

      expect(summary).to.deep.equal([
        {
          entity: 'ExampleEntity',
          blockingTime: 200,
          mainThreadTime: 1000,
          transferSize: 1024,
        },
      ]);
    });

    it('returns an empty array if third party summary details are absent', () => {
      const psiAudit = {};

      const summary = extractThirdPartySummary(psiAudit);

      expect(summary).to.be.an('array').that.is.empty;
    });
  });

  describe('getContentLastModified', () => {
    const lastModifiedDate = 'Tue, 05 Dec 2023 20:08:48 GMT';
    const expectedDate = new Date(lastModifiedDate).toISOString();
    let logSpy;

    beforeEach(() => {
      logSpy = { error: sinon.spy() };
    });

    afterEach(() => {
      nock.cleanAll();
    });

    it('returns last modified date on successful fetch', async () => {
      nock('https://www.site1.com')
        .head('/')
        .reply(200, '', { 'last-modified': lastModifiedDate });

      const result = await getContentLastModified('https://www.site1.com', logSpy);

      expect(result).to.equal(expectedDate);
    });

    it('returns current date when last modified date is not present', async () => {
      nock('https://www.site2.com')
        .head('/')
        .reply(200, '', { 'last-modified': null });

      const result = await getContentLastModified('https://www.site2.com', logSpy);

      expect(result).to.not.equal(expectedDate);
    });

    it('returns current date and logs error on fetch failure', async () => {
      nock('https://www.site3.com')
        .head('/')
        .replyWithError('Network error');

      const result = await getContentLastModified('https://www.site3.com', logSpy);

      expect(result).to.not.equal(expectedDate);
      expect(isIsoDate(result)).to.be.true;
      expect(logSpy.error.calledOnce).to.be.true;
    });

    it('returns current date and logs error on non-OK response', async () => {
      nock('https://www.site4.com')
        .head('/')
        .reply(404);

      const result = await getContentLastModified('https://www.site4.com', logSpy);

      expect(result).to.not.equal(expectedDate);
      expect(isIsoDate(result)).to.be.true;
      expect(logSpy.error.calledOnce).to.be.true;
    });
  });
});
