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
  buildAnalysisVisibilityMessage,
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

  describe('buildAnalysisVisibilityMessage', () => {
    const base = { analysisName: 'cited-analysis', baseUrl: 'https://x.com', suggestionsCount: 4 };

    it('does not show the raw rate on a visible opportunity, only that it is below threshold', () => {
      const msg = buildAnalysisVisibilityMessage({
        ...base,
        isVisible: true,
        verdict: { rate: 0.48, rateDetermined: true },
      });
      expect(msg).to.include(':white_check_mark:');
      expect(msg).to.include('Visible in the UI — below hallucination threshold');
      expect(msg).to.not.include('48%');
      expect(msg).to.not.include('%');
    });

    it('notes how many flagged items were removed on a recovered opportunity', () => {
      const msg = buildAnalysisVisibilityMessage({
        ...base,
        isVisible: true,
        verdict: { rate: 0.48, droppedUrls: ['a', 'b', 'c'] },
      });
      expect(msg).to.include('below hallucination threshold (3 flagged items removed)');
    });

    it('uses singular wording for a single dropped item', () => {
      const msg = buildAnalysisVisibilityMessage({
        ...base,
        isVisible: true,
        verdict: { rate: 0.3, droppedUrls: ['a'] },
      });
      expect(msg).to.include('(1 flagged item removed)');
    });

    it('shows the raw rate on a hidden opportunity (the reason it was suppressed)', () => {
      const msg = buildAnalysisVisibilityMessage({
        ...base,
        isVisible: false,
        verdict: { rate: 0.42, rateDetermined: true },
      });
      expect(msg).to.include(':warning:');
      expect(msg).to.include('Not visible in the UI — hallucination 42%');
    });

    it('shows n/a on a hidden opportunity whose rate could not be determined', () => {
      const msg = buildAnalysisVisibilityMessage({
        ...base,
        isVisible: false,
        verdict: { rate: 0, rateDetermined: false },
      });
      expect(msg).to.include('Not visible in the UI — hallucination rate n/a');
    });

    it('omits the note on a hidden opportunity with a non-numeric rate', () => {
      const msg = buildAnalysisVisibilityMessage({
        ...base,
        isVisible: false,
        verdict: { reasons: ['no rate'] },
      });
      expect(msg).to.include('Not visible in the UI');
      expect(msg).to.not.include('hallucination');
    });

    it('omits the note on a hidden opportunity with no verdict', () => {
      const msg = buildAnalysisVisibilityMessage({ ...base, isVisible: false });
      expect(msg).to.include('Not visible in the UI');
      expect(msg).to.not.include('hallucination');
    });

    it('shows n/a for a visible opportunity whose rate could not be determined', () => {
      const msg = buildAnalysisVisibilityMessage({
        ...base,
        isVisible: true,
        verdict: { rate: 0, rateDetermined: false },
      });
      expect(msg).to.include('Visible in the UI — hallucination rate n/a');
      expect(msg).to.not.include('0%');
    });

    it('omits any note when there is no verdict', () => {
      const msg = buildAnalysisVisibilityMessage({ ...base, isVisible: true });
      expect(msg).to.include('Visible in the UI');
      expect(msg).to.not.include('hallucination');
    });

    it('pluralizes the suggestion count', () => {
      expect(buildAnalysisVisibilityMessage({ ...base, suggestionsCount: 1, isVisible: true }))
        .to.include('1 suggestion processed');
      expect(buildAnalysisVisibilityMessage({ ...base, suggestionsCount: 2, isVisible: true }))
        .to.include('2 suggestions processed');
    });

    it('reports a persistence failure with a warning tone when emptyPersist is set', () => {
      const msg = buildAnalysisVisibilityMessage({
        ...base,
        isVisible: true,
        verdict: { rate: 0.9, rateDetermined: true },
        emptyPersist: true,
      });
      expect(msg).to.include(':warning:');
      expect(msg).to.include('cited-analysis');
      expect(msg).to.include('0 suggestions persisted');
      expect(msg).to.include('Not visible in the UI — no suggestions stored (auto-ignored)');
      // The verdict-driven note is suppressed for a persistence failure.
      expect(msg).to.not.include('hallucination');
    });
  });
});
