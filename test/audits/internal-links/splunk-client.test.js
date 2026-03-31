/*
 * Copyright 2026 Adobe. All rights reserved.
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

import { expect } from 'chai';
import esmock from 'esmock';
import sinon from 'sinon';

describe('internal-links splunk-client', () => {
  it('creates the shared splunk client from context', async () => {
    const createFrom = sinon.stub().returns({ client: 'splunk' });
    const { createSplunkClient } = await esmock('../../../src/internal-links/splunk-client.js', {
      '@adobe/spacecat-shared-splunk-client': {
        default: {
          createFrom,
        },
      },
    });

    const context = { test: true };
    const client = await createSplunkClient(context);

    expect(client).to.deep.equal({ client: 'splunk' });
    expect(createFrom.calledOnceWith(context)).to.equal(true);
  });
});
