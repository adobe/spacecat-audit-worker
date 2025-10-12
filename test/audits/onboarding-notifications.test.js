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

import { sendOnboardingNotification } from '../../src/llmo-customer-analysis/onboarding-notifications.js';

describe('Onboarding Notifications', () => {
  let context;
  let site;
  let mockSlackClient;

  beforeEach(() => {
    context = {
      log: {
        info: sinon.stub(),
        error: sinon.stub(),
        warn: sinon.stub()
      }
    };

    site = {
      getSiteId: () => 'test-site-id',
      getBaseURL: () => 'https://example.com'
    };

    mockSlackClient = {
      postMessage: sinon.stub().resolves({ channel: 'C123', ts: '1234567890.123456' })
    };

    sinon.stub(BaseSlackClient, 'createFrom').returns(mockSlackClient);
  });

  afterEach(() => {
    sinon.restore();
  });

  it('sends first configuration notification', async () => {
    await sendOnboardingNotification(context, site, 'first_configuration', { configVersion: 'v1.0' });

    expect(mockSlackClient.postMessage.calledOnce).to.be.true;
    const message = mockSlackClient.postMessage.firstCall.args[0];

    expect(message.attachments[0].color).to.equal('#1473E6'); // Adobe Blue
  });

  it('sends CDN provisioning notification', async () => {
    const cdnConfig = { bucket: 'test-bucket' };

    await sendOnboardingNotification(context, site, 'cdn_provisioning', { cdnBucketConfig: cdnConfig });

    expect(mockSlackClient.postMessage.calledOnce).to.be.true;
    const message = mockSlackClient.postMessage.firstCall.args[0];

    expect(message.attachments[0].color).to.equal('#FF6B35'); // Adobe Orange
  });

  it('handles unknown event type', async () => {
    await sendOnboardingNotification(context, site, 'unknown_type');

    expect(mockSlackClient.postMessage.called).to.be.false;
    expect(context.log.warn.calledWith('Unknown onboarding event type: unknown_type')).to.be.true;
  });

  it('handles first configuration without version', async () => {
    await sendOnboardingNotification(context, site, 'first_configuration');

    expect(mockSlackClient.postMessage.calledOnce).to.be.true;
    const message = mockSlackClient.postMessage.firstCall.args[0];

    const configVersionField = message.attachments[0].blocks[1].fields.find(field =>
      field.text.includes('Config Version')
    );
    expect(configVersionField.text).to.include('_Not specified_');
  });

  it('handles CDN provisioning without config', async () => {
    await sendOnboardingNotification(context, site, 'cdn_provisioning', { cdnBucketConfig: {} });

    expect(mockSlackClient.postMessage.calledOnce).to.be.true;
    const message = mockSlackClient.postMessage.firstCall.args[0];

    const configSection = message.attachments[0].blocks.find(block =>
      block.text && block.text.text.includes('CDN Configuration Changes')
    );
    expect(configSection.text.text).to.include('_No specific configuration provided_');
  });
});
