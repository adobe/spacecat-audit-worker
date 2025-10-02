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
import RUMAPIClient from '@adobe/spacecat-shared-rum-api-client';
import { AuditBuilder } from '../common/audit-builder.js';
import { wwwUrlResolver } from '../common/index.js';
import { validatePatternsFile, validateUrlsFile, getLastSunday } from './utils.js';
import { referralTrafficRunner } from '../llmo-referral-traffic/handler.js';
import { getRUMUrl } from '../support/utils.js';

const { AUDIT_STEP_DESTINATIONS } = Audit;
const REFERRAL_TRAFFIC_AUDIT = 'llmo-referral-traffic';
const REFERRAL_TRAFFIC_IMPORT = 'traffic-analysis';
const TOP_PAGES_IMPORT = 'top-pages';
const OPTEL_SOURCE_TYPE = 'optel';
const AHREFS_SOURCE_TYPE = 'ahrefs';

async function checkOptelData(domain, context) {
  const { log } = context;
  const rumAPIClient = RUMAPIClient.createFrom(context);

  try {
    const url = await getRUMUrl(domain);
    const options = {
      domain: url,
    };
    const { pageviews } = await rumAPIClient.query('pageviews', options);
    return pageviews > 0;
  } catch (error) {
    log.info(`Failed to check OpTel data for domain ${domain}: ${error.message}`);
    return false;
  }
}

async function runReferralTrafficStep(context) {
  const {
    dataAccess, finalUrl, site, sqs, log,
  } = context;

  const { Configuration } = dataAccess;
  const configuration = await Configuration.findLatest();
  const siteId = site.getSiteId();
  const domain = finalUrl;

  log.info(`Checking domain and triggering appropriate import for site: ${siteId}, domain: ${domain}`);

  const hasOptelData = await checkOptelData(domain, context);

  if (hasOptelData) {
    log.info('Domain has OpTel data; initiating referral traffic import for the last 4 full calendar weeks');

    const last4Weeks = getLastNumberOfWeeks(4);

    // Last week will be imported via step audit
    const lastWeek = last4Weeks.shift();

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
      sqs.sendMessage(configuration.getQueues().imports, message);
    }

    return {
      auditResult: { source: OPTEL_SOURCE_TYPE },
      fullAuditRef: finalUrl,
      type: REFERRAL_TRAFFIC_IMPORT,
      week: lastWeek.week,
      year: lastWeek.year,
      siteId,
    };
  } else {
    log.info('Domain has no OpTel data, skipping referral traffic import; triggering Ahrefs top pages import');

    return {
      type: TOP_PAGES_IMPORT,
      allowCache: false,
      siteId,
      auditResult: { source: AHREFS_SOURCE_TYPE },
      fullAuditRef: finalUrl,
    };
  }
}

async function runAgenticTrafficStep(context) {
  const {
    audit, dataAccess, env, site, log,
  } = context;

  const siteId = site.getSiteId();
  const domain = audit.getFullAuditRef();
  const { SiteTopPage } = dataAccess;
  const auditResult = audit.getAuditResult();
  const lastFourWeeks = getLastNumberOfWeeks(4);
  let urls = [];
  let paths = [];
  let source;

  if (auditResult.source === OPTEL_SOURCE_TYPE) {
    log.info('Agentic Traffic Step: Fetching top URLs from OpTel data');
    // Make sure to create the referral traffic workbook for the last week
    const lastWeek = lastFourWeeks[0];
    referralTrafficRunner(null, context, site, lastWeek);
    const { S3_IMPORTER_BUCKET_NAME: importerBucket } = env;
    const tempLocation = `s3://${importerBucket}/rum-metrics-compact/temp/out/`;
    const databaseName = 'rum_metrics';
    const tableName = 'compact_metrics';
    const athenaClient = AWSAthenaClient.fromContext(context, tempLocation);
    const temporalConditions = lastFourWeeks
      .map(({ year, week }) => getWeekInfo(week, year).temporalCondition);

    const variables = {
      tableName: `${databaseName}.${tableName}`,
      siteId,
      temporalCondition: `(${temporalConditions.join(' OR ')})`,
    };

    const query = await getStaticContent(variables, './src/llmo-customer-analysis/sql/urls.sql');
    const description = `[Athena Query] Fetching customer analysis data for ${domain}`;
    paths = await athenaClient.query(query, databaseName, description);
    urls = paths.slice(0, 20).map((p) => ({ url: `https://${audit.getFullAuditRef()}${p.path}` }));
    source = OPTEL_SOURCE_TYPE;
  } else if (auditResult.source === AHREFS_SOURCE_TYPE) {
    log.info('Agentic Traffic Step: fetching top URLs Ahrefs data');
    const topPages = await SiteTopPage.allBySiteIdAndSourceAndGeo(siteId, 'ahrefs', 'global');
    paths = topPages.slice(0, 100).map((topPage) => ({ path: topPage.getUrl() }));
    source = AHREFS_SOURCE_TYPE;
  }

  log.info('Agentic Traffic Step: Validating that required pattern files exist');

  // Validate that the patterns file exists in SharePoint
  try {
    await validatePatternsFile(site, context);
    log.info('Agentic Traffic Step: Pattern files validated successfully');
  } catch (error) {
    log.error(`Agentic Traffic Step: Pattern file validation failed: ${error.message}`);
    throw new Error(`Required pattern files not found. Please ensure patterns.xlsx exists at {llmoFolder}/agentic-traffic/patterns/ in SharePoint with 'shared-products' and 'shared-pagetype' worksheets containing 'name' and 'regex' columns. Error: ${error.message}`);
  }

  log.info('Agentic Traffic Step: Validation complete; initiating scrape');

  return {
    auditResult: { source },
    siteId,
    urls: urls.length > 0 ? urls : [{ url: `https://${domain}` }],
    maxScrapeAge: 24 * 7,
    options: {
      screenshotTypes: [],
    },
  };
}

async function runBrandPresenceStep(context) {
  const {
    dataAccess, log, site, sqs,
  } = context;
  const { Configuration } = dataAccess;
  const configuration = await Configuration.findLatest();

  try {
    log.info('Brand Presence Step: Validating that required URL files exist');

    // Validate that the urls file exists in SharePoint
    try {
      await validateUrlsFile(site, context);
      log.info('Brand Presence Step: URL files validated successfully');
    } catch (error) {
      log.error(`Brand Presence Step: URL file validation failed: ${error.message}`);
      throw new Error(`Required URL files not found. Please ensure urls.xlsx exists at {llmoFolder}/prompts/ in SharePoint with 'URLs' worksheet containing 'category', 'region', 'topic', and 'url' columns. Error: ${error.message}`);
    }

    log.info('Brand Presence Step: Validation complete; triggering geo-brand-presence audit');

    const geoBrandPresenceMessage = {
      type: 'geo-brand-presence',
      siteId: site.getSiteId(),
      data: getLastSunday(),
    };

    await sqs.sendMessage(configuration.getQueues().audits, geoBrandPresenceMessage);

    return {
      status: 'llmo-customer-analysis audit completed',
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
  .addStep('runReferralTrafficStep', runReferralTrafficStep, AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)
  .addStep('runAgenticTrafficStep', runAgenticTrafficStep, AUDIT_STEP_DESTINATIONS.SCRAPE_CLIENT)
  .addStep('runBrandPresenceStep', runBrandPresenceStep)
  .build();
/* c8 ignore end */
