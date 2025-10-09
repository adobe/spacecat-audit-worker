import { expect } from 'chai';
import sinon from 'sinon';

import { buildProductMetatagsAuditResult } from '../../src/product-metatags/handler.js';

describe('buildProductMetatagsAuditResult', () => {
  const site = { getId: () => 'site-xyz' };
  const context = { env: { S3_SCRAPER_BUCKET_NAME: 'bucket' } };

  it('FF: both projectedTrafficLost and projectedTrafficValue falsy', () => {
    const res = buildProductMetatagsAuditResult({}, 'https://example.com', 0, 0, context, site);
    expect(res).to.have.property('detectedTags');
    expect(res).to.have.property('sourceS3Folder', 'bucket/scrapes/site-xyz/');
    expect(res).to.have.property('finalUrl', 'https://example.com');
    expect('projectedTrafficLost' in res).to.equal(false);
    expect('projectedTrafficValue' in res).to.equal(false);
  });

  it('TT: both projectedTrafficLost and projectedTrafficValue truthy', () => {
    const res = buildProductMetatagsAuditResult({}, 'https://example.com', 10, 200, context, site);
    expect(res).to.have.property('projectedTrafficLost', 10);
    expect(res).to.have.property('projectedTrafficValue', 200);
  });

  it('TF: only projectedTrafficLost truthy', () => {
    const res = buildProductMetatagsAuditResult({}, 'https://example.com', 5, 0, context, site);
    expect(res).to.have.property('projectedTrafficLost', 5);
    expect('projectedTrafficValue' in res).to.equal(false);
  });

  it('FT: only projectedTrafficValue truthy (edge case)', () => {
    const res = buildProductMetatagsAuditResult({}, 'https://example.com', 0, 1234, context, site);
    expect('projectedTrafficLost' in res).to.equal(false);
    expect(res).to.have.property('projectedTrafficValue', 1234);
  });
});

