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
import { apexAuditRunner } from '../../src/apex/handler.js';
import { MockContextBuilder } from '../shared.js';
import { hasNonWWWSubdomain, toggleWWW } from '../../src/support/utils.js';

use(sinonChai);
use(chaiAsPromised);

const message = {
  type: 'apex',
  url: 'site-id',
};
const sandbox = sinon.createSandbox();

describe('Apex audit', () => {
  let context;

  beforeEach('setup', () => {
    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .build(message);
  });

  afterEach(() => {
    nock.cleanAll();
    sandbox.restore();
  });

  it('apex audit does not run when baseUrl is not apex', async () => {
    const url = 'https://subdomain.some-domain.com';
    await expect(apexAuditRunner(url, context))
      .to.be.rejectedWith(`Url ${url} already has a subdomain. No need to run apex audit.`);
  });

  it('apex audit unsuccessful when baseurl doesnt resolve', async () => {
    // Arrange
    nock('https://spacecat.com')
      .get('/')
      .replyWithError('connection refused');

    nock('https://www.spacecat.com')
      .get('/')
      .reply(200);

    // Act
    const url = 'https://spacecat.com';
    const result = await apexAuditRunner(url, context);

    // Assert
    const expectedAuditResult = [{
      url: 'https://spacecat.com',
      success: false,
    }, {
      url: 'https://www.spacecat.com',
      success: true,
      status: 200,
    }];

    expect(result).to.eql({
      auditResult: expectedAuditResult,
      fullAuditRef: url,
    });
  });

  it('apex audit successful when baseurl resolves', async () => {
    // Arrange
    nock('https://spacecat.com')
      .get('/')
      .reply(200);

    nock('https://www.spacecat.com')
      .get('/')
      .reply(200);

    // Act
    const url = 'https://spacecat.com';
    const result = await apexAuditRunner(url, context);

    // Assert
    const expectedAuditResult = [{
      url: 'https://spacecat.com',
      success: true,
      status: 200,
    }, {
      url: 'https://www.spacecat.com',
      success: true,
      status: 200,
    }];

    expect(result).to.eql({
      auditResult: expectedAuditResult,
      fullAuditRef: url,
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
