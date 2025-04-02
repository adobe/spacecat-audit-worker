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

async function convertToOpportunityData(opportunityName, urlObject, context) {
  const {
    url, pageViews, formViews, formSubmit, CTA,
  } = urlObject;

  const {
    site,
  } = context;

  let conversionRate = formSubmit / formViews;
  conversionRate = Number.isNaN(conversionRate) ? null : conversionRate;
  const signedScreenshot = await getPresignedUrl('screenshot-desktop-fullpage.png', context, url, site);

  const opportunity = {
    form: url,
    screenshot: signedScreenshot,
    trackedFormKPIName: 'Conversion Rate',
    trackedFormKPIValue: conversionRate,
    formViews,
    pageViews,
    samples: pageViews, // todo: get the actual number of samples
    metrics: [{
      type: 'conversionRate',
      device: '*',
      value: {
        page: conversionRate,
      },
    }],
    ...(opportunityName === 'high-page-views-low-form-nav' && { formNavigation: CTA }),
  };
  return opportunity;
}

export async function generateOpptyData(formVitals, context) {
  const formVitalsCollection = formVitals.filter(
    (row) => row.formengagement && row.formsubmit && row.formview,
  );

  return Promise.all(
    getHighFormViewsLowConversionMetrics(formVitalsCollection)
      .map((highFormViewsLowConversion) => convertToOpportunityData(
        'high-page-views-low-conversion',
        highFormViewsLowConversion,
        context,
      )),
  );
}

// eslint-disable-next-line max-len
export async function generateOpptyDataForHighPageViewsLowFormNav(formVitals, context) {
  const formVitalsCollection = formVitals.filter(
    (row) => row.formengagement && row.formsubmit && row.formview,
  );

  return Promise.all(
    getHighPageViewsLowFormCtrMetrics(formVitalsCollection)
      .map((highPageViewsLowFormCtr) => convertToOpportunityData(
        'high-page-views-low-form-nav',
        highPageViewsLowFormCtr,
        context,
      )),
  );
}

export function shouldExcludeForm(scrapedFormData) {
  return scrapedFormData?.formType === 'search'
    || scrapedFormData?.formType === 'login'
    || scrapedFormData?.classList?.includes('unsubscribe')
    || scrapedFormData?.action?.endsWith('search.html')
    || (scrapedFormData?.fieldsLabels && isNonEmptyArray(scrapedFormData.fieldsLabels) && scrapedFormData.fieldsLabels.every((label) => label.toLowerCase().includes('search')));
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
