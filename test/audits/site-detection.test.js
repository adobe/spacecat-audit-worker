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
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import chaiAsPromised from 'chai-as-promised';
import nock from 'nock';
import { createSite } from '@adobe/spacecat-shared-data-access/src/models/site.js';
import { createSiteCandidate } from '@adobe/spacecat-shared-data-access/src/models/site-candidate.js';
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { siteDetectionRunner } from '../../src/site-detection/handler.js';

use(sinonChai);
use(chaiAsPromised);

const sandbox = sinon.createSandbox();

const jsonPath = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/site-detection');
const files = readdirSync(jsonPath).filter((file) => file.endsWith('.json'));
const coralogixResponse = files
  .map((file) => {
    const fileContent = readFileSync(join(jsonPath, file), 'utf8');
    return fileContent.replace(/\n/g, '');
  })
  .join('\n');

describe('site-detection runner tests', () => {
  let sites;
  let siteCandidates;

  const context = {
    dataAccess: {
      getSites: sandbox.stub(),
      getSiteCandidates: sandbox.stub(),
    },
    log: {
      info: sandbox.stub(),
      warn: sandbox.stub(),
      error: sandbox.stub(),
    },
    env: {
      CORALOGIX_API_KEY: 'some-key',
      SITE_DETECTION_WEBHOOK: 'https://space.cat/hook',
    },
  };

  beforeEach('setup', () => {
    sites = [
      createSite({ baseURL: 'https://spacecat1.com' }),
      createSite({ baseURL: 'https://spacecat2.com' })];
    siteCandidates = [
      createSiteCandidate({ baseURL: 'https://spacecat3.com' }),
      createSiteCandidate({ baseURL: 'https://spacecat4.com' }),
    ];
    context.dataAccess.getSites.resolves(sites);
    context.dataAccess.getSiteCandidates.resolves(siteCandidates);
  });

  afterEach(() => {
    nock.cleanAll();
    sinon.restore();
  });

  it('coralogix API request fails', async () => {
    nock('https://ng-api-http.coralogix.com')
      .post('/api/v1/dataprime/query')
      .reply(500);

    await expect(siteDetectionRunner('', context)).to.be.rejectedWith('Coralogix API request was not successful. Status: 500');
  });

  it('coralogix API returns unparsable response', async () => {
    nock('https://ng-api-http.coralogix.com')
      .post('/api/v1/dataprime/query')
      .reply(200, 'asd');

    await expect(siteDetectionRunner('', context)).to.be.rejectedWith('Unexpected token \'a\', "asd" is not valid JSON');
  });

  it('valid coralogix response two sites re-fed, one successful', async () => {
    nock('https://ng-api-http.coralogix.com')
      .post('/api/v1/dataprime/query')
      .reply(200, coralogixResponse);

    nock('https://space.cat')
      .post('/hook', (body) => {
        expect(body).to.deep.equal({
          hlxVersion: 4,
          requestXForwardedHost: 'business.adobe.com, main--bacom-blog--somerepo.hlx.live, main--bacom-blog--somerepo.hlx.live',
        });
        return true;
      })
      .reply(200);

    nock('https://space.cat')
      .post('/hook', (body) => {
        expect(body).to.deep.equal({
          hlxVersion: 4,
          requestXForwardedHost: 'adobe.com, main--cc--somerepo.hlx.live, main--cc--somerepo.hlx.live',
        });
        return true;
      })
      .reply(500, 'rejected');

    await siteDetectionRunner('', context);

    expect(context.log.warn).to.have.been.calledWith('Failed to re-feed www.adobe.com: Re-feed request failed with 500');
  });
});
