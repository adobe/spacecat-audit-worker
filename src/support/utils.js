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
import { context as h2, h1 } from '@adobe/fetch';
import { isValidUrl } from '@adobe/spacecat-shared-utils';

/* c8 ignore next 3 */
export const { fetch } = process.env.HELIX_FETCH_FORCE_HTTP1
  ? h1()
  : h2();

export const ensureValidUrl = (input) => {
  if (isValidUrl(input)) {
    return input;
  }

  return `https://${input}`;
};
