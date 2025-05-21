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
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import chaiAsPromised from 'chai-as-promised';
import nock from 'nock';
import { describe } from 'mocha';
import rumData from '../fixtures/paid/mock-segments-data.json' with { type: 'json' };
import expectedSubmitted from '../fixtures/paid/expected-submitted-audit.json' with {type: 'json'};
import { paidAuditRunner } from '../../src/paid/handler.js';

use(sinonChai);
use(chaiAsPromised);
const sandbox = sinon.createSandbox();
const auditUrl = 'www.spacecat.com';

describe('Paid audit incorporates optel data as input', () => {
  const logStub = {
    info: sinon.stub(),
    debug: sinon.stub(),
    error: sinon.stub(),
  };
  const context = {
    runtime: { name: 'aws-lambda', region: 'us-east-1' },
    func: { package: 'spacecat-services', version: 'ci', name: 'test' },
    rumApiClient: {
      query: sandbox.stub().resolves(rumData),
    },
    dataAccess: {},
    env: {},
    log: logStub,
  };

  afterEach(() => {
    nock.cleanAll();
    sandbox.restore();
  });

  const expectedSegments = ['url', 'pageType'];
  it('Paid should submit expected rum query data', async () => {
    const result = await paidAuditRunner(auditUrl, context);
    expect(result).to.deep.equal(expectedSubmitted);
    const submittedSegments = (result.auditResult.map((entry) => (entry.key)));
    submittedSegments.forEach((key) => expect(expectedSegments).to.include(key));
    result.auditResult.forEach((resultItem) => expect(resultItem.value?.length).to.eqls(3));
  });

  it('Paid should submit values ordered by total sessions', async () => {
    const result = await paidAuditRunner(auditUrl, context);
    result.auditResult.forEach((segment) => {
      const values = segment.value;
      if (values.length > 1) {
        expect(values[0].totalSessions).to.be.greaterThanOrEqual(values[1].totalSessions);
      }
    });
  });

  it('Paid should enrich urls with pageType info', async () => {
    const result = await paidAuditRunner(auditUrl, context);
    const urlSegment = result.auditResult.find((segment) => segment.key === 'url');
    urlSegment.value.forEach((valueItem) => {
      expect(valueItem).to.have.property('pageType');
    });
  });
});
