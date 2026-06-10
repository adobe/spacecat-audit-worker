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
import ExcelJS from 'exceljs';
import {
  BRAND_PRESENCE_REGEX,
  OFFSITE_DOMAINS,
  PROVIDERS_SET,
} from '../../src/offsite-brand-presence/constants.js';

use(sinonChai);

const SITE_ID = 'site-123';
const DEFAULT_WEEK = 7;
const DEFAULT_WEEK_2 = 6;
const DEFAULT_YEAR = 2026;
const DATA_FOLDER = 'test-llmo-folder';

const SHARED_CONSTANTS_MOCK = {
  BRAND_PRESENCE_REGEX,
  PROVIDERS_SET,
  OFFSITE_DOMAINS,
};

function makeSite(overrides = {}) {
  return {
    getId: () => SITE_ID,
    getConfig: () => ({
      getLlmoDataFolder: () => DATA_FOLDER,
    }),
    getBaseURL: () => 'https://www.example.com',
    ...overrides,
  };
}

async function makeQueryIndexBuffer(paths) {
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('Sheet1');
  ws.addRow(['Path']);
  for (const p of paths) {
    ws.addRow([p]);
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function makeQueryIndexPaths(providers = ['copilot'], week = DEFAULT_WEEK, year = DEFAULT_YEAR) {
  return providers.map(
    (p) => `/adobe/brand-presence/w${week}/brandpresence-${p}-w${week}-${year}-010126.json`,
  );
}

async function makeBrandPresenceBuffer(rows) {
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('Sheet1');
  ws.addRow(['Sources', 'Region', 'Topics', 'Category', 'Prompt']);
  for (const row of rows) {
    ws.addRow([
      row.Sources ?? '',
      row.Region ?? '',
      row.Topics ?? '',
      row.Category ?? '',
      row.Prompt ?? '',
    ]);
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function makeBrandPresenceRow(overrides = {}) {
  return {
    Sources: 'https://www.reddit.com/r/test/comments/abc',
    Region: 'US',
    Topics: 'MyTopic',
    Category: 'Insurance',
    Prompt: 'Why choose us?',
    ...overrides,
  };
}

describe('offsite-brand-presence-enrichment', function () {
  this.timeout(10000);

  let sandbox;
  let mockIsoCalendarWeek;
  let mockCreateSPClient;
  let mockReadFromSP;
  let computeTopicsFromBrandPresence;
  let formatTopicsForEnrichment;
  let filterBrandPresenceFiles;
  let loadBrandPresenceData;
  let getPreviousWeeks;
  let log;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    mockIsoCalendarWeek = sandbox.stub();
    mockIsoCalendarWeek.onFirstCall().returns({ week: DEFAULT_WEEK, year: DEFAULT_YEAR });
    mockIsoCalendarWeek.onSecondCall().returns({ week: DEFAULT_WEEK_2, year: DEFAULT_YEAR });

    mockCreateSPClient = sandbox.stub().resolves({});
    mockReadFromSP = sandbox.stub();

    log = {
      info: sandbox.stub(),
      warn: sandbox.stub(),
      error: sandbox.stub(),
      debug: sandbox.stub(),
    };

    const mod = await esmock('../../src/utils/offsite-brand-presence-enrichment.js', {
      '@adobe/spacecat-shared-utils': {
        isoCalendarWeek: mockIsoCalendarWeek,
      },
      '../../src/offsite-brand-presence/constants.js': SHARED_CONSTANTS_MOCK,
      '../../src/utils/report-uploader.js': {
        createLLMOSharepointClient: mockCreateSPClient,
        readFromSharePointWithRetry: mockReadFromSP,
      },
    });

    computeTopicsFromBrandPresence = mod.computeTopicsFromBrandPresence;
    formatTopicsForEnrichment = mod.formatTopicsForEnrichment;
    filterBrandPresenceFiles = mod.filterBrandPresenceFiles;
    loadBrandPresenceData = mod.loadBrandPresenceData;
    getPreviousWeeks = mod.getPreviousWeeks;
  });

  afterEach(() => {
    sandbox.restore();
  });

  async function esmockWithPostgrest(brandalfOverrides = {}) {
    return esmock('../../src/utils/offsite-brand-presence-enrichment.js', {
      '@adobe/spacecat-shared-utils': {
        isoCalendarWeek: mockIsoCalendarWeek,
      },
      '../../src/offsite-brand-presence/constants.js': SHARED_CONSTANTS_MOCK,
      '../../src/utils/report-uploader.js': {
        createLLMOSharepointClient: mockCreateSPClient,
        readFromSharePointWithRetry: mockReadFromSP,
      },
      '../../src/utils/brandalf-utils.js': {
        isBrandalfEnabled: sandbox.stub().resolves(true),
        resolveOrganizationIdForSite: sandbox.stub().resolves('org-123'),
        ...brandalfOverrides,
      },
      '../../src/utils/offsite-brand-presence-postgrest.js': {
        loadBrandPresenceDataFromPostgrest: sandbox.stub().resolves(null),
        ...brandalfOverrides,
      },
    });
  }

  async function setupSharePointStubs(rows, providers = ['copilot']) {
    const qiPaths = makeQueryIndexPaths(providers);
    const qiBuffer = await makeQueryIndexBuffer(qiPaths);
    const bpBuffer = await makeBrandPresenceBuffer(rows);

    mockReadFromSP.callsFake(async (filename) => {
      if (filename === 'query-index.xlsx') {
        return qiBuffer;
      }
      return bpBuffer;
    });
  }

  describe('filterBrandPresenceFiles', () => {
    it('returns paths matching week, year, and known provider', () => {
      const paths = [
        `w${DEFAULT_WEEK}/brandpresence-copilot-w${DEFAULT_WEEK}-${DEFAULT_YEAR}-010126`,
      ];
      const result = filterBrandPresenceFiles(paths, DEFAULT_WEEK, DEFAULT_YEAR);
      expect(result).to.deep.equal(paths);
    });

    it('returns empty array when no entries match', () => {
      expect(filterBrandPresenceFiles([], DEFAULT_WEEK, DEFAULT_YEAR)).to.deep.equal([]);
    });

    it('excludes files when ISO week in filename does not match target week', () => {
      const paths = [`w8/brandpresence-copilot-w8-${DEFAULT_YEAR}-010126`];
      expect(filterBrandPresenceFiles(paths, DEFAULT_WEEK, DEFAULT_YEAR)).to.deep.equal([]);
    });

    it('treats null paths as empty', () => {
      expect(filterBrandPresenceFiles(null, DEFAULT_WEEK, DEFAULT_YEAR)).to.deep.equal([]);
    });

    it('ignores paths with unknown provider id or that do not match the pattern', () => {
      const paths = [
        'other/file',
        `w${DEFAULT_WEEK}/brandpresence-not-a-real-provider-w${DEFAULT_WEEK}-${DEFAULT_YEAR}-010126`,
      ];
      expect(filterBrandPresenceFiles(paths, DEFAULT_WEEK, DEFAULT_YEAR)).to.deep.equal([]);
    });

    it('ignores brand-presence paths that do not match the filename pattern', () => {
      const paths = ['w7/foo'];
      expect(filterBrandPresenceFiles(paths, DEFAULT_WEEK, DEFAULT_YEAR)).to.deep.equal([]);
    });

    it('excludes files when year in filename does not match target year', () => {
      const paths = [`w${DEFAULT_WEEK}/brandpresence-copilot-w${DEFAULT_WEEK}-2025-010126`];
      expect(filterBrandPresenceFiles(paths, DEFAULT_WEEK, DEFAULT_YEAR)).to.deep.equal([]);
    });

    it('matches filenames without a trailing date suffix', () => {
      const paths = [`brandpresence-copilot-w${DEFAULT_WEEK}-${DEFAULT_YEAR}`];
      const result = filterBrandPresenceFiles(paths, DEFAULT_WEEK, DEFAULT_YEAR);
      expect(result).to.have.lengthOf(1);
      expect(result[0]).to.include('copilot');
    });
  });

  describe('formatTopicsForEnrichment', () => {
    it('maps topicMap and allUrls to enrichment topic shape', () => {
      const topicMap = new Map();
      const urlMap = new Map();
      urlMap.set('https://reddit.com/r/x', { category: 'cat', subPrompts: new Set(['p1']) });
      topicMap.set('T1', { category: 'cat', urlMap });

      const allUrls = new Map();
      allUrls.set('https://reddit.com/r/x', { count: 3, domain: 'reddit.com' });

      const topics = formatTopicsForEnrichment(topicMap, allUrls);
      expect(topics).to.deep.equal([{
        name: 'T1',
        urls: [{
          url: 'https://reddit.com/r/x',
          timesCited: 3,
          category: 'cat',
          subPrompts: ['p1'],
        }],
      }]);
    });

    it('uses zero timesCited when url missing from allUrls', () => {
      const topicMap = new Map();
      const urlMap = new Map();
      urlMap.set('https://example.com/a', { category: '', subPrompts: new Set() });
      topicMap.set('T', { category: '', urlMap });

      const topics = formatTopicsForEnrichment(topicMap, new Map());
      expect(topics[0].urls[0].timesCited).to.equal(0);
    });
  });

  describe('computeTopicsFromBrandPresence', () => {
    it('uses PostgREST data before SharePoint reads', async () => {
      const loadBrandPresenceDataFromPostgrest = sandbox.stub().resolves({
        data: [makeBrandPresenceRow()],
      });
      const mod = await esmockWithPostgrest({ loadBrandPresenceDataFromPostgrest });
      const postgrestClient = { from: sandbox.stub() };

      const result = await mod.computeTopicsFromBrandPresence(SITE_ID, {
        log,
        dataAccess: { services: { postgrestClient } },
      });

      expect(result).to.have.lengthOf(1);
      expect(result[0].name).to.equal('MyTopic');
      expect(result[0].urls[0].url).to.equal('https://www.reddit.com/r/test/comments/abc');
      expect(mockReadFromSP).to.not.have.been.called;
      expect(
        loadBrandPresenceDataFromPostgrest.firstCall.args[0].postgrestClient,
      ).to.equal(postgrestClient);
    });

    it('falls back to SharePoint fetch for brandalf-enabled site when PostgREST returns no rows', async () => {
      const mod = await esmockWithPostgrest();
      const site = makeSite();

      const result = await mod.computeTopicsFromBrandPresence(
        SITE_ID,
        { log, dataAccess: {} },
        site,
      );

      expect(result).to.deep.equal([]);
      expect(log.info).to.have.been.calledWithMatch(
        /No PostgREST data for brandalf-enabled site/,
      );
    });

    it('forwards the provided site object to organization resolution', async () => {
      const resolveOrganizationIdForSite = sandbox.stub().resolves('org-123');
      const mod = await esmockWithPostgrest({ resolveOrganizationIdForSite });
      const fakeSite = makeSite({ getOrganizationId: sandbox.stub().returns('org-from-site') });

      await mod.computeTopicsFromBrandPresence(
        SITE_ID,
        { log, dataAccess: {} },
        fakeSite,
      );

      expect(resolveOrganizationIdForSite).to.have.been.calledOnce;
      expect(resolveOrganizationIdForSite.firstCall.args[0].site).to.equal(fakeSite);
      expect(resolveOrganizationIdForSite.firstCall.args[0].siteId).to.equal(SITE_ID);
    });

    it('returns empty array when site cannot be resolved', async () => {
      const result = await computeTopicsFromBrandPresence(SITE_ID, {
        log,
        dataAccess: { Site: { findById: sandbox.stub().resolves(null) } },
      });
      expect(result).to.deep.equal([]);
      expect(log.warn).to.have.been.calledWithMatch(/Cannot resolve site/);
    });

    it('returns empty array when site has no LLMO data folder', async () => {
      const site = makeSite({ getConfig: () => ({ getLlmoDataFolder: () => null }) });
      const result = await computeTopicsFromBrandPresence(SITE_ID, { log }, site);
      expect(result).to.deep.equal([]);
      expect(log.warn).to.have.been.calledWithMatch(/No LLMO data folder configured/);
    });

    it('returns empty array when SharePoint query-index read throws', async () => {
      mockReadFromSP.rejects(new Error('SharePoint down'));
      const site = makeSite();
      const result = await computeTopicsFromBrandPresence(SITE_ID, { log }, site);
      expect(result).to.deep.equal([]);
      expect(log.error).to.have.been.calledWithMatch(/Error reading query-index from SharePoint/);
    });

    it('returns empty array when no brand presence files match the week', async () => {
      const qiBuffer = await makeQueryIndexBuffer([]);
      mockReadFromSP.resolves(qiBuffer);

      const site = makeSite();
      const result = await computeTopicsFromBrandPresence(SITE_ID, { log }, site);
      expect(result).to.deep.equal([]);
      expect(log.warn).to.have.been.calledWithMatch(/Failed to read query-index for site/);
    });

    it('aggregates topics from brand presence rows (US, reddit URL, topic)', async () => {
      await setupSharePointStubs([makeBrandPresenceRow()]);
      const site = makeSite();

      const result = await computeTopicsFromBrandPresence(SITE_ID, { log }, site);

      expect(result).to.have.lengthOf(1);
      expect(result[0].name).to.equal('MyTopic');
      expect(result[0].urls).to.have.lengthOf(1);
      expect(result[0].urls[0].url).to.equal('https://www.reddit.com/r/test/comments/abc');
      expect(result[0].urls[0].timesCited).to.equal(1);
      expect(result[0].urls[0].category).to.equal('Insurance');
      expect(result[0].urls[0].subPrompts).to.deep.equal(['Why choose us?']);
    });

    it('skips non-US rows and rows without Sources', async () => {
      await setupSharePointStubs([
        { Sources: 'https://reddit.com/r/a', Region: 'EU', Topics: 'T' },
        { Sources: '', Region: 'US', Topics: 'T' },
      ]);
      const site = makeSite();

      const result = await computeTopicsFromBrandPresence(SITE_ID, { log }, site);
      expect(result).to.deep.equal([]);
    });

    it('skips empty source segments and invalid URL tokens', async () => {
      await setupSharePointStubs([
        makeBrandPresenceRow({
          Sources: ';https://www.reddit.com/r/good',
          Topics: 'T',
          Category: 'C',
          Prompt: 'p',
        }),
        { Sources: ':::', Region: 'US', Topics: 'T2' },
      ]);
      const site = makeSite();

      const result = await computeTopicsFromBrandPresence(SITE_ID, { log }, site);
      expect(result).to.have.lengthOf(1);
      expect(result[0].name).to.equal('T');
      expect(result[0].urls[0].url).to.equal('https://www.reddit.com/r/good');
    });

    it('increments citation count when the same normalized URL appears in multiple rows', async () => {
      const url = 'https://www.reddit.com/r/x/y';
      await setupSharePointStubs([
        makeBrandPresenceRow({
          Sources: url, Topics: 'T', Category: 'C', Prompt: 'P',
        }),
        makeBrandPresenceRow({
          Sources: url, Topics: 'T', Category: 'C', Prompt: '',
        }),
      ]);
      const site = makeSite();

      const result = await computeTopicsFromBrandPresence(SITE_ID, { log }, site);
      expect(result[0].urls[0].timesCited).to.equal(2);
    });

    it('does not track topic when Topics is empty', async () => {
      await setupSharePointStubs([makeBrandPresenceRow({ Topics: '   ' })]);
      const site = makeSite();

      const result = await computeTopicsFromBrandPresence(SITE_ID, { log }, site);
      expect(result).to.deep.equal([]);
    });

    it('continues when one sheet read throws and another succeeds', async () => {
      const qiPaths = makeQueryIndexPaths(['copilot', 'gemini']);
      const qiBuffer = await makeQueryIndexBuffer(qiPaths);
      const row = makeBrandPresenceRow({ Topics: 'T', Category: '', Prompt: 'x' });
      const bpBuffer = await makeBrandPresenceBuffer([row]);

      let callCount = 0;
      mockReadFromSP.callsFake(async (filename) => {
        if (filename === 'query-index.xlsx') {
          return qiBuffer;
        }
        callCount += 1;
        if (callCount === 1) {
          throw new Error('SharePoint error');
        }
        return bpBuffer;
      });

      const site = makeSite();
      const result = await computeTopicsFromBrandPresence(SITE_ID, { log }, site);
      expect(log.error).to.have.been.calledWithMatch(/Error reading brand presence sheet/);
      expect(result).to.have.lengthOf(1);
    });

    it('normalizes youtu.be watch URLs and classifies youtube domain', async () => {
      await setupSharePointStubs([makeBrandPresenceRow({
        Sources: 'https://www.youtube.com/watch?v=abc123',
        Topics: 'Vid',
        Category: 'C',
        Prompt: 'P',
      })]);
      const site = makeSite();

      const result = await computeTopicsFromBrandPresence(SITE_ID, { log }, site);
      expect(result[0].urls[0].url).to.equal('https://youtu.be/abc123');
    });

    it('handles youtube watch without video id using origin pathname', async () => {
      await setupSharePointStubs([makeBrandPresenceRow({
        Sources: 'https://www.youtube.com/watch',
        Topics: 'Vid',
      })]);
      const site = makeSite();

      const result = await computeTopicsFromBrandPresence(SITE_ID, { log }, site);
      expect(result[0].urls[0].url).to.match(/youtube\.com\/watch$/);
    });

    it('maps youtu.be hostname through DOMAIN_ALIASES', async () => {
      await setupSharePointStubs([makeBrandPresenceRow({
        Sources: 'https://youtu.be/xyz789',
        Topics: 'Short',
      })]);
      const site = makeSite();

      const result = await computeTopicsFromBrandPresence(SITE_ID, { log }, site);
      expect(result[0].urls[0].url).to.equal('https://youtu.be/xyz789');
    });

    it('strips trailing slash from normalized URLs (non-root path)', async () => {
      await setupSharePointStubs([makeBrandPresenceRow({
        Sources: 'https://www.reddit.com/r/foo/',
        Topics: 'Trailing',
      })]);
      const site = makeSite();

      const result = await computeTopicsFromBrandPresence(SITE_ID, { log }, site);
      expect(result[0].urls[0].url).to.equal('https://www.reddit.com/r/foo');
    });

    it('includes generic (non-offsite) normalized URLs', async () => {
      await setupSharePointStubs([makeBrandPresenceRow({
        Sources: 'https://news.otherdomain.com/story',
        Topics: 'News',
      })]);
      const site = makeSite();

      const result = await computeTopicsFromBrandPresence(SITE_ID, { log }, site);
      expect(result[0].urls[0].url).to.equal('https://news.otherdomain.com/story');
    });

    it('merges duplicate trackTopicUrl entries for same url (subPrompts set)', async () => {
      await setupSharePointStubs([
        makeBrandPresenceRow({ Sources: 'https://www.reddit.com/r/same', Topics: 'T', Prompt: 'a' }),
        makeBrandPresenceRow({ Sources: 'https://www.reddit.com/r/same', Topics: 'T', Prompt: 'b' }),
      ]);
      const site = makeSite();

      const result = await computeTopicsFromBrandPresence(SITE_ID, { log }, site);
      expect(result[0].urls[0].subPrompts.sort()).to.deep.equal(['a', 'b']);
    });

    it('excludes URLs matching the site own hostname when site is provided', async () => {
      await setupSharePointStubs([makeBrandPresenceRow({
        Sources: 'https://example.com/page;https://www.reddit.com/r/other',
        Topics: 'T',
        Category: 'C',
        Prompt: 'P',
      })]);
      const site = makeSite();

      const result = await computeTopicsFromBrandPresence(SITE_ID, { log }, site);

      expect(result).to.have.lengthOf(1);
      expect(result[0].urls).to.have.lengthOf(1);
      expect(result[0].urls[0].url).to.include('reddit.com');
    });

    it('logs a warning and skips site filter when baseURL is unparseable', async () => {
      await setupSharePointStubs([makeBrandPresenceRow({
        Sources: 'https://www.reddit.com/r/test',
        Topics: 'T',
        Category: 'C',
        Prompt: 'P',
      })]);
      const site = makeSite({ getBaseURL: () => 'not-a-valid-url' });

      const result = await computeTopicsFromBrandPresence(SITE_ID, { log }, site);

      expect(result).to.have.lengthOf(1);
      expect(log.warn).to.have.been.calledWithMatch(/Could not parse baseURL/);
    });
  });

  describe('getPreviousWeeks', () => {
    it('returns two week objects from the mocked isoCalendarWeek', () => {
      const weeks = getPreviousWeeks();
      expect(weeks).to.deep.equal([
        { week: DEFAULT_WEEK, year: DEFAULT_YEAR },
        { week: DEFAULT_WEEK_2, year: DEFAULT_YEAR },
      ]);
    });
  });

  describe('loadBrandPresenceData', () => {
    const previousWeeks = [{ week: DEFAULT_WEEK, year: DEFAULT_YEAR }];

    it('returns { data: rows } from PostgREST for brandalf org', async () => {
      const rows = [makeBrandPresenceRow()];
      const loadPostgrest = sandbox.stub().resolves({ data: rows });
      const mod = await esmockWithPostgrest({
        loadBrandPresenceDataFromPostgrest: loadPostgrest,
      });

      const result = await mod.loadBrandPresenceData({
        siteId: SITE_ID,
        previousWeeks,
        context: { log, dataAccess: { services: { postgrestClient: {} } } },
      });

      expect(result).to.deep.equal({ data: rows });
      expect(mockReadFromSP).to.not.have.been.called;
    });

    it('falls back to SharePoint fetch for brandalf org when PostgREST has no data', async () => {
      const mod = await esmockWithPostgrest();
      const site = makeSite();

      const result = await mod.loadBrandPresenceData({
        siteId: SITE_ID,
        site,
        previousWeeks,
        context: { log, dataAccess: {} },
      });

      expect(result).to.be.null;
      expect(log.info).to.have.been.calledWithMatch(
        /No PostgREST data for brandalf-enabled site/,
      );
    });

    it('returns data from SharePoint fetch when brandalf org has no PostgREST data', async () => {
      const row = makeBrandPresenceRow();
      await setupSharePointStubs([row]);
      const mod = await esmockWithPostgrest();
      const site = makeSite();

      const result = await mod.loadBrandPresenceData({
        siteId: SITE_ID,
        site,
        previousWeeks,
        context: { log, dataAccess: {} },
      });

      expect(result).to.not.be.null;
      expect(result.data).to.have.lengthOf(1);
      expect(result.data[0].Sources).to.equal(row.Sources);
      expect(result.data[0].Topics).to.equal(row.Topics);
      expect(log.info).to.have.been.calledWithMatch(
        /No PostgREST data for brandalf-enabled site/,
      );
    });

    it('returns null without legacy fetch when the brandalf flag state is unknown', async () => {
      const loadBrandPresenceDataFromPostgrest = sandbox.stub().resolves({
        data: [makeBrandPresenceRow()],
      });
      const mod = await esmockWithPostgrest({
        isBrandalfEnabled: sandbox.stub().resolves(null),
        loadBrandPresenceDataFromPostgrest,
      });

      const result = await mod.loadBrandPresenceData({
        siteId: SITE_ID,
        previousWeeks,
        context: { log, dataAccess: {} },
      });

      expect(result).to.be.null;
      expect(loadBrandPresenceDataFromPostgrest).to.not.have.been.called;
      expect(mockReadFromSP).to.not.have.been.called;
      expect(log.warn).to.have.been.calledWithMatch(
        /Brandalf flag state unknown/,
      );
    });

    it('returns { data: rows } from SharePoint for non-brandalf org', async () => {
      const row = makeBrandPresenceRow();
      await setupSharePointStubs([row]);
      const site = makeSite();

      const result = await loadBrandPresenceData({
        siteId: SITE_ID,
        site,
        previousWeeks,
        context: { log },
      });

      expect(result).to.not.be.null;
      expect(result.data).to.have.lengthOf(1);
      expect(result.data[0].Sources).to.equal(row.Sources);
    });

    it('reads brand presence sheets across a year boundary', async () => {
      const firstWeekRow = makeBrandPresenceRow({ Topics: 'Week 1' });
      const previousYearRow = makeBrandPresenceRow({ Topics: 'Week 52' });
      const qiPaths = [
        '/adobe/brand-presence/w1/brandpresence-copilot-w1-2026-010126.json',
        '/adobe/brand-presence/w52/brandpresence-gemini-w52-2025-122925.json',
      ];
      const qiBuffer = await makeQueryIndexBuffer(qiPaths);
      const bpBuffer1 = await makeBrandPresenceBuffer([firstWeekRow]);
      const bpBuffer2 = await makeBrandPresenceBuffer([previousYearRow]);

      let sheetCallIdx = 0;
      mockReadFromSP.callsFake(async (filename) => {
        if (filename === 'query-index.xlsx') {
          return qiBuffer;
        }
        sheetCallIdx += 1;
        return sheetCallIdx === 1 ? bpBuffer1 : bpBuffer2;
      });

      const site = makeSite();
      const result = await loadBrandPresenceData({
        siteId: SITE_ID,
        site,
        previousWeeks: [{ week: 1, year: 2026 }, { week: 52, year: 2025 }],
        context: { log },
      });

      expect(result).to.not.be.null;
      expect(result.data).to.have.lengthOf(2);
      expect(result.data[0].Topics).to.equal('Week 1');
      expect(result.data[1].Topics).to.equal('Week 52');
    });

    it('returns null when site cannot be resolved (non-brandalf)', async () => {
      const result = await loadBrandPresenceData({
        siteId: SITE_ID,
        previousWeeks,
        context: { log },
      });

      expect(result).to.be.null;
      expect(log.warn).to.have.been.calledWithMatch(
        /Cannot resolve site/,
      );
    });

    it('returns null when SharePoint query-index read fails (non-brandalf)', async () => {
      mockReadFromSP.rejects(new Error('SharePoint unavailable'));
      const site = makeSite();

      const result = await loadBrandPresenceData({
        siteId: SITE_ID,
        site,
        previousWeeks,
        context: { log },
      });

      expect(result).to.be.null;
      expect(log.error).to.have.been.calledWithMatch(
        /Error reading query-index from SharePoint/,
      );
    });

    it('resolves site via dataAccess when site is not provided', async () => {
      const row = makeBrandPresenceRow();
      await setupSharePointStubs([row]);
      const site = makeSite();
      const findById = sandbox.stub().resolves(site);

      const result = await loadBrandPresenceData({
        siteId: SITE_ID,
        previousWeeks,
        context: { log, dataAccess: { Site: { findById } } },
      });

      expect(findById).to.have.been.calledWith(SITE_ID);
      expect(result).to.not.be.null;
      expect(result.data).to.have.lengthOf(1);
    });
  });
});
