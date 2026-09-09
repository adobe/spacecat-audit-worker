/* eslint-env mocha */
import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import { deriveFixedUrls, resolveBand, pageUrlsFromSuggestion } from '../../../src/gsc-search-analytics/derive.js';

use(sinonChai);

describe('pageUrlsFromSuggestion', () => {
  it('reads the type-specific key for each opportunity type', () => {
    expect(pageUrlsFromSuggestion('meta-tags', { url: 'https://k/a' })).to.deep.equal(['https://k/a']);
    expect(pageUrlsFromSuggestion('broken-internal-links', { urlFrom: 'https://k/from', urlTo: 'https://k/to' }))
      .to.deep.equal(['https://k/from']);
    expect(pageUrlsFromSuggestion('broken-backlinks', { url_to: 'https://k/to', url_from: 'https://ext/x' }))
      .to.deep.equal(['https://k/to']);
    expect(pageUrlsFromSuggestion('sitemap', { pageUrl: 'https://k/p', sitemapUrl: 'https://k/sm.xml' }))
      .to.deep.equal(['https://k/p']);
  });

  it('reads alt-text from nested recommendations[], deduped, and only for alt-text', () => {
    const data = { recommendations: [{ pageUrl: 'https://k/img' }, { pageUrl: 'https://k/img' }, { url: 'https://k/img2' }] };
    expect(pageUrlsFromSuggestion('alt-text', data)).to.deep.equal(['https://k/img', 'https://k/img2']);
    // a non-alt-text type that also carries a recommendations array must NOT take that branch
    expect(pageUrlsFromSuggestion('paid-traffic', data)).to.deep.equal([]);
  });

  it('falls back through common keys for an unmapped type and returns [] when nothing matches', () => {
    expect(pageUrlsFromSuggestion('some-new-type', { pageUrl: 'https://k/p' })).to.deep.equal(['https://k/p']);
    expect(pageUrlsFromSuggestion('meta-tags', { documentPath: '/content/site/en/a' })).to.deep.equal([]); // author path, not http
    expect(pageUrlsFromSuggestion('meta-tags', null)).to.deep.equal([]);
  });
});

describe('resolveBand', () => {
  const now = new Date('2026-09-01T00:00:00Z');

  it('backfills the full band when no input is given', () => {
    // ~13 months ago .. ~3 months ago
    expect(resolveBand({}, now)).to.deep.equal({ from: '2025-08-01', to: '2026-06-06' });
  });

  it('since:D shifts the from-edge to fixes matured since D (minus the ~87-day lag)', () => {
    const { from, to } = resolveBand({ since: '2026-08-01' }, now);
    expect(from).to.equal('2026-05-06'); // 2026-08-01 minus 87 days
    expect(to).to.equal('2026-06-06');
  });

  it('never lets since dip below the retention floor', () => {
    const { from } = resolveBand({ since: '2020-01-01' }, now);
    expect(from).to.equal('2025-08-01'); // clamped to floor, not 2019
  });

  it('explicit from/to override everything', () => {
    expect(resolveBand({ since: '2026-08-01', from: '2026-01-01', to: '2026-06-05' }, now))
      .to.deep.equal({ from: '2026-01-01', to: '2026-06-05' });
  });
});

const mkFe = (over) => ({
  getPublishedAt: () => null,
  getExecutedAt: () => '2026-05-04T10:00:00.000Z',
  getChangeDetails: () => ({}),
  getSuggestions: async () => [],
  ...over,
});

describe('deriveFixedUrls', () => {
  const sandbox = sinon.createSandbox();
  let context;
  let Opportunity;
  let FixEntity;

  beforeEach(() => {
    FixEntity = {
      STATUSES: { DEPLOYED: 'DEPLOYED', PUBLISHED: 'PUBLISHED' },
      allByOpportunityIdAndStatus: sandbox.stub().resolves([]),
    };
    Opportunity = { allBySiteId: sandbox.stub().resolves([]) };
    context = { log: { info: sandbox.stub(), warn: sandbox.stub(), error: sandbox.stub() }, dataAccess: { Opportunity, FixEntity } };
  });

  afterEach(() => sandbox.restore());

  it('pulls URL from changeDetails.url and type from the opportunity', async () => {
    Opportunity.allBySiteId.resolves([{ getId: () => 'op1', getType: () => 'meta-tags' }]);
    FixEntity.allByOpportunityIdAndStatus
      .withArgs('op1', 'DEPLOYED')
      .resolves([mkFe({ getChangeDetails: () => ({ url: 'https://krisshop.com/en/brands/loccitane.html' }) })]);

    const out = await deriveFixedUrls('site-1', { from: '2026-01-01', to: '2026-06-05' }, context);

    expect(out.fixedUrls).to.deep.equal([
      { url: 'https://krisshop.com/en/brands/loccitane.html', fixType: 'meta-tags', fixDate: '2026-05-04' },
    ]);
    expect(out.sourcing).to.include({ mode: 'backfill', truncated: false });
  });

  it('falls back to the linked suggestion, using the type-aware key (bbl uses urlFrom, not url)', async () => {
    Opportunity.allBySiteId.resolves([{ getId: () => 'op1', getType: () => 'broken-internal-links' }]);
    FixEntity.allByOpportunityIdAndStatus.withArgs('op1', 'DEPLOYED').resolves([mkFe({
      // broken-internal-links stores the fixed page under data.urlFrom — a plain data.url read would drop it
      getSuggestions: async () => [{ getData: () => ({ urlFrom: 'https://krisshop.com/en/x.html', urlTo: 'https://krisshop.com/en/target' }) }],
    })]);

    const out = await deriveFixedUrls('site-1', { from: '2026-01-01', to: '2026-06-05' }, context);
    expect(out.fixedUrls.map((f) => f.url)).to.deep.equal(['https://krisshop.com/en/x.html']);
  });

  it('excludes non-SEO opportunity types (SEO allow-list) without fetching their fix entities', async () => {
    Opportunity.allBySiteId.resolves([
      { getId: () => 'op1', getType: () => 'security-vulnerabilities' },
      { getId: () => 'op2', getType: () => 'paid-traffic' },
    ]);
    const out = await deriveFixedUrls('site-1', { from: '2026-01-01', to: '2026-06-05' }, context);
    expect(out.fixedUrls).to.deep.equal([]);
    expect(FixEntity.allByOpportunityIdAndStatus).to.not.have.been.called;
  });

  it('filters out fixes outside the date range', async () => {
    Opportunity.allBySiteId.resolves([{ getId: () => 'op1', getType: () => 'meta-tags' }]);
    FixEntity.allByOpportunityIdAndStatus.withArgs('op1', 'DEPLOYED').resolves([
      mkFe({ getExecutedAt: () => '2020-01-01T00:00:00Z', getChangeDetails: () => ({ url: 'https://k/old' }) }),
    ]);
    const out = await deriveFixedUrls('site-1', { from: '2026-01-01', to: '2026-06-05' }, context);
    expect(out.fixedUrls).to.deep.equal([]);
  });

  it('honours fixTypes filter and dedupes on (url, fixDate)', async () => {
    Opportunity.allBySiteId.resolves([
      { getId: () => 'op1', getType: () => 'meta-tags' },
      { getId: () => 'op2', getType: () => 'alt-text' },
    ]);
    FixEntity.allByOpportunityIdAndStatus.withArgs('op1', 'DEPLOYED').resolves([
      mkFe({ getChangeDetails: () => ({ url: 'https://k/a' }) }),
      mkFe({ getChangeDetails: () => ({ url: 'https://k/a' }) }), // dup
    ]);
    const out = await deriveFixedUrls('site-1', { from: '2026-01-01', to: '2026-06-05', fixTypes: ['meta-tags'] }, context);
    expect(out.fixedUrls).to.have.length(1);
    expect(FixEntity.allByOpportunityIdAndStatus).to.not.have.been.calledWith('op2', 'DEPLOYED');
  });

  it('explicit fixTypes:[alt-text] overrides the default set (alt-text not in SEO_FIX_TYPES)', async () => {
    Opportunity.allBySiteId.resolves([{ getId: () => 'op1', getType: () => 'alt-text' }]);
    FixEntity.allByOpportunityIdAndStatus.withArgs('op1', 'DEPLOYED').resolves([mkFe({
      getSuggestions: async () => [{ getData: () => ({ recommendations: [{ pageUrl: 'https://k/en/img.html' }] }) }],
    })]);
    const out = await deriveFixedUrls('site-1', { from: '2026-01-01', to: '2026-06-05', fixTypes: ['alt-text'] }, context);
    expect(out.fixedUrls.map((f) => f.url)).to.deep.equal(['https://k/en/img.html']);
  });

  it('bounds a wide backfill to the newest MAX_DATE_GROUPS and flags truncation', async () => {
    // 31 distinct fix-dates, one URL each — exceeds the 30-group cap by one.
    const opps = [];
    for (let i = 0; i < 31; i += 1) {
      const id = `op${i}`;
      const date = `2026-06-${String(i + 1).padStart(2, '0')}`; // wide spread within band
      opps.push({ getId: () => id, getType: () => 'meta-tags' });
      FixEntity.allByOpportunityIdAndStatus.withArgs(id, 'DEPLOYED').resolves([mkFe({
        getExecutedAt: () => `${date}T00:00:00Z`,
        getChangeDetails: () => ({ url: `https://k/en/p${i}` }),
      })]);
    }
    Opportunity.allBySiteId.resolves(opps);
    const out = await deriveFixedUrls('site-1', { from: '2026-01-01', to: '2026-07-15' }, context); // backfill (no since)
    const distinctDates = new Set(out.fixedUrls.map((f) => f.fixDate));
    expect(distinctDates.size).to.equal(30); // capped
    expect(out.sourcing).to.include({ truncated: true, sourcedDateGroups: 31, keptDateGroups: 30 });
  });

  it('caps URLs to MAX_FIXED_URLS within the kept date-groups and flags truncation', async () => {
    // 1 deploy-date, 600 distinct URLs — under the 30-date cap but over the 500-URL cap.
    const suggestions = [];
    for (let i = 0; i < 600; i += 1) {
      suggestions.push({ getData: () => ({ url: `https://k/en/p${i}` }) });
    }
    Opportunity.allBySiteId.resolves([{ getId: () => 'op1', getType: () => 'meta-tags' }]);
    FixEntity.allByOpportunityIdAndStatus.withArgs('op1', 'DEPLOYED').resolves([mkFe({
      getExecutedAt: () => '2026-05-04T00:00:00Z',
      getSuggestions: async () => suggestions, // changeDetails.url absent → suggestion path
    })]);
    const out = await deriveFixedUrls('site-1', { from: '2026-01-01', to: '2026-07-15' }, context);
    expect(out.fixedUrls).to.have.length(500); // urlTruncated branch exercised
    expect(out.sourcing).to.include({ truncated: true, keptDateGroups: 1 });
  });

  it('prefers getPublishedAt over getExecutedAt when present', async () => {
    Opportunity.allBySiteId.resolves([{ getId: () => 'op1', getType: () => 'meta-tags' }]);
    FixEntity.allByOpportunityIdAndStatus.withArgs('op1', 'DEPLOYED').resolves([mkFe({
      getPublishedAt: () => '2026-05-10T09:00:00Z', // published wins over executed
      getExecutedAt: () => '2026-05-04T10:00:00Z',
      getChangeDetails: () => ({ url: 'https://k/pub' }),
    })]);
    const out = await deriveFixedUrls('site-1', { from: '2026-01-01', to: '2026-06-05' }, context);
    expect(out.fixedUrls).to.deep.equal([{ url: 'https://k/pub', fixType: 'meta-tags', fixDate: '2026-05-10' }]);
  });

  it('skips a fix entity with neither published nor executed date', async () => {
    Opportunity.allBySiteId.resolves([{ getId: () => 'op1', getType: () => 'meta-tags' }]);
    FixEntity.allByOpportunityIdAndStatus.withArgs('op1', 'DEPLOYED').resolves([mkFe({
      getPublishedAt: () => null,
      getExecutedAt: () => null, // raw null -> fixDate null -> filtered out of range
      getChangeDetails: () => ({ url: 'https://k/x' }),
    })]);
    const out = await deriveFixedUrls('site-1', { from: '2026-01-01', to: '2026-06-05' }, context);
    expect(out.fixedUrls).to.deep.equal([]);
  });

  it('tolerates missing getChangeDetails/getSuggestions accessors', async () => {
    Opportunity.allBySiteId.resolves([{ getId: () => 'op1', getType: () => 'meta-tags' }]);
    FixEntity.allByOpportunityIdAndStatus.withArgs('op1', 'DEPLOYED').resolves([{
      getPublishedAt: () => null,
      getExecutedAt: () => '2026-05-04T00:00:00Z',
      getChangeDetails: undefined, // exercises `?.` + `?? {}` fallback
      getSuggestions: undefined, // exercises `?.` + `?? []` fallback
    }]);
    const out = await deriveFixedUrls('site-1', { from: '2026-01-01', to: '2026-06-05' }, context);
    expect(out.fixedUrls).to.deep.equal([]);
  });

  it('reports incremental mode when since is supplied', async () => {
    const out = await deriveFixedUrls('site-1', { since: '2026-08-01' }, context);
    expect(out.sourcing.mode).to.equal('incremental'); // opts.since truthy branch
  });
});
