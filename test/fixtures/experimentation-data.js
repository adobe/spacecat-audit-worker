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
export const expectedAuditDataVariant1 = {
  fullAuditRef: 'https://helix-pages.anywhere.run/helix-services/run-query@v3/rum-experiments?interval=7&offset=0&limit=101&url=bamboohr.com',
  auditResult: [
    {
      experiment: '24-101c-lp-enhanced-applicant-tracking-system',
      p_value: 0.5000000005,
      variant: 'challenger-2',
      variant_experimentation_events: 13,
      variant_conversion_events: 3,
      variant_experimentations: '1300',
      variant_conversions: '300',
      variant_conversion_rate: '0.230769231',
      time5: '2024-02-01 17:00:19+00',
      time95: '2024-02-07 20:00:55+00',
    },
    {
      experiment: '24-101c-lp-enhanced-applicant-tracking-system',
      p_value: 0.5000000005,
      variant: 'challenger-1',
      variant_experimentation_events: 11,
      variant_conversion_events: 3,
      variant_experimentations: '1100',
      variant_conversions: '300',
      variant_conversion_rate: '0.272727273',
      time5: '2024-02-01 00:00:08+00',
      time95: '2024-02-07 23:00:58+00',
    },
    {
      experiment: '24-101a-lp-enhanced-onboarding',
      p_value: 0.5000000005,
      variant: 'challenger-1',
      variant_experimentation_events: 23,
      variant_conversion_events: 8,
      variant_experimentations: '2300',
      variant_conversions: '800',
      variant_conversion_rate: '0.347826087',
      time5: '2024-02-01 13:00:04+00',
      time95: '2024-02-07 21:00:08+00',
    },
    {
      experiment: '24-101a-lp-enhanced-onboarding',
      p_value: 0.5000000005,
      variant: 'challenger-2',
      variant_experimentation_events: 31,
      variant_conversion_events: 3,
      variant_experimentations: '3100',
      variant_conversions: '300',
      variant_conversion_rate: '0.096774194',
      time5: '2024-02-01 15:00:13+00',
      time95: '2024-02-07 20:00:18+00',
    },
    {
      experiment: '2-21-free-trial-cp-delay-load',
      p_value: 0.3431751933689274,
      variant: 'challenger-1',
      variant_experimentation_events: 24,
      variant_conversion_events: 20,
      variant_experimentations: '2400',
      variant_conversions: '2000',
      variant_conversion_rate: '0.833333333',
      time5: '2024-02-01 00:00:08+00',
      time95: '2024-02-07 23:00:12+00',
    },
    {
      experiment: '2-21-free-trial-cp-delay-load',
      p_value: 0.47701597063430096,
      variant: 'challenger-2',
      variant_experimentation_events: 24,
      variant_conversion_events: 13,
      variant_experimentations: '2400',
      variant_conversions: '1300',
      variant_conversion_rate: '0.541666667',
      time5: '2024-02-01 18:00:00+00',
      time95: '2024-02-07 19:00:09+00',
    },
  ],
};

export const expectedAuditDataVariant2 = {
  fullAuditRef: 'https://helix-pages.anywhere.run/helix-services/run-query@v3/rum-experiments?interval=7&offset=0&limit=101&url=www.spacecat.com',
  auditResult: [
    {
      experiment: '24-101c-lp-enhanced-applicant-tracking-system',
      p_value: 0.5000000005,
      variant: 'challenger-2',
      variant_experimentation_events: 13,
      variant_conversion_events: 3,
      variant_experimentations: '1300',
      variant_conversions: '300',
      variant_conversion_rate: '0.230769231',
      time5: '2024-02-01 17:00:19+00',
      time95: '2024-02-07 20:00:55+00',
    },
    {
      experiment: '24-101c-lp-enhanced-applicant-tracking-system',
      p_value: 0.5000000005,
      variant: 'challenger-1',
      variant_experimentation_events: 11,
      variant_conversion_events: 3,
      variant_experimentations: '1100',
      variant_conversions: '300',
      variant_conversion_rate: '0.272727273',
      time5: '2024-02-01 00:00:08+00',
      time95: '2024-02-07 23:00:58+00',
    },
    {
      experiment: '24-101a-lp-enhanced-onboarding',
      p_value: 0.5000000005,
      variant: 'challenger-1',
      variant_experimentation_events: 23,
      variant_conversion_events: 8,
      variant_experimentations: '2300',
      variant_conversions: '800',
      variant_conversion_rate: '0.347826087',
      time5: '2024-02-01 13:00:04+00',
      time95: '2024-02-07 21:00:08+00',
    },
    {
      experiment: '24-101a-lp-enhanced-onboarding',
      p_value: 0.5000000005,
      variant: 'challenger-2',
      variant_experimentation_events: 31,
      variant_conversion_events: 3,
      variant_experimentations: '3100',
      variant_conversions: '300',
      variant_conversion_rate: '0.096774194',
      time5: '2024-02-01 15:00:13+00',
      time95: '2024-02-07 20:00:18+00',
    },
    {
      experiment: '2-21-free-trial-cp-delay-load',
      p_value: 0.3431751933689274,
      variant: 'challenger-1',
      variant_experimentation_events: 24,
      variant_conversion_events: 20,
      variant_experimentations: '2400',
      variant_conversions: '2000',
      variant_conversion_rate: '0.833333333',
      time5: '2024-02-01 00:00:08+00',
      time95: '2024-02-07 23:00:12+00',
    },
    {
      experiment: '2-21-free-trial-cp-delay-load',
      p_value: 0.47701597063430096,
      variant: 'challenger-2',
      variant_experimentation_events: 24,
      variant_conversion_events: 13,
      variant_experimentations: '2400',
      variant_conversions: '1300',
      variant_conversion_rate: '0.541666667',
      time5: '2024-02-01 18:00:00+00',
      time95: '2024-02-07 19:00:09+00',
    },
  ],
};

export const expectedAuditDataVariant3 = {
  fullAuditRef: 'https://helix-pages.anywhere.run/helix-services/run-query@v3/rum-experiments?interval=7&offset=0&limit=101&url=subdomain.spacecat.com',
  auditResult: [],
};

export const rumData = {
  ':names': [
    'results',
    'meta',
  ],
  ':type': 'multi-sheet',
  ':version': 3,
  results: {
    limit: 6,
    offset: 0,
    total: 6,
    data: [
      {
        experiment: '24-101c-lp-enhanced-applicant-tracking-system',
        variant: 'challenger-2',
        tdiff: 6,
        variant_experimentation_events: 13,
        control_experimentation_events: 0,
        variant_conversion_events: 3,
        control_conversion_events: 0,
        variant_experimentations: '1300',
        control_experimentations: '0',
        variant_conversions: '300',
        control_conversions: '0',
        variant_conversion_rate: '0.230769231',
        control_conversion_rate: '0',
        topurl: 'https://www.bamboohr.com/pl-pages/applicant-tracking-system-a2',
        time95: '2024-02-07 20:00:55+00',
        time5: '2024-02-01 17:00:19+00',
        pooled_sample_proportion: 0.23076923076923078,
        pooled_standard_error: null,
        test: null,
        p_value: 0.5000000005,
        remaining_runtime: 494,
      },
      {
        experiment: '24-101c-lp-enhanced-applicant-tracking-system',
        variant: 'challenger-1',
        tdiff: 6,
        variant_experimentation_events: 11,
        control_experimentation_events: 0,
        variant_conversion_events: 3,
        control_conversion_events: 0,
        variant_experimentations: '1100',
        control_experimentations: '0',
        variant_conversions: '300',
        control_conversions: '0',
        variant_conversion_rate: '0.272727273',
        control_conversion_rate: '0',
        topurl: 'https://www.bamboohr.com/pl-pages/applicant-tracking-system-a1',
        time95: '2024-02-07 23:00:58+00',
        time5: '2024-02-01 00:00:08+00',
        pooled_sample_proportion: 0.2727272727272727,
        pooled_standard_error: null,
        test: null,
        p_value: 0.5000000005,
        remaining_runtime: 494,
      },
      {
        experiment: '24-101a-lp-enhanced-onboarding',
        variant: 'challenger-1',
        tdiff: 6,
        variant_experimentation_events: 23,
        control_experimentation_events: 0,
        variant_conversion_events: 8,
        control_conversion_events: 0,
        variant_experimentations: '2300',
        control_experimentations: '0',
        variant_conversions: '800',
        control_conversions: '0',
        variant_conversion_rate: '0.347826087',
        control_conversion_rate: '0',
        topurl: 'https://www.bamboohr.com/pl-pages/onboarding-c1',
        time95: '2024-02-07 21:00:08+00',
        time5: '2024-02-01 13:00:04+00',
        pooled_sample_proportion: 0.34782608695652173,
        pooled_standard_error: null,
        test: null,
        p_value: 0.5000000005,
        remaining_runtime: 267,
      },
      {
        experiment: '24-101a-lp-enhanced-onboarding',
        variant: 'challenger-2',
        tdiff: 6,
        variant_experimentation_events: 31,
        control_experimentation_events: 0,
        variant_conversion_events: 3,
        control_conversion_events: 0,
        variant_experimentations: '3100',
        control_experimentations: '0',
        variant_conversions: '300',
        control_conversions: '0',
        variant_conversion_rate: '0.096774194',
        control_conversion_rate: '0',
        topurl: 'https://www.bamboohr.com/pl-pages/onboarding-c2',
        time95: '2024-02-07 20:00:18+00',
        time5: '2024-02-01 15:00:13+00',
        pooled_sample_proportion: 0.0967741935483871,
        pooled_standard_error: null,
        test: null,
        p_value: 0.5000000005,
        remaining_runtime: 267,
      },
      {
        experiment: '2-21-free-trial-cp-delay-load',
        variant: 'challenger-1',
        tdiff: 6,
        variant_experimentation_events: 24,
        control_experimentation_events: 20,
        variant_conversion_events: 20,
        control_conversion_events: 10,
        variant_experimentations: '2400',
        control_experimentations: '2000',
        variant_conversions: '2000',
        control_conversions: '1000',
        variant_conversion_rate: '0.833333333',
        control_conversion_rate: '0.5',
        topurl: 'https://www.bamboohr.com/signup/c1',
        time95: '2024-02-07 23:00:12+00',
        time5: '2024-02-01 00:00:08+00',
        pooled_sample_proportion: 0.6818181818181818,
        pooled_standard_error: 0.8254647450373558,
        test: 0.40381292478446823,
        p_value: 0.3431751933689274,
        remaining_runtime: 64,
      },
      {
        experiment: '2-21-free-trial-cp-delay-load',
        variant: 'challenger-2',
        tdiff: 6,
        variant_experimentation_events: 24,
        control_experimentation_events: 20,
        variant_conversion_events: 13,
        control_conversion_events: 10,
        variant_experimentations: '2400',
        control_experimentations: '2000',
        variant_conversions: '1300',
        control_conversions: '1000',
        variant_conversion_rate: '0.541666667',
        control_conversion_rate: '0.5',
        topurl: 'https://www.bamboohr.com/signup/c2',
        time95: '2024-02-07 19:00:09+00',
        time5: '2024-02-01 18:00:00+00',
        pooled_sample_proportion: 0.5227272727272727,
        pooled_standard_error: 0.7228255661993029,
        test: 0.05764415226634547,
        p_value: 0.47701597063430096,
        remaining_runtime: 64,
      },
    ],
    columns: [
      'experiment',
      'variant',
      'tdiff',
      'variant_experimentation_events',
      'control_experimentation_events',
      'variant_conversion_events',
      'control_conversion_events',
      'variant_experimentations',
      'control_experimentations',
      'variant_conversions',
      'control_conversions',
      'variant_conversion_rate',
      'control_conversion_rate',
      'topurl',
      'time95',
      'time5',
      'pooled_sample_proportion',
      'pooled_standard_error',
      'test',
      'p_value',
      'remaining_runtime',
    ],
  },
  meta: {
    limit: 13,
    offset: 0,
    total: 13,
    columns: [
      'name',
      'value',
      'type',
    ],
    data: [
      {
        name: 'description',
        value: 'Using Helix RUM data, get a report of conversion rates of experiment variants compared to control, including p value.',
        type: 'query description',
      },
      {
        name: 'url',
        value: 'www.bamboohr.com',
        type: 'request parameter',
      },
      {
        name: 'interval',
        value: 7,
        type: 'request parameter',
      },
      {
        name: 'offset',
        value: 0,
        type: 'request parameter',
      },
      {
        name: 'startdate',
        value: '-',
        type: 'request parameter',
      },
      {
        name: 'enddate',
        value: '-',
        type: 'request parameter',
      },
      {
        name: 'timezone',
        value: 'UTC',
        type: 'request parameter',
      },
      {
        name: 'experiment',
        value: '-',
        type: 'request parameter',
      },
      {
        name: 'conversioncheckpoint',
        value: 'click',
        type: 'request parameter',
      },
      {
        name: 'sources',
        value: '-',
        type: 'request parameter',
      },
      {
        name: 'targets',
        value: '-',
        type: 'request parameter',
      },
      {
        name: 'threshold',
        value: '500',
        type: 'request parameter',
      },
      {
        name: 'limit',
        value: null,
        type: 'request parameter',
      },
    ],
  },
};

export const rumDataEmpty = {
  ':names': [
    'results',
    'meta',
  ],
  ':type': 'multi-sheet',
  ':version': 3,
  results: {
    limit: 1,
    offset: 0,
    total: 0,
    data: [],
    columns: [],
  },
  meta: {
    limit: 13,
    offset: 0,
    total: 13,
    columns: [
      'name',
      'value',
      'type',
    ],
    data: [
      {
        name: 'description',
        value: 'Using Helix RUM data, get a report of conversion rates of experiment variants compared to control, including p value.',
        type: 'query description',
      },
      {
        name: 'url',
        value: 'maidenform.com',
        type: 'request parameter',
      },
      {
        name: 'interval',
        value: 7,
        type: 'request parameter',
      },
      {
        name: 'offset',
        value: 0,
        type: 'request parameter',
      },
      {
        name: 'startdate',
        value: '-',
        type: 'request parameter',
      },
      {
        name: 'enddate',
        value: '-',
        type: 'request parameter',
      },
      {
        name: 'timezone',
        value: 'UTC',
        type: 'request parameter',
      },
      {
        name: 'experiment',
        value: '-',
        type: 'request parameter',
      },
      {
        name: 'conversioncheckpoint',
        value: 'click',
        type: 'request parameter',
      },
      {
        name: 'sources',
        value: '-',
        type: 'request parameter',
      },
      {
        name: 'targets',
        value: '-',
        type: 'request parameter',
      },
      {
        name: 'threshold',
        value: '500',
        type: 'request parameter',
      },
      {
        name: 'limit',
        value: null,
        type: 'request parameter',
      },
    ],
  },
};
