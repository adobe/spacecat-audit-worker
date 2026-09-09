/*
 * Copyright 2026 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

/* eslint-env mocha */
import { expect } from 'chai';
import { getStaticContent } from '@adobe/spacecat-shared-utils';

// LLMO-7412: favicon requests (/favicon.ico and the /favicon.ico.html variant)
// return an HTML error page, so they pass the text/html content-type gate in the
// referral aggregation and get counted as ChatGPT referral pageviews. Each vendor's
// insert-aggregated-referral.sql must exclude them from the referrals_raw CTE.
//
// Most vendors expose the request path as the `url` column inside referrals_raw;
// frontdoor has no such column there and references `properties.requestUri` directly.
const FAVICON_REGEX = "'(?i)^/favicon\\.ico(\\.html)?$'";

const VENDOR_URL_EXPR = {
  fastly: 'url_extract_path(url)',
  cloudfront: 'url_extract_path(url)',
  cloudflare: 'url_extract_path(url)',
  akamai: 'url_extract_path(url)',
  imperva: 'url_extract_path(url)',
  other: 'url_extract_path(url)',
  frontdoor: 'url_extract_path(properties.requestUri)',
};

const TEMPLATE_VARIABLES = {
  database: 'cdn_logs_db',
  rawTable: 'raw_logs',
  aggregatedTable: 'aggregated_referral_logs',
  year: '2026',
  month: '06',
  day: '25',
  hour: '10',
  hourFilter: '',
  bucket: 'cdn-logs-bucket',
  serviceProvider: 'byocdn-other',
};

async function renderReferralSql(provider) {
  return getStaticContent(
    TEMPLATE_VARIABLES,
    `./src/cdn-analysis/sql/${provider}/insert-aggregated-referral.sql`,
  );
}

describe('CDN referral aggregation - favicon exclusion (LLMO-7412)', () => {
  Object.entries(VENDOR_URL_EXPR).forEach(([provider, urlExpr]) => {
    it(`${provider}: excludes favicon requests from the referrals_raw CTE`, async () => {
      const sql = await renderReferralSql(provider);

      const faviconPredicate = `AND NOT REGEXP_LIKE(${urlExpr}, ${FAVICON_REGEX})`;
      expect(sql).to.include(faviconPredicate);

      // The exclusion must sit inside the referrals_raw CTE (before its closing
      // paren and the final SELECT), not somewhere in the outer query.
      const cteEnd = sql.indexOf('FROM referrals_raw');
      expect(cteEnd).to.be.greaterThan(-1);
      expect(sql.indexOf(faviconPredicate)).to.be.lessThan(cteEnd);

      // It must come after the bot user-agent filter, so it does not disturb that block.
      const botFilterIndex = sql.indexOf('synthetics|probe|ahc');
      expect(botFilterIndex).to.be.greaterThan(-1);
      expect(sql.indexOf(faviconPredicate)).to.be.greaterThan(botFilterIndex);
    });
  });
});
