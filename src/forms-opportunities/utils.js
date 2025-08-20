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
  FORMS_AUDIT_INTERVAL,
  isNonEmptyArray,
} from '@adobe/spacecat-shared-utils';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  getHighPageViewsLowFormCtrMetrics, getHighFormViewsLowConversionMetrics,
  getHighPageViewsLowFormViewsMetrics,
} from './formcalc.js';
import { FORM_OPPORTUNITY_TYPES, successCriteriaLinks } from './constants.js';
import { calculateCPCValue } from '../support/utils.js';

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

function calculateRate(numerator, denominator) {
  if (denominator === 0 || Number.isNaN(numerator) || Number.isNaN(denominator)) {
    return null; // Return null if the calculation is invalid
  }
  return Number((numerator / denominator).toFixed(3));
}

function getFormMetrics(metricObject) {
  const { formview, formengagement, formsubmit } = metricObject;

  const calculateMetrics = (_formSubmit, _formViews, _formEngagement) => {
    let bounceRate = 1;
    let conversionRate = 0;
    // if engagement is zero, it means bounce rate is 1, then dropoffRate does not makes sense
    let dropoffRate = null;

    if (_formViews > 0) {
      conversionRate = calculateRate(_formSubmit, _formViews);
      bounceRate = 1 - calculateRate(_formEngagement, _formViews);
    }
    if (_formEngagement > 0) {
      dropoffRate = 1 - calculateRate(_formSubmit, _formEngagement);
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
    pageview: { total: pageViews, mobile: pageViewsMobile, desktop: pageViewsDesktop },
    // trafficacquisition,
  } = metricObject;
  return {
    trackedFormKPIName: 'Form View Rate',
    trackedFormKPIValue: calculateRate(formViews, pageViews),
    metrics: [
      {
        type: 'formViewRate',
        device: '*',
        value: {
          page: calculateRate(formViews, pageViews),
        },
      },
      {
        type: 'formViewRate',
        device: 'mobile',
        value: {
          page: calculateRate(formViewsMobile, pageViewsMobile),
        },
      },
      {
        type: 'formViewRate',
        device: 'desktop',
        value: {
          page: calculateRate(formViewsDesktop, pageViewsDesktop),
        },
      },
      {
        type: 'traffic',
        device: 'desktop',
        value: {
          page: pageViewsDesktop,
        },
      },
      {
        type: 'traffic',
        device: 'mobile',
        value: {
          page: pageViewsMobile,
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
  const {
    pageview: { mobile: pageViewsMobile, desktop: pageViewsDesktop },
    trafficacquisition: { sources: trafficAcquisitionSources },
  } = metricObject;

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
      { type: 'formBounceRate', value: bounceRate },
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
    device: 'desktop',
    value: {
      page: pageViewsDesktop,
    },
  });

  metrics.push({
    type: 'traffic',
    device: 'mobile',
    value: {
      page: pageViewsMobile,
    },
  });

  if (Array.isArray(trafficAcquisitionSources) && trafficAcquisitionSources.length > 0) {
    metrics.push({
      type: 'trafficAcquisitionSource',
      device: '*',
      value: {
        page: trafficAcquisitionSources,
      },
    });
  }

  return {
    trackedFormKPIName: 'Conversion Rate',
    trackedFormKPIValue: totalConversionRate,
    metrics,
  };
}

async function convertToOpportunityData(opportunityType, metricObject, context) {
  const {
    url, pageview: { total: pageViews }, formview: { total: formViews },
    formsource = '', iframeSrc,
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

  if (iframeSrc) {
    opportunityData.iframeSrc = iframeSrc;
  }

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
  const containsOnlyNumericInputField = scrapedFormData?.formFields?.filter((field) => field.tagName === 'input').length === 1
      && scrapedFormData?.formFields?.some((field) => field.tagName === 'input' && field.inputmode === 'numeric');

  const containsNoInputField = scrapedFormData?.formFields?.filter((field) => field.tagName === 'input').length === 0;

  const doesNotHaveButton = scrapedFormData?.formFields?.filter((field) => field.tagName === 'button').length === 0;

  return scrapedFormData?.formType === 'search'
    || scrapedFormData?.formType === 'login'
    || scrapedFormData?.classList?.includes('unsubscribe')
    || scrapedFormData?.fieldCount === 0
    || containsOnlyNumericInputField
    || containsNoInputField
    || doesNotHaveButton;
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

/**
 * Get the urls and form sources for accessibility audit
 * @param scrapedData
 * @param formVitals
 * @param context
 * @returns {Array} array of objects with url and formsources
 */
export function getUrlsDataForAccessibilityAudit(scrapedData, formVitals, context) {
  const { log } = context;
  const urlsData = [];
  const addedFormSources = new Set();
  if (isNonEmptyArray(scrapedData.formData)) {
    const formUrlPageViewsMap = new Map();
    for (const fv of formVitals) {
      const totalPageViews = Object.values(fv.pageview).reduce((acc, curr) => acc + curr, 0);
      const existingPageViews = formUrlPageViewsMap.get(fv.url) || 0;
      if (totalPageViews >= existingPageViews) {
        formUrlPageViewsMap.set(fv.url, totalPageViews);
      }
    }
    const formScrapedData = [...scrapedData.formData];
    formScrapedData.sort((a, b) => {
      const aPageViews = formUrlPageViewsMap.get(a.finalUrl);
      const bPageViews = formUrlPageViewsMap.get(b.finalUrl);
      return bPageViews - aPageViews;
    });
    // sort the form in scraped data based on the page views in the form vitals
    for (const form of formScrapedData) {
      const formSources = [];
      const scrapeResultArray = Array.isArray(form.scrapeResult) ? form.scrapeResult : [];
      const validForms = scrapeResultArray.filter((sr) => !shouldExcludeForm(sr));
      if (form.finalUrl.includes('search') || validForms.length === 0) {
        // eslint-disable-next-line no-continue
        continue;
      }
      // 1. get formSources from scraped data if available
      let isFormSourceAlreadyAdded = false;
      validForms.forEach((sr) => {
        if (!sr.formSource) {
          return;
        }
        if (!addedFormSources.has(sr.formSource)) {
          formSources.push(sr.formSource);
          if (!['dialog form', 'form'].includes(sr.formSource)) {
            addedFormSources.add(sr.formSource);
          }
        } else {
          isFormSourceAlreadyAdded = true;
        }
      });
      // eslint-disable-next-line max-len
      // 2. If no unique formSource found in current page, then use id or classList to identify the form
      if (formSources.length === 0) {
        log.debug(`[Form Opportunity] No formSource found in scraped data for form: ${form.finalUrl}`);
        validForms.forEach((sr) => {
          if (sr.formSource) {
            return;
          }
          if (sr.id) {
            if (!addedFormSources.has(`form#${sr.id}`)) {
              formSources.push(`form#${sr.id}`);
              addedFormSources.add(`form#${sr.id}`);
            } else {
              isFormSourceAlreadyAdded = true;
            }
          } else if (sr.classList) {
            formSources.push(`form.${sr.classList.split(' ').join('.')}`);
          }
        });
      }
      // 3. Fallback to "form" element. If any formSource of current page is already added
      // in previous pages, then don't add "form" element.
      if (!isFormSourceAlreadyAdded && formSources.length === 0) {
        formSources.push('form');
      }
      log.debug(`[Form Opportunity] Form sources for page: ${form.finalUrl} are ${formSources.join(', ')}`);
      if (formSources.length > 0) {
        urlsData.push({
          url: form.finalUrl,
          formSources,
        });
      }
    }
  }
  return urlsData;
}

export function getSuccessCriteriaDetails(criteria) {
  let cNumber;

  if (criteria.match(/\b\d+\.\d+\.\d+\b/)) {
    // Format: "1.2.1 Audio-only and Video-only"
    cNumber = criteria.match(/\b\d+\.\d+\.\d+\b/)[0].replaceAll('.', '');
  } else if (criteria.match(/^wcag\d+$/i)) {
    // Format: "wcag121"
    cNumber = criteria.replace(/^wcag/i, '');
  } else {
    throw new Error(`Invalid criteria format: ${criteria}`);
  }

  const successCriteriaDetails = successCriteriaLinks[cNumber];
  const successCriteriaNumber = cNumber.replace(/(\d)(\d)(\d)/, '$1.$2.$3');

  return {
    name: successCriteriaDetails.name,
    criteriaNumber: successCriteriaNumber,
    understandingUrl: successCriteriaDetails.understandingUrl,
  };
}

// eslint-disable-next-line no-shadow
function getCostSaved(originalTraffic, cpc) {
  const costSaved = 0.2 * originalTraffic * cpc;
  return parseFloat(costSaved.toFixed(2));
}

/**
 * Calculates the projected conversion value for a form based on its views and CPC
 * @param {Object} context - The context object containing necessary dependencies
 * @param {string} siteId - The site ID
 * @param {Object} formMetrics - The form metrics object containing traffic data
 * @returns {Promise<Object>} Object containing cpcValue and projectedConversionValue
 */
export async function calculateProjectedConversionValue(context, siteId, opportunityData) {
  const { log } = context;

  try {
    const cpcValue = await calculateCPCValue(context, siteId);
    log.info(`Calculated CPC value: ${cpcValue} for site: ${siteId}`);

    const originalTraffic = opportunityData.pageViews;
    // traffic is calculated for 15 days - extrapolating for a year
    const trafficPerYear = Math.floor((originalTraffic / FORMS_AUDIT_INTERVAL)) * 365;
    const projectedConversionValue = getCostSaved(
      trafficPerYear,
      cpcValue,
    );

    return {
      projectedConversionValue,
    };
  } catch (error) {
    log.error(`Error calculating projected conversion value for site ${siteId}:`, error);
    return null;
  }
}

export async function sendMessageToFormsQualityAgent(auditDataObject, context, opportunityData) {
  const auditData = JSON.parse(JSON.stringify(auditDataObject));
  const {
    log, sqs, site, env,
  } = context;
  const mystiqueFormsQualityAgentMessage = {
    type: 'detect:form-details',
    siteId: auditData.siteId,
    auditId: auditData.auditId,
    deliveryType: site.getDeliveryType(),
    time: new Date().toISOString(),
    data: {
      url: opportunityData.data.form,
      form_source: opportunityData.data.formsource,
    },
  };

  // eslint-disable-next-line no-await-in-loop
  await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, mystiqueFormsQualityAgentMessage);
  log.info(`forms quality agent message sent to mystique : ${JSON.stringify(mystiqueFormsQualityAgentMessage)}`);
}
