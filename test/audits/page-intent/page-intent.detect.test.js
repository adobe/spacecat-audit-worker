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

import { PageIntent as PageIntentModel } from '@adobe/spacecat-shared-data-access';
import handler from '../../../src/page-intent/handler.detect.js';

use(sinonChai);
use(chaiAsPromised);

describe('page-intent.detect handler', () => {
  let sandbox;
  let context;
  let log;
  let PageIntent;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    log = {
      info: sandbox.stub(),
      error: sandbox.stub(),
    };

    PageIntent = {
      findByUrl: sandbox.stub(),
      create: sandbox.stub(),
    };

    context = {
      log,
      dataAccess: { PageIntent },
    };
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should reject when any required parameter is missing', async () => {
    const message = {}; // missing siteId, url, data.pageIntent, data.topic
    await expect(handler(message, context))
      .to.be.rejectedWith(Error, /Missing required parameters/);
  });

  it('should reject when pageIntent is invalid', async () => {
    const raw = 'not-valid';
    const message = {
      siteId: 'site-1',
      url: 'https://example.com',
      data: {
        pageIntent: raw,
        topic: 'topic-1',
      },
    };

    await expect(handler(message, context))
      .to.be.rejectedWith(Error, `Invalid page intent value: ${raw.toUpperCase()}`);
  });

  it('should update an existing PageIntent when found', async () => {
    const validIntent = Object.values(PageIntentModel.PAGE_INTENTS)[0];
    const raw = validIntent.toLowerCase();

    const message = {
      siteId: 'site-foo',
      url: 'https://foo.com/path',
      data: {
        pageIntent: raw,
        topic: 'new-topic',
      },
    };

    const existing = {
      setTopic: sandbox.stub(),
      setPageIntent: sandbox.stub(),
      save: sandbox.stub().resolvesThis(),
      toJSON: () => ({}),
    };

    PageIntent.findByUrl.resolves(existing);

    await handler(message, context);

    // verify the update branch
    expect(PageIntent.findByUrl).to.have.been.calledWith(message.url);
    expect(existing.setTopic).to.have.been.calledWith('new-topic');
    expect(existing.setPageIntent).to.have.been.calledWith(validIntent);
    expect(existing.save).to.have.been.calledOnce;
    expect(log.info).to.have.been.calledWithMatch(/Updated Page Intent entity/);
  });

  it('should create a new PageIntent when none exists', async () => {
    const validIntent = Object.values(PageIntentModel.PAGE_INTENTS)[1];
    const raw = validIntent.toLowerCase();

    const message = {
      siteId: 'site-bar',
      url: 'https://bar.com/xyz',
      data: {
        pageIntent: raw,
        topic: 'topic-bar',
      },
    };

    PageIntent.findByUrl.resolves(null);
    PageIntent.create.resolves({ toJSON: () => ({}) });

    await handler(message, context);

    // verify the create branch
    expect(PageIntent.create).to.have.been.calledWith({
      siteId: 'site-bar',
      url: 'https://bar.com/xyz',
      pageIntent: validIntent,
      topic: 'topic-bar',
    });
    expect(log.info).to.have.been.calledWithMatch(/New Page Intent entity created/);
  });
});
