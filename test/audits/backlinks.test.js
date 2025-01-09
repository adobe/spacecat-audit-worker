/*
 * Copyright 2024 Adobe. All rights reserved.
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
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import nock from 'nock';
import auditDataMock from '../fixtures/broken-backlinks/audit.json' with { type: 'json' };
import { brokenBacklinksAuditRunner, convertToOpportunity } from '../../src/backlinks/handler.js';
import { MockContextBuilder } from '../shared.js';
import {
  brokenBacklinkWithTimeout,
  excludedUrl,
  fixedBacklinks,
  site,
  site2,
  siteWithExcludedUrls,
} from '../fixtures/broken-backlinks/sites.js';
import { ahrefsMock, mockFixedBacklinks } from '../fixtures/broken-backlinks/ahrefs.js';
import {
  brokenBacklinksOpportunity,
  opportunityData,
  otherOpportunity,
} from '../fixtures/broken-backlinks/opportunity.js';
import {
  brokenBacklinkExistingSuggestions,
  brokenBacklinksSuggestions,
  suggestions,
} from '../fixtures/broken-backlinks/suggestion.js';
import { mockUrlResponses } from '../fixtures/broken-backlinks/urls.js';

use(sinonChai);
use(chaiAsPromised);

// eslint-disable-next-line func-names
describe('Backlinks Tests', function () {
  this.timeout(10000);
  let message;
  let context;
  const auditUrl = 'https://audit.url';

  const sandbox = sinon.createSandbox();

  beforeEach(() => {
    message = {
      type: 'broken-backlinks',
      siteId: 'site1',
    };

    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        env: {
          AHREFS_API_BASE_URL: 'https://ahrefs.com',
          AHREFS_API_KEY: 'ahrefs-api',
        },
      })
      .build(message);

    mockUrlResponses();
  });
  afterEach(() => {
    nock.cleanAll();
    sinon.restore();
  });

  it('should run broken backlinks audit and filter out excluded URLs and include valid backlinks', async () => {
    const { brokenBacklinks } = auditDataMock.auditResult;
    const withoutExcluded = brokenBacklinks.filter((backlink) => backlink.url_to !== excludedUrl);

    ahrefsMock(siteWithExcludedUrls.getBaseURL(), { backlinks: brokenBacklinks });

    const auditData = await brokenBacklinksAuditRunner(auditUrl, context, siteWithExcludedUrls);

    expect(auditData.auditResult.brokenBacklinks).to.deep.equal(withoutExcluded);
  });

  it('should filter out broken backlinks that return ok (even with redirection)', async () => {
    const allBacklinks = auditDataMock.auditResult.brokenBacklinks
      .concat(fixedBacklinks)
      .concat(brokenBacklinkWithTimeout);

    mockFixedBacklinks(allBacklinks);

    const auditData = await brokenBacklinksAuditRunner(auditUrl, context, site2);
    expect(auditData.auditResult.brokenBacklinks)
      .to
      .deep
      .equal(auditDataMock.auditResult.brokenBacklinks.concat(brokenBacklinkWithTimeout));
  });

  it('should transform the audit result into an opportunity in the post processor and create a new opportunity', async () => {
    context.dataAccess.Site.findById = sinon.stub().withArgs('site1').resolves(site);
    context.dataAccess.Opportunity.create.resolves(brokenBacklinksOpportunity);
    brokenBacklinksOpportunity.addSuggestions.resolves(brokenBacklinksSuggestions);
    brokenBacklinksOpportunity.getSuggestions.resolves([]);
    context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([otherOpportunity]);

    ahrefsMock(site.getBaseURL(), auditDataMock.auditResult);

    await convertToOpportunity(auditUrl, auditDataMock, context);

    expect(context.dataAccess.Opportunity.create)
      .to
      .have
      .been
      .calledOnceWith(opportunityData(auditDataMock.siteId, auditDataMock.id));
    expect(brokenBacklinksOpportunity.addSuggestions).to.have.been.calledOnceWith(suggestions);
  });

  it('should transform the audit result into an opportunity in the post processor and add it to an existing opportunity', async () => {
    context.dataAccess.Site.findById = sinon.stub().withArgs('site1').resolves(site);
    brokenBacklinksOpportunity.addSuggestions.resolves(brokenBacklinksSuggestions);
    brokenBacklinksOpportunity.getSuggestions.resolves(brokenBacklinkExistingSuggestions);
    context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves(
      [brokenBacklinksOpportunity, otherOpportunity],
    );

    ahrefsMock(site.getBaseURL(), auditDataMock.auditResult);

    await convertToOpportunity(auditUrl, auditDataMock, context);

    expect(context.dataAccess.Opportunity.create).to.not.have.been.called;
    expect(brokenBacklinksOpportunity.setAuditId).to.have.been.calledOnceWith(auditDataMock.id);

    expect(brokenBacklinksOpportunity.save).to.have.been.calledOnce;
    expect(brokenBacklinksOpportunity.addSuggestions).to.have.been.calledWith(
      suggestions.filter((s) => brokenBacklinkExistingSuggestions[0].data.url_to !== s.data.url_to),
    );
  });

  it('should throw an error if opportunity creation fails', async () => {
    context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([]);
    context.dataAccess.Opportunity.create.throws('broken-backlinks opportunity-error');
    const errorMessage = 'Sinon-provided broken-backlinks opportunity-error';

    nock(site.getBaseURL())
      .get(/.*/)
      .reply(200);

    nock('https://ahrefs.com')
      .get(/.*/)
      .reply(200, auditDataMock.auditResult);

    try {
      await convertToOpportunity(auditUrl, auditDataMock, context);
    } catch (e) {
      expect(e.message).to.equal(errorMessage);
    }

    expect(context.log.error).to.have.been.calledWith(`Failed to create new opportunity for siteId site-id and auditId audit-id: ${errorMessage}`);
  });

  it('should handle audit api errors gracefully', async () => {
    nock(site.getBaseURL())
      .get(/.*/)
      .reply(200);

    nock('https://ahrefs.com')
      .get(/.*/)
      .reply(500);

    const auditData = await brokenBacklinksAuditRunner(auditUrl, context, site);

    expect(auditData).to.deep.equal({
      fullAuditRef: auditUrl,
      auditResult: {
        error: 'Broken Backlinks audit for site1 with url https://audit.url failed with error: Ahrefs API request failed with status: 500',
        success: false,
      },
    });
  });

  it('should handle fetch errors gracefully', async () => {
    context.dataAccess.Site.findById = sinon.stub().withArgs('site1').resolves(site);
    const errorMessage = 'Broken Backlinks audit for site1 with url https://audit.url failed with error: Ahrefs API request failed with status: 404';
    nock(site.getBaseURL())
      .get(/.*/)
      .replyWithError({ code: 'ECONNREFUSED', syscall: 'connect' });

    const auditResult = await brokenBacklinksAuditRunner(auditUrl, context, site);

    expect(context.log.error).to.have.been.calledWith(errorMessage);
    expect(auditResult).to.deep.equal({
      fullAuditRef: auditUrl,
      auditResult: {
        error: errorMessage,
        success: false,
      },
    });
  });
});
