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
import chaiAsPromised from 'chai-as-promised';
import nock from 'nock';
import { describe } from 'mocha';
import { ok, notFound } from '@adobe/spacecat-shared-http-utils';
import handler from '../../../src/paid/guidance-handler.js';

use(sinonChai);
use(chaiAsPromised);

describe('PaidGuidanceHandler', () => {
  let sandbox;

  let logStub;
  let context;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    logStub = {
      info: sandbox.stub(),
      debug: sandbox.stub(),
      error: sandbox.stub(),
      warn: sandbox.stub(),
    };

    context = {
      log: logStub,
    };
  });

  afterEach(() => {
    nock.cleanAll();
    sandbox.restore();
  });

  it('should handle guidance messages for paid', async () => {
    const Audit = { findById: sinon.stub().resolves(null) };
    const Opportunity = { allBySiteId: sinon.stub().resolves([]) };
    const contextWithDA = { ...context, dataAccess: { Audit, Opportunity } };
    const sampleMessage = {
      auditId: 'id',
      siteId: 'site',
      data: { url: 'url', guidance: {} },
    };
    await handler(sampleMessage, contextWithDA);
    expect(logStub.info.callCount).to.be.above(0);
  });

  it('should return notFound if no audit is found', async () => {
    const Audit = { findById: sinon.stub().resolves(null) };
    const Opportunity = { allBySiteId: sinon.stub().resolves([]) };
    const contextWithDA = { ...context, dataAccess: { Audit, Opportunity } };
    const message = { auditId: '123', siteId: 'site', data: { url: 'url', guidance: {} } };

    const result = await handler(message, contextWithDA);
    expect(result.status).to.equal(notFound().status);
  });

  it('should create a new opportunity if none exists', async () => {
    const audit = { auditType: 'paid' };
    const Audit = { findById: sandbox.stub().resolves(audit) };
    const Opportunity = {
      allBySiteId: sandbox.stub().resolves([]),
      create: sandbox.stub().resolves({ setAuditId: sandbox.stub() }),
    };
    const guidanceItem = {
      insight: 'Banner hides hero CTA on mobile',
      rationale: 'Blocks the primary purchase path for high-intent visitors.',
      recommendation: 'Move banner to bottom-center without overlay.',
      brief: null,
      type: 'guidanceWithBody',
      body: '**Banner hides hero CTA on mobile.**\n\nCould recover up to 8% of mobile ad visitors dropping before engaging the main CTA.\n\n- On mobile, the cookie consent banner occupies about one-third of the screen and pushes the main \\"Try free\\" CTA partially out of view, making immediate action less seamless.\n- The banner uses a white background, high-contrast dark text, and a blue accept button—accessible and visually clear, but highly prominent.\n- Banner wording is neutral and professional, avoiding manipulation; users feel neither anxious nor suspicious, but do see the interruption as a hurdle on first visit.\n- "I can\'t immediately tap the CTA or see it in the most natural reading flow... I would tap to accept, but it interrupts my product discovery."\n\n**_Move banner to bottom-center without overlay._**\n\n| Position                | Pros                                             | Cons                                        |\n|-------------------------|--------------------------------------------------|---------------------------------------------|\n| Bottom, no overlay      | CTA and hero remain visible; no conversion loss  | May feel less prominent for compliance      |\n| Current (bottom, large) | Ensures high noticeability, clear acceptance     | Disrupts purchase path, frustrates visitors |\n\nFreeing up the hero CTA on mobile will increase paid traffic returns by maximizing every clickthrough\'s chance to convert.',
    };
    const contextWithDA = { ...context, dataAccess: { Audit, Opportunity } };
    const message = {
      auditId: '123',
      siteId: 'site',
      data: { url: 'url', guidance: [guidanceItem] },
    };

    const result = await handler(message, contextWithDA);
    expect(Opportunity.create).to.have.been.called;
    const calledWith = Opportunity.create.getCall(0).args[0];
    expect(calledWith).to.have.property('guidance');
    expect(calledWith.guidance).to.equal(guidanceItem.body);
    expect(calledWith.title).to.equal(guidanceItem.insight);
    expect(calledWith.description).to.include(guidanceItem.recommendation);
    expect(calledWith.type).to.equal('paid');
    expect(calledWith.origin).to.equal('AUTOMATION');
    expect(calledWith.status).to.equal('NEW');
    expect(result.status).to.deep.equal(ok().status);
  });

  it('should update an existing opportunity if found', async () => {
    const audit = { auditType: 'type' };
    const existingOppty = {
      getType: () => 'type',
      page: 'url',
      setAuditId: sinon.stub(),
    };
    const Audit = { findById: sinon.stub().resolves(audit) };
    const Opportunity = {
      allBySiteId: sinon.stub().resolves([existingOppty]),
      create: sinon.stub(),
    };
    const contextWithDA = { ...context, dataAccess: { Audit, Opportunity } };
    const message = { auditId: '123', siteId: 'site', data: { url: 'url', guidance: {} } };

    const result = await handler(message, contextWithDA);
    expect(existingOppty.setAuditId).to.have.been.calledWith('123');
    expect(Opportunity.create).not.to.have.been.called;
    expect(result.status).to.deep.equal(ok().status);
  });
});
