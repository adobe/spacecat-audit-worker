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

export const TOPIC_PATTERNS = {
  'bulk.com': [{
    regex: '/products/([^/]+)/',
  }],
  'adobe.com': [
    {
      name: 'Acrobat',
      regex: '(?!.*blog|.*learn)(/?acrobat.|/?acrobat/|/?products/acrobat)',
    },
    {
      name: 'Firefly',
      regex: '(?!.*blog|.*learn)(/products/firefly|/ai/.*firefly)',
    },
    {
      name: 'Express',
      regex: '(?!.*blog|.*learn)(/?express)',
    },
    {
      name: 'Creative Cloud',
      regex: '(?!.*blog|.*learn)(/?creativecloud)',
    },
  ],
  'business.adobe.com': [
    {
      regex: '^(?!/blog|/learn).*?/products/([^/.]+)',
    },
  ],
  'wilson.com': [
    {
      name: 'Tennis Rackets',
      regex: '^/(?:[a-z]{2}-[a-z]{2}/)?(?!.*blog|.*explore)(?:product/(?:blade|pro-staff|clash|ultra|burn|shift|tour-slam)|tennis/(?:tennis-rackets|collections))',
    },
    {
      name: 'Tennis Shoes',
      regex: '^/(?:[a-z]{2}-[a-z]{2}/)?(?!.*blog|.*explore)(?:product|shoes)/(?:intrigue|tour-slam)',
    },
    {
      name: 'Basketball',
      regex: '^/(?:[a-z]{2}-[a-z]{2}/)?(?!.*blog|.*explore)basketball',
    },
    {
      name: 'Golf',
      regex: '^/(?:[a-z]{2}-[a-z]{2}/)?(?!.*blog|.*explore)golf',
    },
    {
      name: 'Baseball',
      regex: '^/(?:[a-z]{2}-[a-z]{2}/)?(?!.*blog|.*explore)baseball',
    },
    {
      name: 'Padel',
      regex: '^/(?:[a-z]{2}-[a-z]{2}/)?(?!.*blog|.*explore)padel',
    },
    {
      name: 'Football',
      regex: '^/(?:[a-z]{2}-[a-z]{2}/)?(?!.*blog|.*explore)football',
    },
    {
      name: 'Volleyball',
      regex: '^/(?:[a-z]{2}-[a-z]{2}/)?(?!.*blog|.*explore)volleyball',
    },
  ],
};
