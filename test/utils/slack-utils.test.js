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
  postMessage,
  postMessageOptional,
  postMessageSafe,
  say,
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
    let log;
    let env;
    let slackContext;

    beforeEach(() => {
      log = { error: sinon.stub() };
      env = {
        SLACK_BOT_TOKEN: 'test-bot-token',
        SLACK_SIGNING_SECRET: 'test-signing-secret',
        SLACK_TOKEN_WORKSPACE_INTERNAL: 'test-workspace-token',
        SLACK_OPS_CHANNEL_WORKSPACE_INTERNAL: 'test-ops-channel',
      };
      slackContext = {
        channelId: 'C12345678',
        threadTs: '12345.67890',
      };
    });

    it('sends message to Slack when channelId and threadTs are present', async () => {
      await say(env, log, slackContext, 'Audit completed');

      expect(mockSlackClient.postMessage.calledOnce).to.be.true;
      const msg = mockSlackClient.postMessage.firstCall.args[0];
      expect(msg.channel).to.equal('C12345678');
      expect(msg.thread_ts).to.equal('12345.67890');
      expect(msg.text).to.equal('Audit completed');
      expect(msg.unfurl_links).to.be.false;
    });

    it('creates client with correct context derived from env and log', async () => {
      await say(env, log, slackContext, 'Test');

      expect(BaseSlackClient.createFrom.calledOnce).to.be.true;
      const [clientCtx, target] = BaseSlackClient.createFrom.firstCall.args;
      expect(clientCtx.channelId).to.equal('C12345678');
      expect(clientCtx.threadTs).to.equal('12345.67890');
      expect(clientCtx.log).to.equal(log);
      expect(clientCtx.env.SLACK_BOT_TOKEN).to.equal('test-bot-token');
      expect(clientCtx.env.SLACK_TOKEN_WORKSPACE_INTERNAL).to.equal('test-workspace-token');
      expect(target).to.equal(SLACK_TARGETS.WORKSPACE_INTERNAL);
    });

    it('does not send message when threadTs is empty', async () => {
      slackContext.threadTs = '';

      await say(env, log, slackContext, 'Test');

      expect(mockSlackClient.postMessage.called).to.be.false;
    });

    it('does not send message when channelId is empty', async () => {
      slackContext.channelId = '';

      await say(env, log, slackContext, 'Test');

      expect(mockSlackClient.postMessage.called).to.be.false;
    });

    it('logs error and does not throw when slackContext is null', async () => {
      await say(env, log, null, 'Test');

      expect(log.error.calledOnce).to.be.true;
      expect(log.error.firstCall.args[0]).to.equal('Error sending Slack message:');
    });

    it('logs error and does not throw when slackContext is undefined', async () => {
      await say(env, log, undefined, 'Test');

      expect(log.error.calledOnce).to.be.true;
      expect(log.error.firstCall.args[0]).to.equal('Error sending Slack message:');
    });

    it('logs error and does not throw when postMessage rejects', async () => {
      mockSlackClient.postMessage.rejects(new Error('Slack API down'));

      await say(env, log, slackContext, 'Test');

      expect(log.error.calledOnce).to.be.true;
      const errArg = log.error.firstCall.args[1];
      expect(errArg.error).to.equal('Slack API down');
      expect(errArg.errorType).to.equal('Error');
    });

    it('logs error and does not throw when BaseSlackClient.createFrom throws', async () => {
      mockSlackClient.postMessage.rejects(new Error('ignored'));
      BaseSlackClient.createFrom.throws(new Error('Client init failed'));

      await say(env, log, slackContext, 'Test');

      expect(log.error.calledOnce).to.be.true;
      const errArg = log.error.firstCall.args[1];
      expect(errArg.error).to.equal('Client init failed');
    });
  });
});
