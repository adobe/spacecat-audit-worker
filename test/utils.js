/*
 * Copyright 2021 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

// eslint-disable-next-line import/no-mutable-exports
let main;

if (process.env.HELIX_TEST_BUNDLE_NAME) {
  const createDefaultFactory = await import(`../${process.env.HELIX_TEST_BUNDLE_NAME}`)
    .then((bundle) => bundle.default.lambda.factory)
    .catch((e) => {
      /* Wrap in a different error to prevent mocha from running into a require() cycle */
      if (e?.code === 'ERR_MODULE_NOT_FOUND' && e?.url.endsWith(process.env.HELIX_TEST_BUNDLE_NAME)) {
        throw new Error(e.message);
      }
      throw e;
    });
  main = await createDefaultFactory();
  main.unbundled = await import('../src/index.js').then((module) => module.main);
} else {
  main = await import('../src/index.js').then((module) => module.main);
  main.unbundled = main;
}

export { main };
