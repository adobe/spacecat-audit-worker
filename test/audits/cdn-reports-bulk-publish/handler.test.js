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
import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import esmock from 'esmock';

use(sinonChai);

describe('cdn-reports-bulk-publish handler', () => {
  let sandbox;
  let bulkPublishStub;
  let runCdnReportsBulkPublish;
  let log;

  // Build a fake site that reports the given enabled flag and llmo folder
  const makeSite = (id, llmoFolder) => ({
    getId: () => id,
    getConfig: () => ({ getLlmoDataFolder: () => llmoFolder }),
  });

  const makeContext = (sites, enabledIds) => ({
    log,
    dataAccess: {
      Configuration: {
        findLatest: sandbox.stub().resolves({
          isHandlerEnabledForSite: (type, site) => (
            type === 'cdn-logs-report' && enabledIds.includes(site.getId())
          ),
        }),
      },
      Site: {
        all: sandbox.stub().resolves(sites),
      },
    },
  });

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    bulkPublishStub = sandbox.stub().resolves();
    log = {
      info: sandbox.stub(), warn: sandbox.stub(), error: sandbox.stub(), debug: sandbox.stub(),
    };

    ({ runCdnReportsBulkPublish } = await esmock(
      '../../../src/cdn-reports-bulk-publish/handler.js',
      {
        '../../../src/utils/report-uploader.js': { bulkPublishToAdminHlx: bulkPublishStub },
      },
    ));
  });

  afterEach(() => sandbox.restore());

  it('builds paths for current week across all enabled sites with an LLMO folder', async () => {
    // Wednesday — only current week expected
    const clock = sandbox.useFakeTimers(new Date('2026-05-20T10:00:00Z'));

    const sites = [
      makeSite('site-1', 'acme-com'),
      makeSite('site-2', 'beta-co'),
      makeSite('site-3', 'gamma-io'),
    ];
    const context = makeContext(sites, ['site-1', 'site-2', 'site-3']);

    const result = await runCdnReportsBulkPublish(undefined, context);

    expect(bulkPublishStub).to.have.been.calledOnce;
    const [reports, , opts] = bulkPublishStub.firstCall.args;
    expect(opts).to.deep.equal({ pollTimeoutMs: 10 * 60_000 });

    // 3 sites x 2 report types x 1 period = 6 reports
    expect(reports).to.have.lengthOf(6);
    expect(reports).to.deep.include({
      outputLocation: 'acme-com/agentic-traffic',
      filename: 'agentictraffic-w21-2026.xlsx',
    });
    expect(reports).to.deep.include({
      outputLocation: 'acme-com/referral-traffic-cdn',
      filename: 'referral-traffic-w21-2026.xlsx',
    });

    expect(result.auditResult).to.deep.equal({
      sites: 3,
      paths: 6,
      periods: ['w21-2026'],
    });
    expect(result.fullAuditRef).to.equal('cdn-reports-bulk-publish/w21-2026');

    clock.restore();
  });

  it('includes previous week paths when run on a Monday', async () => {
    // Monday — current + previous week expected
    const clock = sandbox.useFakeTimers(new Date('2026-05-18T10:00:00Z'));

    const sites = [makeSite('site-1', 'acme-com')];
    const context = makeContext(sites, ['site-1']);

    await runCdnReportsBulkPublish(undefined, context);

    const [reports] = bulkPublishStub.firstCall.args;
    // 1 site x 2 report types x 2 periods = 4 reports
    expect(reports).to.have.lengthOf(4);
    const filenames = reports.map((r) => r.filename).sort();
    expect(filenames).to.deep.equal([
      'agentictraffic-w20-2026.xlsx', // previous week
      'agentictraffic-w21-2026.xlsx', // current week
      'referral-traffic-w20-2026.xlsx',
      'referral-traffic-w21-2026.xlsx',
    ]);

    clock.restore();
  });

  it('filters out sites where cdn-logs-report is disabled or LLMO folder is empty', async () => {
    const clock = sandbox.useFakeTimers(new Date('2026-05-20T10:00:00Z'));

    const sites = [
      makeSite('site-1', 'acme-com'), // enabled, has folder -> kept
      makeSite('site-2', 'beta-co'), // not enabled -> dropped
      makeSite('site-3', ''), // enabled but no folder -> dropped
    ];
    const context = makeContext(sites, ['site-1', 'site-3']);

    const result = await runCdnReportsBulkPublish(undefined, context);

    expect(result.auditResult.sites).to.equal(1);
    expect(result.auditResult.paths).to.equal(2);
    const [reports] = bulkPublishStub.firstCall.args;
    expect(reports.every((r) => r.outputLocation.startsWith('acme-com/'))).to.be.true;

    clock.restore();
  });
});
