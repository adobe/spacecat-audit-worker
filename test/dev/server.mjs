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
import { DevelopmentServer } from '@adobe/helix-universal-devserver';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

import { hasText } from '@adobe/spacecat-shared-utils';
import { main } from '../../src/index.js';

// eslint-disable-next-line no-underscore-dangle
global.__rootdir = resolve(fileURLToPath(import.meta.url), '..', '..', '..');

// poor man's env locking. Ask dj.
function checkEnvSafe() {
  const x = Buffer.from(process.env.AWS_SESSION_TOKEN, 'base64')
    .toString('utf8')
    .match(/\d{12}/)?.[0];
  // checks the session token of 1h
  if (!hasText(x) || !x.includes('8203346262')) {
    throw new Error('RUNS ONLY ON DEV!');
  }
}

async function run() {
  // comment this fct if the session token is longer than 1h
  checkEnvSafe();

  process.env.HLX_DEV_SERVER_HOST = 'localhost:3000';
  process.env.HLX_DEV_SERVER_SCHEME = 'http';
  const devServer = await new DevelopmentServer(main)
    .init();
  await devServer.start();
}

run().then(process.stdout).catch(process.stderr);
