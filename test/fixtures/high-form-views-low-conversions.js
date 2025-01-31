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
      ],
    },
  },
  opportunityData: {
    siteId: 'site-id',
    auditId: 'audit-id',
    runbook: 'https://adobe.sharepoint.com/:w:/s/AEM_Forms/EU_cqrV92jNIlz8q9gxGaOMBSRbcwT9FPpQX84bRKQ9Phw?e=Nw9ZRz',
    type: 'high-form-views-low-conversions',
    origin: 'AUTOMATION',
    title: 'Form has high views but low conversions',
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
      metrics: [
        {
          type: 'conversionRate',
          vendor: '*',
          value: {
            page: 0.014947683109118086,
          },
        },
      ],
    },
  },
};

export default testData;
