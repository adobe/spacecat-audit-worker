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

const AUDIT_CONSTANTS = {
  GUIDANCE_TYPE: 'guidance:paid-cookie-consent',
  OBSERVATION: 'Landing page should not have a blocking cookie concent banner',
};

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

const filterByMaxUrls = (segment) => {
  const { key, value } = segment;

  if (!value[0]?.urls) {
    return segment;
  }

  const maxValue = value.map((valueItem) => {
    if (valueItem.urls.length <= MAX_SEGMENT_SIZE) {
      return valueItem;
    }

    const maxUrls = valueItem.urls.slice(0, MAX_SEGMENT_SIZE);
    return {
      ...valueItem,
      urls: maxUrls,
    };
  });

  return {
    key,
    value: maxValue,
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

function fetchPageTypeClassifier(site, log) {
  const siteId = site.getId();
  log.info(`[paid-audit] [Site: ${siteId}] Fetching page type classifier`);

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

function getUniqueUrls(segments) {
  const urlSegment = segments.find((s) => s.key === 'url');
  const pageTypeSegment = segments.find((s) => s.key === 'pageType');

  const urlsFromUrlSegment = (urlSegment?.value ?? [])
    .map((entry) => entry.url)
    .filter(Boolean);

  const urlsFromPageType = (pageTypeSegment?.value ?? [])
    .flatMap((entry) => (entry.urls ?? []))
    .map((urlObj) => urlObj.url)
    .filter(Boolean);

  return {
    segments,
    urls: [...new Set([...urlsFromUrlSegment, ...urlsFromPageType])],
  };
}

function tryEnrich(segments, classifier, auditUrl, log) {
  if (isNonEmptyObject(classifier)) {
    return enrichPageTypes(segments, classifier);
  }
  log.warn(`[paid-audit] [Site: ${auditUrl}] Page type configuration missing, proceeding without enrichment`);
  return segments;
}

function buildMystiqueMessage(site, auditId, url) {
  return {
    type: AUDIT_CONSTANTS.GUIDANCE_TYPE,
    observation: AUDIT_CONSTANTS.OBSERVATION,
    siteId: site.getId(),
    url,
    auditId,
    deliveryType: site.getDeliveryType(),
    time: new Date().toISOString(),
    data: {
      url,
    },
  };
}

export async function paidAuditRunner(auditUrl, context, site) {
  const {
    log,
  } = context;
  const rumAPIClient = RUMAPIClient.createFrom(context, auditUrl, site);
  const classifier = fetchPageTypeClassifier(site, log);

  const hasClassifier = isNonEmptyObject(classifier);
  const options = {
    domain: auditUrl,
    interval: INTERVAL_DAYS,
    granularity: 'hourly',
    pageTypes: classifier,
  };

  log.info(`[paid-audit] [Site: ${auditUrl}] Querying paid Optel metrics (hasPageClassifier: ${hasClassifier})`);
  const allSegments = await rumAPIClient.query('trafficMetrics', options);
  const segmentsFiltered = allSegments.filter(isAllowedSegment);

  const enrichedResult = tryEnrich(segmentsFiltered, classifier, auditUrl, log);

  log.info(`[paid-audit] [Site: ${auditUrl}] Processing ${enrichedResult?.length} segments`);
  const segment = enrichedResult
    .filter(hasValues)
    .map(removeUncategorizedPages)
    .map(filterByTopSessionViews)
    .map(filterByMaxUrls);

  const auditResult = getUniqueUrls(segment);

  return {
    auditResult,
    fullAuditRef: auditUrl,
  };
}

export async function paidConsentBannerCheck(auditUrl, auditData, context, site) {
  const {
    log, sqs, env,
  } = context;

  const { auditResult } = auditData;
  if (!auditResult?.urls || !Array.isArray(auditResult.urls) || auditResult.urls.length === 0) {
    throw new Error(`Failed to send page to mystique auditUrl ${auditUrl}`);
  }

  // Logic for which url to pick will be improved
  const selectedPage = auditResult.urls[0];

  const mystiqueMessage = buildMystiqueMessage(site, auditResult.auditId, selectedPage);

  log.info(`[paid-audit] [Site: ${auditUrl}] Sending page ${selectedPage} evaluation to mystique`);
  await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, mystiqueMessage);
  log.info(`[paid-audit] [Site: ${auditUrl}] Completed mystique evaluation step`);
}

export default new AuditBuilder()
  .withUrlResolver(wwwUrlResolver)
  .withRunner(paidAuditRunner)
  .withPostProcessors([paidConsentBannerCheck])
  .build();
