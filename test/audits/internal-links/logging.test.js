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

/* eslint-env mocha */

import { expect } from 'chai';
import sinon from 'sinon';

import { createContextLogger } from '../../../src/common/context-logger.js';
import {
  createInternalLinksStepLogger,
  ensureInternalLinksStepLogger,
} from '../../../src/internal-links/logging.js';

describe('internal-links logging helpers', () => {
  let sandbox;
  let baseLog;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    baseLog = {
      info: sandbox.stub(),
      warn: sandbox.stub(),
      error: sandbox.stub(),
      debug: sandbox.stub(),
    };
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('creates a step logger with audit and step context', () => {
    const log = createInternalLinksStepLogger({
      createContextLogger,
      log: baseLog,
      auditType: 'broken-internal-links',
      siteId: 'site-123',
      auditId: 'audit-456',
      step: 'run-crawl-detection-batch',
      extraContext: { batchNum: 2 },
    });

    log.info('Processing batch');

    expect(baseLog.info).to.have.been.calledWith(
      '[auditType=broken-internal-links] [siteId=site-123] [auditId=audit-456] [step=run-crawl-detection-batch] [batchNum=2] Processing batch',
    );
  });

  it('returns the existing contextual logger when already wrapped', () => {
    const contextualLog = createContextLogger(baseLog, {
      auditType: 'broken-internal-links',
      siteId: 'site-123',
      auditId: 'audit-456',
      step: 'run-crawl-detection-batch',
    });

    const ensuredLog = ensureInternalLinksStepLogger({
      createContextLogger,
      log: contextualLog,
      auditType: 'broken-internal-links',
      siteId: 'site-123',
      auditId: 'audit-456',
      step: 'ignored-step',
    });

    expect(ensuredLog).to.equal(contextualLog);
  });

  it('wraps raw loggers when ensuring internal-links step context', () => {
    const ensuredLog = ensureInternalLinksStepLogger({
      createContextLogger,
      log: baseLog,
      auditType: 'broken-internal-links',
      siteId: 'site-123',
      auditId: 'audit-456',
      step: 'finalize-crawl-detection',
    });

    ensuredLog.warn('Finalizing');

    expect(baseLog.warn).to.have.been.calledWith(
      '[auditType=broken-internal-links] [siteId=site-123] [auditId=audit-456] [step=finalize-crawl-detection] Finalizing',
    );
  });
});
