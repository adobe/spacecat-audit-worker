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

export const FORMS_AUDIT_INTERVAL = 15;
const DAILY_PAGEVIEW_THRESHOLD = 200;
const CR_THRESHOLD_RATIO = 0.3;
const MOBILE = 'mobile';
const DESKTOP = 'desktop';

/**
 * Aggregates the form vitals by device type.
 *
 * @param {*} formVitalsCollection - form vitals collection
 * @returns {object} - aggregated form vitals by device type
 */
function aggregateFormVitalsByDevice(formVitalsCollection) {
  const resultMap = new Map();

  formVitalsCollection.forEach((item) => {
    const {
      url, formview = {}, formengagement = {}, pageview = {}, formsubmit = {},
      trafficacquisition = {},
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
    totals.trafficacquisition = trafficacquisition;
    resultMap.set(url, totals);
  });

  return resultMap;
}

function hasHighPageViews(pageViews) {
  return pageViews > DAILY_PAGEVIEW_THRESHOLD * FORMS_AUDIT_INTERVAL;
}

function hasLowerConversionRate(formSubmit, formViews) {
  return formSubmit / formViews < CR_THRESHOLD_RATIO;
}

function hasLowFormViews(pageViews, formViews) {
  return formViews > 0 && (formViews / pageViews) < 0.7;
}

function hasHighPageViewLowFormCtr(ctaPageViews, ctaClicks, ctaPageTotalClicks, formPageViews) {
  return ctaPageTotalClicks > 0
      && (ctaClicks / ctaPageTotalClicks) < 0.4
      && (formPageViews / ctaPageViews) < 0.1;
}

/**
 * Returns the form urls with high form views and low conversion rate
 *
 * @param {*} formVitalsCollection - form vitals collection
 * @returns {Array} - urls with high form views and low conversion rate
 */
export function getHighFormViewsLowConversionMetrics(formVitalsCollection) {
  const resultMap = aggregateFormVitalsByDevice(formVitalsCollection);
  const urls = [];
  resultMap.forEach((metrics, url) => {
    const pageViews = metrics.pageview.total;
    const formViews = metrics.formview.total;
    const formSubmit = metrics.formsubmit.total;

    if (hasHighPageViews(pageViews) && hasLowerConversionRate(formSubmit, formViews)) {
      urls.push({
        url,
        ...metrics,
      });
    }
  });
  return urls;
}

/**
 * Returns the form urls with high page views and low form views
 *
 * @param resultMap
 * @returns {*[]}
 */
export function getHighPageViewsLowFormViewsMetrics(formVitalsCollection) {
  const urls = [];
  const resultMap = aggregateFormVitalsByDevice(formVitalsCollection);
  resultMap.forEach((metrics, url) => {
    const { total: pageViews } = metrics.pageview;
    const { total: formViews } = metrics.formview;
    const { total: formEngagement } = metrics.formengagement;

    if (hasHighPageViews(pageViews) && hasLowFormViews(pageViews, formViews)) {
      urls.push({
        url,
        pageViews,
        formViews,
        formEngagement,
      });
    }
  });
  return urls;
}

/**
 * Returns the form urls with high page views containing ctr and low form views
 * @param formVitalsCollection
 * @param formVitalsByDevice
 * @returns {*[]}
 */
export function getHighPageViewsLowFormCtrMetrics(formVitalsCollection) {
  const urls = [];
  const formVitalsByDevice = aggregateFormVitalsByDevice(formVitalsCollection);
  formVitalsCollection.forEach((entry) => {
    const { forminternalnavigation, pageview } = entry;
    // Calculate `x`: sum of pageview for the URL with the highest sum
    let x = 0;
    let maxPageviewUrl = null;
    if (forminternalnavigation) {
      forminternalnavigation.forEach((nav) => {
        if (nav.pageview) {
          const pageviewSum = Object.values(nav.pageview).reduce((sum, val) => sum + val, 0);
          if (pageviewSum > x) {
            x = pageviewSum;
            maxPageviewUrl = nav;
          }
        }
      });
    }

    // Skip entry if no valid maxPageviewUrl is found
    if (!maxPageviewUrl) return;

    // Calculate `y`: find the CTA with the highest clicks and include the source
    const y = maxPageviewUrl.CTAs.reduce((maxCta, cta) => {
      if (cta.clicks > (maxCta.clicks || 0)) {
        return cta;
      }
      return maxCta;
    }, { clicks: 0, source: '' });

    // Get `z`: totalClicksOnPage for the matched URL
    const z = maxPageviewUrl.totalClicksOnPage || 0;
    // Calculate `f`: sum of `pageview` for `formengagement`
    const f = Object.values(pageview).reduce((sum, val) => sum + val, 0);

    // Evaluate conditions and add URL to the result if all are met
    if (hasHighPageViews(x) && hasHighPageViewLowFormCtr(x, y.clicks, z, f)) {
      const deviceData = formVitalsByDevice.get(entry.url);
      if (deviceData != null) {
        urls.push({
          url: entry.url,
          ...deviceData,
          CTA: {
            url: maxPageviewUrl.url,
            source: y.source,
          },
        });
      }
    }
  });
  return urls;
}
