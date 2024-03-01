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
export const expectedAuditResult = [
  {
    url: 'https://www.abc.com/kr/acrobat/hub/how-to/how-to-convert-pdf-to-image.html',
    pageviews: '10000',
    source: 'https://post.naver.com/viewer/postView.naver',
  },
  {
    url: 'https://www.abc.com/sea/acrobat/online/merge-pdf.html',
    pageviews: '8000',
    source: 'https://brandinside.asia/',
  },
];
export const notFoundData = {
  ':names': [
    'results',
    'meta',
  ],
  ':type': 'multi-sheet',
  ':version': 3,
  results: {
    limit: 30,
    offset: 0,
    total: 30,
    data: [
      {
        ids: 7,
        views: '10000',
        actions: '10000',
        topurl: 'https://www.abc.com/kr/acrobat/hub/how-to/how-to-convert-pdf-to-image.html',
        checkpoint: '404',
        source: 'https://post.naver.com/viewer/postView.naver',
        actions_per_view: '1',
      },
      {
        ids: 4,
        views: '8000',
        actions: '8000',
        topurl: 'https://www.abc.com/sea/acrobat/online/merge-pdf.html',
        checkpoint: '404',
        source: 'https://brandinside.asia/',
        actions_per_view: '1',
      },
      {
        ids: 9,
        views: '700',
        actions: '400',
        topurl: 'https://www.abc.com/sea/acrobat/online/pdf-to-word.html',
        checkpoint: '404',
        source: '',
        actions_per_view: '1',
      },
      {
        ids: 11,
        views: '100',
        actions: '100',
        topurl: 'https://www.abc.com/sea/acrobat/online/pdf-to-word22.html',
        checkpoint: '404',
        source: 'https://www.abc.com/',
        actions_per_view: '1',
      },
    ],
    columns: [
      'ids',
      'views',
      'actions',
      'url',
      'checkpoint',
      'source',
      'actions_per_view',
    ],
  },
  meta: {
    limit: 10,
    offset: 0,
    total: 10,
    columns: [
      'name',
      'value',
      'type',
    ],
    data: [
      {
        name: 'description',
        value: 'Get popularity data for RUM target attribute values, filtered by checkpoint',
        type: 'query description',
      },
      {
        name: 'limit',
        value: 30,
        type: 'request parameter',
      },
      {
        name: 'interval',
        value: '30',
        type: 'request parameter',
      },
      {
        name: 'offset',
        value: '0',
        type: 'request parameter',
      },
      {
        name: 'startdate',
        value: '2022-01-01',
        type: 'request parameter',
      },
      {
        name: 'enddate',
        value: '2022-01-31',
        type: 'request parameter',
      },
      {
        name: 'timezone',
        value: 'UTC',
        type: 'request parameter',
      },
      {
        name: 'url',
        value: 'www.abc.com',
        type: 'request parameter',
      },
      {
        name: 'checkpoint',
        value: 404,
        type: 'request parameter',
      },
      {
        name: 'source',
        value: '-',
        type: 'request parameter',
      },
    ],
  },
};
