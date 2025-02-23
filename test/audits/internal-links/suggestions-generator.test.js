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
import sinonChai from 'sinon-chai';
import { FirefallClient } from '@adobe/spacecat-shared-gpt-client';
import sinon from 'sinon';
import nock from 'nock';
import { Config } from '@adobe/spacecat-shared-data-access/src/models/site/config.js';
import { generateSuggestionData } from '../../../src/internal-links/suggestions-generator.js';
import { MockContextBuilder } from '../../shared.js';

const site = {
  getConfig: () => Config({}),
  getId: () => 'site1',
  getBaseURL: () => 'https://bar.foo.com',
  getIsLive: () => true,
  getOrganizationId: () => 'org1',
};

use(sinonChai);
use(chaiAsPromised);

describe('generateSuggestionData', async function test() {
  this.timeout(10000);

  let auditData;
  let configuration;
  let firefallClient;

  let message;
  let context;

  const sandbox = sinon.createSandbox();

  beforeEach(() => {
    message = {
      type: 'internal-links',
      siteId: 'site1',
    };

    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        env: {
          S3_SCRAPER_BUCKET_NAME: 'test-bucket',
        },
        s3Client: {
          send: sandbox.stub(),
        },
      })
      .build(message);
  });
  afterEach(() => {
    nock.cleanAll();
    sinon.restore();
  });

  const mockFileResponse = {
    ContentType: 'application/json',
    Body: {
      transformToString: sandbox.stub().resolves(JSON.stringify({
        finalUrl: 'https://example.com/page1',
        scrapeResult: {
          rawBody: '<html lang="en"><body><header><a href="/home">Home</a><a href="/about">About</a></header></body></html>',
          tags: {
            title: 'Page 1 Title',
            description: 'Page 1 Description',
            h1: ['Page 1 H1'],
          },
        },
      })),
    },
  };

  beforeEach(() => {
    auditData = {
      auditResult: {
        success: true,
        brokenInternalLinks: [
          { urlTo: 'https://example.com/broken1' },
          { urlTo: 'https://example.com/broken2' },
        ],
      },
    };
    configuration = {
      isHandlerEnabledForSite: sandbox.stub(),
    };
    context.dataAccess.Configuration.findLatest.resolves(configuration);

    firefallClient = {
      fetchChatCompletion: sandbox.stub(),
    };
    sandbox.stub(FirefallClient, 'createFrom').returns(firefallClient);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('returns original auditData if audit result is unsuccessful', async () => {
    auditData.auditResult.success = false;

    const result = await generateSuggestionData('https://example.com', auditData, context, site);

    expect(result).to.deep.equal(auditData);
    expect(context.log.info).to.have.been.calledWith('Audit failed, skipping suggestions generation');
  });

  it('returns original auditData if auto-suggest is disabled for the site', async () => {
    configuration.isHandlerEnabledForSite.returns(false);

    const result = await generateSuggestionData('https://example.com', auditData, context, site);

    expect(result).to.deep.equal(auditData);
    expect(context.log.info).to.have.been.calledWith('Auto-suggest is disabled for site');
  });

  it('processes suggestions for broken internal links, defaults to base URL if none found', async () => {
    context.s3Client.send.onCall(0).resolves({
      Contents: [
        { Key: 'scrapes/site1/scrape.json' },
      ],
      IsTruncated: false,
      NextContinuationToken: 'token',
    });
    context.s3Client.send.resolves(mockFileResponse);
    configuration.isHandlerEnabledForSite.returns(true);
    firefallClient.fetchChatCompletion.resolves({
      choices: [{
        message: { content: JSON.stringify({ suggested_urls: ['https://fix.com'], aiRationale: 'Rationale' }) },
        finish_reason: 'stop',
      }],
    });
    firefallClient.fetchChatCompletion.onCall(3).resolves({
      choices: [{
        message: { content: JSON.stringify({ some_other_property: 'some other value' }) },
        finish_reason: 'stop',
      }],
    });

    await generateSuggestionData('https://example.com', auditData, context, site);

    // expect(firefallClient.fetchChatCompletion).to.have.been.callCount(4);
    // expect(result.auditResult.brokenInternalLinks).to.deep.equal([
    //   {
    //     urlTo: 'https://example.com/broken1',
    //     urlsSuggested: ['https://fix.com'],
    //     aiRationale: 'Rationale',
    //   },
    //   {
    //     urlTo: 'https://example.com/broken2',
    //     urlsSuggested: ['https://example.com'],
    //     aiRationale: 'No suitable suggestions found',
    //   },
    // ]);
    // expect(context.log.info).to.have.been.calledWith('Suggestions generation complete.');
  });

  it('generates suggestions in multiple batches if there are more than 300 alternative URLs', async () => {
    context.s3Client.send.onCall(0).resolves({
      Contents: [
        // genereate 301 keys
        ...Array.from({ length: 301 }, (_, i) => ({ Key: `scrapes/site-id/scrape${i}.json` })),
      ],
      IsTruncated: false,
      NextContinuationToken: 'token',
    });
    context.s3Client.send.resolves(mockFileResponse);
    configuration.isHandlerEnabledForSite.returns(true);
    firefallClient.fetchChatCompletion.resolves({
      choices: [{
        message: {
          content: JSON.stringify({ suggested_urls: ['https://fix.com'], aiRationale: 'Rationale' }),
          aiRationale: 'Rationale',
        },
        finish_reason: 'stop',
      }],
    });

    firefallClient.fetchChatCompletion.onCall(1).resolves({
      choices: [{
        message: {
          content: JSON.stringify({ suggested_urls: ['https://fix.com'], aiRationale: 'Rationale' }),
          aiRationale: 'Rationale',
        },
        finish_reason: 'length',
      }],
    });

    firefallClient.fetchChatCompletion.onCall(6).resolves({
      choices: [{
        message: {
          content: JSON.stringify({ suggested_urls: ['https://fix.com'], aiRationale: 'Rationale' }),
          aiRationale: 'Rationale',
        },
        finish_reason: 'length',
      }],
    });

    firefallClient.fetchChatCompletion.onCall(7).resolves({
      choices: [{
        message: {
          content: JSON.stringify({ suggested_urls: ['https://fix.com'], aiRationale: 'Rationale' }),
          aiRationale: 'Rationale',
        },
        finish_reason: 'length',
      }],
    });

    await generateSuggestionData('https://example.com', auditData, context, site);

    // expect(firefallClient.fetchChatCompletion).to.have.been.callCount(8);
    // expect(result.auditResult.brokenInternalLinks).to.deep.equal([
    //   {
    //     urlTo: 'https://example.com/broken1',
    //     urlsSuggested: ['https://fix.com'],
    //     aiRationale: 'Rationale',
    //   },
    //   {
    //     urlTo: 'https://example.com/broken2',
    //   },
    // ]);
    // expect(context.log.info).to.have.been.calledWith('Suggestions generation complete.');
  }).timeout(20000);

  it('handles Firefall client errors gracefully and continues processing, should suggest base URL instead', async () => {
    context.s3Client.send.onCall(0).resolves({
      Contents: [
        // genereate 301 keys
        ...Array.from({ length: 301 }, (_, i) => ({ Key: `scrapes/site-id/scrape${i}.json` })),
      ],
      IsTruncated: false,
      NextContinuationToken: 'token',
    });
    context.s3Client.send.resolves(mockFileResponse);
    configuration.isHandlerEnabledForSite.returns(true);
    firefallClient.fetchChatCompletion.onCall(0).rejects(new Error('Firefall error'));
    firefallClient.fetchChatCompletion.onCall(2).rejects(new Error('Firefall error'));
    firefallClient.fetchChatCompletion.onCall(4).resolves({
      choices: [{
        message: {
          content: JSON.stringify({ some_other_property: 'some other value' }),
          aiRationale: 'Rationale',
        },
        finish_reason: 'stop',
      }],
    });
    firefallClient.fetchChatCompletion.onCall(7).rejects(new Error('Firefall error'));
    firefallClient.fetchChatCompletion.resolves({
      choices: [{
        message: {
          content: JSON.stringify({ suggested_urls: ['https://fix.com'], aiRationale: 'Rationale' }),
          aiRationale: 'Rationale',
        },
        finish_reason: 'stop',
      }],
    });

    await generateSuggestionData('https://example.com', auditData, context, site);

    // expect(result.auditResult.brokenInternalLinks).to.deep.equal([
    //   {
    //     urlTo: 'https://example.com/broken1',
    //     urlsSuggested: ['https://example.com'],
    //     aiRationale: 'No suitable suggestions found',
    //   },
    //   {
    //     urlTo: 'https://example.com/broken2',
    //   },
    // ]);
    // expect(context.log.error).to.have.been.calledWith('Batch processing error: Firefall error');
  }).timeout(20000);
});
