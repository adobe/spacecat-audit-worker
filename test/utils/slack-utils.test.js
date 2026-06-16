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

import { expect } from 'chai';
import sinon from 'sinon';

import { BaseSlackClient } from '@adobe/spacecat-shared-slack-client';
import {
  formatAuditCompletionMessage,
  formatAuditFailureMessage,
  formatBotProtectionPartialBlockMessage,
  formatBotProtectionSlackMessage,
  formatStepCompletionMessage,
  humanizeStepName,
  postMessage,
  postMessageOptional,
  postMessageSafe,
  say,
  sendAuditFailureNotification,
  SLACK_TARGETS,
} from '../../src/utils/slack-utils.js';

describe('Slack Utils', () => {
  let context;
  let mockSlackClient;

  beforeEach(() => {
    context = {
      log: {
        info: sinon.stub(),
        error: sinon.stub(),
      },
    };

    mockSlackClient = {
      postMessage: sinon.stub().resolves({ channel: 'C123', ts: '1234567890.123456' }),
    };

    sinon.stub(BaseSlackClient, 'createFrom').returns(mockSlackClient);
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('postMessage', () => {
    it('sends basic message', async () => {
      const result = await postMessage(context, 'C123', 'Hello World');

      expect(mockSlackClient.postMessage.calledOnce).to.be.true;
      const message = mockSlackClient.postMessage.firstCall.args[0];
      expect(message.channel).to.equal('C123');
      expect(message.text).to.equal('Hello World');
      expect(result).to.deep.equal({ channel: 'C123', ts: '1234567890.123456' });
    });

    it('sends message with blocks', async () => {
      const blocks = [{ type: 'section', text: { type: 'mrkdwn', text: 'Test' } }];

      await postMessage(context, 'C123', 'Hello', { blocks });

      const message = mockSlackClient.postMessage.firstCall.args[0];
      expect(message.blocks).to.deep.equal(blocks);
    });

    it('sends message with attachments', async () => {
      const attachments = [{ color: '#FF0000', text: 'Red attachment' }];

      await postMessage(context, 'C123', 'Hello', { attachments });

      const message = mockSlackClient.postMessage.firstCall.args[0];
      expect(message.attachments).to.deep.equal(attachments);
    });

    it('sends message with thread timestamp', async () => {
      await postMessage(context, 'C123', 'Reply', { threadTs: '1234567890.123456' });

      const message = mockSlackClient.postMessage.firstCall.args[0];
      expect(message.thread_ts).to.equal('1234567890.123456');
    });
  });

  describe('postMessageSafe', () => {
    it('returns success when message sent successfully', async () => {
      const result = await postMessageSafe(context, 'C123', 'Hello World');

      expect(result.success).to.be.true;
      expect(result.result).to.deep.equal({ channel: 'C123', ts: '1234567890.123456' });
      expect(context.log.info.calledWith('Successfully sent Slack message to channel C123')).to.be.true;
    });

    it('returns error when message fails', async () => {
      const error = new Error('Slack API error');
      mockSlackClient.postMessage.rejects(error);

      const result = await postMessageSafe(context, 'C123', 'Hello World');

      expect(result.success).to.be.false;
      expect(result.error).to.equal(error);
      expect(context.log.error.calledWith('Failed to send Slack message to channel C123:', error)).to.be.true;
    });
  });

  describe('postMessageOptional', () => {
    it('returns success:false and does not call Slack when channelId is missing', async () => {
      const result = await postMessageOptional(context, '', 'Hello', { threadTs: '1234567890.123456' });

      expect(result).to.deep.equal({ success: false, result: null });
      expect(mockSlackClient.postMessage.called).to.be.false;
    });

    it('returns success:false and does not call Slack when threadTs is missing', async () => {
      const result = await postMessageOptional(context, 'C123', 'Hello', {});

      expect(result).to.deep.equal({ success: false, result: null });
      expect(mockSlackClient.postMessage.called).to.be.false;
    });

    it('delegates to postMessageSafe when channelId and threadTs are present', async () => {
      const result = await postMessageOptional(context, 'C123', 'Hello', { threadTs: '1234567890.123456' });

      expect(result.success).to.be.true;
      expect(result.result).to.deep.equal({ channel: 'C123', ts: '1234567890.123456' });
      expect(mockSlackClient.postMessage.calledOnce).to.be.true;
      expect(context.log.info.calledWith('Successfully sent Slack message to channel C123')).to.be.true;
    });

    it('passes target workspace through to the Slack client when sending', async () => {
      await postMessageOptional(context, 'C123', 'Hello', {
        threadTs: '1234567890.123456',
        target: SLACK_TARGETS.WORKSPACE_EXTERNAL,
      });

      expect(
        BaseSlackClient.createFrom.calledWith(context, SLACK_TARGETS.WORKSPACE_EXTERNAL),
      ).to.be.true;
    });

    it('returns error from postMessageSafe when Slack post fails', async () => {
      const error = new Error('Slack API error');
      mockSlackClient.postMessage.rejects(error);

      const result = await postMessageOptional(context, 'C123', 'Hello', { threadTs: '1234567890.123456' });

      expect(result.success).to.be.false;
      expect(result.error).to.equal(error);
    });
  });

  describe('say', () => {
    let sayContext;
    let slackContext;

    beforeEach(() => {
      sayContext = {
        log: { error: sinon.stub() },
        env: {
          SLACK_TOKEN_WORKSPACE_INTERNAL: 'test-workspace-token',
          SLACK_OPS_CHANNEL_WORKSPACE_INTERNAL: 'test-ops-channel',
        },
      };
      slackContext = {
        channelId: 'C12345678',
        threadTs: '12345.67890',
      };
    });

    it('sends message to Slack when channelId and threadTs are present', async () => {
      await say(sayContext, slackContext, 'Audit completed');

      expect(mockSlackClient.postMessage.calledOnce).to.be.true;
      const msg = mockSlackClient.postMessage.firstCall.args[0];
      expect(msg.channel).to.equal('C12345678');
      expect(msg.thread_ts).to.equal('12345.67890');
      expect(msg.text).to.equal('Audit completed');
      expect(msg.unfurl_links).to.be.false;
    });

    it('passes the real Lambda context to BaseSlackClient.createFrom (not a synthetic env subset)', async () => {
      await say(sayContext, slackContext, 'Test');

      expect(BaseSlackClient.createFrom.calledOnce).to.be.true;
      const [clientCtx, target] = BaseSlackClient.createFrom.firstCall.args;
      // The same context reference is passed through — mirrors site-detection's
      // pattern so every key BaseSlackClient reads (incl. SLACK_OPS_CHANNEL_*,
      // SLACK_OPS_ADMINS_*) is available.
      expect(clientCtx).to.equal(sayContext);
      expect(target).to.equal(SLACK_TARGETS.WORKSPACE_INTERNAL);
    });

    it('does not send message when threadTs is empty', async () => {
      slackContext.threadTs = '';

      await say(sayContext, slackContext, 'Test');

      expect(mockSlackClient.postMessage.called).to.be.false;
    });

    it('does not send message when channelId is empty', async () => {
      slackContext.channelId = '';

      await say(sayContext, slackContext, 'Test');

      expect(mockSlackClient.postMessage.called).to.be.false;
    });

    it('silently no-ops when slackContext is null (not triggered from Slack)', async () => {
      await say(sayContext, null, 'Test');

      expect(mockSlackClient.postMessage.called).to.be.false;
      expect(sayContext.log.error.called).to.be.false;
    });

    it('silently no-ops when slackContext is undefined (not triggered from Slack)', async () => {
      await say(sayContext, undefined, 'Test');

      expect(mockSlackClient.postMessage.called).to.be.false;
      expect(sayContext.log.error.called).to.be.false;
    });

    it('logs error and does not throw when postMessage rejects', async () => {
      mockSlackClient.postMessage.rejects(new Error('Slack API down'));

      await say(sayContext, slackContext, 'Test');

      expect(sayContext.log.error.calledOnce).to.be.true;
      const errArg = sayContext.log.error.firstCall.args[1];
      expect(errArg.error).to.equal('Slack API down');
      expect(errArg.errorType).to.equal('Error');
    });

    it('logs error and does not throw when BaseSlackClient.createFrom throws', async () => {
      mockSlackClient.postMessage.rejects(new Error('ignored'));
      BaseSlackClient.createFrom.throws(new Error('Client init failed'));

      await say(sayContext, slackContext, 'Test');

      expect(sayContext.log.error.calledOnce).to.be.true;
      const errArg = sayContext.log.error.firstCall.args[1];
      expect(errArg.error).to.equal('Client init failed');
    });
  });

  describe('formatBotProtectionSlackMessage', () => {
    const baseOptions = {
      auditType: 'cwv',
      siteUrl: 'https://example.com',
      details: {
        blockedUrlsCount: 2,
        totalUrlsCount: 5,
        byHttpStatus: { 403: 2 },
        byBlockerType: { cloudflare: 2 },
        blockedUrls: [
          {
            url: 'https://example.com/page1', blockerType: 'cloudflare', httpStatus: 403, confidence: 0.98,
          },
          {
            url: 'https://example.com/page2', blockerType: 'akamai', httpStatus: 200, confidence: 0.7,
          },
        ],
      },
      allowlistIps: ['1.2.3.4', '5.6.7.8'],
      allowlistUserAgent: 'SpacecatBot/1.0',
    };

    it('includes audit type, site URL and summary', () => {
      const msg = formatBotProtectionSlackMessage(baseOptions);
      expect(msg).to.include('cwv');
      expect(msg).to.include('https://example.com');
      expect(msg).to.include('2/5 URLs blocked');
    });

    it('includes HTTP status and blocker type breakdowns', () => {
      const msg = formatBotProtectionSlackMessage(baseOptions);
      expect(msg).to.include('403 Forbidden');
      expect(msg).to.include('Cloudflare');
    });

    it('includes sample blocked URLs and marks high-confidence entries', () => {
      const msg = formatBotProtectionSlackMessage(baseOptions);
      expect(msg).to.include('https://example.com/page1');
      expect(msg).to.include('(high confidence)');
    });

    it('appends "and N more" when more than 3 blocked URLs exist', () => {
      const moreOptions = {
        ...baseOptions,
        details: {
          ...baseOptions.details,
          blockedUrlsCount: 5,
          blockedUrls: [
            {
              url: 'https://example.com/p1', blockerType: 'cloudflare', httpStatus: 403, confidence: 0.99,
            },
            {
              url: 'https://example.com/p2', blockerType: 'akamai', httpStatus: 403, confidence: 0.99,
            },
            {
              url: 'https://example.com/p3', blockerType: 'fastly', httpStatus: 403, confidence: 0.5,
            },
            {
              url: 'https://example.com/p4', blockerType: 'cloudfront', httpStatus: 200, confidence: 0.5,
            },
            {
              url: 'https://example.com/p5', blockerType: 'imperva', httpStatus: 403, confidence: 0.5,
            },
          ],
        },
      };
      const msg = formatBotProtectionSlackMessage(moreOptions);
      expect(msg).to.include('and 2 more URLs');
    });

    it('uses all blocker type labels', () => {
      const allBlockers = {
        ...baseOptions,
        details: {
          ...baseOptions.details,
          byBlockerType: {
            cloudflare: 1, akamai: 1, imperva: 1, fastly: 1, cloudfront: 1, unknown: 1, custom: 1,
          },
        },
      };
      const msg = formatBotProtectionSlackMessage(allBlockers);
      expect(msg).to.include('Cloudflare');
      expect(msg).to.include('Akamai');
      expect(msg).to.include('Imperva');
      expect(msg).to.include('Fastly');
      expect(msg).to.include('AWS CloudFront');
      expect(msg).to.include('Unknown Blocker');
      expect(msg).to.include('custom'); // unmapped key returned as-is
    });

    it('handles 200 and unknown HTTP status codes', () => {
      const withStatuses = {
        ...baseOptions,
        details: {
          ...baseOptions.details,
          byHttpStatus: { 200: 1, unknown: 1, 429: 1 },
        },
      };
      const msg = formatBotProtectionSlackMessage(withStatuses);
      expect(msg).to.include('200 OK (Challenge Page)');
      expect(msg).to.include('Unknown Status');
      expect(msg).to.include('429'); // default fallback
    });

    it('handles empty details gracefully', () => {
      const msg = formatBotProtectionSlackMessage({
        auditType: 'lhs-mobile',
        siteUrl: 'https://site.com',
        details: {},
        allowlistIps: [],
        allowlistUserAgent: 'Bot/1.0',
      });
      expect(msg).to.include('0/0 URLs blocked');
      expect(msg).to.include('No status data available');
      expect(msg).to.include('No blocker data available');
      expect(msg).to.include('(no IPs configured)');
    });

    it('uses || {} fallback when byHttpStatus or byBlockerType are null', () => {
      // Passes null explicitly — bypasses the default {} in destructuring
      const msg = formatBotProtectionSlackMessage({
        auditType: 'cwv',
        siteUrl: 'https://example.com',
        details: { byHttpStatus: null, byBlockerType: null },
        allowlistIps: [],
        allowlistUserAgent: 'Bot/1.0',
      });
      expect(msg).to.include('No status data available');
      expect(msg).to.include('No blocker data available');
    });

    it('shows singular "URL" label when count is 1', () => {
      const msg = formatBotProtectionSlackMessage({
        ...baseOptions,
        details: {
          ...baseOptions.details,
          byHttpStatus: { 403: 1 },
          byBlockerType: { cloudflare: 1 },
        },
      });
      expect(msg).to.include('403 Forbidden: 1 URL');
      expect(msg).to.not.include('1 URLs');
    });

    it('defaults confidence to 0 when property is absent on blocked URLs', () => {
      // Two URLs without confidence — sort comparator runs (covers || 0 on lines 214 and 217)
      const msg = formatBotProtectionSlackMessage({
        ...baseOptions,
        details: {
          ...baseOptions.details,
          blockedUrls: [
            { url: 'https://example.com/noconf1', blockerType: 'cloudflare', httpStatus: 403 },
            { url: 'https://example.com/noconf2', blockerType: 'akamai', httpStatus: 403 },
          ],
        },
      });
      // Confidence defaults to 0, so label should NOT be "(high confidence)"
      expect(msg).to.include('https://example.com/noconf1');
      expect(msg).to.not.include('(high confidence)');
    });
  });

  describe('formatAuditFailureMessage', () => {
    it('includes audit type, site URL and error message', () => {
      const msg = formatAuditFailureMessage('cwv', 'https://example.com', new Error('PSI timeout'));
      expect(msg).to.include('cwv');
      expect(msg).to.include('https://example.com');
      expect(msg).to.include('PSI timeout');
    });

    it('uses "Unknown error" when error is null', () => {
      const msg = formatAuditFailureMessage('sitemap', 'https://example.com', null);
      expect(msg).to.include('Unknown error');
    });
  });

  describe('sendAuditFailureNotification', () => {
    let notifContext;
    let notifEnv;

    beforeEach(() => {
      notifEnv = {
        SLACK_BOT_TOKEN: 'tok',
        SLACK_SIGNING_SECRET: 'sec',
        SLACK_TOKEN_WORKSPACE_INTERNAL: 'wtok',
        SLACK_OPS_CHANNEL_WORKSPACE_INTERNAL: 'ops',
        SPACECAT_BOT_IPS: '1.2.3.4,5.6.7.8',
      };
      notifContext = {
        env: notifEnv,
        log: { error: sinon.stub(), info: sinon.stub() },
      };
    });

    it('returns early without sending when slackContext is absent', async () => {
      await sendAuditFailureNotification(notifContext, {
        type: 'cwv',
        siteUrl: 'https://example.com',
        auditContext: {},
        error: new Error('boom'),
      });
      expect(mockSlackClient.postMessage.called).to.be.false;
    });

    it('returns early when channelId is missing', async () => {
      await sendAuditFailureNotification(notifContext, {
        type: 'cwv',
        siteUrl: 'https://example.com',
        auditContext: { slackContext: { threadTs: '123' } },
        error: new Error('boom'),
      });
      expect(mockSlackClient.postMessage.called).to.be.false;
    });

    it('sends bot-protection message when abort reason is bot-protection', async () => {
      const abort = {
        reason: 'bot-protection',
        details: {
          blockedUrlsCount: 3,
          totalUrlsCount: 3,
          byHttpStatus: { 403: 3 },
          byBlockerType: { cloudflare: 3 },
          blockedUrls: [],
        },
      };

      await sendAuditFailureNotification(notifContext, {
        type: 'cwv',
        siteUrl: 'https://example.com',
        auditContext: { slackContext: { channelId: 'C123', threadTs: '1234.5678' } },
        abort,
      });

      expect(mockSlackClient.postMessage.calledOnce).to.be.true;
      const msg = mockSlackClient.postMessage.firstCall.args[0];
      expect(msg.text).to.include('Bot Protection Detected');
      expect(msg.text).to.include('cwv');
    });

    it('sends generic failure message when error is provided', async () => {
      await sendAuditFailureNotification(notifContext, {
        type: 'lhs-mobile',
        siteUrl: 'https://example.com',
        auditContext: { slackContext: { channelId: 'C123', threadTs: '1234.5678' } },
        error: new Error('PSI API failed'),
      });

      expect(mockSlackClient.postMessage.calledOnce).to.be.true;
      const msg = mockSlackClient.postMessage.firstCall.args[0];
      expect(msg.text).to.include('Audit Failed');
      expect(msg.text).to.include('PSI API failed');
    });

    it('includes IP addresses from SPACECAT_BOT_IPS in the bot-protection message', async () => {
      await sendAuditFailureNotification(notifContext, {
        type: 'cwv',
        siteUrl: 'https://example.com',
        auditContext: { slackContext: { channelId: 'C123', threadTs: '1234.5678' } },
        abort: {
          reason: 'bot-protection',
          details: {
            blockedUrlsCount: 1,
            totalUrlsCount: 1,
            byHttpStatus: {},
            byBlockerType: {},
            blockedUrls: [],
          },
        },
      });

      expect(mockSlackClient.postMessage.calledOnce).to.be.true;
      const msg = mockSlackClient.postMessage.firstCall.args[0];
      expect(msg.text).to.include('1.2.3.4');
      expect(msg.text).to.include('5.6.7.8');
    });

    it('uses empty object when abort.details is null', async () => {
      // Covers the `abort.details || {}` fallback branch (line 308)
      await sendAuditFailureNotification(notifContext, {
        type: 'cwv',
        siteUrl: 'https://example.com',
        auditContext: { slackContext: { channelId: 'C123', threadTs: '1234.5678' } },
        abort: { reason: 'bot-protection', details: null },
      });

      expect(mockSlackClient.postMessage.calledOnce).to.be.true;
      const msg = mockSlackClient.postMessage.firstCall.args[0];
      expect(msg.text).to.include('Bot Protection Detected');
    });

    it('suppresses duplicate alerts when both inner and outer catches fire on the same invocation', async () => {
      // Simulates the StepAudit-catches-and-rethrows → index.js-catches sequence.
      // Both reporters share the same `context` object (Lambda invocation handle);
      // dedup state lives on context so it works even if auditContext is cloned
      // (or its slackContext copied) between catches.
      const slackContext = { channelId: 'C123', threadTs: '1234.5678' };
      const error = new Error('boom');

      await sendAuditFailureNotification(notifContext, {
        type: 'cwv',
        siteUrl: 'https://example.com',
        auditContext: { slackContext },
        error,
      });
      // Outer catch may receive a fresh/cloned auditContext (e.g. if a future
      // refactor deep-clones it for safety). Reusing a structurally-equal but
      // referentially distinct slackContext here proves dedup doesn't rely on
      // reference identity of the propagated payload.
      const clonedSlackContext = { ...slackContext };
      await sendAuditFailureNotification(notifContext, {
        type: 'cwv',
        siteUrl: 'https://example.com',
        auditContext: { slackContext: clonedSlackContext },
        error,
      });

      expect(mockSlackClient.postMessage.calledOnce).to.be.true;
      // Marker lives on context (Lambda invocation), NOT on the serializable
      // slackContext that gets propagated to downstream queues.
      expect(notifContext.slackFailureNotifiedAt).to.be.a('string');
      expect(slackContext).to.not.have.property('notifiedAt');
      expect(clonedSlackContext).to.not.have.property('notifiedAt');
    });

    it('logs and swallows formatter errors so the audit error is not masked', async () => {
      // Triggers formatAllowlistMessage to throw by omitting SPACECAT_BOT_IPS on
      // the bot-protection path. The outer try/catch in sendAuditFailureNotification
      // must log the formatter error (lines 443-451) and still set the dedup
      // marker so a subsequent retry doesn't loop on the same broken formatter.
      const ctx = {
        env: {
          SLACK_BOT_TOKEN: 'tok',
          SLACK_TOKEN_WORKSPACE_INTERNAL: 'wtok',
          SLACK_OPS_CHANNEL_WORKSPACE_INTERNAL: 'ops',
          // SPACECAT_BOT_IPS deliberately omitted → formatAllowlistMessage throws
        },
        log: { error: sinon.stub(), info: sinon.stub() },
      };
      const abort = {
        reason: 'bot-protection',
        details: { blockedUrlsCount: 1, totalUrlsCount: 1 },
      };

      await sendAuditFailureNotification(ctx, {
        type: 'cwv',
        siteUrl: 'https://example.com',
        auditContext: { slackContext: { channelId: 'C123', threadTs: '1.2' } },
        abort,
      });

      // No Slack post — the formatter threw before say() was reached.
      expect(mockSlackClient.postMessage.called).to.be.false;
      // The formatter error was logged under the dedicated diagnostic key.
      expect(ctx.log.error.calledOnce).to.be.true;
      expect(ctx.log.error.firstCall.args[0])
        .to.equal('Error preparing Slack failure notification:');
      const errArg = ctx.log.error.firstCall.args[1];
      expect(errArg.error).to.include('SPACECAT_BOT_IPS');
      // Dedup marker still set so we don't retry-and-loop on a broken formatter.
      expect(ctx.slackFailureNotifiedAt).to.be.a('string');
    });
  });

  describe('formatAuditCompletionMessage', () => {
    it('renders type and site URL with a completion icon', () => {
      const msg = formatAuditCompletionMessage('cwv', 'https://example.com');
      expect(msg).to.include('Audit Completed');
      expect(msg).to.include('cwv');
      expect(msg).to.include('https://example.com');
    });
  });

  describe('humanizeStepName', () => {
    it('splits camelCase into title case', () => {
      expect(humanizeStepName('collectCwvData')).to.equal('Collect Cwv Data');
    });

    it('preserves acronyms (CWV stays together)', () => {
      expect(humanizeStepName('collectCWVDataAndImportCode'))
        .to.equal('Collect CWV Data And Import Code');
    });

    it('converts kebab-case to Title Case (every word capitalized)', () => {
      expect(humanizeStepName('send-to-mystique')).to.equal('Send To Mystique');
      expect(humanizeStepName('run-audit-and-generate-suggestions'))
        .to.equal('Run Audit And Generate Suggestions');
    });

    it('converts snake_case to Title Case (every word capitalized)', () => {
      expect(humanizeStepName('sync_opportunity_and_suggestions_step'))
        .to.equal('Sync Opportunity And Suggestions Step');
    });

    it('returns empty string for empty / undefined input', () => {
      expect(humanizeStepName('')).to.equal('');
      expect(humanizeStepName(undefined)).to.equal('');
      expect(humanizeStepName(null)).to.equal('');
    });
  });

  describe('formatStepCompletionMessage', () => {
    it('renders the humanized step name with type and site', () => {
      const msg = formatStepCompletionMessage(
        'cwv',
        'https://example.com',
        'collectCWVDataAndImportCode',
      );
      expect(msg).to.include('Collect CWV Data And Import Code');
      expect(msg).to.include('done');
      expect(msg).to.include('cwv');
      expect(msg).to.include('https://example.com');
    });
  });

  describe('formatBotProtectionPartialBlockMessage', () => {
    it('renders summary, blocker breakdown, and resolution hint', () => {
      const msg = formatBotProtectionPartialBlockMessage({
        auditType: 'cwv',
        siteUrl: 'https://example.com',
        details: {
          blockedUrlsCount: 3,
          totalUrlsCount: 10,
          byBlockerType: { cloudflare: 3 },
        },
      });
      expect(msg).to.include('Partial Block');
      expect(msg).to.include('3/10');
      expect(msg).to.include('continuing');
      expect(msg).to.include('Cloudflare');
      expect(msg).to.include('Allowlist');
    });

    it('omits the blocker breakdown section when no blocker data is provided', () => {
      const msg = formatBotProtectionPartialBlockMessage({
        auditType: 'cwv',
        siteUrl: 'https://example.com',
        details: { blockedUrlsCount: 1, totalUrlsCount: 5 },
      });
      expect(msg).to.include('1/5');
      expect(msg).to.not.include('By Blocker Type');
    });
  });
});
