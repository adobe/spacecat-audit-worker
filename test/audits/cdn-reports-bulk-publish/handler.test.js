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
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import esmock from 'esmock';

use(sinonChai);
use(chaiAsPromised);

describe('cdn-reports-bulk-publish handler', () => {
  let sandbox;
  let clock;
  let bulkPublishStub;
  let handler;
  let log;

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
      Site: { all: sandbox.stub().resolves(sites) },
    },
  });

  // Run the handler at a fixed Wednesday so only the current week's paths are emitted
  // (Monday adds previous week, covered in its own test).
  const runOnWednesday = async (sites, enabledIds) => {
    clock = sandbox.useFakeTimers(new Date('2026-05-20T10:00:00Z'));
    return handler({}, makeContext(sites, enabledIds));
  };

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    bulkPublishStub = sandbox.stub().resolves();
    log = {
      info: sandbox.stub(), warn: sandbox.stub(), error: sandbox.stub(), debug: sandbox.stub(),
    };

    const mod = await esmock(
      '../../../src/cdn-reports-bulk-publish/handler.js',
      {
        '../../../src/utils/report-uploader.js': { bulkPublishToAdminHlx: bulkPublishStub },
      },
    );
    handler = mod.default;
  });

  afterEach(() => {
    if (clock) clock.restore();
    sandbox.restore();
  });

  it('publishes agentic and referral reports for each enabled site', async () => {
    await runOnWednesday(
      [makeSite('site-1', 'acme-com'), makeSite('site-2', 'beta-co')],
      ['site-1', 'site-2'],
    );

    expect(bulkPublishStub).to.have.been.calledOnce;
    const [reports] = bulkPublishStub.firstCall.args;
    expect(reports).to.deep.include.members([
      { outputLocation: 'acme-com/agentic-traffic', filename: 'agentictraffic-w21-2026.xlsx' },
      { outputLocation: 'acme-com/referral-traffic-cdn', filename: 'referral-traffic-w21-2026.xlsx' },
      { outputLocation: 'beta-co/agentic-traffic', filename: 'agentictraffic-w21-2026.xlsx' },
      { outputLocation: 'beta-co/referral-traffic-cdn', filename: 'referral-traffic-w21-2026.xlsx' },
    ]);
  });

  it('configures bulk publish with a preview poll timeout longer than the per-site default', async () => {
    await runOnWednesday([makeSite('site-1', 'acme-com')], ['site-1']);

    const [, , opts] = bulkPublishStub.firstCall.args;
    // Per-site default is 3 min; the consolidator needs more headroom for the
    // bigger batch. Hard bound asserted in report-uploader tests.
    expect(opts.pollTimeoutMs).to.be.greaterThan(3 * 60_000);
  });

  it('includes the previous week alongside the current week when run on a Monday', async () => {
    clock = sandbox.useFakeTimers(new Date('2026-05-18T10:00:00Z')); // Monday

    await handler({}, makeContext([makeSite('site-1', 'acme-com')], ['site-1']));

    const [reports] = bulkPublishStub.firstCall.args;
    const filenames = reports.map((r) => r.filename).sort();
    expect(filenames).to.deep.equal([
      'agentictraffic-w20-2026.xlsx', // previous week
      'agentictraffic-w21-2026.xlsx', // current week
      'referral-traffic-w20-2026.xlsx',
      'referral-traffic-w21-2026.xlsx',
    ]);
  });

  it('skips sites for which cdn-logs-report is not enabled', async () => {
    await runOnWednesday(
      [makeSite('enabled-site', 'acme-com'), makeSite('disabled-site', 'beta-co')],
      ['enabled-site'],
    );

    const [reports] = bulkPublishStub.firstCall.args;
    expect(reports.every((r) => r.outputLocation.startsWith('acme-com/'))).to.be.true;
  });

  it('skips sites that do not have an LLMO data folder configured', async () => {
    await runOnWednesday(
      [makeSite('with-folder', 'acme-com'), makeSite('no-folder', '')],
      ['with-folder', 'no-folder'],
    );

    const [reports] = bulkPublishStub.firstCall.args;
    expect(reports.every((r) => r.outputLocation.startsWith('acme-com/'))).to.be.true;
  });

  it('returns 200 with site, path, and period counts on success', async () => {
    const result = await runOnWednesday(
      [makeSite('site-1', 'acme-com'), makeSite('site-2', 'beta-co')],
      ['site-1', 'site-2'],
    );

    // restore real timers so Response.json() can resolve
    clock.restore();
    clock = null;

    expect(result.status).to.equal(200);
    const body = await result.json();
    expect(body).to.deep.equal({
      sites: 2,
      paths: 4, // 2 sites x 2 report types x 1 period
      periods: ['w21-2026'],
    });
  });

  it('propagates bulk-publish failures so SQS surfaces the failure', async () => {
    clock = sandbox.useFakeTimers(new Date('2026-05-20T10:00:00Z'));

    bulkPublishStub.rejects(new Error('preview timeout for job URL: ...'));

    await expect(handler(
      {},
      makeContext([makeSite('site-1', 'acme-com')], ['site-1']),
    )).to.be.rejectedWith(/preview timeout/);
  });

  it('returns 200 and no-ops when no sites have cdn-logs-report enabled with a folder', async () => {
    const result = await runOnWednesday(
      [makeSite('disabled-site', 'acme-com')],
      [], // no sites enabled
    );

    clock.restore();
    clock = null;

    expect(result.status).to.equal(200);
    const body = await result.json();
    expect(body).to.deep.equal({ sites: 0, paths: 0, periods: ['w21-2026'] });
    expect(bulkPublishStub).to.not.have.been.called;
    expect(log.warn).to.have.been.calledWith(sinon.match(/no sites with cdn-logs-report enabled/));
  });
});
