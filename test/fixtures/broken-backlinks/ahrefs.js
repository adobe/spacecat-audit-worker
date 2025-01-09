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
import nock from 'nock';
import { site2 } from './sites.js';

export const ahrefsMock = (url, result) => {
  nock(url)
    .get(/.*/)
    .reply(200);

  nock('https://ahrefs.com')
    .get(/.*/)
    .reply(200, result);
};

export const mockFixedBacklinks = (backlinks) => {
  nock('https://foo.com')
    .get('/fixed')
    .reply(200);

  nock('https://foo.com')
    .get('/fixed-via-redirect')
    .reply(301, undefined, { location: 'https://www.foo.com/fixed-via-redirect' });

  nock('https://www.foo.com')
    .get('/fixed-via-redirect')
    .reply(200);

  nock(site2.getBaseURL())
    .get('/')
    .reply(200);

  nock('https://ahrefs.com')
    .get(/.*/)
    .reply(200, { backlinks });
};
