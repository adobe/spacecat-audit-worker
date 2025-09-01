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

/* eslint-env mocha */
import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import { promises as fs } from 'fs';
import { weeklyBreakdownQueries } from '../../../src/cdn-logs-report/utils/query-builder.js';

use(sinonChai);

describe('CDN Logs Query Builder (Referral)', () => {
  const sandbox = sinon.createSandbox();

  const { createReferralReportQuery } = weeklyBreakdownQueries;
  const options = {
    periods: {
      weeks: [
        {
          startDate: new Date('2025-08-18T00:00:00.000Z'),
          endDate: new Date('2025-08-24T23:59:59.999Z'),
          weekNumber: 34,
          year: 2025,
          weekLabel: 'Week 34',
        },
      ],
      columns: [
        'Week 34',
      ],
    },
    databaseName: 'cdn_logs_database',
    tableName: 'aggregated_referral_logs',
    site: {
      getConfig: () => ({
        getCdnLogsConfig: () => ({
          filters: [
            {
              type: 'exclude',
              value: [
                'preprod',
                'stag',
                'catalog',
                'test',
              ],
              key: 'host',
            }, {
              value: [
                'www.another.com',
              ],
              key: 'host',
            },
          ],
        }),
      }),
    },
  };

  afterEach(() => {
    sandbox.restore();
  });

  it('creates agentic report query with ChatGPT and Perplexity filtering', async () => {
    const expectedQuery = await fs.readFile('./test/audits/cdn-logs-report/queries/referral-traffic-report.sql', { encoding: 'utf8' });

    const query = await createReferralReportQuery(options);

    expect(query).to.equal(expectedQuery);
  });

  it('handles llmo cdn logs site filters correctly', async () => {
    options.site.getConfig = () => ({
      getCdnLogsConfig: () => ({}),
      getLlmoCdnlogsFilter: () => ([{ value: ['test'], key: 'url' }]
      ),
    });

    const query = await createReferralReportQuery(options);
    expect(query).to.include("(REGEXP_LIKE(url, '(?i)(test)'))");
  });
});
