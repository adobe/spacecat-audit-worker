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
export const formVitalsCollection = [
  {
    url: 'https://www.surest.com/contact-us',
    formsubmit: {
      'desktop:windows': 100,
    },
    formview: {},
    formengagement: {
      'desktop:windows': 700,
      'mobile:ios': 300,
    },
    pageview: {
      'desktop:windows': 5690,
      'mobile:ios': 1000,
    },
  },
  {
    url: 'https://www.surest.com/info/win',
    formsubmit: {
    },
    formview: { 'mobile:ios': 300 },
    formengagement: {
      'desktop:windows': 4000,
      'mobile:ios': 300,
    },
    pageview: {
      'desktop:windows': 4670,
      'mobile:ios': 4000,
    },
    formsource: '.myform',
  },
  {
    url: 'https://www.surest.com/newsletter',
    formsubmit: {
    },
    formview: { 'mobile:ios': 300 },
    formengagement: {
      'mobile:ios': 300,
    },
    pageview: {
      'desktop:windows': 4670,
      'mobile:ios': 4000,
    },
    forminternalnavigation: [
      {
        url: 'https://www.surest.com/about-us',
        pageview: {
          'desktop:windows:blink': 54000,
          'mobile:android:blink': 26000,
          'mobile:ios:webkit': 24000,
          'desktop:mac:webkit': 2000,
          'desktop:chromeos:blink': 900,
          'desktop:mac:blink': 900,
          'desktop:linux:gecko': 200,
          'mobile:ipados:webkit': 100,
          'mobile:android:gecko': 100,
          'desktop:linux:blink': 100,
          'desktop:windows:gecko': 100,
        },
        CTAs: [
          {
            source: '#teaser-related02 .cmp-teaser__action-link',
            clicks: 800,
          },
          {
            source: '#teaser-related02 .cmp-teaser__action-container',
            clicks: 300,
          },
          {
            source: 'nav',
            clicks: 200,
          },
          {
            source: '#teaser-related01 .cmp-teaser__action-container',
            clicks: 200,
          },
          {
            source: '#teaser-related01 .cmp-teaser__content',
            clicks: 100,
          },
          {
            source: 'header .cmp-list__item-title',
            clicks: 100,
          },
        ],
        totalClicksOnPage: 7200,
      },
      {
        url: 'https://www.surest.com/about-us/history',
        pageview: {
          'desktop:windows:blink': 54000,
          'mobile:android:blink': 26000,
        },
        CTAs: [
          {
            source: '#teaser-related02 .cmp-teaser__action-link',
            clicks: 800,
          },
        ],
      },
    ],
  },
];

export const formVitalsCollection2 = [
  {
    url: 'https://www.surest.com/contact-us',
    formsubmit: {
      'desktop:windows': 100,
    },
    formview: {},
    formengagement: {
      'desktop:windows': 700,
      'mobile:ios': 300,
    },
    pageview: {
      'desktop:windows': 5690,
      'mobile:ios': 1000,
    },
  },
  {
    url: 'https://www.surest.com/info/win',
    formsubmit: {
    },
    formview: { 'mobile:ios': 300 },
    formengagement: {
      'desktop:windows': 4000,
      'mobile:ios': 300,
    },
    pageview: {
      'desktop:windows': 4670,
      'mobile:ios': 4000,
    },
  },
  {
    url: 'https://www.surest.com/newsletter',
    formsubmit: {
    },
    formview: { 'mobile:ios': 300 },
    formengagement: {
      'mobile:ios': 300,
    },
    pageview: {
      'desktop:windows': 4670,
      'mobile:ios': 4000,
    },
    forminternalnavigation: [
      {
        url: 'https://www.surest.com/about-us',
        pageview: {
          'desktop:windows:blink': 54000,
          'mobile:android:blink': 26000,
          'mobile:ios:webkit': 24000,
          'desktop:mac:webkit': 2000,
          'desktop:chromeos:blink': 900,
          'desktop:mac:blink': 900,
          'desktop:linux:gecko': 200,
          'mobile:ipados:webkit': 100,
          'mobile:android:gecko': 100,
          'desktop:linux:blink': 100,
          'desktop:windows:gecko': 100,
        },
        CTAs: [
          {
            source: '#teaser-related02 .cmp-teaser__action-link',
            clicks: 800,
          },
          {
            source: '#teaser-related02 .cmp-teaser__action-container',
            clicks: 300,
          },
          {
            source: 'nav',
            clicks: 200,
          },
          {
            source: '#teaser-related01 .cmp-teaser__action-container',
            clicks: 200,
          },
          {
            source: '#teaser-related01 .cmp-teaser__content',
            clicks: 100,
          },
          {
            source: 'header .cmp-list__item-title',
            clicks: 100,
          },
        ],
      },
      {
        url: 'https://www.surest.com/about-us/history',
        pageview: {
          'desktop:windows:blink': 54000,
          'mobile:android:blink': 26000,
        },
        CTAs: [
          {
            source: '#teaser-related02 .cmp-teaser__action-link',
            clicks: 800,
          },
        ],
      },
    ],
  },
];
