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
};
