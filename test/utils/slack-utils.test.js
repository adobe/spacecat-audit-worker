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
import { postMessage, postMessageSafe } from '../../src/utils/slack-utils.js';

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
});
