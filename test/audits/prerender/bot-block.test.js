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
import esmock from 'esmock';
import { isStickyBotBlocked, buildBotBlockedResult } from '../../../src/prerender/bot-block.js';

use(sinonChai);

const WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();

describe('bot-block', () => {
  let sandbox;

  beforeEach(() => { sandbox = sinon.createSandbox(); });
  afterEach(() => { sandbox.restore(); });

  // ─── isStickyBotBlocked ─────────────────────────────────────────────────────

  const normalMode = { isCsv: false, isSlack: false };
  const blocked = { scrapeForbidden: true, scrapeForbiddenSince: daysAgo(1) };

  describe('isStickyBotBlocked', () => {
    it('returns false when scrapeForbidden is false', () => {
      expect(isStickyBotBlocked(normalMode, { scrapeForbidden: false, scrapeForbiddenSince: daysAgo(1) })).to.be.false;
    });

    it('returns false when scrapeForbiddenSince is absent', () => {
      expect(isStickyBotBlocked(normalMode, { scrapeForbidden: true })).to.be.false;
    });

    it('returns false when scrapeForbiddenSince is an invalid date string', () => {
      expect(isStickyBotBlocked(normalMode, { scrapeForbidden: true, scrapeForbiddenSince: 'not-a-date' })).to.be.false;
    });

    it('returns true when scrapeForbidden=true and within 3-day window', () => {
      expect(isStickyBotBlocked(normalMode, blocked)).to.be.true;
    });

    it('returns false when scrapeForbidden=true but older than 3-day window', () => {
      expect(isStickyBotBlocked(normalMode, { scrapeForbidden: true, scrapeForbiddenSince: daysAgo(4) })).to.be.false;
    });

    it('returns true at exactly the window boundary (just within 3 days)', () => {
      const justWithin = new Date(Date.now() - WINDOW_MS + 1000).toISOString();
      expect(isStickyBotBlocked(normalMode, { scrapeForbidden: true, scrapeForbiddenSince: justWithin })).to.be.true;
    });

    it('returns false at exactly the window boundary (just outside 3 days)', () => {
      const justOutside = new Date(Date.now() - WINDOW_MS - 1000).toISOString();
      expect(isStickyBotBlocked(normalMode, { scrapeForbidden: true, scrapeForbiddenSince: justOutside })).to.be.false;
    });

    it('returns false for Slack mode regardless of status', () => {
      expect(isStickyBotBlocked({ isCsv: false, isSlack: true }, blocked)).to.be.false;
    });

    it('returns false for CSV mode regardless of status', () => {
      expect(isStickyBotBlocked({ isCsv: true, isSlack: false }, blocked)).to.be.false;
    });
  });

  // ─── buildBotBlockedResult ──────────────────────────────────────────────────

  describe('buildBotBlockedResult', () => {
    function makeContext() {
      return {
        site: { getId: () => 'site-1', getBaseURL: () => 'https://example.com' },
        log: { info: sandbox.stub() },
      };
    }

    it('returns domainBlocked result shape', () => {
      const ctx = makeContext();
      const result = buildBotBlockedResult(ctx, { scrapeForbiddenSince: daysAgo(1) });

      expect(result.urls).to.deep.equal([]);
      expect(result.siteId).to.equal('site-1');
      expect(result.processingType).to.be.a('string');
      expect(result.maxScrapeAge).to.equal(0);
      expect(result.auditContext).to.deep.equal({ domainBlocked: true });
    });

    it('logs the sticky skip message with blockedSince', () => {
      const ctx = makeContext();
      const since = daysAgo(1);
      buildBotBlockedResult(ctx, { scrapeForbiddenSince: since });

      expect(ctx.log.info).to.have.been.calledWithMatch(/Sticky scrapeForbidden within 3d window/);
      expect(ctx.log.info).to.have.been.calledWithMatch(new RegExp(`blockedSince=${since}`));
    });
  });

  // ─── detectBotBlock ──────────────────────────────────────────────────────────

  describe('detectBotBlock', () => {
    let detectBotBlock;
    let detectBotBlockerStub;

    beforeEach(async () => {
      detectBotBlockerStub = sandbox.stub();
      ({ detectBotBlock } = await esmock('../../../src/prerender/bot-block.js', {
        '@adobe/spacecat-shared-utils': { detectBotBlocker: detectBotBlockerStub },
      }));
    });

    const makeContext = () => ({
      log: { info: sandbox.stub(), warn: sandbox.stub() },
      site: { getId: () => 'site-1', getBaseURL: () => 'https://example.com' },
    });

    it('returns scrapeForbidden=isDomainBlocked without calling detectBotBlocker when domain is already blocked', async () => {
      const result = await detectBotBlock(makeContext(), {
        isDomainBlocked: true, urlsSubmittedForScraping: 2, scrapeForbiddenCount: 2,
      });

      expect(result.scrapeForbidden).to.be.true;
      expect(detectBotBlockerStub).to.not.have.been.called;
    });

    it('returns scrapeForbidden=false without calling detectBotBlocker when ratio < 0.5', async () => {
      const result = await detectBotBlock(makeContext(), {
        isDomainBlocked: false, urlsSubmittedForScraping: 4, scrapeForbiddenCount: 1,
      });

      expect(result.scrapeForbidden).to.be.false;
      expect(detectBotBlockerStub).to.not.have.been.called;
    });

    it('returns scrapeForbidden=false without calling detectBotBlocker when urlsSubmittedForScraping=0', async () => {
      const result = await detectBotBlock(makeContext(), {
        isDomainBlocked: false, urlsSubmittedForScraping: 0, scrapeForbiddenCount: 0,
      });

      expect(result.scrapeForbidden).to.be.false;
      expect(detectBotBlockerStub).to.not.have.been.called;
    });

    it('sets scrapeForbidden=true when ratio≥0.5 and known CDN with confidence≥0.99', async () => {
      detectBotBlockerStub.resolves({ crawlable: false, confidence: 0.99, type: 'cloudflare' });

      const result = await detectBotBlock(makeContext(), {
        isDomainBlocked: false, urlsSubmittedForScraping: 2, scrapeForbiddenCount: 1,
      });

      expect(result.scrapeForbidden).to.be.true;
      expect(result.scrapeForbiddenSince).to.be.a('string');
    });

    it('leaves scrapeForbidden=false when ratio≥0.5 but confidence < 0.99', async () => {
      detectBotBlockerStub.resolves({ crawlable: false, confidence: 0.95, type: 'cloudflare' });

      const result = await detectBotBlock(makeContext(), {
        isDomainBlocked: false, urlsSubmittedForScraping: 2, scrapeForbiddenCount: 1,
      });

      expect(result.scrapeForbidden).to.be.false;
      expect(result.scrapeForbiddenSince).to.be.undefined;
    });

    it('leaves scrapeForbidden=false when ratio≥0.5 but type is unknown CDN', async () => {
      detectBotBlockerStub.resolves({ crawlable: false, confidence: 0.99, type: 'unknown-cdn' });

      const result = await detectBotBlock(makeContext(), {
        isDomainBlocked: false, urlsSubmittedForScraping: 2, scrapeForbiddenCount: 1,
      });

      expect(result.scrapeForbidden).to.be.false;
    });

    it('logs warning and returns scrapeForbidden=false when detectBotBlocker throws', async () => {
      detectBotBlockerStub.rejects(new Error('probe timeout'));
      const ctx = makeContext();

      const result = await detectBotBlock(ctx, {
        isDomainBlocked: false, urlsSubmittedForScraping: 2, scrapeForbiddenCount: 2,
      });

      expect(result.scrapeForbidden).to.be.false;
      expect(ctx.log.warn).to.have.been.calledWithMatch(/detectBotBlocker failed after high 403 ratio/);
    });
  });
});
