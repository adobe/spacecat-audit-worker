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
import { Audit } from '@adobe/spacecat-shared-data-access';
import { isNonEmptyObject } from '@adobe/spacecat-shared-utils';
import { wwwUrlResolver } from '../common/index.js';
import { AuditBuilder } from '../common/audit-builder.js';
import { generateSignedUrl as getSignedUrl } from '../utils/s3-utils.js';

const { AUDIT_STEP_DESTINATIONS } = Audit;

const MAX_SEGMENT_SIZE = 3;
const INTERVAL_DAYS = 7;
const UNCATEGORIZED = 'uncategorized';

const ALLOWED_SEGMENTS = ['url', 'pageType'];
const SITE_CLASSIFIER = {};

const AUDIT_CONSTANTS = {
  TYPES: {
    BANNER_ON: 'paid-top-segment-scrape-banner-on',
    BANNER_OFF: 'paid-top-segment-scrape-banner-off',
    MYSTIQUE: 'guidance:paid-cookie-consent',
  },
  OBSERVATION: 'Landing page should not have a blocking cookie concent banner',
  STORAGE_PREFIX: {
    BANNER_ON: 'consent-banner-on',
    BANNER_OFF: 'consent-banner-off',
  },
};

const SCREENSHOT_CONF = {
  BANNER_STATES: {
    ON: 'consent-banner-on',
    OFF: 'consent-banner-off',
  },
  TYPES: {
    MOBILE: 'screenshot-iphone-6-viewport.png',
    DESKTOP: 'screenshot-desktop-viewport.png',
  },
  OPTIONS: {
    TYPES: ['viewport'],
  },
};

const normalizeUrl = (url) => {
  const urlObj = new URL(typeof url === 'string' ? url : url.url);
  return `${urlObj.origin}${urlObj.pathname.replace(/\/$/, '')}`;
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

function tryEnrich(segments, classifier, auditUrl, log) {
  if (isNonEmptyObject(classifier)) {
    return enrichPageTypes(segments, classifier);
  }
  log.warn(`[paid-audit] [Site: ${auditUrl}] Page type configuration missing, proceeding without enrichment`);
  return segments;
}

function getUrlKeys(site, urls) {
  const blPath = (basePath, bannerState, type) => `${basePath}/${bannerState}/${type}`;

  return urls.map((item) => {
    const urlPath = new URL(item.url).pathname;
    const suffix = urlPath === '/' ? '' : urlPath;
    const base = `scrapes/${site.getId()}${suffix}`;

    return {
      url: item.url,
      mobile_on: blPath(base, SCREENSHOT_CONF.BANNER_STATES.ON, SCREENSHOT_CONF.TYPES.MOBILE),
      desktop_on: blPath(base, SCREENSHOT_CONF.BANNER_STATES.ON, SCREENSHOT_CONF.TYPES.DESKTOP),
      mobile_off: blPath(base, SCREENSHOT_CONF.BANNER_STATES.OFF, SCREENSHOT_CONF.TYPES.MOBILE),
      desktop_off: blPath(base, SCREENSHOT_CONF.BANNER_STATES.OFF, SCREENSHOT_CONF.TYPES.DESKTOP),
    };
  });
}

async function getSignedUrls(context, keys) {
  const { s3Client, s3Presigner, log } = context;

  const { S3_SCRAPER_BUCKET_NAME: SCRAPER_BUCKET } = context.env;
  return Promise.all(
    keys.map(async (item) => {
      const mOn = await getSignedUrl(s3Presigner, s3Client, SCRAPER_BUCKET, item.mobile_on, log);
      const dOn = await getSignedUrl(s3Presigner, s3Client, SCRAPER_BUCKET, item.desktop_on, log);
      const mOff = await getSignedUrl(s3Presigner, s3Client, SCRAPER_BUCKET, item.mobile_off, log);
      const dOff = await getSignedUrl(s3Presigner, s3Client, SCRAPER_BUCKET, item.desktop_off, log);
      return {
        url: item.url,
        mOn,
        dOn,
        mOff,
        dOff,
      };
    }),
  );
}

async function fetchScrappedUrls(context, site, urls) {
  const keys = getUrlKeys(site, urls);
  const signedUrls = await getSignedUrls(context, keys);
  return signedUrls;
}

function buildMystiqueMessage(site, audit, signedUrls) {
  const { url } = signedUrls;
  return {
    type: AUDIT_CONSTANTS.TYPES.MYSTIQUE,
    observation: AUDIT_CONSTANTS.OBSERVATION,
    siteId: site.getId(),
    url,
    auditId: audit.getAuditId(),
    deliveryType: site.getDeliveryType(),
    time: new Date().toISOString(),
    data: {
      url,
      mobile_path_cookie_banner_on: signedUrls.mOn,
      mobile_path_cookie_banner_off: signedUrls.mOff,
      desktop_path_cookie_banner_on: signedUrls.dOn,
      desktop_path_cookie_banner_off: signedUrls.dOff,
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
  };

  log.info(`[paid-audit] [Site: ${auditUrl}] Querying paid Optel metrics (hasPageClassifier: ${hasClassifier})`);
  const allSegments = await rumAPIClient.query('trafficMetrics', options);
  const segmentsFiltered = allSegments.filter(isAllowedSegment);

  const enrichedResult = tryEnrich(segmentsFiltered, classifier, auditUrl, log);

  log.info(`[paid-audit] [Site: ${auditUrl}] Processing ${enrichedResult?.length} segments`);
  const auditResult = enrichedResult
    .filter(hasValues)
    .map(removeUncategorizedPages)
    .map(filterByTopSessionViews)
    .map(filterByMaxUrls);

  log.info(`[paid-audit] [Site: ${auditUrl}] Completed traffic metrics (segments: ${auditResult?.length})`);
  return {
    auditResult,
    fullAuditRef: auditUrl,
  };
}

export async function auditAndScrapeBannerOn(context) {
  const { site, finalUrl, log } = context;
  const siteId = site.getId();

  log.info(`[paid-audit] [Site: ${siteId}] Starting banner-on audit step`);
  const result = await paidAuditRunner(finalUrl, context, site);

  const urlsRaw = result
    .auditResult
    .find((segment) => (segment.key === 'url'))?.value
    .map((value) => value.url);
  result.auditResult
    .find((segment) => (segment.key === 'pageType'))?.value
    .forEach((valueItem) => (urlsRaw.push(...valueItem.urls)));

  const uniqueUrls = [...new Set(urlsRaw)];
  const cleanUrls = uniqueUrls.map((url) => ({
    url: normalizeUrl(url),
  }));

  log.info(`[paid-audit] [Site: ${siteId}] Completed banner-on audit step (urls: ${cleanUrls.length})`);
  return {
    type: AUDIT_CONSTANTS.TYPES.BANNER_ON,
    siteId: site.getId(),
    observation: AUDIT_CONSTANTS.OBSERVATION,
    auditResult: result.auditResult,
    urls: cleanUrls,
    fullAuditRef: result.fullAuditRef,
    allowCache: false,
    options: {
      storagePrefix: SCREENSHOT_CONF.BANNER_STATES.ON,
      screenshotTypes: SCREENSHOT_CONF.OPTIONS.TYPES,
      hideConsentBanners: false,
    },
  };
}

export async function scrapeBannerOff(context) {
  const { site, audit, log } = context;
  const siteId = site.getId();

  log.info(`[paid-audit] [Site: ${siteId}] Starting banner-off scrape step`);
  const auditResult = audit.getAuditResult();
  log.debug(`[paid-audit] [Site: ${siteId}] Previous step result: ${JSON.stringify(auditResult, null, 1)}`);

  const { urls } = auditResult;
  if (!urls || !Array.isArray(urls)) {
    throw new Error('No URLs found in previous step audit result');
  }

  log.info(`[paid-audit] [Site: ${siteId}] Completed banner-off scrape step (urls: ${urls.length})`);
  return {
    type: AUDIT_CONSTANTS.TYPES.BANNER_OFF,
    siteId: site.getId(),
    urls,
    allowCache: false,
    options: {
      storagePrefix: SCREENSHOT_CONF.BANNER_STATES.OFF,
      screenshotTypes: SCREENSHOT_CONF.OPTIONS.TYPES,
      hideConsentBanners: true,
    },
  };
}

export async function submitForMystiqueEvaluation(context) {
  const {
    site, env, audit, sqs, log,
  } = context;
  const siteId = site.getId();

  log.info(`[paid-audit] [Site: ${siteId}] Starting mystique evaluation step`);
  const auditResult = audit.getAuditResult();
  log.debug(`[paid-audit] [Site: ${siteId}] Previous step result: ${JSON.stringify(auditResult, null, 2)}`);

  if (!auditResult?.urls || !Array.isArray(auditResult.urls) || auditResult.urls.length === 0) {
    throw new Error('No URLs found in previous step audit result');
  }

  const normalizedUrls = auditResult.urls.map((url) => ({
    url: normalizeUrl(url),
  }));

  log.info(`[paid-audit] [Site: ${siteId}] Processing opportunity evaluation data`);
  let signedUrls;
  try {
    signedUrls = await fetchScrappedUrls(context, site, normalizedUrls.slice(0, 1));
  } catch (error) {
    log.error(`[paid-audit] [Site: ${siteId}] Error fetching scrapped URLs: ${error.message}`);
    throw error;
  }

  const mystiqueMessage = buildMystiqueMessage(site, audit, signedUrls[0]);

  log.info(`[paid-audit] [Site: ${siteId}] Sending evaluation to mystique`);
  await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, mystiqueMessage);
  log.info(`[paid-audit] [Site: ${siteId}] Completed mystique evaluation step`);
}

export default new AuditBuilder()
  .withUrlResolver(wwwUrlResolver)
  .addStep('auditAndScrapeBannerOn', auditAndScrapeBannerOn, AUDIT_STEP_DESTINATIONS.CONTENT_SCRAPER)
  .addStep('scrapeBannerOff', scrapeBannerOff, AUDIT_STEP_DESTINATIONS.CONTENT_SCRAPER)
  .addStep('submitForMystiqueEvaluation', submitForMystiqueEvaluation)
  .build();
