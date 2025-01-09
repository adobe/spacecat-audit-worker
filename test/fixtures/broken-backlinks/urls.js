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

export const mockUrlResponses = () => {
  nock('https://foo.com')
    .get('/returns-404')
    .reply(404);

  nock('https://foo.com')
    .get('/redirects-throws-error')
    .reply(301, undefined, { location: 'https://www.foo.com/redirects-throws-error' });

  nock('https://www.foo.com')
    .get('/redirects-throws-error')
    .replyWithError({ code: 'ECONNREFUSED', syscall: 'connect' });

  nock('https://foo.com')
    .get('/returns-429')
    .reply(429);

  nock('https://foo.com')
    .get('/times-out')
    .delay(3010)
    .reply(200);
};
