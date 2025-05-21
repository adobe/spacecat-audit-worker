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
import RUMAPIClient from '@adobe/spacecat-shared-rum-api-client';
import { isNonEmptyObject } from '@adobe/spacecat-shared-utils';
import { wwwUrlResolver } from '../common/index.js';
import { AuditBuilder } from '../common/audit-builder.js';

const MAX_SEGMENT_SIZE = 3;
const INTERVAL = 7; // days
const UNCATEGORIZED_PAGE = 'uncategorized';

const pageTypes = {
  'homepage | Homepage': /^\/(home\/?)?$/,
  'homepage | Homepage (Customer Variant)': /^\/homepage(-customer)?(\/|$)/i,
  'productpage | Product/Feature Pages': /^\/(products?|features?|services?)(\/|$)/i,
  'pricingpage | Pricing Pages': /^\/(pricing|plans|compare)(\/|$)/i,
  'customers | Customer Stories/Case Studies': /^\/(customers?|case-studies)(\/|$)/i,
  'landingpage | Signup / Demo / Booking': /^\/(signup|register|demo|booking|free-trial|get-started)(\/|$)/i,
  'blog | Blog Post': /^\/blog\/.+/,
  'blog | Blog Homepage': /^\/blog(\/|$)/,
  'careers | Careers': /^\/(careers?|jobs|work-with-us)(\/|$)/i,
  'resourcepage | Resources': /^\/(resources?|downloads|library|ebooks|whitepapers|guides|templates)(\/|$)/i,
  'webinarpage | Webinars': /^\/(webinars?|events\/webinar)(\/|$)/i,
  'support | Support / Help / FAQ': /^\/(support|help|faq|contact)(\/|$)/i,
  'about | About / Company Info': /^\/(about|company|team|press)(\/|$)/i,
  'legal | Legal / Privacy / Terms': /^\/(privacy|terms|legal|cookies)(\/|$)/i,
  'events | Events': /^\/(events?|conferences?|summits?)(\/|$)/i,
  'integration | Integrations': /^\/(integrations?|apps|connectors)(\/|$)/i,
  'tutorials | Tutorials / How-To': /^\/(tutorials?|how-to|docs|documentation)(\/|$)/i,
  'unsubscribe | Subscription Preferences': /^\/(unsubscribe|preferences)(\/|$)/i,
  'other | Other Pages': /.*/,
};

const allowedSegments = ['url', 'pageType'];

function filterByAllowedSegments(segments, allowed) {
  return segments.filter((segment) => allowed.includes(segment.key));
}

function filterByTopSessionViews(segments) {
  const result = segments
    .map((segment) => {
      const sortedByTotalSession = segment
        .value.sort((a, b) => b.totalSessions - a.totalSessions);
      const top10Sessions = (sortedByTotalSession?.length > MAX_SEGMENT_SIZE)
        ? sortedByTotalSession.slice(0, MAX_SEGMENT_SIZE)
        : sortedByTotalSession;
      return {
        key: segment.key,
        value: top10Sessions,
      };
    });
  return result;
}

function classifyUrl(url, classifier) {
  for (const [category, regEx] of Object.entries(classifier)) {
    const pattern = regEx instanceof RegExp ? regEx : new RegExp(regEx);
    if (pattern.test(url)) {
      return category;
    }
  }
  return UNCATEGORIZED_PAGE;
}

function fetchPageTypeClassifier(log, siteId) {
  log.info(`Fetching classifier for site ${siteId}`);
  return pageTypes;
}

function removeUncategorizedPages(segment) {
  const categorized = segment.value.filter((valueItem) => valueItem.type !== 'uncategorized');
  return {
    key: segment.key,
    value: categorized,
  };
}

function createPageTypeUrls(auditResult) {
  const urlsSegment = auditResult.find((segment) => segment.key === 'url');
  const urls = urlsSegment?.value || [];

  const pageTypeUrls = urls.reduce((acc, entry) => {
    const { pageType, url } = entry;
    if (!pageType) return acc;

    if (!acc[pageType]) acc[pageType] = [];
    acc[pageType].push(url);

    return acc;
  }, {});

  return pageTypeUrls;
}

function enrichPageTypes(auditResult, classifier) {
  const enriched = auditResult?.map((segment) => {
    if (segment.key === 'url') {
      const enrichedValues = segment.value.map((vEntry) => ({
        ...vEntry,
        pageType: classifyUrl(vEntry?.url, classifier),
      }));

      return {
        key: segment.key,
        value: enrichedValues,
      };
    }
    return segment;
  });

  return enriched;
}

function enrichContainedUrls(enrichedPageTypeUrs) {
  const pageUrlDict = createPageTypeUrls(enrichedPageTypeUrs);

  const enriched = enrichedPageTypeUrs?.map((segment) => {
    if (segment.key === 'pageType') {
      const enrichedValue = segment.value.map((pt) => {
        const type = pt?.type;
        const urls = type && pageUrlDict?.[type] ? pageUrlDict?.[type] : [];
        return {
          ...pt,
          urls,
        };
      });

      return {
        key: segment.key,
        value: enrichedValue,
      };
    }
    return segment;
  });

  return enriched;
}

export async function paidAuditRunner(auditUrl, context) {
  const { log } = context;
  const rumAPIClient = RUMAPIClient.createFrom(context);
  const classifier = fetchPageTypeClassifier(log, auditUrl) ?? null;
  const options = {
    domain: auditUrl,
    interval: INTERVAL,
    granularity: 'hourly',
    pageTypes: classifier,
  };

  log.info(`Querying paid Optel metrics for site ${auditUrl} with hasPageClassifier: ${isNonEmptyObject(classifier)}`);
  const allSegments = await rumAPIClient.query('trafficMetrics', options);
  let resultSubset = filterByAllowedSegments(allSegments, allowedSegments);
  if (isNonEmptyObject(classifier)) {
    const enrichedWithPageType = enrichPageTypes(resultSubset, classifier);
    resultSubset = enrichContainedUrls(enrichedWithPageType);
  }

  log.info(`Filtering ${resultSubset?.length} segments by top totalSessions`);
  const top = filterByTopSessionViews(resultSubset);
  const topNoUncategorized = top.map((segment) => removeUncategorizedPages(segment));
  const auditResult = topNoUncategorized.filter((segment) => segment.value?.length > 0);

  log.info(`Traffic metric runner has completed  for domain: ${auditUrl} and found segment Count: ${auditResult?.length}`);

  return {
    auditResult,
    fullAuditRef: auditUrl,
  };
}

export default new AuditBuilder()
  .withRunner(paidAuditRunner)
  .withUrlResolver(wwwUrlResolver)
  .withAsyncJob()
  .build();
