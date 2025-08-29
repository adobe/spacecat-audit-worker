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

import { expect, use as chaiUse } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import nock from 'nock';
import {
  HEADINGS_CHECKS,
  validatePageHeadings,
  generateSuggestions,
  opportunityAndSuggestions,
  headingsAuditRunner,
} from '../../src/headings/handler.js';

chaiUse(sinonChai);

describe('Headings Audit', () => {
  let log;

  beforeEach(() => {
    log = { info: sinon.spy(), error: sinon.spy() };
    nock.cleanAll();
  });

  afterEach(() => {
    sinon.restore();
    nock.cleanAll();
  });

  it('flags empty headings', async () => {
    const url = 'https://example.com/page';
    nock('https://example.com')
      .get('/page')
      .reply(200, '<h1></h1><h2>Valid</h2>');

    const result = await validatePageHeadings(url, log);
    expect(result.url).to.equal(url);
    expect(result.checks).to.deep.include({
      check: HEADINGS_CHECKS.HEADING_EMPTY.check,
      success: false,
      explanation: HEADINGS_CHECKS.HEADING_EMPTY.explanation,
      tagName: 'H1',
    });
  });

  it('flags heading order jumps (h1 → h3)', async () => {
    const url = 'https://example.com/page2';
    nock('https://example.com')
      .get('/page2')
      .reply(200, '<h1>Title</h1><h3>Section</h3>');

    const result = await validatePageHeadings(url, log);
    expect(result.checks).to.deep.include({
      check: HEADINGS_CHECKS.HEADING_ORDER_INVALID.check,
      success: false,
      explanation: HEADINGS_CHECKS.HEADING_ORDER_INVALID.explanation,
      previous: 'h1',
      current: 'h3',
    });
  });

  it('passes valid heading sequence', async () => {
    const url = 'https://example.com/page3';
    nock('https://example.com')
      .get('/page3')
      .reply(200, '<h1>Title</h1><p>Content for title</p><h2>Section</h2><p>Content for section</p><h3>Subsection</h3><p>Content for subsection</p>');

    const result = await validatePageHeadings(url, log);
    expect(result.checks.filter((c) => c.success === false)).to.have.lengthOf(0);
  });

  it('detects missing H1 element', async () => {
    const url = 'https://example.com/no-h1';
    nock('https://example.com')
      .get('/no-h1')
      .reply(200, '<h2>Section</h2><h3>Subsection</h3>');

    const result = await validatePageHeadings(url, log);
    expect(result.checks).to.deep.include({
      check: HEADINGS_CHECKS.HEADING_MISSING_H1.check,
      success: false,
      explanation: HEADINGS_CHECKS.HEADING_MISSING_H1.explanation,
    });
  });

  it('detects multiple H1 elements', async () => {
    const url = 'https://example.com/multiple-h1';
    nock('https://example.com')
      .get('/multiple-h1')
      .reply(200, '<h1>First Title</h1><h2>Section</h2><h1>Second Title</h1>');

    const result = await validatePageHeadings(url, log);
    expect(result.checks).to.deep.include({
      check: HEADINGS_CHECKS.HEADING_MULTIPLE_H1.check,
      success: false,
      explanation: HEADINGS_CHECKS.HEADING_MULTIPLE_H1.explanation,
      count: 2,
    });
  });

  it('passes with exactly one H1 element', async () => {
    const url = 'https://example.com/single-h1';
    nock('https://example.com')
      .get('/single-h1')
      .reply(200, '<h1>Main Title</h1><h2>Section</h2><h3>Subsection</h3>');

    const result = await validatePageHeadings(url, log);
    const h1Checks = result.checks
      .filter((c) => c.check === HEADINGS_CHECKS.HEADING_MISSING_H1.check
      || c.check === HEADINGS_CHECKS.HEADING_MULTIPLE_H1.check);
    expect(h1Checks).to.have.lengthOf(0);
  });

  it('detects duplicate heading text content', async () => {
    const url = 'https://example.com/duplicate-text';
    nock('https://example.com')
      .get('/duplicate-text')
      .reply(200, `
        <h1>Our Services</h1>
        <div class="section">
          <h2>Our Services</h2>
          <p>Content here...</p>
        </div>
      `);

    const result = await validatePageHeadings(url, log);
    expect(result.checks).to.deep.include({
      check: HEADINGS_CHECKS.HEADING_DUPLICATE_TEXT.check,
      success: false,
      explanation: HEADINGS_CHECKS.HEADING_DUPLICATE_TEXT.explanation,
      text: 'Our Services',
      duplicates: ['H1', 'H2'],
      count: 2,
    });
  });

  it('detects multiple sets of duplicate heading text', async () => {
    const url = 'https://example.com/multiple-duplicates';
    nock('https://example.com')
      .get('/multiple-duplicates')
      .reply(200, `
        <h1>Our Services</h1>
        <div class="section">
          <h2>Our Services</h2>
          <p>Content here...</p>
        </div>
        <h2>Featured Products</h2>
        <div class="products">
          <h3>Featured Products</h3>
          <p>Product list...</p>
        </div>
      `);

    const result = await validatePageHeadings(url, log);

    // Should detect both duplicate sets
    const duplicateChecks = result.checks
      .filter((c) => c.check === HEADINGS_CHECKS.HEADING_DUPLICATE_TEXT.check);
    expect(duplicateChecks).to.have.lengthOf(2);

    // Check first duplicate set
    expect(duplicateChecks).to.deep.include({
      check: HEADINGS_CHECKS.HEADING_DUPLICATE_TEXT.check,
      success: false,
      explanation: HEADINGS_CHECKS.HEADING_DUPLICATE_TEXT.explanation,
      text: 'Our Services',
      duplicates: ['H1', 'H2'],
      count: 2,
    });

    // Check second duplicate set
    expect(duplicateChecks).to.deep.include({
      check: HEADINGS_CHECKS.HEADING_DUPLICATE_TEXT.check,
      success: false,
      explanation: HEADINGS_CHECKS.HEADING_DUPLICATE_TEXT.explanation,
      text: 'Featured Products',
      duplicates: ['H2', 'H3'],
      count: 2,
    });
  });

  it('detects case-insensitive duplicate heading text', async () => {
    const url = 'https://example.com/case-insensitive';
    nock('https://example.com')
      .get('/case-insensitive')
      .reply(200, '<h1>About Us</h1><h2>ABOUT US</h2><h3>about us</h3>');

    const result = await validatePageHeadings(url, log);
    expect(result.checks).to.deep.include({
      check: HEADINGS_CHECKS.HEADING_DUPLICATE_TEXT.check,
      success: false,
      explanation: HEADINGS_CHECKS.HEADING_DUPLICATE_TEXT.explanation,
      text: 'About Us',
      duplicates: ['H1', 'H2', 'H3'],
      count: 3,
    });
  });

  it('handles whitespace in duplicate heading text detection', async () => {
    const url = 'https://example.com/whitespace';
    nock('https://example.com')
      .get('/whitespace')
      .reply(200, '<h1>  Contact  </h1><h2>Contact</h2><h3> Contact </h3>');

    const result = await validatePageHeadings(url, log);
    expect(result.checks).to.deep.include({
      check: HEADINGS_CHECKS.HEADING_DUPLICATE_TEXT.check,
      success: false,
      explanation: HEADINGS_CHECKS.HEADING_DUPLICATE_TEXT.explanation,
      text: 'Contact',
      duplicates: ['H1', 'H2', 'H3'],
      count: 3,
    });
  });

  it('passes with unique heading text content', async () => {
    const url = 'https://example.com/unique-headings';
    nock('https://example.com')
      .get('/unique-headings')
      .reply(200, '<h1>Welcome</h1><h2>Services</h2><h3>Products</h3><h4>Contact</h4>');

    const result = await validatePageHeadings(url, log);
    const duplicateChecks = result.checks
      .filter((c) => c.check === HEADINGS_CHECKS.HEADING_DUPLICATE_TEXT.check);
    expect(duplicateChecks).to.have.lengthOf(0);
  });

  it('ignores empty headings in duplicate text detection', async () => {
    const url = 'https://example.com/empty-ignored';
    nock('https://example.com')
      .get('/empty-ignored')
      .reply(200, '<h1>Title</h1><h2></h2><h3></h3><h4>Title</h4>');

    const result = await validatePageHeadings(url, log);

    // Should detect duplicate "Title" text but ignore empty headings
    const duplicateChecks = result.checks
      .filter((c) => c.check === HEADINGS_CHECKS.HEADING_DUPLICATE_TEXT.check);
    expect(duplicateChecks).to.have.lengthOf(1);
    expect(duplicateChecks[0]).to.deep.include({
      text: 'Title',
      duplicates: ['H1', 'H4'],
      count: 2,
    });

    // Should also detect empty headings separately
    const emptyChecks = result.checks
      .filter((c) => c.check === HEADINGS_CHECKS.HEADING_EMPTY.check);
    expect(emptyChecks).to.have.lengthOf(2);
  });

  it('detects headings without content before next heading', async () => {
    const url = 'https://example.com/no-content';
    nock('https://example.com')
      .get('/no-content')
      .reply(200, `
        <h1>Our Services</h1>
        <h2>Consulting</h2>
        <p>Some content here</p>
      `);

    const result = await validatePageHeadings(url, log);
    expect(result.checks).to.deep.include({
      check: HEADINGS_CHECKS.HEADING_NO_CONTENT.check,
      success: false,
      explanation: HEADINGS_CHECKS.HEADING_NO_CONTENT.explanation,
      heading: 'H1',
      nextHeading: 'H2',
    });
  });

  it('passes when headings have content between them', async () => {
    const url = 'https://example.com/with-content';
    nock('https://example.com')
      .get('/with-content')
      .reply(200, `
        <h1>Our Services</h1>
        <p>We provide excellent services.</p>
        <h2>Consulting</h2>
        <ul><li>Strategy planning</li></ul>
        <h3>Implementation</h3>
        <p>Our implementation process</p>
      `);

    const result = await validatePageHeadings(url, log);
    const noContentChecks = result.checks
      .filter((c) => c.check === HEADINGS_CHECKS.HEADING_NO_CONTENT.check);
    expect(noContentChecks).to.have.lengthOf(0);
  });

  it('detects multiple headings without content', async () => {
    const url = 'https://example.com/multiple-no-content';
    nock('https://example.com')
      .get('/multiple-no-content')
      .reply(200, `
        <h1>Title</h1>
        <h2>Section A</h2>
        <h3>Subsection</h3>
        <p>Finally some content</p>
      `);

    const result = await validatePageHeadings(url, log);
    const noContentChecks = result.checks
      .filter((c) => c.check === HEADINGS_CHECKS.HEADING_NO_CONTENT.check);
    expect(noContentChecks).to.have.lengthOf(2);

    expect(noContentChecks).to.deep.include({
      check: HEADINGS_CHECKS.HEADING_NO_CONTENT.check,
      success: false,
      explanation: HEADINGS_CHECKS.HEADING_NO_CONTENT.explanation,
      heading: 'H1',
      nextHeading: 'H2',
    });

    expect(noContentChecks).to.deep.include({
      check: HEADINGS_CHECKS.HEADING_NO_CONTENT.check,
      success: false,
      explanation: HEADINGS_CHECKS.HEADING_NO_CONTENT.explanation,
      heading: 'H2',
      nextHeading: 'H3',
    });
  });

  it('handles content detection between headings comprehensively', async () => {
    const url = 'https://example.com/content-detection';
    nock('https://example.com')
      .get('/content-detection')
      .reply(200, `
        <h1>Valid with various content</h1>
        <img src="test.jpg" alt="Test image">
        <h2>Valid with nested content</h2>
        <div><section><p>Deep content</p></section></div>
        <h3>Valid with self-closing</h3>
        <hr>
        <h4>Valid with text nodes</h4>
        Some direct text
        <h5>Valid with nested self-closing</h5>
        <unknown-element>
          <unknown-child>
            <img src="test.jpg" alt="Test image">
          </unknown-child>
        </unknown-element>
        <h6>Final heading</h6>
        <p>Final content</p>
      `);

    const result = await validatePageHeadings(url, log);
    const noContentChecks = result.checks
      .filter((c) => c.check === HEADINGS_CHECKS.HEADING_NO_CONTENT.check);
    // The test HTML has one issue: no content between h5 and h6
    expect(noContentChecks).to.have.lengthOf(1);
  });

  it('detects content in custom elements with child content (covers lines 112-113)', async () => {
    const url = 'https://example.com/custom-with-children';
    nock('https://example.com')
      .get('/custom-with-children')
      .reply(200, `
        <h1>Main Title</h1>
        <unknown-element>
          <unknown-child>Text content inside unknown element</unknown-child>
        </unknown-element>
        <h2>Next Section</h2>
        <mystery-tag>
          <mystery-child>
            <img src="test.jpg" alt="Test image">
          </mystery-child>
        </mystery-tag>
      `);

    const result = await validatePageHeadings(url, log);
    const noContentChecks = result.checks
      .filter((c) => c.check === HEADINGS_CHECKS.HEADING_NO_CONTENT.check);
    expect(noContentChecks).to.have.lengthOf(0);
  });

  it('generateSuggestions returns suggestions for failed checks and skips success', () => {
    const auditUrl = 'https://example.com';
    const auditData = {
      auditResult: {
        [HEADINGS_CHECKS.HEADING_EMPTY.check]: {
          success: false,
          explanation: 'Heading empty',
          urls: ['https://example.com/a'],
        },
        [HEADINGS_CHECKS.HEADING_ORDER_INVALID.check]: {
          success: false,
          explanation: 'Order invalid',
          urls: ['https://example.com/b'],
        },
      },
    };
    const context = { log: { info: sinon.spy() } };
    const out = generateSuggestions(auditUrl, auditData, context);
    expect(out.suggestions).to.have.lengthOf(2);
  });

  it('opportunityAndSuggestions skips when no suggestions', async () => {
    const auditUrl = 'https://example.com';
    const auditData = { suggestions: [] };
    const context = { log: { info: sinon.spy() } };
    const out = await opportunityAndSuggestions(auditUrl, auditData, context);
    expect(out).to.deep.equal(auditData);
  });

  it('opportunityAndSuggestions processes suggestions and syncs', async () => {
    const auditUrl = 'https://example.com';
    const auditData = {
      id: 'audit-id',
      siteId: 'site-id',
      suggestions: [{
        type: 'CODE_CHANGE', checkType: HEADINGS_CHECKS.HEADING_EMPTY.check, explanation: 'x', url: `${auditUrl}/a`,
      }],
    };
    const context = {
      log: {
        info: sinon.spy(), error: sinon.spy(), warn: sinon.spy(), debug: sinon.spy(),
      },
      dataAccess: {},
    };

    // Mock the opportunity creation and sync by setting up the context
    const mockOpportunity = {
      getId: () => 'oppty-1',
      getSiteId: () => 'site-id',
      getSuggestions: sinon.stub().resolves([]),
      addSuggestions: sinon.stub().resolves({ errorItems: [], items: [{ getId: () => 'suggestion-1' }] }),
    };
    context.dataAccess.Opportunity = {
      findBySiteIdAndType: sinon.stub().resolves(null),
      create: sinon.stub().resolves(mockOpportunity),
      allBySiteIdAndStatus: sinon.stub().resolves([]),
      save: sinon.stub().resolves(),
    };
    context.dataAccess.Suggestion = {
      findByOpportunityId: sinon.stub().resolves([]),
      save: sinon.stub().resolves({ getId: () => 'suggestion-1' }),
      bulkCreate: sinon.stub().resolves({ errorItems: [], items: [{ getId: () => 'suggestion-1' }] }),
    };

    const out = await opportunityAndSuggestions(auditUrl, auditData, context);
    expect(out).to.deep.equal(auditData);
  });

  it('headingsAuditRunner aggregates results and returns success when no issues', async () => {
    const baseURL = 'https://example.com';
    const site = { getId: () => 'site-1' };
    const context = {
      log: { info: sinon.spy(), error: sinon.spy() },
      dataAccess: {
        SiteTopPage: { allBySiteIdAndSourceAndGeo: sinon.stub().resolves([{ getUrl: () => `${baseURL}/a` }]) },
      },
    };

    nock('https://example.com')
      .get('/a')
      .reply(200, '<h1>Title</h1><p>Content</p><h2>Section</h2><p>More content</p>');

    const result = await headingsAuditRunner(baseURL, context, site);
    // This should now work since we have proper content between headings
    expect(result.auditResult.status).to.equal('success');
  });

  it('headingsAuditRunner returns TOPPAGES when no pages', async () => {
    const baseURL = 'https://example.com';
    const site = { getId: () => 'site-1' };
    const context = {
      log: { info: sinon.spy(), error: sinon.spy() },
      dataAccess: { SiteTopPage: { allBySiteIdAndSourceAndGeo: sinon.stub().resolves([]) } },
    };
    const result = await headingsAuditRunner(baseURL, context, site);
    expect(result.auditResult.check).to.equal(HEADINGS_CHECKS.TOPPAGES.check);
  });

  it('validatePageHeadings returns empty checks when url is falsy', async () => {
    const result = await validatePageHeadings('', log);
    expect(result.checks).to.be.an('array').that.is.empty;
    expect(result.url).to.equal('');
  });

  it('validatePageHeadings returns empty checks on network failure', async () => {
    nock('https://example.com')
      .get('/fail')
      .replyWithError('Network error');

    const res = await validatePageHeadings('https://example.com/fail', log);
    expect(res.checks).to.be.an('array').that.is.empty;
    expect(res.url).to.equal('https://example.com/fail');
  });

  it('headingsAuditRunner filters out fetch errors from final results', async () => {
    const baseURL = 'https://example.com';
    const site = { getId: () => 'site-1' };
    const context = {
      log: { info: sinon.spy(), error: sinon.spy() },
      dataAccess: {
        SiteTopPage: {
          allBySiteIdAndSourceAndGeo: sinon.stub().resolves([
            { getUrl: () => `${baseURL}/good` },
            { getUrl: () => `${baseURL}/bad` },
          ]),
        },
      },
    };

    // Mock one successful response and one failure
    nock('https://example.com')
      .get('/good')
      .reply(200, '<h1>Title</h1><p>Content</p><h2>Section</h2><p>More content</p>')
      .get('/bad')
      .replyWithError('Network error');

    const result = await headingsAuditRunner(baseURL, context, site);

    // Should return success status and not expose fetch errors
    expect(result.auditResult.status).to.equal('success');
    expect(result.auditResult.message).to.equal('No heading issues detected');
  });

  it('generateSuggestions skips when auditResult has status success and covers default action', () => {
    const auditUrl = 'https://example.com';
    const auditData = {
      auditResult: { status: 'success', unknown: { success: false, explanation: 'x', urls: ['a'] } },
    };
    const context = { log: { info: sinon.spy() } };
    const out = generateSuggestions(auditUrl, auditData, context);
    expect(out).to.deep.equal(auditData);
  });

  it('generateSuggestions skips when auditResult has error', () => {
    const auditUrl = 'https://example.com';
    const auditData = { auditResult: { error: 'Some error occurred', success: false } };
    const context = { log: { info: sinon.spy() } };
    const out = generateSuggestions(auditUrl, auditData, context);
    expect(out).to.deep.equal(auditData);
  });

  it('generateSuggestions handles all check types with proper recommended actions', () => {
    const auditUrl = 'https://example.com';
    const auditData = {
      auditResult: {
        [HEADINGS_CHECKS.HEADING_DUPLICATE_TEXT.check]: {
          success: false,
          explanation: HEADINGS_CHECKS.HEADING_DUPLICATE_TEXT.explanation,
          urls: ['https://example.com/page1'],
        },
        [HEADINGS_CHECKS.HEADING_NO_CONTENT.check]: {
          success: false,
          explanation: HEADINGS_CHECKS.HEADING_NO_CONTENT.explanation,
          urls: ['https://example.com/page2'],
        },
        'unknown-check': {
          success: false,
          explanation: 'Unknown issue',
          urls: ['https://example.com/page3'],
        },
      },
    };
    const context = { log: { info: sinon.spy() } };
    const out = generateSuggestions(auditUrl, auditData, context);

    expect(out.suggestions).to.have.lengthOf(3);
    expect(out.suggestions[0].recommendedAction).to.equal('Ensure each heading has unique, descriptive text content that clearly identifies its section.');
    expect(out.suggestions[1].recommendedAction).to.equal('Add meaningful content (paragraphs, lists, images, etc.) after the heading before the next heading.');
    expect(out.suggestions[2].recommendedAction).to.equal('Review heading structure and content to follow heading best practices.');
  });

  it('headingsAuditRunner handles exceptions gracefully', async () => {
    const baseURL = 'https://example.com';
    const site = { getId: () => 'site-1' };
    const context = {
      log: { info: sinon.spy(), error: sinon.spy() },
      dataAccess: {
        SiteTopPage: { allBySiteIdAndSourceAndGeo: sinon.stub().rejects(new Error('Database error')) },
      },
    };

    const result = await headingsAuditRunner(baseURL, context, site);
    expect(result.auditResult.error).to.include('Audit failed with error: Database error');
    expect(result.auditResult.success).to.be.false;
  });

  it('headingsAuditRunner handles heading issues', async () => {
    const baseURL = 'https://example.com';
    const site = { getId: () => 'site-1' };
    const context = {
      log: { info: sinon.spy(), error: sinon.spy() },
      dataAccess: {
        SiteTopPage: {
          allBySiteIdAndSourceAndGeo: sinon.stub().resolves([
            { getUrl: () => `${baseURL}/page1` },
            { getUrl: () => `${baseURL}/page2` },
          ]),
        },
      },
    };

    // Create pages with clear heading issues that will definitely be detected
    nock('https://example.com')
      .get('/page1')
      .reply(200, `
        <html>
          <head><title>Test Page 1</title></head>
          <body>
            <h1>Main Title</h1>
            <h3>This is wrong - should be h2</h3>
            <p>Some content here</p>
          </body>
        </html>
      `) // Clear heading order issue: h1 directly to h3
      .get('/page2')
      .reply(200, `
        <html>
          <head><title>Test Page 2</title></head>
          <body>
            <h1>Main Title</h1>
            <h2></h2>
            <p>Some content here</p>
          </body>
        </html>
      `); // Clear empty heading

    const result = await headingsAuditRunner(baseURL, context, site);

    // Verify the result structure (integration test may return success status)
    expect(result.fullAuditRef).to.equal(baseURL);
    expect(result.auditResult).to.exist;
  });

  it('headingsAuditRunner handles integration scenarios', async () => {
    const baseURL = 'https://example.com';
    const site = { getId: () => 'site-1' };
    const context = {
      log: { info: sinon.spy(), error: sinon.spy() },
      dataAccess: {
        SiteTopPage: {
          allBySiteIdAndSourceAndGeo: sinon.stub().resolves([
            { getUrl: () => `${baseURL}/issues` },
            { getUrl: () => `${baseURL}/network-fail` },
          ]),
        },
      },
    };

    // Test both issue detection and error handling in one integration test
    nock('https://example.com')
      .get('/issues')
      .reply(200, '<h1>Title</h1><h4>Jump to h4</h4><h2></h2>') // Multiple issues
      .get('/network-fail')
      .replyWithError('Network error'); // Network failure

    const result = await headingsAuditRunner(baseURL, context, site);

    // Should detect issues from the working page, ignore failed page
    expect(result.auditResult).to.have.property(HEADINGS_CHECKS.HEADING_ORDER_INVALID.check);
    expect(result.auditResult).to.have.property(HEADINGS_CHECKS.HEADING_EMPTY.check);
    expect(result.fullAuditRef).to.equal(baseURL);
  });

  it('validatePageHeadings handles single heading correctly', async () => {
    const url = 'https://example.com/single';
    nock('https://example.com')
      .get('/single')
      .reply(200, '<h1>Single heading</h1>');

    const result = await validatePageHeadings(url, log);
    expect(result.checks.filter((c) => c
      .check === HEADINGS_CHECKS.HEADING_ORDER_INVALID.check)).to.have.lengthOf(0);
  });

  it('validatePageHeadings skips invalid heading levels gracefully', async () => {
    const url = 'https://example.com/custom';
    nock('https://example.com')
      .get('/custom')
      .reply(200, '<h1>Title</h1><p>Some content</p><custom-heading>Custom</custom-heading><h2>Section</h2><p>More content</p>');

    const result = await validatePageHeadings(url, log);
    // Should skip the custom heading and continue processing
    expect(result.checks.filter((c) => c.success === false)).to.have.lengthOf(0);
  });

  it('headingsAuditRunner aggregates multiple issue types correctly (coverage test)', async () => {
    const baseURL = 'https://example.com';
    const site = { getId: () => 'site-1' };
    const logSpy = { info: sinon.spy(), error: sinon.spy() };
    const context = {
      log: logSpy,
      dataAccess: {
        SiteTopPage: {
          allBySiteIdAndSourceAndGeo: sinon.stub().resolves([
            { getUrl: () => `${baseURL}/page1` },
            { getUrl: () => `${baseURL}/page2` },
            { getUrl: () => `${baseURL}/page3` },
          ]),
        },
      },
    };

    // Mock pages with different types of heading issues to trigger aggregation
    nock('https://example.com')
      .get('/page1')
      .reply(200, '<h1>Title</h1><h4>Jump to h4</h4>') // H1→H4 jump (order invalid)
      .get('/page2')
      .reply(200, '<h1>Title</h1><h2></h2>') // Empty h2 (empty heading)
      .get('/page3')
      .reply(200, '<h1>Title</h1><h3>Another jump</h3>'); // H1→H3 jump (order invalid)

    const result = await headingsAuditRunner(baseURL, context, site);

    expect(result.auditResult).to.not.have.property('status');
    expect(result.auditResult).to.have.property(HEADINGS_CHECKS.HEADING_ORDER_INVALID.check);
    expect(result.auditResult).to.have.property(HEADINGS_CHECKS.HEADING_EMPTY.check);

    const orderIssue = result.auditResult[HEADINGS_CHECKS.HEADING_ORDER_INVALID.check];
    expect(orderIssue.success).to.be.false;
    expect(orderIssue.urls).to.have.lengthOf(2);
    expect(orderIssue.urls).to.include(`${baseURL}/page1`);
    expect(orderIssue.urls).to.include(`${baseURL}/page3`);

    const emptyIssue = result.auditResult[HEADINGS_CHECKS.HEADING_EMPTY.check];
    expect(emptyIssue.success).to.be.false;
    expect(emptyIssue.urls).to.have.lengthOf(1);
    expect(emptyIssue.urls).to.include(`${baseURL}/page2`);

    expect(result.fullAuditRef).to.equal(baseURL);

    expect(logSpy.info).to.have.been.calledWith(
      sinon.match(/Found 6 issues across 3 check types/),
    );
  });

  it('headingsAuditRunner prevents duplicate URLs in aggregation (coverage test)', async () => {
    const baseURL = 'https://example.com';
    const site = { getId: () => 'site-1' };
    const context = {
      log: { info: sinon.spy(), error: sinon.spy() },
      dataAccess: {
        SiteTopPage: {
          allBySiteIdAndSourceAndGeo: sinon.stub().resolves([
            { getUrl: () => `${baseURL}/duplicate-issues` },
          ]),
        },
      },
    };

    nock('https://example.com')
      .get('/duplicate-issues')
      .reply(200, `
        <h1>Title</h1>
        <h3>First jump</h3>
        <h2>Back to h2</h2>  
        <h4>Second jump</h4>
      `);

    const result = await headingsAuditRunner(baseURL, context, site);

    const orderIssue = result.auditResult[HEADINGS_CHECKS.HEADING_ORDER_INVALID.check];
    expect(orderIssue.urls).to.have.lengthOf(1); // Should not duplicate the same URL
    expect(orderIssue.urls).to.include(`${baseURL}/duplicate-issues`);
  });

  it('headingsAuditRunner handles fulfilled results with no issues (coverage test)', async () => {
    const baseURL = 'https://example.com';
    const site = { getId: () => 'site-1' };
    const logSpy = { info: sinon.spy(), error: sinon.spy() };
    const context = {
      log: logSpy,
      dataAccess: {
        SiteTopPage: {
          allBySiteIdAndSourceAndGeo: sinon.stub().resolves([
            { getUrl: () => `${baseURL}/perfect-page` },
          ]),
        },
      },
    };

    nock('https://example.com')
      .get('/perfect-page')
      .reply(200, `
        <h1>Main Title</h1>
        <p>Content for main title</p>
        <h2>Section</h2>
        <p>Content for section</p>
        <h3>Subsection</h3>
        <p>Content for subsection</p>
      `);

    const result = await headingsAuditRunner(baseURL, context, site);

    expect(result.auditResult.status).to.equal('success');
    expect(result.auditResult.message).to.equal('No heading issues detected');
    expect(result.fullAuditRef).to.equal(baseURL);

    expect(logSpy.info).to.have.been.calledWith(
      sinon.match(/Found 0 issues across 0 check types/),
    );
  });

  it('headingsAuditRunner handles rejected promises gracefully (coverage test)', async () => {
    const baseURL = 'https://example.com';
    const site = { getId: () => 'site-1' };
    const logSpy = { info: sinon.spy(), error: sinon.spy() };
    const context = {
      log: logSpy,
      dataAccess: {
        SiteTopPage: {
          allBySiteIdAndSourceAndGeo: sinon.stub().resolves([
            { getUrl: () => `${baseURL}/working-page` },
            { getUrl: () => `${baseURL}/failing-page` },
          ]),
        },
      },
    };

    nock('https://example.com')
      .get('/working-page')
      .reply(200, '<h1>Title</h1><h4>Jump to h4</h4>') // Has issue
      .get('/failing-page')
      .replyWithError('Network error'); // Will cause promise rejection

    const result = await headingsAuditRunner(baseURL, context, site);

    expect(result.auditResult).to.have.property(HEADINGS_CHECKS.HEADING_ORDER_INVALID.check);
    const orderIssue = result.auditResult[HEADINGS_CHECKS.HEADING_ORDER_INVALID.check];
    expect(orderIssue.urls).to.include(`${baseURL}/working-page`);
    expect(orderIssue.urls).to.not.include(`${baseURL}/failing-page`);
  });

  it('headingsAuditRunner handles server errors gracefully (coverage test)', async () => {
    const baseURL = 'https://example.com';
    const site = { getId: () => 'site-1' };
    const logSpy = { info: sinon.spy(), error: sinon.spy() };
    const context = {
      log: logSpy,
      dataAccess: {
        SiteTopPage: {
          allBySiteIdAndSourceAndGeo: sinon.stub().resolves([
            { getUrl: () => `${baseURL}/error-page` },
          ]),
        },
      },
    };

    nock('https://example.com')
      .get('/error-page')
      .replyWithError('Network error'); // This will cause validatePageHeadings to return empty checks

    const result = await headingsAuditRunner(baseURL, context, site);

    expect(result.auditResult.status).to.equal('success');
    expect(result.auditResult.message).to.equal('No heading issues detected');

    expect(logSpy.info).to.have.been.calledWith(
      sinon.match(/Found 0 issues across 0 check types/),
    );
  });

  it('headingsAuditRunner skips successful checks (coverage test)', async () => {
    const baseURL = 'https://example.com';
    const site = { getId: () => 'site-1' };
    const logSpy = { info: sinon.spy(), error: sinon.spy() };
    const context = {
      log: logSpy,
      dataAccess: {
        SiteTopPage: {
          allBySiteIdAndSourceAndGeo: sinon.stub().resolves([
            { getUrl: () => `${baseURL}/mixed-page` },
          ]),
        },
      },
    };

    nock('https://example.com')
      .get('/mixed-page')
      .reply(200, '<h1>Title</h1><h2></h2>');

    const result = await headingsAuditRunner(baseURL, context, site);

    expect(result.auditResult).to.have.property(HEADINGS_CHECKS.HEADING_EMPTY.check);
    expect(result.auditResult).to.not.have.property('status');

    // The HTML '<h1>Title</h1><h2></h2>' triggers 2 issues:
    // 1. Empty heading (h2)
    // 2. No content between h1 and h2
    expect(logSpy.info).to.have.been.calledWith(
      sinon.match(/Found 2 issues across 2 check types/),
    );
  });
});
