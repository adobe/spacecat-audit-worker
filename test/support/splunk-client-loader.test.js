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

import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createSplunkClient, loadSplunkClientClass } from '../../src/support/splunk-client-loader.js';

use(chaiAsPromised);

const SPLUNK_CLIENT_MODULE_ENV = 'SPACECAT_SPLUNK_CLIENT_MODULE';

describe('splunk-client-loader', () => {
  let tempDir;
  let originalModuleEnv;

  beforeEach(async () => {
    originalModuleEnv = process.env[SPLUNK_CLIENT_MODULE_ENV];
    tempDir = await mkdtemp(join(tmpdir(), 'spacecat-splunk-loader-'));
  });

  afterEach(async () => {
    if (originalModuleEnv === undefined) {
      delete process.env[SPLUNK_CLIENT_MODULE_ENV];
    } else {
      process.env[SPLUNK_CLIENT_MODULE_ENV] = originalModuleEnv;
    }
    await rm(tempDir, { recursive: true, force: true });
  });

  it('loads configured splunk client module successfully', async () => {
    const modulePath = join(tempDir, 'splunk-client-success.mjs');
    await writeFile(modulePath, `
      export default class FakeSplunkClient {
        static createFrom(context) {
          return { source: 'fake', context };
        }
      }
    `);

    process.env[SPLUNK_CLIENT_MODULE_ENV] = `${pathToFileURL(modulePath).href}?success=1`;

    const SplunkClientClass = await loadSplunkClientClass();
    const client = await createSplunkClient({ testContext: true });

    expect(SplunkClientClass).to.be.a('function');
    expect(client).to.deep.equal({
      source: 'fake',
      context: { testContext: true },
    });
  });

  it('throws a descriptive error when configured module cannot be loaded', async () => {
    const missingModule = `${pathToFileURL(join(tempDir, 'missing-splunk-client.mjs')).href}?missing=1`;
    process.env[SPLUNK_CLIENT_MODULE_ENV] = missingModule;

    await expect(loadSplunkClientClass()).to.be.rejectedWith(
      `Failed to load Splunk client module (${missingModule})`,
    );
  });

  it('falls back to default module name when override is not set', async () => {
    delete process.env[SPLUNK_CLIENT_MODULE_ENV];
    try {
      const SplunkClientClass = await loadSplunkClientClass();
      expect(SplunkClientClass).to.be.a('function');
    } catch (error) {
      expect(error.message).to.include(
        'Failed to load Splunk client module (@adobe/spacecat-shared-splunk-client)',
      );
    }
  });
});
