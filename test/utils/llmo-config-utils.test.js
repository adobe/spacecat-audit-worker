/*
 * Copyright 2026 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import esmock from 'esmock';

use(sinonChai);

describe('llmo-config-utils', () => {
  let sandbox;
  let mockLlmoConfig;
  let llmoConfigUtils;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    mockLlmoConfig = {
      readConfig: sandbox.stub(),
    };

    llmoConfigUtils = await esmock('../../src/utils/llmo-config-utils.js', {
      '@adobe/spacecat-shared-utils': {
        llmoConfig: mockLlmoConfig,
      },
    });
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('returns the trimmed configured cdn provider', async () => {
    const site = {
      getId: sandbox.stub().returns('site-123'),
    };
    const context = {
      log: { warn: sandbox.stub() },
      s3Client: {},
      env: { S3_IMPORTER_BUCKET_NAME: 'config-bucket' },
    };
    mockLlmoConfig.readConfig.resolves({
      config: {
        cdnBucketConfig: {
          cdnProvider: ' byocdn-akamai ',
        },
      },
    });

    const provider = await llmoConfigUtils.getConfigCdnProvider(site, context);

    expect(provider).to.equal('byocdn-akamai');
    expect(mockLlmoConfig.readConfig).to.have.been.calledOnceWith(
      'site-123',
      context.s3Client,
      { s3Bucket: 'config-bucket' },
    );
  });

  it('returns an empty string when required config lookup inputs are missing', async () => {
    const provider = await llmoConfigUtils.getConfigCdnProvider(
      {},
      { env: { S3_IMPORTER_BUCKET_NAME: 'config-bucket' } },
    );

    expect(provider).to.equal('');
    expect(mockLlmoConfig.readConfig).not.to.have.been.called;
  });

  it('returns an empty string when cdn provider is missing from config', async () => {
    const site = {
      getId: sandbox.stub().returns('site-123'),
    };
    const context = {
      log: { warn: sandbox.stub() },
      s3Client: {},
      env: { S3_IMPORTER_BUCKET_NAME: 'config-bucket' },
    };
    mockLlmoConfig.readConfig.resolves({
      config: {
        cdnBucketConfig: {},
      },
    });

    const provider = await llmoConfigUtils.getConfigCdnProvider(site, context);

    expect(provider).to.equal('');
  });

  it('returns an empty string and logs a warning when config lookup fails', async () => {
    const site = {
      getId: sandbox.stub().returns('site-123'),
    };
    const context = {
      log: { warn: sandbox.stub() },
      s3Client: {},
      env: { S3_IMPORTER_BUCKET_NAME: 'config-bucket' },
    };
    mockLlmoConfig.readConfig.rejects(new Error('lookup failed'));

    const provider = await llmoConfigUtils.getConfigCdnProvider(site, context);

    expect(provider).to.equal('');
    expect(context.log.warn).to.have.been.calledWith(
      'Failed to fetch config CDN provider: lookup failed',
    );
  });

  it('returns an empty string on lookup failure even when warn logger is absent', async () => {
    const site = {
      getId: sandbox.stub().returns('site-123'),
    };
    const context = {
      s3Client: {},
      env: { S3_IMPORTER_BUCKET_NAME: 'config-bucket' },
    };
    mockLlmoConfig.readConfig.rejects(new Error('lookup failed'));

    const provider = await llmoConfigUtils.getConfigCdnProvider(site, context);

    expect(provider).to.equal('');
  });
});
