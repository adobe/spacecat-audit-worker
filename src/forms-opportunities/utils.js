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
  getHighPageViewsLowFormCtrMetrics,
} from '@adobe/spacecat-shared-utils';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const EXPIRY_IN_SECONDS = 25 * 60;
const DAILY_PAGEVIEW_THRESHOLD = 200;
const CR_THRESHOLD_RATIO = 0.3;
const MOBILE = 'mobile';
const DESKTOP = 'desktop';

function hasHighPageViews(interval, pageViews) {
  return pageViews > DAILY_PAGEVIEW_THRESHOLD * interval;
}

function hasLowerConversionRate(formSubmit, formViews) {
  return formSubmit / formViews < CR_THRESHOLD_RATIO;
}

function getHighFormViewsLowConversion(interval, resultMap) {
  const urls = [];
  resultMap.forEach((metrics, url) => {
    const pageViews = metrics.pageview.total;
    // Default to pageViews if formViews are not available
    const formViews = metrics.formview.total || pageViews;
    const formEngagement = metrics.formengagement.total;
    const formSubmit = metrics.formsubmit.total || formEngagement;

    if (hasHighPageViews(interval, pageViews) && hasLowerConversionRate(formSubmit, formViews)) {
      urls.push({
        url,
        pageViews,
        formViews,
        formEngagement,
        formSubmit,
      });
    }
  });
  return urls;
}

function aggregateFormVitalsByDevice(formVitalsCollection) {
  const resultMap = new Map();

  formVitalsCollection.forEach((item) => {
    const {
      url, formview = {}, formengagement = {}, pageview = {}, formsubmit = {},
    } = item;

    const totals = {
      formview: { total: 0, desktop: 0, mobile: 0 },
      formengagement: { total: 0, desktop: 0, mobile: 0 },
      pageview: { total: 0, desktop: 0, mobile: 0 },
      formsubmit: { total: 0, desktop: 0, mobile: 0 },
    };

    const calculateSums = (metric, initialTarget) => {
      const updatedTarget = { ...initialTarget }; // Create a new object to store the updated totals
      Object.entries(metric).forEach(([key, value]) => {
        updatedTarget.total += value;
        if (key.startsWith(DESKTOP)) {
          updatedTarget.desktop += value;
        } else if (key.startsWith(MOBILE)) {
          updatedTarget.mobile += value;
        }
      });
      return updatedTarget; // Return the updated target
    };

    totals.formview = calculateSums(formview, totals.formview);
    totals.formengagement = calculateSums(formengagement, totals.formengagement);
    totals.pageview = calculateSums(pageview, totals.pageview);
    totals.formsubmit = calculateSums(formsubmit, totals.formsubmit);

    resultMap.set(url, totals);
  });

  return resultMap;
}

// async function getPresignedUrl(context, screenshotPath) {
//   const { log, s3Client: s3ClientObj } = context;
//   try {
//     log.info(`Generating presigned URL for ${screenshotPath}`);
//     const command = new GetObjectCommand({
//       Bucket: process.env.S3_BUCKET_NAME,
//       Key: screenshotPath,
//     });
//     const signedUrl = await getSignedUrl(s3ClientObj, command, {
//       expiresIn: EXPIRY_IN_SECONDS,
//     });
//     return signedUrl;
//   } catch (error) {
//     log.error(`Error generating presigned URL for ${screenshotPath}:`, error);
//     return '';
//   }
// }

function convertToOpportunityData(opportunityName, urlObject, scrapedData, context) {
  const {
    url, pageViews, formViews, formSubmit, CTA,
  } = urlObject;
  const {
    log, s3Client: s3ClientObj,
  } = context;

  let conversionRate = formSubmit / formViews;
  conversionRate = Number.isNaN(conversionRate) ? null : conversionRate;

  // Find matching entry in scrapedData
  let screenshots = '';
  let s3Key = '';
  log.info(`debug log scraped data ${JSON.stringify(scrapedData, null, 2)}`);
  if (scrapedData) {
    const matchedData = scrapedData.formData.find((data) => data.finalUrl === url);
    screenshots = matchedData ? matchedData.screenshots || '' : '';
    s3Key = matchedData ? matchedData.s3Key || '' : '';
    if (s3Key.endsWith('scrape.json')) {
      s3Key = s3Key.replace(/scrape\.json$/, '');
    }
  }
  log.info(`debug log screenshots ${JSON.stringify(screenshots, null, 2)}`);
  log.info(`debug log s3Key ${s3Key}`);

  // Create presigned URL promises for each screenshot
  const screenshotPromises = screenshots.map((screenshot) => {
    const screenshotPath = `${s3Key}${screenshot.fileName}`;
    log.info(`debug log screenshot path ${screenshotPath}`);
    const command = new GetObjectCommand({
      Bucket: process.env.S3_BUCKET_NAME,
      Key: screenshotPath,
    });

    return getSignedUrl(s3ClientObj, command, { expiresIn: EXPIRY_IN_SECONDS })
      .then((presignedurl) => ({
        ...screenshot,
        presignedurl,
      }))
      .catch((error) => {
        log.error(`Error generating presigned URL for ${screenshot.fileName}: ${error.message}`);
        return {
          ...screenshot,
          presignedurl: '',
        };
      });
  });

  // Ensure all presigned URLs are generated before proceeding
  Promise.all(screenshotPromises)
    .then((resolvedScreenshots) => {
      // Handle resolved screenshots here
      log.info('Presigned URLs generated successfully', resolvedScreenshots);
    })
    .catch((error) => {
      log.error('Error generating presigned URLs:', error);
    });

  // eslint-disable-next-line max-len
  // const screenshoturl = 'scrapes/5a377a31-b6c3-411c-8b00-62d7e1b116ac/account/forms/screenshot-iphone-6-fullpage.png';
  //
  // let presignedurl;
  //
  // // Generate presigned URL synchronously
  // // let presignedurl = '';
  // try {
  //   const command = new GetObjectCommand({
  //     Bucket: process.env.S3_BUCKET_NAME,
  //     Key: screenshoturl,
  //   });
  //
  //   // Use getSignedUrl synchronously
  //   // presignedurl = getSignedUrl(s3ClientObj, command, {
  //   //   expiresIn: EXPIRY_IN_SECONDS,
  //   // });
  //
  //   // Call getSignedUrl and wait for it to resolve
  //   log.info(`s3 object:  ${JSON.stringify(s3ClientObj, null, 2)}`);
  //   getSignedUrl(s3ClientObj, command, { expiresIn: EXPIRY_IN_SECONDS })
  //     .then((url1) => {
  //       log.info(`Generated presigned URL: ${url1}`);
  //       presignedurl = url1; // Assign the resolved URL
  //       log.info(`Generated presigned URL 1: ${presignedurl}`); // Log the actual URL her
  //       return url1;
  //     })
  //     .catch((error) => {
  //       log.error(`Error generating presigned URL: ${error.message}`);
  //       return '';
  //     });
  //
  //   log.info(`Generated presigned URL for ${screenshoturl}`);
  // } catch (error) {
  //   log.error(`Error generating presigned URL: ${error.message}`);
  //   presignedurl = '';
  // }

  // log.info(`debug log screenshots presigned url: ${presignedurl}`);

  const opportunity = {
    form: url,
    screenshot: screenshots,
    trackedFormKPIName: 'Conversion Rate',
    trackedFormKPIValue: conversionRate,
    formViews,
    pageViews,
    samples: pageViews, // todo: get the actual number of samples
    metrics: [{
      type: 'conversionRate',
      vendor: '*',
      value: {
        page: conversionRate,
      },
    }],
    ...(opportunityName === 'high-page-views-low-form-nav' && { formNavigation: CTA }),
  };
  return opportunity;
}

export function generateOpptyData(formVitals, scrapedData, context) {
  const formVitalsCollection = formVitals.filter(
    (row) => row.formengagement && row.formsubmit && row.formview,
  );

  const formVitalsByDevice = aggregateFormVitalsByDevice(formVitalsCollection);
  return getHighFormViewsLowConversion(7, formVitalsByDevice).map((highFormViewsLowConversion) => convertToOpportunityData('high-page-views-low-conversion', highFormViewsLowConversion, scrapedData, context));
}

export function generateOpptyDataForHighPageViewsLowFormNav(formVitals, scrapedData, context) {
  const formVitalsCollection = formVitals.filter(
    (row) => row.formengagement && row.formsubmit && row.formview,
  );

  return getHighPageViewsLowFormCtrMetrics(formVitalsCollection, 7).map((highPageViewsLowFormCtr) => convertToOpportunityData('high-page-views-low-form-nav', highPageViewsLowFormCtr, scrapedData, context));
}

/**
 * filter login and search forms from the opportunities
 * @param formOpportunities
 * @param scrapedData
 * @param log
 * @returns {*}
 */
export function filterForms(formOpportunities, scrapedData, log) {
  if (!scrapedData?.formData || !Array.isArray(scrapedData.formData)) {
    log.debug('No valid scraped data available.');
    return formOpportunities; // Return original opportunities if no valid scraped data
  }

  return formOpportunities.filter((opportunity) => {
    // Find matching form in scraped data
    const matchingForm = scrapedData.formData.find((form) => {
      const urlMatches = form.finalUrl === opportunity?.form;
      const isSearchForm = Array.isArray(form.scrapeResult)
          && form.scrapeResult.some((result) => result?.formType === 'search' || result?.classList?.includes('search') || result?.classList?.includes('unsubscribe') || result?.action?.endsWith('search.html'));

      return urlMatches && isSearchForm;
    });

    if (matchingForm) {
      log.debug(`Filtered out search form: ${opportunity?.form}`);
      return false;
    }

    return true;
  });
}
