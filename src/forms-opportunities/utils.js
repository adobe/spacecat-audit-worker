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
  getHighPageViewsLowFormCtrMetrics, getHighFormViewsLowConversionMetrics, isNonEmptyArray,
} from '@adobe/spacecat-shared-utils';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
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
  const {
    formViews, formEngagement, formSubmit,
  } = metricObject;

  let bounceRate = 1;
  let conversionRate = 0;
  // if engagement is zero, it means bounce rate is 1, then dropoffRate does not makes sense
  let dropoffRate = null;

  if (formViews > 0) {
    conversionRate = formSubmit / formViews;
    bounceRate = 1 - (formEngagement / formViews);
  }
  if (formEngagement > 0) {
    dropoffRate = 1 - (formSubmit / formEngagement);
  }

  return {
    conversionRate,
    bounceRate,
    dropoffRate,
  };
}

function convertToLowNavOpptyData(metricObject) {
  const {
    formViews, CTA,
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
    ],
    formNavigation: CTA,
  };
}

function convertToLowConversionOpptyData(metricObject) {
  const { conversionRate, bounceRate, dropoffRate } = getFormMetrics(metricObject);

  return {
    trackedFormKPIName: 'Conversion Rate',
    trackedFormKPIValue: conversionRate,
    metrics: [
      {
        type: 'conversionRate',
        device: '*',
        value: {
          page: conversionRate,
        },
      },
      {
        type: 'bounceRate',
        device: '*',
        value: {
          page: bounceRate,
        },
      },
      dropoffRate !== undefined && {
        type: 'dropoffRate',
        device: '*',
        value: {
          page: dropoffRate,
        },
      },
    ],
  };
}

async function convertToOpportunityData(opportunityType, metricObject, context) {
  const {
    url, pageViews, formViews,
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
  }

  const screenshot = await getPresignedUrl('screenshot-desktop-fullpage.png', context, url, site);
  opportunityData = {
    ...opportunityData,
    form: url,
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
  opportunityTypes = [FORM_OPPORTUNITY_TYPES.LOW_CONVERSION, FORM_OPPORTUNITY_TYPES.LOW_NAVIGATION],
) {
  const formVitalsCollection = formVitals.filter(
    (row) => row.formengagement && row.formsubmit && row.formview,
  );
  return Promise.all(
    Object.entries({
      [FORM_OPPORTUNITY_TYPES.LOW_CONVERSION]: getHighFormViewsLowConversionMetrics,
      [FORM_OPPORTUNITY_TYPES.LOW_NAVIGATION]: getHighPageViewsLowFormCtrMetrics,
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
 * @returns {*}
 */
export function filterForms(formOpportunities, scrapedData, log) {
  return formOpportunities.filter((opportunity) => {
    let urlMatches = false;
    if (opportunity.form.includes('search')) {
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
