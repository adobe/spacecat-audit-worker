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

const MAX_PAGES_TO_AUDIT = 3;
const INTERVAL_DAYS = 7;
const UNCATEGORIZED = 'uncategorized';
const TRAFFIC_TYPE = 'paid';
const MIN_DAILY_PAGE_VIEWS = 500;

const ALLOWED_SEGMENTS = ['url', 'pageType', 'urlTrafficSource', 'pageTypeTrafficSource'];
const SITE_CLASSIFIER = {};

const AUDIT_CONSTANTS = {
  GUIDANCE_TYPE: 'guidance:paid-cookie-consent',
  OBSERVATION: 'Landing page should not have a blocking cookie concent banner',
};

const isAllowedSegment = (segment) => ALLOWED_SEGMENTS.includes(segment.key);
const filterAndSortByPageViews = ({ key, value }) => {
  const minViews = INTERVAL_DAYS * MIN_DAILY_PAGE_VIEWS;

  return {
    key,
    value: value
      .filter((item) => item.pageViews >= minViews)
      .sort((a, b) => b.pageViews - a.pageViews),
  };
};

const removeUncategorizedPages = (segment) => {
  const categorized = segment.value.filter((valueItem) => valueItem.type !== UNCATEGORIZED);
  return {
    key: segment.key,
    value: categorized,
  };
};

const hasValues = (segment) => segment?.value?.length > 0;

function fetchPageTypeClassifier(site, log) {
  const siteId = site.getId();
  log.info(`[paid-audit] [Site: ${siteId}] Fetching page type classifier`);

  let classifier = SITE_CLASSIFIER[siteId];
  if (!classifier) {
    const config = site.getConfig()?.getGroupedURLs(TRAFFIC_TYPE);
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

const sortAndfilterByUrlPageViews = (segment, rankingMap) => {
  const { key, value } = segment;
  if (key === 'url') return segment;

  const valueWithSortedUrls = value.map((entry) => {
    const { urls } = entry;

    const sortedUrls = [...urls]
      .sort((a, b) => rankingMap.get(b) - rankingMap.get(a))
      .slice(0, 10);

    return {
      ...entry,
      urls: sortedUrls,
    };
  });

  return {
    key,
    value: valueWithSortedUrls,
  };
};

function getRankingMap(allSegments) {
  const urlSegment = allSegments.find((item) => item.key === 'url');
  return new Map(
    urlSegment.value.map(({ url, pageViews }) => [url, pageViews]),
  );
}

function renameUrlsToTopURLs(segments) {
  return segments.map((segment) => ({
    ...segment,
    value: segment.value.map((item) => {
      const { urls, ...rest } = item;
      return { ...rest, topURLs: urls };
    }),
  }));
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
  const { log } = context;
  const rumAPIClient = RUMAPIClient.createFrom(context, auditUrl, site);
  const classifier = fetchPageTypeClassifier(site, log);

  const hasClassifier = isNonEmptyObject(classifier);
  const options = {
    domain: auditUrl,
    interval: INTERVAL_DAYS,
    granularity: 'hourly',
    pageTypes: classifier,
    trafficType: TRAFFIC_TYPE,
  };

  log.info(`[paid-audit] [Site: ${auditUrl}] Querying paid Optel metrics (hasPageClassifier: ${hasClassifier}, trafficType: ${options.trafficType})`);
  const allSegments = await rumAPIClient.query('trafficMetrics', options);
  const segmentsFiltered = allSegments.filter(isAllowedSegment);

  log.info(`[paid-audit] [Site: ${auditUrl}] Processing ${segmentsFiltered?.length} segments`);
  const filteredAndSorted = segmentsFiltered
    .filter(hasValues)
    .map(removeUncategorizedPages)
    .map(filterAndSortByPageViews);

  let segmentsSortedByViews = filteredAndSorted;
  if (filteredAndSorted.some(hasValues)) {
    // Only create rankingMap if there are segments with values
    const rankingMap = getRankingMap(allSegments);
    segmentsSortedByViews = filteredAndSorted
      .map((segment) => sortAndfilterByUrlPageViews(segment, rankingMap));
  }

  const auditResult = renameUrlsToTopURLs(segmentsSortedByViews);
  return {
    auditResult,
    fullAuditRef: auditUrl,
  };
}

function selectPagesForConsentBannerAudit(auditResult, auditUrl) {
  if (!auditResult || !Array.isArray(auditResult) || auditResult === 0) {
    throw new Error(`Failed to find valid page for consent banner audit for AuditUrl ${auditUrl}`);
  }

  const urlSegment = auditResult
    .find((item) => item.key === 'url');
  const urls = urlSegment?.value.flatMap((item) => item.topURLs);

  return urls.slice(0, MAX_PAGES_TO_AUDIT);
}

export async function paidConsentBannerCheck(auditUrl, auditData, context, site) {
  const {
    log, sqs, env,
  } = context;

  const { auditResult, id } = auditData;
  const pagesToAudit = selectPagesForConsentBannerAudit(auditResult, auditUrl);

  // Logic for which url to pick will be improved
  const selectedPage = pagesToAudit[0];

  const mystiqueMessage = buildMystiqueMessage(site, id, selectedPage);

  log.info(`[paid-audit] [Site: ${auditUrl}] Sending page ${selectedPage} evaluation to mystique`);
  await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, mystiqueMessage);
  log.info(`[paid-audit] [Site: ${auditUrl}] Completed mystique evaluation step`);
}

export default new AuditBuilder()
  .withUrlResolver(wwwUrlResolver)
  .withRunner(paidAuditRunner)
  .withPostProcessors([paidConsentBannerCheck])
  .build();
