/*
 * Copyright 2025 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */
import { createRequire } from 'module';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { DevelopmentServer } from '@adobe/helix-universal-devserver';

import { main } from '../../src/index.js';

const require = createRequire(import.meta.url);
const { version } = require('../../package.json');

// eslint-disable-next-line no-underscore-dangle
global.__rootdir = resolve(fileURLToPath(import.meta.url), '..', '..', '..');

async function run(args) {
  process.env.HLX_DEV_SERVER_HOST = 'localhost:3000';
  process.env.HLX_DEV_SERVER_SCHEME = 'http';

  let devServer;
  if (args.includes('--webpack')) {
    // eslint-disable-next-line import/no-unresolved
    devServer = await import(`../../dist/spacecat-services/api-service@${version}-bundle.cjs`)
      .then((m) => new DevelopmentServer().withAdapter(m.default.lambda));
  } else if (args.includes('--esbuild')) {
    // eslint-disable-next-line import/no-unresolved
    devServer = await import(`../../dist/spacecat-services/api-service@${version}-bundle.mjs`)
      .then((m) => new DevelopmentServer().withAdapter(m.default.lambda));
  } else {
    devServer = new DevelopmentServer(main);
  }
  await devServer
    .withHeader('x-forwarded-host', '')
    .init();
  await devServer.start();
}

run(process.argv.slice(2)).then(process.stdout).catch(process.stderr);
