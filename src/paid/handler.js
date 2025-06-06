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

function getUrlKeys(site, urls) {
  return urls.map((item) => {
    const url = new URL(item.url);
    const suffix = url.pathname === '/' ? '' : `${url.pathname}`;
    const key = `scrapes/${site.getSiteId()}${suffix}`;
    return {
      url: item.url,
      mobile_on: `${key}/consent-banner-on/screenshot-iphone-6-viewport.png`,
      desktop_on: `${key}/consent-banner-on/screenshot-desktop-viewport.png`,
      mobile_off: `${key}/consent-banner-off/screenshot-iphone-6-viewport.png`,
      desktop_off: `${key}/consent-banner-off/screenshot-desktop-viewport.png`,
    };
  });
}

async function getSignedUrls(context, keys) {
  const { s3Client } = context;
  if (typeof log === 'undefined') {
    log = context.log;
  }
  const { S3_SCRAPER_BUCKET_NAME } = context.env;
  return Promise.all(
    keys.map(async (item) => {
      const mOn = await getSignedUrl(s3Client, S3_SCRAPER_BUCKET_NAME, item.mobile_on, log);
      const dOn = await getSignedUrl(s3Client, S3_SCRAPER_BUCKET_NAME, item.desktop_on, log);
      const mOff = await getSignedUrl(s3Client, S3_SCRAPER_BUCKET_NAME, item.mobile_off, log);
      const dOff = await getSignedUrl(s3Client, S3_SCRAPER_BUCKET_NAME, item.desktop_off, log);
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
    .filter(hasValues)
    .map(removeUncategorizedPages)
    .map(filterByTopSessionViews)
    .map(filterByMaxUrls);

  log.info(`Traffic metric runner has completed  for domain: ${auditUrl} and found segment Count: ${auditResult?.length}`);

  return {
    auditResult,
    fullAuditRef: auditUrl,
  };
}

export async function fetchScrappedUrls(context, site, urls) {
  const keys = getUrlKeys(site, urls);
  const signedUrls = await getSignedUrls(context, keys);
  return signedUrls;
}

export async function auditAndScrapeBannerOn(context) {
  const {
    site, finalUrl, sqs, env,
  } = context;
  const result = await paidAuditRunner(finalUrl, context, site);
  const urlsRaw = result
    .auditResult
    .find((segment) => (segment.key === 'url'))?.value
    .map((value) => value.url);
  result.auditResult
    .find((segment) => (segment.key === 'pageType'))?.value
    .forEach((valueItem) => (urlsRaw.push(...valueItem.urls)));

  const uniqueUrls = [...new Set(urlsRaw)];
  const cleanUrls = uniqueUrls.map((url) => {
    const urlObj = new URL(url);
    return {
      url: `${urlObj.origin}${urlObj.pathname.replace(/\/$/, '')}`,
    };
  });

  const signedUrls = await fetchScrappedUrls(context, site, cleanUrls.slice(0, 1));

  const mystiqueMessage = {
    observation: 'Url important for paid traffic checking if consent banner affects users',
    siteId: site.getSiteId(),
    url: signedUrls[0].url,
    auditId: '08d0ed9a-f07d-4b1d-bd6f-15835346419a',
    deliveryType: site.getDeliveryType(),
    time: new Date().toISOString(),
    data: {
      url: signedUrls[0].url,
      mobile_path_cookie_banner_on: signedUrls[0].mOn,
      mobile_path_cookie_banner_off: signedUrls[0].mOff,
      desktop_path_cookie_banner_on: signedUrls[0].dOn,
      desktop_path_cookie_banner_off: signedUrls[0].dOff,
    },
  };

  log.info(`Sending sqs message to mistique ${JSON.stringify(mystiqueMessage, 0, 2)}`);

  await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, mystiqueMessage);

  return {
    type: 'paid-top-segment-scrape-banner-on',
    siteId: site.getSiteId(),
    observation: 'Landing page should not have a blocking cookie concent banner',
    auditResult: result.auditResult,
    urls: cleanUrls,
    fullAuditRef: result.fullAuditRef,
    allowCache: false,
    options: {
      storagePrefix: 'consent-banner-on',
      screenshotTypes: ['viewport'],
      hideConsentBanners: false,
    },
  };
}

export async function scrapeBannerOff(context) {
  const { site, job, audit } = context;

  if (typeof log === 'undefined') {
    log = context.log;
  }
  log.info(`${JSON.stringify(audit.getAuditResult(), null, 1)}`);
  const jobMetadata = job.getMetadata();
  const { urls } = jobMetadata.payload;
  const normalizedUrls = urls.map((url) => {
    const urlObj = new URL(url);
    return {
      url: `${urlObj.origin}${urlObj.pathname.replace(/\/$/, '')}`,
    };
  });

  log.info(`[paid-audit-scrape-banner-off] site: Submit scrapper with banner off has started for site ${site.getId()}.`);

  return {
    type: 'paid-top-segment-scrape-banner-off',
    siteId: site.getSiteId(),
    urls: normalizedUrls,
    allowCache: false,
    options: {
      storagePrefix: 'consent-banner-off',
      screenshotTypes: ['viewport'],
      hideConsentBanners: true,
    },
  };
}

export async function submitForMystiqueEvaluation(context) {
  const {
    site, job, env, audit, sqs,
  } = context;

  const auditResult = audit.getAuditResult();
  log.info('auditResult in submitForMystiqueEvaluation: ', JSON.stringify(auditResult, null, 2));

  if (typeof log === 'undefined') {
    log = context.log;
  }

  const jobMetadata = job.getMetadata();
  const { urls } = jobMetadata.payload;
  const normalizedUrls = urls.map((url) => {
    const urlObj = new URL(url);
    return `${urlObj.origin}${urlObj.pathname.replace(/\/$/, '')}`;
  });

  log.info(`[Paid Audit] [Site Id: ${site.getId()}] processing data to send for opportunity evaluation`);

  const signedUrls = await fetchScrappedUrls(context, site, normalizedUrls.slice(0, 1))[0];

  const mystiqueMessage = {
    type: 'guidance:paid-cookie-consent',
    observation: 'Landing page should not have a blocking cookie concent banner',
    siteId: site.getSiteId(),
    url: signedUrls[0].url,
    auditId: audit.getAuditId(),
    deliveryType: site.getDeliveryType(),
    time: new Date().toISOString(),
    data: {
      url: signedUrls[0].url,
      mobile_path_cookie_banner_on: signedUrls[0].mOn,
      mobile_path_cookie_banner_off: signedUrls[0].mOff,
      desktop_path_cookie_banner_on: signedUrls[0].dOn,
      desktop_path_cookie_banner_off: signedUrls[0].dOff,
    },
  };

  log.info(`sending to mysticque ${mystiqueMessage}`);
  await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, mystiqueMessage);
  log.info();
}

export default new AuditBuilder()
  .withUrlResolver(wwwUrlResolver)
  .addStep('auditAndScrapeBannerOn', auditAndScrapeBannerOn, AUDIT_STEP_DESTINATIONS.CONTENT_SCRAPER)
  .addStep('scrapeBannerOff', scrapeBannerOff, AUDIT_STEP_DESTINATIONS.CONTENT_SCRAPER)
  .addStep('submitForMystiqueEvaluation', submitForMystiqueEvaluation)
  .build();
