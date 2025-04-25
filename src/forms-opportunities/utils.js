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

import {
  isNonEmptyArray,
} from '@adobe/spacecat-shared-utils';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  getHighPageViewsLowFormCtrMetrics, getHighFormViewsLowConversionMetrics,
  getHighPageViewsLowFormViewsMetrics,
} from './formcalc.js';
import { FORM_OPPORTUNITY_TYPES } from './constants.js';

const EXPIRY_IN_SECONDS = 3600 * 24 * 7;

function getS3PathPrefix(url, site) {
  const urlObj = new URL(url);
  let { pathname } = urlObj;
  pathname = pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  return `scrapes/${site.getId()}${pathname}/forms`;
}

async function getPresignedUrl(fileName, context, url, site) {
  const { log, s3Client: s3ClientObj } = context;
  const screenshotPath = `${getS3PathPrefix(url, site)}/${fileName}`;
  log.info(`Generating presigned URL for ${screenshotPath}`);

  const command = new GetObjectCommand({
    Bucket: process.env.S3_BUCKET_NAME,
    Key: screenshotPath,
  });

  return getSignedUrl(s3ClientObj, command, { expiresIn: EXPIRY_IN_SECONDS })
    // eslint-disable-next-line no-shadow
    .then((signedUrl) => signedUrl)
    .catch((error) => {
      log.error(`Error generating presigned URL for ${screenshotPath}:`, error);
      return ''; // Ensure the function always returns something
    });
}

function getFormMetrics(metricObject) {
  const { formview, formengagement, formsubmit } = metricObject;

  const calculateMetrics = (_formSubmit, _formViews, _formEngagement) => {
    let bounceRate = 1;
    let conversionRate = 0;
    // if engagement is zero, it means bounce rate is 1, then dropoffRate does not makes sense
    let dropoffRate = null;

    if (_formViews > 0) {
      conversionRate = _formSubmit / _formViews;
      bounceRate = 1 - (_formEngagement / _formViews);
    }
    if (_formEngagement > 0) {
      dropoffRate = 1 - (_formSubmit / _formEngagement);
    }

    return {
      conversionRate,
      bounceRate,
      dropoffRate,
    };
  };

  return ['total', 'desktop', 'mobile'].map((device) => {
    const formViews = formview[device] || 0;
    const formEngagement = formengagement[device] || 0;
    const formSubmit = formsubmit[device] || 0;
    const {
      conversionRate,
      bounceRate,
      dropoffRate,
    } = calculateMetrics(formSubmit, formViews, formEngagement);
    return {
      device,
      conversionRate,
      bounceRate,
      dropoffRate,
    };
  });
}

function convertToLowViewOpptyData(metricObject) {
  const {
    formview: { total: formViews, mobile: formViewsMobile, desktop: formViewsDesktop },
    trafficacquisition,
  } = metricObject;
  return {
    trackedFormKPIName: 'Form Views',
    trackedFormKPIValue: formViews,
    metrics: [
      {
        type: 'formViews',
        device: '*',
        value: {
          page: formViews,
        },
      },
      {
        type: 'formViews',
        device: 'mobile',
        value: {
          page: formViewsMobile,
        },
      },
      {
        type: 'formViews',
        device: 'desktop',
        value: {
          page: formViewsDesktop,
        },
      },
      {
        type: 'traffic',
        device: '*',
        value: {
          total: trafficacquisition.total ? trafficacquisition.total : null,
          paid: trafficacquisition.paid ? trafficacquisition.paid : null,
          earned: trafficacquisition.earned ? trafficacquisition.earned : null,
          owned: trafficacquisition.owned ? trafficacquisition.owned : null,
        },
      },
    ],
  };
}

function convertToLowNavOpptyData(metricObject) {
  const {
    CTA,
  } = metricObject;
  const opptyData = convertToLowViewOpptyData(metricObject);
  opptyData.formNavigation = CTA;
  return opptyData;
}

function convertToLowConversionOpptyData(metricObject) {
  const { trafficacquisition } = metricObject;
  const deviceWiseMetrics = getFormMetrics(metricObject);

  let totalConversionRate = 0;

  const metrics = [];

  for (const metric of deviceWiseMetrics) {
    const {
      device, conversionRate, bounceRate, dropoffRate,
    } = metric;
    if (device === 'total') {
      totalConversionRate = conversionRate;
    }
    const metricsConfig = [
      { type: 'conversionRate', value: conversionRate },
      { type: 'bounceRate', value: bounceRate },
      { type: 'dropoffRate', value: dropoffRate },
    ];
    metricsConfig.forEach(({ type, value }) => {
      metrics.push({
        type,
        device: device === 'total' ? '*' : device,
        value: {
          page: value,
        },
      });
    });
  }

  metrics.push({
    type: 'traffic',
    device: '*',
    value: {
      total: trafficacquisition.total ? trafficacquisition.total : null,
      paid: trafficacquisition.paid ? trafficacquisition.paid : null,
      earned: trafficacquisition.earned ? trafficacquisition.earned : null,
      owned: trafficacquisition.owned ? trafficacquisition.owned : null,
    },
  });

  return {
    trackedFormKPIName: 'Conversion Rate',
    trackedFormKPIValue: totalConversionRate,
    metrics,
  };
}

async function convertToOpportunityData(opportunityType, metricObject, context) {
  const {
    url, pageview: { total: pageViews }, formview: { total: formViews },
    formsource = '',
  } = metricObject;

  const {
    site,
  } = context;

  /*
  if (formViews === 0 && (formSubmit > 0 || formEngagement > 0)) {
    log.debug(`Form views are 0 but form engagement and submissions are > 0 for form: ${url}`);
  } */

  let opportunityData = {};

  if (opportunityType === FORM_OPPORTUNITY_TYPES.LOW_CONVERSION) {
    opportunityData = convertToLowConversionOpptyData(metricObject);
  } else if (opportunityType === FORM_OPPORTUNITY_TYPES.LOW_NAVIGATION) {
    opportunityData = convertToLowNavOpptyData(metricObject);
  } else if (opportunityType === FORM_OPPORTUNITY_TYPES.LOW_VIEWS) {
    opportunityData = convertToLowViewOpptyData(metricObject);
  }

  const screenshot = await getPresignedUrl('screenshot-desktop-fullpage.png', context, url, site);
  opportunityData = {
    ...opportunityData,
    form: url,
    formsource,
    formViews,
    pageViews,
    screenshot,
    samples: pageViews, // todo: get the actual number of samples
  };

  return opportunityData;
}

export async function generateOpptyData(
  formVitals,
  context,
  opportunityTypes = [FORM_OPPORTUNITY_TYPES.LOW_CONVERSION,
    FORM_OPPORTUNITY_TYPES.LOW_NAVIGATION, FORM_OPPORTUNITY_TYPES.LOW_VIEWS],
) {
  const formVitalsCollection = formVitals.filter(
    (row) => row.formengagement && row.formsubmit && row.formview,
  );
  return Promise.all(
    Object.entries({
      [FORM_OPPORTUNITY_TYPES.LOW_CONVERSION]: getHighFormViewsLowConversionMetrics,
      [FORM_OPPORTUNITY_TYPES.LOW_NAVIGATION]: getHighPageViewsLowFormCtrMetrics,
      [FORM_OPPORTUNITY_TYPES.LOW_VIEWS]: getHighPageViewsLowFormViewsMetrics,
    })
      .filter(([opportunityType]) => opportunityTypes.includes(opportunityType))
      .flatMap(([opportunityType, metricsMethod]) => metricsMethod(formVitalsCollection)
        .map((metric) => convertToOpportunityData(opportunityType, metric, context))),
  );
}

export function shouldExcludeForm(scrapedFormData) {
  return scrapedFormData?.formType === 'search'
    || scrapedFormData?.formType === 'login'
    || scrapedFormData?.classList?.includes('unsubscribe');
}

/**
 * filter login and search forms from the opportunities
 * @param formOpportunities
 * @param scrapedData
 * @param log
 * @param excludeUrls urls to exclude from opportunity creation
 * @returns {*}
 */
export function filterForms(formOpportunities, scrapedData, log, excludeUrls = new Set()) {
  return formOpportunities.filter((opportunity) => {
    let urlMatches = false;
    if (opportunity.form.includes('search') || excludeUrls.has(opportunity.form + opportunity.formsource)) {
      return false; // exclude search pages
    }
    if (isNonEmptyArray(scrapedData?.formData)) {
      for (const form of scrapedData.formData) {
        const formUrl = new URL(form.finalUrl);
        const opportunityUrl = new URL(opportunity.form);

        if (formUrl.origin + formUrl.pathname === opportunityUrl.origin + opportunityUrl.pathname) {
          urlMatches = true;
          const nonSearchForms = form.scrapeResult.filter((sr) => !shouldExcludeForm(sr));
          if (urlMatches && nonSearchForms.length === 0) {
            log.debug(`Filtered out search form: ${opportunity?.form}`);
            return false;
          }
        }
      }
    }
    // eslint-disable-next-line no-param-reassign
    opportunity.scrapedStatus = urlMatches;
    return true;
  });
}
