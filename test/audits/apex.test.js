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
import chai from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import chaiAsPromised from 'chai-as-promised';
import nock from 'nock';
import { apexAuditRunner, hasNonWWWSubdomain, toggleWWW } from '../../src/apex/handler.js';

chai.use(sinonChai);
chai.use(chaiAsPromised);
const { expect } = chai;

const sandbox = sinon.createSandbox();

describe('Apex audit', () => {
  let context;
  let mockLog;

  const urlWithApexDomain = 'https://some-domain.com';
  const urlWithSubdomain = 'https://subdomain.some-domain.com';

  beforeEach('setup', () => {
    mockLog = {
      info: sandbox.spy(),
      warn: sandbox.spy(),
      error: sandbox.spy(),
    };

    context = { log: mockLog };
  });

  afterEach(() => {
    nock.cleanAll();
    sandbox.restore();
  });

  it('apex audit does not run when baseUrl is not apex', async () => {
    await expect(apexAuditRunner(urlWithSubdomain, context))
      .to.be.rejectedWith('Url https://subdomain.some-domain.com already has a subdomain. No need to run apex audit.');
  });

  it('apex audit unsuccessful when baseurl doesnt resolve', async () => {
    // Arrange
    nock('https://some-domain.com')
      .get('/')
      .replyWithError({ code: 'ECONNREFUSED', syscall: 'connect' });

    nock('https://www.some-domain.com')
      .get('/')
      .reply(200);

    // Act
    const result = await apexAuditRunner(urlWithApexDomain, context);

    // Assert
    const expectedAuditResult = [{
      url: 'https://some-domain.com',
      success: false,
    }, {
      url: 'https://www.some-domain.com',
      success: true,
      status: 200,
    }];
    const expectedFullAuditRef = 'https://some-domain.com';

    expect(result).to.eql({
      auditResult: expectedAuditResult,
      fullAuditRef: expectedFullAuditRef,
    });
  });

  it('apex audit successful when baseurl resolves', async () => {
    // Arrange
    nock('https://some-domain.com')
      .get('/')
      .reply(200);

    nock('https://www.some-domain.com')
      .get('/')
      .reply(200);

    // Act
    const result = await apexAuditRunner(urlWithApexDomain, context);

    // Assert
    const expectedAuditResult = [{
      url: 'https://some-domain.com',
      success: true,
      status: 200,
    }, {
      url: 'https://www.some-domain.com',
      success: true,
      status: 200,
    }];
    const expectedFullAuditRef = 'https://some-domain.com';

    expect(result).to.eql({
      auditResult: expectedAuditResult,
      fullAuditRef: expectedFullAuditRef,
    });
  });

  describe('apex domain validation', () => {
    it('urls with subdomains', () => {
      expect(hasNonWWWSubdomain('https://subdomain.domain.com')).to.equal(true);
      expect(hasNonWWWSubdomain('https://sub.domain.museum')).to.equal(true);
      expect(hasNonWWWSubdomain('https://sub.domain.com/path?query=123')).to.equal(true);
      expect(hasNonWWWSubdomain('https://sub.domain.com/')).to.equal(true);
      expect(hasNonWWWSubdomain('https://sub.domain.com:3000')).to.equal(true);
    });

    it('urls with apex domains', () => {
      expect(hasNonWWWSubdomain('https://www.example.com/path/')).to.equal(false);
      expect(hasNonWWWSubdomain('https://www.site.com')).to.equal(false);
      expect(hasNonWWWSubdomain('https://domain.com')).to.equal(false);
      expect(hasNonWWWSubdomain('https://example.co.uk')).to.equal(false);
      expect(hasNonWWWSubdomain('https://example.com.tr')).to.equal(false);
      expect(hasNonWWWSubdomain('https://example.com/somepath')).to.equal(false);
      expect(hasNonWWWSubdomain('https://domain.com/path?query=123')).to.equal(false);
      expect(hasNonWWWSubdomain('https://domain.com/')).to.equal(false);
      expect(hasNonWWWSubdomain('https://example.com/path/')).to.equal(false);
      expect(hasNonWWWSubdomain('https://domain.com:8000')).to.equal(false);
      expect(hasNonWWWSubdomain('https://example.site')).to.equal(false);
      expect(hasNonWWWSubdomain('invalid-url^&*')).to.equal(false);
    });

    it('throws error when parse fails', () => {
      expect(() => hasNonWWWSubdomain('https://example,site')).to.throw('Cannot parse baseURL: https://example,site');
    });

    it('toggleWWW', () => {
      expect(toggleWWW('https://www.example.com/path/')).to.equal('https://example.com/path/');
      expect(toggleWWW('https://example.com/path/')).to.equal('https://www.example.com/path/');
      expect(toggleWWW('https://subdomain.example.com/path/')).to.equal('https://subdomain.example.com/path/');
    });
  });
});
