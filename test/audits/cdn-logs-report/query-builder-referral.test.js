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

import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import { weeklyBreakdownQueries } from '../../../src/cdn-logs-report/utils/query-builder.js';

use(sinonChai);

describe('CDN Logs Query Builder (Referral)', () => {
  const sandbox = sinon.createSandbox();

  const { createReferralDailyReportQuery } = weeklyBreakdownQueries;

  afterEach(() => {
    sandbox.restore();
  });

  it('creates referral daily report query with single-day partition filter', async () => {
    const query = await createReferralDailyReportQuery({
      trafficDate: new Date('2026-03-31T00:00:00.000Z'),
      databaseName: 'cdn_logs_database',
      tableName: 'aggregated_referral_logs',
      site: {
        getBaseURL: () => 'https://www.example.com',
        getConfig: () => ({ getLlmoCdnlogsFilter: () => [] }),
      },
    });

    expect(query).to.include("(year = '2026' AND month = '03' AND day = '31')");
    expect(query).to.include('host');
    expect(query).to.include('COUNT(*) AS pageviews');
    expect(query).to.include('aggregated_referral_logs');
  });

  it('creates referral daily report query with site filters', async () => {
    const query = await createReferralDailyReportQuery({
      trafficDate: new Date('2026-03-31T00:00:00.000Z'),
      databaseName: 'cdn_logs_database',
      tableName: 'aggregated_referral_logs',
      site: {
        getBaseURL: () => 'https://www.example.com',
        getConfig: () => ({
          getLlmoCdnlogsFilter: () => [{ value: ['staging'], key: 'host', type: 'exclude' }],
        }),
      },
    });

    expect(query).to.include("(year = '2026' AND month = '03' AND day = '31')");
    expect(query).to.include('staging');
  });
});
