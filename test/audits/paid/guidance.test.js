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
import { describe } from 'mocha';
import handler from '../../../src/paid/guidance-handler.js';

use(sinonChai);
use(chaiAsPromised);

describe('PaidGuidanceHandler', () => {
  let sandbox;

  let logStub;
  let context;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    logStub = {
      info: sandbox.stub(),
      debug: sandbox.stub(),
      error: sandbox.stub(),
      warn: sandbox.stub(),
    };

    context = {
      log: logStub,
    };
  });

  afterEach(() => {
    nock.cleanAll();
    sandbox.restore();
  });

  it('should handle guidance messages for paid', async () => {
    const sampleMessage = {
      message: 'sample',
    };
    await handler(sampleMessage, context);
    expect(logStub.info.callCount).to.be.above(0);
  });
});
