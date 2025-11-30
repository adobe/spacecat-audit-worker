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
import {
  healthCheckAuditRunner,
  checkSpacecatUserAgentAccess,
  analyzeBlockingResponse,
  SPACECAT_USER_AGENT,
} from '../../src/health-check/handler.js';
import { MockContextBuilder } from '../shared.js';

use(sinonChai);
use(chaiAsPromised);

const sandbox = sinon.createSandbox();

describe('Health Check Audit', () => {
  let context;

  beforeEach('setup', () => {
    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .build();
  });

  afterEach(() => {
    nock.cleanAll();
    sandbox.restore();
  });

  describe('SPACECAT_USER_AGENT', () => {
    it('should be Spacecat/1.0', () => {
      expect(SPACECAT_USER_AGENT).to.equal('Spacecat/1.0');
    });
  });

  describe('analyzeBlockingResponse', () => {
    it('should detect blocking based on 403 status code', () => {
      const mockResponse = { status: 403 };
      const result = analyzeBlockingResponse(mockResponse, 'Some content');

      expect(result.isBlocked).to.be.true;
      expect(result.statusCode).to.equal(403);
      expect(result.indicators).to.include('HTTP status code 403');
    });

    it('should detect blocking based on 401 status code', () => {
      const mockResponse = { status: 401 };
      const result = analyzeBlockingResponse(mockResponse, 'Unauthorized');

      expect(result.isBlocked).to.be.true;
      expect(result.statusCode).to.equal(401);
      expect(result.indicators).to.include('HTTP status code 401');
    });

    it('should detect blocking based on 429 status code', () => {
      const mockResponse = { status: 429 };
      const result = analyzeBlockingResponse(mockResponse, 'Too many requests');

      expect(result.isBlocked).to.be.true;
      expect(result.statusCode).to.equal(429);
    });

    it('should detect blocking when multiple content indicators are present', () => {
      const mockResponse = { status: 200 };
      const blockedContent = 'Access Denied - Please verify you are not a robot';
      const result = analyzeBlockingResponse(mockResponse, blockedContent);

      expect(result.isBlocked).to.be.true;
      expect(result.statusCode).to.equal(200);
      expect(result.indicators.length).to.be.greaterThan(1);
    });

    it('should not flag as blocked with single content indicator', () => {
      const mockResponse = { status: 200 };
      const normalContent = 'Welcome to our site. Cloudflare powers our CDN.';
      const result = analyzeBlockingResponse(mockResponse, normalContent);

      expect(result.isBlocked).to.be.false;
      expect(result.statusCode).to.equal(200);
    });

    it('should not flag normal 200 response as blocked', () => {
      const mockResponse = { status: 200 };
      const result = analyzeBlockingResponse(mockResponse, '<html>Normal page content</html>');

      expect(result.isBlocked).to.be.false;
      expect(result.statusCode).to.equal(200);
      expect(result.indicators).to.have.length(0);
    });
  });

  describe('checkSpacecatUserAgentAccess', () => {
    it('should successfully check accessible site', async () => {
      nock('https://example.com')
        .get('/')
        .matchHeader('User-Agent', SPACECAT_USER_AGENT)
        .reply(200, '<html>Normal page</html>');

      const result = await checkSpacecatUserAgentAccess('https://example.com', context.log);

      expect(result.success).to.be.true;
      expect(result.isBlocked).to.be.false;
      expect(result.statusCode).to.equal(200);
      expect(result.userAgent).to.equal(SPACECAT_USER_AGENT);
      expect(result.url).to.equal('https://example.com');
      expect(nock.pendingMocks()).to.have.lengthOf(0);
    });

    it('should detect blocked site with 403 response', async () => {
      nock('https://blocked-site.com')
        .get('/')
        .matchHeader('User-Agent', SPACECAT_USER_AGENT)
        .reply(403, 'Forbidden');

      const result = await checkSpacecatUserAgentAccess('https://blocked-site.com', context.log);

      expect(result.success).to.be.true;
      expect(result.isBlocked).to.be.true;
      expect(result.statusCode).to.equal(403);
      expect(nock.pendingMocks()).to.have.lengthOf(0);
    });

    it('should add https:// scheme if missing', async () => {
      nock('https://example.com')
        .get('/')
        .reply(200, '<html>Normal page</html>');

      const result = await checkSpacecatUserAgentAccess('example.com', context.log);

      expect(result.url).to.equal('https://example.com');
      expect(result.success).to.be.true;
      expect(nock.pendingMocks()).to.have.lengthOf(0);
    });

    it('should handle network errors gracefully', async () => {
      nock('https://unreachable-site.com')
        .get('/')
        .replyWithError('Connection refused');

      const result = await checkSpacecatUserAgentAccess('https://unreachable-site.com', context.log);

      expect(result.success).to.be.false;
      expect(result.isBlocked).to.be.false;
      expect(result.statusCode).to.be.null;
      expect(result.error).to.include('Connection refused');
      expect(result.indicators).to.include('Request failed');
      expect(context.log.error).to.have.been.called;
      expect(nock.pendingMocks()).to.have.lengthOf(0);
    });

    it('should detect CAPTCHA/bot protection pages', async () => {
      const captchaPage = `
        <html>
          <body>
            <h1>Security Check</h1>
            <p>Please verify you are not a robot</p>
            <div class="captcha-container">CAPTCHA</div>
          </body>
        </html>
      `;

      nock('https://captcha-site.com')
        .get('/')
        .reply(200, captchaPage);

      const result = await checkSpacecatUserAgentAccess('https://captcha-site.com', context.log);

      expect(result.success).to.be.true;
      expect(result.isBlocked).to.be.true;
      expect(result.statusCode).to.equal(200);
      expect(nock.pendingMocks()).to.have.lengthOf(0);
    });
  });

  describe('healthCheckAuditRunner', () => {
    it('should return complete audit result for accessible site', async () => {
      nock('https://www.example.com')
        .get('/')
        .reply(200, '<html>Normal page</html>');

      const result = await healthCheckAuditRunner('https://www.example.com', context);

      expect(result.auditResult).to.exist;
      expect(result.auditResult.spacecatUserAgentAccess).to.exist;
      expect(result.auditResult.spacecatUserAgentAccess.isBlocked).to.be.false;
      expect(result.auditResult.timestamp).to.exist;
      expect(result.fullAuditRef).to.equal('https://www.example.com');
      expect(context.log.info).to.have.been.called;
      expect(nock.pendingMocks()).to.have.lengthOf(0);
    });

    it('should return blocked result for blocked site', async () => {
      nock('https://www.blocked-site.com')
        .get('/')
        .reply(403, 'Access Denied');

      const result = await healthCheckAuditRunner('https://www.blocked-site.com', context);

      expect(result.auditResult.spacecatUserAgentAccess.isBlocked).to.be.true;
      expect(result.auditResult.spacecatUserAgentAccess.statusCode).to.equal(403);
      expect(nock.pendingMocks()).to.have.lengthOf(0);
    });

    it('should include timestamp in audit result', async () => {
      nock('https://www.example.com')
        .get('/')
        .reply(200, '<html>Content</html>');

      const before = new Date();
      const result = await healthCheckAuditRunner('https://www.example.com', context);
      const after = new Date();

      const timestamp = new Date(result.auditResult.timestamp);
      expect(timestamp).to.be.at.least(before);
      expect(timestamp).to.be.at.most(after);
      expect(nock.pendingMocks()).to.have.lengthOf(0);
    });

    it('should handle 503 service unavailable as blocked', async () => {
      nock('https://www.unavailable-site.com')
        .get('/')
        .reply(503, 'Service Unavailable');

      const result = await healthCheckAuditRunner('https://www.unavailable-site.com', context);

      expect(result.auditResult.spacecatUserAgentAccess.isBlocked).to.be.true;
      expect(result.auditResult.spacecatUserAgentAccess.statusCode).to.equal(503);
      expect(nock.pendingMocks()).to.have.lengthOf(0);
    });

    it('should use overrideBaseURL from site config when available', async () => {
      const site = {
        getConfig: () => ({
          getFetchConfig: () => ({
            overrideBaseURL: 'https://override.example.com',
          }),
        }),
      };

      nock('https://override.example.com')
        .get('/')
        .reply(200, '<html>Override page</html>');

      const result = await healthCheckAuditRunner('www.example.com', context, site);

      expect(result.auditResult.spacecatUserAgentAccess.isBlocked).to.be.false;
      expect(result.auditResult.spacecatUserAgentAccess.url).to.equal('https://override.example.com');
      expect(result.fullAuditRef).to.equal('override.example.com');
      expect(nock.pendingMocks()).to.have.lengthOf(0);
    });

    it('should fallback to baseURL when fetchConfig is missing', async () => {
      const site = {
        getConfig: () => ({
          getFetchConfig: () => null,
        }),
      };

      nock('https://www.example.com')
        .get('/')
        .reply(200, '<html>Normal page</html>');

      const result = await healthCheckAuditRunner('www.example.com', context, site);

      expect(result.auditResult.spacecatUserAgentAccess.url).to.equal('https://www.example.com');
      expect(result.fullAuditRef).to.equal('www.example.com');
      expect(nock.pendingMocks()).to.have.lengthOf(0);
    });
  });
});