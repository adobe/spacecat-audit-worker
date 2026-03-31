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
import sinonChai from 'sinon-chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import nock from 'nock';
import { AsyncJob } from '@adobe/spacecat-shared-data-access';
import { MockContextBuilder } from '../shared.js';

use(sinonChai);
use(chaiAsPromised);

describe('Preflight URL Matching Bug Demonstration', () => {
  let context;
  let site;
  let job;
  let s3Client;

  const sandbox = sinon.createSandbox();

  beforeEach(() => {
    site = {
      getId: () => 'site-123',
      getBaseURL: () => 'https://example.com',
    };

    s3Client = {
      send: sinon.stub(),
    };

    job = {
      getMetadata: () => ({
        payload: {
          step: 'identify',
          urls: ['https://main--example--page.aem.page/'], // Input URL with trailing slash
          enableAuthentication: false,
        },
      }),
      getStatus: sinon.stub().returns('IN_PROGRESS'),
      getId: () => 'job-123',
    };

    context = new MockContextBuilder()
      .withSandbox(sinon.createSandbox())
      .withOverrides({
        job,
        site,
        s3Client,
        env: {
          S3_SCRAPER_BUCKET_NAME: 'test-bucket',
        },
      })
      .build();

    // Mock AsyncJob.findById
    context.dataAccess.AsyncJob.findById = sinon.stub().callsFake(() => Promise.resolve({
      getId: () => 'job-123',
      setResult: sinon.stub(),
      setStatus: sinon.stub(),
      setResultType: sinon.stub(),
      setEndedAt: sinon.stub(),
      setError: sinon.stub(),
      save: sinon.stub().resolves(),
    }));
  });

  afterEach(() => {
    sinon.restore();
    sandbox.restore();
  });

  it('shows the URL normalization process', () => {
    // This test demonstrates the URL normalization logic
    const inputUrl = 'https://main--example--page.aem.page/';
    const urlObj = new URL(inputUrl);
    const normalizedUrl = urlObj.origin + urlObj.pathname.replace(/\/$/, '');

    // Input URL has trailing slash
    expect(inputUrl).to.equal('https://main--example--page.aem.page/');

    // Normalized URL removes trailing slash
    expect(normalizedUrl).to.equal('https://main--example--page.aem.page');

    // This is the mismatch that causes the bug:
    // - audits Map key: 'https://main--example--page.aem.page' (normalized)
    // - finalUrl from S3: 'https://main--example--page.aem.page/' (with slash)
    // - audits.get(finalUrl) returns undefined
  });
});
