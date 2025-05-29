/*
 * Copyright 2024 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */
const testData = {
  auditData: {
    type: 'high-form-views-low-conversions',
    siteId: 'site-id',
    id: 'audit-id',
    auditResult: {
      formVitals: [
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
          formview: {},
          formengagement: {
            'desktop:windows': 4000,
            'mobile:ios': 300,
          },
          pageview: {
            'desktop:windows': 4670,
            'mobile:ios': 1000,
          },
        },
        {
          url: 'https://www.surest.com/info/win-1',
          formsubmit: {
          },
          formview: {},
          formengagement: {
            'desktop:windows': 4000,
            'mobile:ios': 300,
          },
          pageview: {
            'desktop:windows': 4670,
            'mobile:ios': 1000,
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
      ],
    },
  },
  opptyAuditDataWithIframe: {
    type: 'high-page-views-low-form-nav',
    siteId: 'site-id',
    auditId: 'audit-id',
    auditResult: {
      formVitals: [
        {
          url: 'https://www.iframe-example.com/test/getting-iframe-example/guide/newsletter',
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
          trafficacquisition: {
            paid: 4670,
            maxTimeDelta: 3060,
            total: 8670,
            earned: 2000,
            sources: [],
            owned: 2000,
          },
          iframeSrc: 'https://www.iframe-example.com/content/iframe-example/en-us/test/getting-iframe-example/guide/begin/jcr:content/contentpar/columns/0/aemform.iframe.en.html',
          forminternalnavigation: [
            {
              url: 'https://www.suriframe-example.com/newsletter',
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
              ],
              totalClicksOnPage: 7200,
            },
          ],
        },
      ],
    },
  },
  oppty2AuditData: {
    type: 'high-page-views-low-form-nav',
    siteId: 'site-id',
    auditId: 'audit-id',
    auditResult: {
      formVitals: [
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
          formview: {},
          formengagement: {
            'desktop:windows': 4000,
            'mobile:ios': 300,
          },
          pageview: {
            'desktop:windows': 4670,
            'mobile:ios': 1000,
          },
        },
        {
          url: 'https://www.surest.com/info/win-1',
          formsubmit: {
          },
          formview: {},
          formengagement: {
            'desktop:windows': 4000,
            'mobile:ios': 300,
          },
          pageview: {
            'desktop:windows': 4670,
            'mobile:ios': 1000,
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
          trafficacquisition: {
            paid: 4670,
            maxTimeDelta: 3060,
            total: 8670,
            earned: 2000,
            sources: [],
            owned: 2000,
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
        {
          url: 'https://www.surest.com/newsletter-2',
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
              url: 'https://www.surest.com/search/product',
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
      ],
    },
  },
  lowFormviewsAuditData: {
    type: 'high-page-views-low-form-nav',
    siteId: 'site-id',
    auditId: 'audit-id',
    auditResult: {
      formVitals: [
        {
          url: 'https://www.surest.com/high-page-low-form-view',
          formsubmit: {
            'desktop:windows': 0,
          },
          formview: {
            'desktop:windows': 200,
          },
          formengagement: {
            'desktop:windows': 100,
          },
          pageview: {
            'desktop:windows': 5690,
          },
          trafficacquisition: {
            paid: 2690,
            maxTimeDelta: 3060,
            total: 6690,
            earned: 2000,
            sources: [],
            owned: 2000,
          },
        },
        {
          url: 'https://www.surest.com/existing-opportunity',
          formsubmit: {
            'desktop:windows': 0,
          },
          formview: {
            'desktop:windows': 200,
          },
          formengagement: {
            'desktop:windows': 100,
          },
          pageview: {
            'desktop:windows': 5690,
            'mobile:ios': 1000,
          },
          trafficacquisition: {
            paid: 2690,
            maxTimeDelta: 3060,
            total: 6690,
            earned: 2000,
            sources: [],
            owned: 2000,
          },
        },
      ],
    },
  },
  auditData3: {
    type: 'high-form-views-low-conversions',
    siteId: 'site-id',
    auditId: 'audit-id',
    auditResult: {
      formVitals: [
        {
          url: 'https://www.surest.com/search',
          formsubmit: {
            'desktop:windows': 100,
          },
          formview: {
            'desktop:windows': 5690,
            'mobile:ios': 1000,
          },
          formengagement: {
            'desktop:windows': 700,
            'mobile:ios': 300,
          },
          pageview: {
            'desktop:windows': 5690,
          },
        },
        {
          url: 'https://www.surest.com/contact-us',
          formsource: '.mycontact',
          formsubmit: {
            'desktop:windows': 100,
          },
          formview: {
            'desktop:windows': 5690,
            'mobile:ios': 1000,
          },
          formengagement: {
            'desktop:windows': 700,
            'mobile:ios': 300,
          },
          pageview: {
            'desktop:windows': 5690,
          },
        },
        {
          url: 'https://www.surest.com/info/win',
          formsource: 'dialog form',
          formsubmit: {
            'desktop:windows': 100,
          },
          formview: {
            'desktop:windows': 4670,
            'mobile:ios': 1000,
          },
          formengagement: {
            'desktop:windows': 4000,
            'mobile:ios': 300,
          },
          pageview: {
            'desktop:windows': 4670,
            'mobile:ios': 1000,
          },
        },
        {
          url: 'https://www.surest.com/info/win-1',
          formsource: '.form',
          formsubmit: {
            'desktop:windows': 100,
          },
          formview: {
            'desktop:windows': 4670,
            'mobile:ios': 1000,
          },
          formengagement: {
            'desktop:windows': 4000,
            'mobile:ios': 300,
          },
          pageview: {
            'desktop:windows': 4670,
            'mobile:ios': 1000,
          },
        },
        {
          url: 'https://www.surest.com/info/win-2',
          formsubmit: {
            'desktop:windows': 100,
          },
          formview: {
            'desktop:windows': 4670,
            'mobile:ios': 1000,
          },
          formengagement: {
            'desktop:windows': 4000,
            'mobile:ios': 300,
          },
          pageview: {
            'desktop:windows': 4670,
            'mobile:ios': 1000,
          },
        },

        {
          url: 'https://www.surest.com/newsletter',
          formsubmit: {
            'desktop:windows': 100,
          },
          formview: { 'mobile:ios': 3200 },
          formengagement: {
            'mobile:ios': 300,
          },
          pageview: {
            'desktop:windows': 4670,
            'mobile:ios': 4000,
          },
          trafficacquisition: {
            earned: 0,
            maxTimeDelta: 33324,
            owned: 2400,
            paid: 0,
            sources: [
              {
                type: 'owned:direct',
                views: 2400,
              },
            ],
            total: 2400,
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
      ],
    },
  },
  auditDataWithExistingOppty: {
    type: 'high-form-views-low-conversions',
    siteId: 'site-id',
    auditId: 'audit-id',
    auditResult: {
      formVitals: [
        {
          url: 'https://www.surest.com/contact-us',
          formsubmit: {
            'desktop:windows': 100,
          },
          formview: {
            'desktop:windows': 5690,
            'mobile:ios': 1000,
          },
          formengagement: {
            'desktop:windows': 700,
            'mobile:ios': 300,
          },
          pageview: {
            'desktop:windows': 5690,
          },
        },
        {
          url: 'https://www.surest.com/info/win-1',
          formsubmit: {
            'desktop:windows': 100,
          },
          formview: {
            'desktop:windows': 4670,
            'mobile:ios': 1000,
          },
          formengagement: {
            'desktop:windows': 4000,
            'mobile:ios': 300,
          },
          pageview: {
            'desktop:windows': 4670,
            'mobile:ios': 1000,
          },
        },
      ],
    },
  },
  auditDataWithTrafficMetrics: {
    type: 'high-form-views-low-conversions',
    siteId: 'site-id',
    auditId: 'audit-id',
    auditResult: {
      formVitals: [
        {
          url: 'https://www.surest.com/contact-us',
          formsubmit: {
            'desktop:windows': 100,
            'mobile:ios': 100,
          },
          formview: {
            'desktop:windows': 2000,
            'mobile:ios': 1200,
          },
          formengagement: {
            'desktop:windows': 700,
            'mobile:ios': 300,
          },
          pageview: {
            'desktop:windows': 5690,
            'mobile:ios': 2000,
          },
          trafficacquisition: {
            paid: 192200,
            maxTimeDelta: 3060,
            total: 211400,
            earned: 4400,
            sources: [],
            owned: 14800,
          },
        },
      ],
    },
  },
  auditDataOpportunitiesWithSearchFields: {
    type: 'high-form-views-low-conversions',
    siteId: 'site-id',
    auditId: 'audit-id',
    auditResult: {
      formVitals: [
        {
          url: 'https://www.surest.com/contact-us',
          formsubmit: {
            'desktop:windows': 100,
          },
          formview: {
            'desktop:windows': 5690,
            'mobile:ios': 1000,
          },
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
            'desktop:windows': 100,
          },
          formview: {
            'desktop:windows': 4670,
            'mobile:ios': 1000,
          },
          formengagement: {
            'desktop:windows': 4000,
            'mobile:ios': 300,
          },
          pageview: {
            'desktop:windows': 4670,
            'mobile:ios': 1000,
          },
        },
        {
          url: 'https://www.surest.com/info/win-1',
          formsubmit: {
            'desktop:windows': 100,
          },
          formview: {
            'desktop:windows': 4670,
            'mobile:ios': 1000,
          },
          formengagement: {
            'desktop:windows': 4000,
            'mobile:ios': 300,
          },
          pageview: {
            'desktop:windows': 4670,
            'mobile:ios': 1000,
          },
        },
        {
          url: 'https://www.surest.com/info/win-2',
          formsubmit: {
            'desktop:windows': 100,
          },
          formview: {
            'desktop:windows': 4670,
            'mobile:ios': 1000,
          },
          formengagement: {
            'desktop:windows': 4000,
            'mobile:ios': 300,
          },
          pageview: {
            'desktop:windows': 4670,
            'mobile:ios': 1000,
          },
        },
      ],
    },
  },
  mystiqueMessage: {
    type: 'guidance:high-form-views-low-conversions',
    siteId: 'site-id',
    auditId: 'audit-id',
    deliveryType: 'eds',
    time: '2025-05-29T03:51:51.564Z',
    data: {
      url: 'https://www.surest.com/newsletter',
      cr: 0.031,
      screenshot: '',
      metrics: [
        {
          type: 'conversionRate',
          device: '*',
          value: {
            page: 0.031,
          },
        },
        {
          type: 'formBounceRate',
          device: '*',
          value: {
            page: 0.906,
          },
        },
        {
          type: 'dropoffRate',
          device: '*',
          value: {
            page: 0.667,
          },
        },
        {
          type: 'conversionRate',
          device: 'desktop',
          value: {
            page: 0,
          },
        },
        {
          type: 'formBounceRate',
          device: 'desktop',
          value: {
            page: 1,
          },
        },
        {
          type: 'dropoffRate',
          device: 'desktop',
          value: {
            page: null,
          },
        },
        {
          type: 'conversionRate',
          device: 'mobile',
          value: {
            page: 0,
          },
        },
        {
          type: 'formBounceRate',
          device: 'mobile',
          value: {
            page: 0.906,
          },
        },
        {
          type: 'dropoffRate',
          device: 'mobile',
          value: {
            page: 1,
          },
        },
        {
          type: 'traffic',
          device: 'desktop',
          value: {
            page: 4670,
          },
        },
        {
          type: 'traffic',
          device: 'mobile',
          value: {
            page: 4000,
          },
        },
        {
          type: 'trafficAcquisitionSource',
          device: '*',
          value: {
            page: [
              {
                type: 'owned:direct',
                views: 2400,
              },
            ],
          },
        },
      ],
    },
  },
  opportunityData: {
    siteId: 'site-id',
    auditId: 'audit-id',
    runbook: 'https://adobe.sharepoint.com/:w:/s/AEM_Forms/EU_cqrV92jNIlz8q9gxGaOMBSRbcwT9FPpQX84bRKQ9Phw?e=Nw9ZRz',
    type: 'high-form-views-low-conversions',
    origin: 'AUTOMATION',
    title: 'Form has low conversions',
    description: 'Form has high views but low conversions',
    tags: [
      'Form Conversion',
    ],
    data: {
      trackedFormKPIName: 'Conversion Rate',
      trackedFormKPIValue: 0.031,
      metrics: [
        {
          type: 'conversionRate',
          device: '*',
          value: {
            page: 0.031,
          },
        },
        {
          type: 'formBounceRate',
          device: '*',
          value: {
            page: 0.906,
          },
        },
        {
          type: 'dropoffRate',
          device: '*',
          value: {
            page: 0.667,
          },
        },
        {
          type: 'conversionRate',
          device: 'desktop',
          value: {
            page: 0,
          },
        },
        {
          type: 'formBounceRate',
          device: 'desktop',
          value: {
            page: 1,
          },
        },
        {
          type: 'dropoffRate',
          device: 'desktop',
          value: {
            page: null,
          },
        },
        {
          type: 'conversionRate',
          device: 'mobile',
          value: {
            page: 0,
          },
        },
        {
          type: 'formBounceRate',
          device: 'mobile',
          value: {
            page: 0.906,
          },
        },
        {
          type: 'dropoffRate',
          device: 'mobile',
          value: {
            page: 1,
          },
        },
        {
          type: 'traffic',
          device: 'desktop',
          value: {
            page: 4670,
          },
        },
        {
          type: 'traffic',
          device: 'mobile',
          value: {
            page: 4000,
          },
        },
        {
          type: 'trafficAcquisitionSource',
          device: '*',
          value: {
            page: [
              {
                type: 'owned:direct',
                views: 2400,
              },
            ],
          },
        },
      ],
      form: 'https://www.surest.com/newsletter',
      formsource: '',
      formViews: 3200,
      pageViews: 8670,
      screenshot: '',
      samples: 8670,
      scrapedStatus: false,
      dataSources: [
        'RUM',
        'Page',
      ],
    },
    guidance: {},
  },
  opportunityData2: {
    siteId: 'site-id',
    auditId: 'audit-id',
    runbook: 'https://adobe.sharepoint.com/:w:/s/AEM_Forms/EU_cqrV92jNIlz8q9gxGaOMBSRbcwT9FPpQX84bRKQ9Phw?e=Nw9ZRz',
    type: 'high-form-views-low-conversions',
    origin: 'AUTOMATION',
    title: 'Form has low conversions',
    description: 'Form has high views but low conversions',
    tags: [
      'Form Conversion',
    ],
    data: {
      form: 'https://www.surest.com/contact-us',
      screenshot: '',
      trackedFormKPIName: 'Conversion Rate',
      trackedFormKPIValue: 0.015,
      formViews: 6690,
      pageViews: 6690,
      formsource: '',
      samples: 6690,
      scrapedStatus: false,
      dataSources: ['RUM', 'Page'],
      metrics: [
        {
          type: 'conversionRate',
          device: '*',
          value: {
            page: 0.015,
          },
        },
        {
          type: 'formBounceRate',
          device: '*',
          value: {
            page: 0.851,
          },
        },
        {
          type: 'dropoffRate',
          device: '*',
          value: {
            page: 0.9,
          },
        },
        {
          type: 'conversionRate',
          device: 'desktop',
          value: {
            page: 0.018,
          },
        },
        {
          type: 'formBounceRate',
          device: 'desktop',
          value: {
            page: 0.877,
          },
        },
        {
          type: 'dropoffRate',
          device: 'desktop',
          value: {
            page: 0.857,
          },
        },
        {
          type: 'conversionRate',
          device: 'mobile',
          value: {
            page: 0,
          },
        },
        {
          type: 'formBounceRate',
          device: 'mobile',
          value: {
            page: 0.7,
          },
        },
        {
          type: 'dropoffRate',
          device: 'mobile',
          value: {
            page: 1,
          },
        },
        {
          type: 'traffic',
          device: 'desktop',
          value: {
            page: 5690,
          },
        },
        {
          type: 'traffic',
          device: 'mobile',
          value: {
            page: 1000,
          },
        },
      ],
    },
    guidance: {},
  },
  opportunityData3: {
    siteId: 'site-id',
    auditId: 'audit-id',
    runbook: 'https://adobe.sharepoint.com/:w:/s/AEM_Forms/EU_cqrV92jNIlz8q9gxGaOMBSRbcwT9FPpQX84bRKQ9Phw?e=Nw9ZRz',
    type: 'high-form-views-low-conversions',
    origin: 'AUTOMATION',
    title: 'Form has low conversions',
    description: 'Form has high views but low conversions',
    tags: [
      'Form Conversion',
    ],
    data: {
      form: 'https://www.surest.com/contact-us',
      screenshot: '',
      trackedFormKPIName: 'Conversion Rate',
      trackedFormKPIValue: 0.015,
      formViews: 6690,
      pageViews: 6690,
      formsource: '',
      samples: 6690,
      scrapedStatus: false,
      dataSources: ['RUM', 'Page'],
      metrics: [
        {
          type: 'conversionRate',
          device: '*',
          value: {
            page: 0.015,
          },
        },
        {
          type: 'formBounceRate',
          device: '*',
          value: {
            page: 0.851,
          },
        },
        {
          type: 'dropoffRate',
          device: '*',
          value: {
            page: 0.9,
          },
        },
        {
          type: 'conversionRate',
          device: 'desktop',
          value: {
            page: 0.018,
          },
        },
        {
          type: 'formBounceRate',
          device: 'desktop',
          value: {
            page: 0.877,
          },
        },
        {
          type: 'dropoffRate',
          device: 'desktop',
          value: {
            page: 0.857,
          },
        },
        {
          type: 'conversionRate',
          device: 'mobile',
          value: {
            page: 0,
          },
        },
        {
          type: 'formBounceRate',
          device: 'mobile',
          value: {
            page: 0.7,
          },
        },
        {
          type: 'dropoffRate',
          device: 'mobile',
          value: {
            page: 1,
          },
        },
        {
          type: 'traffic',
          device: 'desktop',
          value: {
            page: 5690,
          },
        },
        {
          type: 'traffic',
          device: 'mobile',
          value: {
            page: 1000,
          },
        },
      ],
    },
    guidance: {
      recommendations: [
        {
          insight: 'The form contains a large number of fields, which can be overwhelming and increase cognitive load for users',
          recommendation: 'Consider using progressive disclosure techniques, such as multi-step forms, to make the process less daunting.',
          type: 'guidance',
          rationale: 'Progressive disclosure can help by breaking the form into smaller, more manageable steps that can decrease cognitive load and make it more likely for users to complete the form.',
        },
      ],
    },
  },
  opportunityData4: {
    siteId: 'site-id',
    auditId: 'audit-id',
    runbook: 'https://adobe.sharepoint.com/:w:/s/AEM_Forms/EU_cqrV92jNIlz8q9gxGaOMBSRbcwT9FPpQX84bRKQ9Phw?e=Nw9ZRz',
    type: 'high-form-views-low-conversions',
    origin: 'AUTOMATION',
    title: 'Form has low conversions',
    description: 'Form has high views but low conversions',
    tags: [
      'Form Conversion',
    ],
    data: {
      form: 'https://www.surest.com/contact-us',
      screenshot: '',
      trackedFormKPIName: 'Conversion Rate',
      trackedFormKPIValue: 0.015,
      formViews: 6690,
      pageViews: 6690,
      formsource: '',
      samples: 6690,
      scrapedStatus: true,
      dataSources: ['RUM', 'Page'],
      metrics: [
        {
          type: 'conversionRate',
          device: '*',
          value: {
            page: 0.015,
          },
        },
        {
          type: 'formBounceRate',
          device: '*',
          value: {
            page: 0.851,
          },
        },
        {
          type: 'dropoffRate',
          device: '*',
          value: {
            page: 0.9,
          },
        },
        {
          type: 'conversionRate',
          device: 'desktop',
          value: {
            page: 0.018,
          },
        },
        {
          type: 'formBounceRate',
          device: 'desktop',
          value: {
            page: 0.877,
          },
        },
        {
          type: 'dropoffRate',
          device: 'desktop',
          value: {
            page: 0.857,
          },
        },
        {
          type: 'conversionRate',
          device: 'mobile',
          value: {
            page: 0,
          },
        },
        {
          type: 'formBounceRate',
          device: 'mobile',
          value: {
            page: 0.7,
          },
        },
        {
          type: 'dropoffRate',
          device: 'mobile',
          value: {
            page: 1,
          },
        },
        {
          type: 'traffic',
          device: 'desktop',
          value: {
            page: 5690,
          },
        },
        {
          type: 'traffic',
          device: 'mobile',
          value: {
            page: 1000,
          },
        },
      ],
    },
    guidance: {
      recommendations: [
        {
          insight: 'The form has a conversion rate of 1%',
          recommendation: 'Ensure that the form communicates a compelling reason for users to fill it out. ',
          type: 'guidance',
          rationale: 'A strong, benefit-driven headline and a concise supporting message can improve engagement.',
        },
      ],
    },
  },
  opportunityData5: {
    siteId: 'site-id',
    auditId: 'audit-id',
    runbook: 'https://adobe.sharepoint.com/:w:/s/AEM_Forms/EU_cqrV92jNIlz8q9gxGaOMBSRbcwT9FPpQX84bRKQ9Phw?e=Nw9ZRz',
    type: 'high-form-views-low-conversions',
    origin: 'AUTOMATION',
    title: 'Form has low conversions',
    description: 'Form has high views but low conversions',
    tags: [
      'Form Conversion',
    ],
    data: {
      trackedFormKPIName: 'Conversion Rate',
      trackedFormKPIValue: 0.063,
      metrics: [
        {
          type: 'conversionRate',
          device: '*',
          value: {
            page: 0.063,
          },
        },
        {
          type: 'formBounceRate',
          device: '*',
          value: {
            page: 0.687,
          },
        },
        {
          type: 'dropoffRate',
          device: '*',
          value: {
            page: 0.8,
          },
        },
        {
          type: 'conversionRate',
          device: 'desktop',
          value: {
            page: 0.05,
          },
        },
        {
          type: 'formBounceRate',
          device: 'desktop',
          value: {
            page: 0.65,
          },
        },
        {
          type: 'dropoffRate',
          device: 'desktop',
          value: {
            page: 0.857,
          },
        },
        {
          type: 'conversionRate',
          device: 'mobile',
          value: {
            page: 0.083,
          },
        },
        {
          type: 'formBounceRate',
          device: 'mobile',
          value: {
            page: 0.75,
          },
        },
        {
          type: 'dropoffRate',
          device: 'mobile',
          value: {
            page: 0.667,
          },
        },
        {
          type: 'traffic',
          device: 'desktop',
          value: {
            page: 5690,
          },
        },
        {
          type: 'traffic',
          device: 'mobile',
          value: {
            page: 2000,
          },
        },
      ],
      form: 'https://www.surest.com/contact-us',
      formsource: '',
      formViews: 3200,
      pageViews: 7690,
      screenshot: '',
      samples: 7690,
      scrapedStatus: false,
      dataSources: [
        'RUM',
        'Page',
      ],
    },
    guidance: {},
  },
  auditData2: {
    type: 'high-form-views-low-conversions',
    siteId: 'site-id',
    auditId: 'audit-id',
    auditResult: {
      formVitals: [
        {
          url: 'https://www.surest.com/contact-us',
          formsubmit: {
            'desktop:windows': 100,
          },
          formview: {
            'desktop:windows': 5690,
            'mobile:ios': 1000,
          },
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
          formview: {},
          formengagement: {
            'desktop:windows': 4000,
            'mobile:ios': 300,
          },
          pageview: {
            'desktop:windows': 4670,
            'mobile:ios': 1000,
          },
        },
      ],
    },
  },
};

export default testData;
