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
            'desktop:windows': 100,
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
            'desktop:windows': 100,
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
          url: 'https://www.surest.com/info/win-2',
          formsubmit: {
            'desktop:windows': 100,
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
            'desktop:windows': 100,
          },
          formview: { 'mobile:ios': 3000 },
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
  opportunityData: {
    siteId: 'site-id',
    auditId: 'audit-id',
    runbook: 'https://adobe.sharepoint.com/:w:/s/AEM_Forms/EU_cqrV92jNIlz8q9gxGaOMBSRbcwT9FPpQX84bRKQ9Phw?e=Nw9ZRz',
    type: 'high-form-views-low-conversions',
    origin: 'AUTOMATION',
    title: 'Form has low conversions',
    description: 'Form has high views but low conversions',
    tags: [
      'Forms Conversion',
    ],
    data: {
      form: 'https://www.surest.com/contact-us',
      screenshot: '',
      trackedFormKPIName: 'Conversion Rate',
      trackedFormKPIValue: 0.014947683109118086,
      formViews: 6690,
      pageViews: 6690,
      samples: 6690,
      scrapedStatus: false,
      metrics: [
        {
          type: 'conversionRate',
          device: '*',
          value: {
            page: 0.014947683109118086,
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
          type: 'conversionRate',
          device: 'desktop',
          value: {
            page: 0.01757469244288225,
          },
        },
        {
          type: 'traffic',
          device: '*',
          value: {
            total: null,
            paid: null,
            earned: null,
            owned: null,
          },
        },
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
      'Forms Conversion',
    ],
    data: {
      form: 'https://www.surest.com/contact-us',
      screenshot: '',
      trackedFormKPIName: 'Conversion Rate',
      trackedFormKPIValue: 0.014947683109118086,
      formViews: 6690,
      pageViews: 6690,
      samples: 6690,
      scrapedStatus: false,
      metrics: [
        {
          type: 'conversionRate',
          device: '*',
          value: {
            page: 0.014947683109118086,
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
          type: 'conversionRate',
          device: 'desktop',
          value: {
            page: 0.01757469244288225,
          },
        },
        {
          type: 'traffic',
          device: '*',
          value: {
            total: null,
            paid: null,
            earned: null,
            owned: null,
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
      'Forms Conversion',
    ],
    data: {
      form: 'https://www.surest.com/contact-us',
      screenshot: '',
      trackedFormKPIName: 'Conversion Rate',
      trackedFormKPIValue: 0.014947683109118086,
      formViews: 6690,
      pageViews: 6690,
      samples: 6690,
      scrapedStatus: false,
      metrics: [
        {
          type: 'conversionRate',
          device: '*',
          value: {
            page: 0.014947683109118086,
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
          type: 'conversionRate',
          device: 'desktop',
          value: {
            page: 0.01757469244288225,
          },
        },
        {
          type: 'traffic',
          device: '*',
          value: {
            total: null,
            paid: null,
            earned: null,
            owned: null,
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
      'Forms Conversion',
    ],
    data: {
      form: 'https://www.surest.com/contact-us',
      screenshot: '',
      trackedFormKPIName: 'Conversion Rate',
      trackedFormKPIValue: 0.014947683109118086,
      formViews: 6690,
      pageViews: 6690,
      samples: 6690,
      scrapedStatus: true,
      metrics: [
        {
          type: 'conversionRate',
          device: '*',
          value: {
            page: 0.014947683109118086,
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
          type: 'conversionRate',
          device: 'desktop',
          value: {
            page: 0.01757469244288225,
          },
        },
        {
          type: 'traffic',
          device: '*',
          value: {
            total: null,
            paid: null,
            earned: null,
            owned: null,
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
      ],
    },
  },
};

export default testData;
