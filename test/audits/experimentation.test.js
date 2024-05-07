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
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import nock from 'nock';
import { experimentationAuditRunner } from '../../src/experimentation/handler.js';
import {
  expectedAuditDataVariant1,
  expectedAuditDataVariant2,
  rumData,
  rumDataEmpty,
} from '../fixtures/experimentation-data.js';

chai.use(sinonChai);
const { expect } = chai;

const DOMAIN_REQUEST_DEFAULT_PARAMS = {
  interval: 7,
  offset: 0,
  limit: 101,
};
describe('Experimentation Audit', () => {
  let context;
  let mockLog;

  beforeEach('setup', () => {
    mockLog = {
      info: sinon.spy(),
      warn: sinon.spy(),
      error: sinon.spy(),
    };
    context = {
      log: mockLog,
      env: {
        RUM_DOMAIN_KEY: 'domainkey',
      },
    };
  });

  afterEach(() => {
    nock.cleanAll();
    sinon.restore();
  });

  it('fetch experiment data for base url > process > send results', async () => {
    nock('https://bamboohr.com')
      .get('/')
      .reply(200);
    nock('https://helix-pages.anywhere.run')
      .get('/helix-services/run-query@v3/rum-experiments')
      .query({
        ...DOMAIN_REQUEST_DEFAULT_PARAMS,
        domainkey: context.env.RUM_DOMAIN_KEY,
        url: 'bamboohr.com',
      })
      .reply(200, rumData);
    const auditData = await experimentationAuditRunner('https://bamboohr.com', context);
    expect(auditData).to.deep.equal(expectedAuditDataVariant1);
  });

  it('fetch experiment data for base url > process > sends zero results', async () => {
    nock('https://spacecat.com')
      .get('/')
      .reply(200);
    nock('https://helix-pages.anywhere.run')
      .get('/helix-services/run-query@v3/rum-experiments')
      .query({
        ...DOMAIN_REQUEST_DEFAULT_PARAMS,
        domainkey: context.env.RUM_DOMAIN_KEY,
        url: 'spacecat.com',
      })
      .reply(200, rumDataEmpty);
    nock('https://helix-pages.anywhere.run')
      .get('/helix-services/run-query@v3/rum-experiments')
      .query({
        ...DOMAIN_REQUEST_DEFAULT_PARAMS,
        domainkey: context.env.RUM_DOMAIN_KEY,
        url: 'www.spacecat.com',
      })
      .reply(200, rumData);
    const auditData = await experimentationAuditRunner('https://spacecat.com', context);
    expect(auditData).to.deep.equal(expectedAuditDataVariant2);
  });
});
