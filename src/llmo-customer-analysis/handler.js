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

/* c8 ignore start */
import {
  getStaticContent, getLastNumberOfWeeks, getWeekInfo,
} from '@adobe/spacecat-shared-utils';
import { AWSAthenaClient } from '@adobe/spacecat-shared-athena-client';
import { Audit } from '@adobe/spacecat-shared-data-access';
import { AuditBuilder } from '../common/audit-builder.js';
import { wwwUrlResolver } from '../common/index.js';
import analyzeDomain from './domain-analysis.js';
import { analyzeProducts } from './product-analysis.js';
import { analyzePageTypes } from './page-type-analysis.js';
import { uploadPatternsWorkbook, uploadUrlsWorkbook, getLastSunday } from './utils.js';

const { AUDIT_STEP_DESTINATIONS } = Audit;
const REFERRAL_TRAFFIC_AUDIT = 'llmo-referral-traffic';
const REFERRAL_TRAFFIC_IMPORT = 'traffic-analysis';

async function runAgenticAndReferralTrafficStep(context) {
  const {
    dataAccess, env, finalUrl, site, sqs, log,
  } = context;

  const { Configuration } = dataAccess;
  const configuration = await Configuration.findLatest();
  const siteId = site.getSiteId();

  log.info(`Starting llmo customer analysis audit for site: ${siteId}}`);

  const last4Weeks = getLastNumberOfWeeks(4);

  for (const last4Week of last4Weeks) {
    const { week, year } = last4Week;
    const message = {
      type: REFERRAL_TRAFFIC_IMPORT,
      siteId,
      auditContext: {
        auditType: REFERRAL_TRAFFIC_AUDIT,
        week,
        year,
      },
    };
    // eslint-disable-next-line no-await-in-loop
    await sqs.sendMessage(configuration.getQueues().imports, message);
    log.info(`Successfully triggered import ${REFERRAL_TRAFFIC_IMPORT} with message: ${JSON.stringify(message)}`);
  }

  const { S3_IMPORTER_BUCKET_NAME: importerBucket } = env;
  const tempLocation = `s3://${importerBucket}/rum-metrics-compact/temp/out/`;
  const databaseName = 'rum_metrics';
  const tableName = 'compact_metrics';
  const athenaClient = AWSAthenaClient.fromContext(context, tempLocation);
  const lastFourWeeks = getLastNumberOfWeeks(4);
  const temporalConditions = lastFourWeeks
    .map(({ year, week }) => getWeekInfo(week, year).temporalCondition);

  const variables = {
    tableName: `${databaseName}.${tableName}`,
    siteId,
    temporalCondition: `(${temporalConditions.join(' OR ')})`,
  };

  const domain = site.getBaseURL();
  const query = await getStaticContent(variables, './src/llmo-customer-analysis/sql/urls.sql');
  const description = `[Athena Query] Fetching customer analysis data for ${domain}`;
  const paths = await athenaClient.query(query, databaseName, description);
  const productRegexes = await analyzeProducts(domain, paths.map((p) => p.path), context);
  const pagetypeRegexes = await analyzePageTypes(domain, paths.map((p) => p.path), context);
  await uploadPatternsWorkbook(productRegexes, pagetypeRegexes, site, context);

  const formatBaseUrl = (url) => url.replace(/^(https?:\/\/)(?!www\.)/, '$1www.');
  const urls = paths.map((p) => ({ url: `${formatBaseUrl(domain)}${p.path}` }));

  return {
    auditResult: { status: 'agentic and referral traffic steps completed' },
    fullAuditRef: finalUrl,
    siteId,
    urls,
    maxScrapeAge: 24 * 7,
    options: {
      screenshotTypes: [],
    },
  };
}

async function runBrandPresenceStep(context) {
  const {
    dataAccess, log, scrapeResultPaths, site, sqs,
  } = context;
  const { Configuration } = dataAccess;
  const configuration = await Configuration.findLatest();
  const domain = site.getBaseURL();
  const results = [...scrapeResultPaths.values()];

  try {
    const domainInsights = await analyzeDomain(domain, results, context);
    await uploadUrlsWorkbook(domainInsights, site, context);

    const geoBrandPresenceMessage = {
      type: 'geo-brand-presence',
      siteId: site.getSiteId(),
      data: getLastSunday(),
    };

    await sqs.sendMessage(configuration.getQueues().audits, geoBrandPresenceMessage);

    return {
      status: 'LLMO customer analysis successfully',
    };
  } catch (error) {
    log.error(`Error during brand presence step: ${error.message}`);

    return {
      status: 'failed to complete brand presence step successfully',
    };
  }
}

export default new AuditBuilder()
  .withUrlResolver(wwwUrlResolver)
  .addStep('runAgenticAndReferralTrafficStep', runAgenticAndReferralTrafficStep, AUDIT_STEP_DESTINATIONS.SCRAPE_CLIENT)
  .addStep('runBrandPresenceStep', runBrandPresenceStep)
  .build();
/* c8 ignore end */
