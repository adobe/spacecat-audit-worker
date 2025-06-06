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
const INTERVAL_DAYS = 7;
const UNCATEGORIZED = 'uncategorized';

const ALLOWED_SEGMENTS = ['url', 'pageType'];
const SITE_CLASSIFIER = {};
let log;

const isAllowedSegment = (segment) => ALLOWED_SEGMENTS.includes(segment.key);
const filterByTopSessionViews = (segment) => {
  const { key, value } = segment;

  if (value.length <= MAX_SEGMENT_SIZE) {
    return segment;
  }

  const topSessions = [...value]
    .sort((a, b) => b.totalSessions - a.totalSessions)
    .slice(0, MAX_SEGMENT_SIZE);

  return { key, value: topSessions };
};

const removeUncategorizedPages = (segment) => {
  const categorized = segment.value.filter((valueItem) => valueItem.type !== 'uncategorized');
  return {
    key: segment.key,
    value: categorized,
  };
};

const hasValues = (segment) => segment.value?.length > 0;

function classifyUrl(url, classifier) {
  let pageType = UNCATEGORIZED;
  const match = Object
    .entries(classifier)
    .find(([, regEx]) => regEx.test(url));
  if (match) {
    [pageType] = match;
  }

  return pageType;
}

function fetchPageTypeClassifier(site) {
  const siteId = site.getSiteId();
  log.info(`Fetching classifier for site ${siteId}`);

  let classifier = SITE_CLASSIFIER[siteId];
  if (!classifier) {
    const config = site.getConfig()?.getGroupedURLs('paid');
    const pageTypes = config?.map((item) => {
      const page = item.name;
      const patternObj = JSON.parse(item.pattern);
      const pattern = new RegExp(patternObj.pattern, patternObj.flags);
      return {
        [page]: pattern,
      };
    });

    classifier = pageTypes?.reduce((acc, pageType) => ({ ...acc, ...pageType }), {});

    if (classifier) {
      SITE_CLASSIFIER[siteId] = classifier;
    }
  }
  return classifier;
}

function enrichPageTypes(auditResult, classifier) {
  const typeUrlsMap = {};

  let enriched = auditResult.map((segment) => {
    if (segment.key === 'url') {
      const enrichedWithPageTypes = segment.value.map((vEntry) => {
        const { url } = vEntry;
        const pageType = classifyUrl(url, classifier);
        const urls = typeUrlsMap[pageType] ?? [];
        urls.push(url);
        typeUrlsMap[pageType] = urls;
        return {
          ...vEntry,
          pageType,
        };
      });

      return {
        key: segment.key,
        value: enrichedWithPageTypes,
      };
    }

    return segment;
  });

  enriched = enriched.map((segment) => {
    if (segment.key === 'pageType') {
      const enrichedWithUrls = segment.value.map((vEntry) => {
        const { type } = vEntry;
        const urls = typeUrlsMap[type] ?? [];
        return {
          ...vEntry,
          urls,
        };
      });

      return {
        key: segment.key,
        value: enrichedWithUrls,
      };
    }
    return segment;
  });

  return enriched;
}

function tryEnrich(segments, classifier, auditUrl) {
  if (isNonEmptyObject(classifier)) {
    return enrichPageTypes(segments, classifier);
  }
  log.warn(`Page type configuration is missing for site ${auditUrl}. Proceeding with auit without page and url enrichment`);

  return segments;
}

export async function paidAuditRunner(auditUrl, context, site) {
  if (typeof log === 'undefined') {
    log = context.log;
  }

  const rumAPIClient = RUMAPIClient.createFrom(context, auditUrl, site);
  const classifier = fetchPageTypeClassifier(site);

  const hasClassifier = isNonEmptyObject(classifier);
  const options = {
    domain: auditUrl,
    interval: INTERVAL_DAYS,
    granularity: 'hourly',
    pageTypes: classifier,
  };

  log.info(`Querying paid Optel metrics for site ${auditUrl} with hasPageClassifier: ${hasClassifier}`);
  const allSegments = await rumAPIClient.query('trafficMetrics', options);
  const segmentsFiltered = allSegments
    .filter(isAllowedSegment);

  const enrichedResult = tryEnrich(segmentsFiltered, classifier, auditUrl);

  log.info(`Filtering ${enrichedResult?.length} segments by top totalSessions`);
  const auditResult = enrichedResult
    .map(filterByTopSessionViews)
    .map(removeUncategorizedPages)
    .filter(hasValues);

  log.info(`Traffic metric runner has completed  for domain: ${auditUrl} and found segment Count: ${auditResult?.length}`);

  return {
    auditResult,
    fullAuditRef: auditUrl,
  };
}

export default new AuditBuilder()
  .withRunner(paidAuditRunner)
  .withUrlResolver(wwwUrlResolver)
  .build();
