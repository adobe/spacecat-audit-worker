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

import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

use(sinonChai);

// eslint-disable-next-line no-underscore-dangle
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODULE_PATH = pathToFileURL(
  path.resolve(__dirname, '../../src/support/postgrest-sam-template-override.js'),
).href;

const TRACKED_ENV_KEYS = [
  'DATA_SERVICE_PROVIDER',
  'POSTGREST_URL',
  'POSTGREST_SCHEMA',
  'POSTGREST_API_KEY',
  'POSTGREST_USE_SAM_TEMPLATE',
  'POSTGREST_LOG_EFFECTIVE_URL',
  'POSTGREST_URL_OVERRIDE',
];

let importCounter = 0;

/**
 * Loads a fresh module instance so SAM_TEMPLATE_POSTGREST reflects `snapshotEnv`.
 * Restores process.env for tracked keys after the snapshot is taken.
 */
async function loadPostgrestOverride(snapshotEnv) {
  const backup = {};
  for (const key of TRACKED_ENV_KEYS) {
    backup[key] = process.env[key];
    delete process.env[key];
  }
  for (const [key, value] of Object.entries(snapshotEnv)) {
    if (value !== undefined) {
      process.env[key] = value;
    }
  }
  // eslint-disable-next-line no-plusplus
  const mod = await import(`${MODULE_PATH}?v=${++importCounter}`);
  for (const key of TRACKED_ENV_KEYS) {
    if (backup[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = backup[key];
    }
  }
  return mod.default;
}

describe('postgrest-sam-template-override', () => {
  let next;
  let request;

  beforeEach(() => {
    next = sinon.stub().resolves('ok');
    request = {};
  });

  afterEach(() => {
    sinon.restore();
  });

  it('calls next without merging when POSTGREST_USE_SAM_TEMPLATE is not true', async () => {
    const postgrestSamTemplateOverride = await loadPostgrestOverride({
      POSTGREST_URL: 'https://snap.example.com',
      POSTGREST_SCHEMA: 'public',
      POSTGREST_API_KEY: 'k',
    });
    process.env.POSTGREST_USE_SAM_TEMPLATE = 'false';
    const context = { env: { existing: 'x' } };
    const result = await postgrestSamTemplateOverride(next)(request, context);

    expect(result).to.equal('ok');
    expect(next).to.have.been.calledOnceWith(request, context);
    expect(context.env.existing).to.equal('x');
    expect(context.env.POSTGREST_URL).to.be.undefined;
  });

  it('merges snapshot values into context.env and process.env when POSTGREST_USE_SAM_TEMPLATE is true', async () => {
    const postgrestSamTemplateOverride = await loadPostgrestOverride({
      DATA_SERVICE_PROVIDER: 'pg',
      POSTGREST_URL: 'https://snap.example.com',
      POSTGREST_SCHEMA: 'public',
      POSTGREST_API_KEY: 'secret',
    });
    process.env.POSTGREST_USE_SAM_TEMPLATE = 'true';
    process.env.POSTGREST_LOG_EFFECTIVE_URL = 'false';
    const context = { env: {} };

    await postgrestSamTemplateOverride(next)(request, context);

    expect(context.env.DATA_SERVICE_PROVIDER).to.equal('pg');
    expect(context.env.POSTGREST_URL).to.equal('https://snap.example.com');
    expect(context.env.POSTGREST_SCHEMA).to.equal('public');
    expect(context.env.POSTGREST_API_KEY).to.equal('secret');
    expect(process.env.POSTGREST_URL).to.equal('https://snap.example.com');
  });

  it('uses POSTGREST_URL_OVERRIDE when snapshot POSTGREST_URL is empty', async () => {
    const postgrestSamTemplateOverride = await loadPostgrestOverride({
      POSTGREST_URL: '',
      POSTGREST_SCHEMA: 'public',
      POSTGREST_API_KEY: 'secret',
    });
    process.env.POSTGREST_USE_SAM_TEMPLATE = 'true';
    process.env.POSTGREST_LOG_EFFECTIVE_URL = 'false';
    process.env.POSTGREST_URL_OVERRIDE = 'https://override.example.com';
    const context = { env: {} };

    await postgrestSamTemplateOverride(next)(request, context);

    expect(context.env.POSTGREST_URL).to.equal('https://override.example.com');
    expect(process.env.POSTGREST_URL).to.equal('https://override.example.com');
  });

  it('uses POSTGREST_URL_OVERRIDE when snapshot omits POSTGREST_URL', async () => {
    const postgrestSamTemplateOverride = await loadPostgrestOverride({
      POSTGREST_SCHEMA: 'public',
      POSTGREST_API_KEY: 'secret',
    });
    process.env.POSTGREST_USE_SAM_TEMPLATE = 'true';
    process.env.POSTGREST_LOG_EFFECTIVE_URL = 'false';
    process.env.POSTGREST_URL_OVERRIDE = 'https://from-override.example.com';
    const context = { env: {} };

    await postgrestSamTemplateOverride(next)(request, context);

    expect(context.env.POSTGREST_URL).to.equal('https://from-override.example.com');
  });

  it('skips keys with empty string values from snapshot (other than POSTGREST_URL override path)', async () => {
    const postgrestSamTemplateOverride = await loadPostgrestOverride({
      POSTGREST_URL: 'https://snap.example.com',
      POSTGREST_SCHEMA: '',
      POSTGREST_API_KEY: 'k',
    });
    process.env.POSTGREST_USE_SAM_TEMPLATE = 'true';
    process.env.POSTGREST_LOG_EFFECTIVE_URL = 'false';
    const context = { env: {} };

    await postgrestSamTemplateOverride(next)(request, context);

    expect(context.env.POSTGREST_SCHEMA).to.be.undefined;
  });

  it('logs diagnostic lines when POSTGREST_LOG_EFFECTIVE_URL is true and log.info exists', async () => {
    const postgrestSamTemplateOverride = await loadPostgrestOverride({
      POSTGREST_URL: 'https://snap.example.com/path',
      POSTGREST_SCHEMA: 'public',
      POSTGREST_API_KEY: 'k',
    });
    process.env.POSTGREST_USE_SAM_TEMPLATE = 'true';
    process.env.POSTGREST_LOG_EFFECTIVE_URL = 'true';
    process.env.POSTGREST_URL_OVERRIDE = 'https://override.example.com/o';
    process.env.POSTGREST_URL = 'http://data-svc.internal';
    const log = { info: sinon.spy() };
    const context = { env: {}, log };

    await postgrestSamTemplateOverride(next)(request, context);

    expect(log.info).to.have.been.calledTwice;
    expect(log.info.firstCall.args[0]).to.include('snap.example.com');
    expect(log.info.firstCall.args[0]).to.include('override.example.com');
    expect(log.info.firstCall.args[0]).to.include('data-svc.internal');
    expect(log.info.secondCall.args[0]).to.include('snap.example.com');
    expect(log.info.secondCall.args[0]).to.include('POSTGREST_LOG_EFFECTIVE_URL=false');
  });

  it('covers safeUrlHost branches: empty snapshot URL, invalid after-vault URL', async () => {
    const postgrestSamTemplateOverride = await loadPostgrestOverride({
      POSTGREST_SCHEMA: 'public',
      POSTGREST_API_KEY: 'k',
    });
    process.env.POSTGREST_USE_SAM_TEMPLATE = 'true';
    process.env.POSTGREST_LOG_EFFECTIVE_URL = 'true';
    process.env.POSTGREST_URL_OVERRIDE = 'not-a-valid-url';
    process.env.POSTGREST_URL = 'also-not-a-valid-url!!!';
    const log = { info: sinon.spy() };
    const context = { env: {}, log };

    await postgrestSamTemplateOverride(next)(request, context);

    expect(log.info.firstCall.args[0]).to.include('(empty)');
    expect(log.info.firstCall.args[0]).to.include('(invalid URL)');
    expect(log.info.secondCall.args[0]).to.include('(invalid URL)');
  });

  it('does not log when diag is true but log.info is missing', async () => {
    const postgrestSamTemplateOverride = await loadPostgrestOverride({
      POSTGREST_URL: 'https://snap.example.com',
      POSTGREST_SCHEMA: 'public',
      POSTGREST_API_KEY: 'k',
    });
    process.env.POSTGREST_USE_SAM_TEMPLATE = 'true';
    process.env.POSTGREST_LOG_EFFECTIVE_URL = 'true';
    const context = { env: {}, log: {} };

    await postgrestSamTemplateOverride(next)(request, context);

    expect(context.env.POSTGREST_URL).to.equal('https://snap.example.com');
  });

  it('does not log when context has no log property', async () => {
    const postgrestSamTemplateOverride = await loadPostgrestOverride({
      POSTGREST_URL: 'https://snap.example.com',
      POSTGREST_SCHEMA: 'public',
      POSTGREST_API_KEY: 'k',
    });
    process.env.POSTGREST_USE_SAM_TEMPLATE = 'true';
    process.env.POSTGREST_LOG_EFFECTIVE_URL = 'true';
    const context = { env: {} };

    await postgrestSamTemplateOverride(next)(request, context);

    expect(context.env.POSTGREST_URL).to.equal('https://snap.example.com');
  });
});
