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

/* eslint-env mocha */

import { expect } from 'chai';
import { formVitalsCollection, formVitalsCollection2 } from '../../fixtures/forms/formcalcaudit.js';
import {
  getHighFormViewsLowConversionMetrics,
  getHighPageViewsLowFormCtrMetrics,
  getHighPageViewsLowFormViewsMetrics,
} from '../../../src/forms-opportunities/formcalc.js';

describe('Form Calc functions', () => {
  it('getHighFormViewsLowConversion', () => {
    const result = getHighFormViewsLowConversionMetrics(formVitalsCollection);
    expect(result).to.eql([
      {
        formengagement: { total: 4300, desktop: 4000, mobile: 300 },
        formsubmit: { total: 0, desktop: 0, mobile: 0 },
        formview: { total: 3200, desktop: 0, mobile: 3200 },
        pageview: { total: 12670, desktop: 4670, mobile: 8000 },
        url: 'https://www.surest.com/info/win-2',
        trafficacquisition: {},
        formsource: '.myform',
      },
    ]);
  });

  it('getHighPageViewsLowFormViews', () => {
    const result = getHighPageViewsLowFormViewsMetrics(formVitalsCollection);
    expect(result).to.eql([
      {
        url: 'https://www.surest.com/info/win',
        formengagement: { total: 4300, desktop: 4000, mobile: 300 },
        formsubmit: { total: 0, desktop: 0, mobile: 0 },
        formview: { total: 300, desktop: 0, mobile: 300 },
        pageview: { total: 8670, desktop: 4670, mobile: 4000 },
        trafficacquisition: {},
        formsource: '.myform',
      },
      {
        formengagement: { total: 4300, desktop: 4000, mobile: 300 },
        formsubmit: { total: 0, desktop: 0, mobile: 0 },
        formview: { total: 3200, desktop: 0, mobile: 3200 },
        pageview: { total: 12670, desktop: 4670, mobile: 8000 },
        url: 'https://www.surest.com/info/win-2',
        trafficacquisition: {},
        formsource: '.myform',
      },
      {
        url: 'https://www.surest.com/newsletter',
        formengagement: { total: 300, desktop: 0, mobile: 300 },
        formsubmit: { total: 0, desktop: 0, mobile: 0 },
        formview: { total: 300, desktop: 0, mobile: 300 },
        pageview: { total: 8670, desktop: 4670, mobile: 4000 },
        trafficacquisition: {},
        formsource: '',
      },
    ]);
  });

  it('getHighPageViewsLowFormCtr', () => {
    const result = getHighPageViewsLowFormCtrMetrics(formVitalsCollection);
    expect(result).to.eql([
      {
        url: 'https://www.surest.com/newsletter',
        pageview: { total: 8670, desktop: 4670, mobile: 4000 },
        formview: { total: 300, desktop: 0, mobile: 300 },
        formengagement: { total: 300, desktop: 0, mobile: 300 },
        formsubmit: { total: 0, desktop: 0, mobile: 0 },
        formsource: '',
        trafficacquisition: {},
        CTA: {
          url: 'https://www.surest.com/about-us',
          source: '#teaser-related02 .cmp-teaser__action-link',
        },
      },
    ]);
  });

  it('getHighPageViewsLowFormCtr-2', () => {
    const result = getHighPageViewsLowFormCtrMetrics(formVitalsCollection2);
    expect(result).to.eql([]);
  });
});
