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

import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import nock from 'nock';
import auditBrokenBacklinks from '../../src/backlinks/handler.js';

chai.use(sinonChai);
chai.use(chaiAsPromised);
const { expect } = chai;

describe('Backlinks Tests', () => {
  let message;
  let context;
  let mockLog;

  const sandbox = sinon.createSandbox();

  const auditResult = {
    backlinks: [
      {
        title: 'backlink title',
        url_from: 'url-from',
        languages: [
          'en',
        ],
        domain_rating_source: 57,
        url_rating_source: 1.3,
        traffic_domain: 37326,
        refdomains_source: 1,
        linked_domains_source_page: 12,
        links_external: 16,
        traffic: 0,
        positions: 5,
        name_target: 'name-target',
        http_code_target: 404,
        snippet_left: 'snippet-left',
        anchor: 'anchor',
        snippet_right: 'snippet-right',
        link_type: 'text',
        is_content: true,
        is_dofollow: true,
        is_ugc: false,
        is_sponsored: false,
        link_group_count: 1,
      },
      {
        title: 'backlink title 2',
        url_from: 'url-from-2',
        languages: [
          'en',
        ],
        domain_rating_source: 49,
        url_rating_source: 3.3,
        traffic_domain: 12819,
        refdomains_source: 0,
        linked_domains_source_page: 6,
        links_external: 7,
        traffic: 0,
        positions: 0,
        name_target: 'name-target-2',
        http_code_target: 404,
        snippet_left: 'snippet-left-2',
        anchor: 'anchor-2',
        snippet_right: 'snippet-right-2',
        link_type: 'text',
        is_content: true,
        is_dofollow: true,
        is_ugc: false,
        is_sponsored: false,
        link_group_count: 1,
      },
    ],
  };

  beforeEach(() => {
    message = {
      type: 'backlinks',
      url: 'test-site.com',
      auditContext: {
        finalUrl: 'final-url',
      },
    };

    mockLog = {
      info: sinon.spy(),
      warn: sinon.spy(),
      error: sinon.spy(),
    };

    context = {
      log: mockLog,
      env: {
        AHREFS_API_BASEURL: 'https://ahrefs.com',
        AHREFS_API_KEY: 'ahrefs-token',
        AUDIT_RESULTS_QUEUE_URL: 'queueUrl',
      },
      sqs: {
        sendMessage: sandbox.stub().resolves(),
      },
    };
  });

  afterEach(() => {
    nock.cleanAll();
    sinon.restore();
  });

  it('should successfully perform an audit to detect broken backlinks', async () => {
    nock('https://ahrefs.com')
      .get(/.*/)
      .reply(200, auditResult);
    const response = await auditBrokenBacklinks(message, context);
    expect(response.status).to.equal(204);
    expect(context.sqs.sendMessage).to.have.been.calledOnce;
    expect(context.log.info).to.have.been.calledWith('Successfully audited test-site.com for'
      + ' backlinks type audit');
  });

  it('should handle audit api errors gracefully', async () => {
    nock('https://ahrefs.com')
      .get(/.*/)
      .reply(500);

    const response = await auditBrokenBacklinks(message, context);
    expect(response.status).to.equal(500);
    expect(context.sqs.sendMessage).to.not.have.been.called;
  });
});
