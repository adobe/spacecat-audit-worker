/*
 * Copyright 2023 Adobe. All rights reserved.
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
import nock from 'nock';
import { audit404Runner } from '../../src/notfound/handler.js';
import { notFoundData } from '../fixtures/notfounddata.js';
import { MockContextBuilder } from '../shared.js';

use(sinonChai);

describe('404 Tests', () => {
  const url = 'https://abc.com';
  const mockDate = '2023-11-27T12:30:01.124Z';

  let clock;
  let context;
  let messageBodyJson;
  let sandbox;

  before('setup', () => {
    sandbox = sinon.createSandbox();
  });

  beforeEach('setup', () => {
    clock = sandbox.useFakeTimers({
      now: +new Date(mockDate),
      toFake: ['Date'],
    });
    messageBodyJson = {
      type: '404',
      url: 'https://abc.com',
      auditContext: {
        finalUrl: 'abc.com',
      },
    };
    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        env: {
          AUDIT_RESULTS_QUEUE_URL: 'queueUrl',
        },
      })
      .build(messageBodyJson);
  });

  afterEach(() => {
    nock.cleanAll();
    clock.restore();
    sinon.restore();
  });

  it('fetch 404s for base url > process > send results', async () => {
    nock('https://abc.com')
      .get('/')
      .reply(200);
    context.rumApiClient = {
      get404Sources: sinon.stub().resolves(notFoundData.results.data),
      create404URL: () => 'abc.com',
    };
    await audit404Runner(url, context);

    expect(context.rumApiClient.get404Sources).calledWith({
      url: 'abc.com',
      interval: -1,
      startdate: '2023-11-20',
      enddate: '2023-11-27',
    });
  });
});
