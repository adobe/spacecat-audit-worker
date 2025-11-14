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
import esmock from 'esmock';

use(sinonChai);

describe('Geo Brand Presence Categorization Callback Handler', () => {
  let context;
  let sandbox;
  let message;
  let site;
  let audit;
  let log;
  let dataAccess;
  let loadCategorizedPromptsStub;
  let handler;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();

    site = {
      getId: () => 'site-id-123',
      getBaseURL: () => 'https://adobe.com',
    };

    audit = {
      getId: () => 'audit-id-456',
      getAuditType: () => 'geo-brand-presence',
    };

    log = {
      info: sandbox.stub(),
      error: sandbox.stub(),
    };

    dataAccess = {
      Site: {
        findById: sandbox.stub().resolves(site),
      },
      Audit: {
        findById: sandbox.stub().resolves(audit),
      },
    };

    message = {
      auditId: 'audit-id-456',
      siteId: 'site-id-123',
      week: 42,
      year: 2025,
      data: {
        categorizedPromptsUrl: 'https://s3.amazonaws.com/bucket/temp/categorized-prompts.json',
      },
    };

    context = {
      log,
      dataAccess,
      env: {
        QUEUE_SPACECAT_TO_MYSTIQUE: 'spacecat-to-mystique',
      },
    };

    // Stub the loadCategorizedPromptsAndSendDetection function
    loadCategorizedPromptsStub = sandbox.stub().resolves({
      status: 'ok',
      message: 'Detection messages sent successfully',
    });

    // Mock the handler module
    const module = await esmock('../../src/geo-brand-presence/categorization-callback-handler.js', {
      '../../src/geo-brand-presence/handler.js': {
        loadCategorizedPromptsAndSendDetection: loadCategorizedPromptsStub,
      },
    });
    handler = module.default;
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('successful callback processing', () => {
    it('should process callback successfully for weekly cadence', async () => {
      const response = await handler(message, context);

      expect(response.status).to.equal(200);

      expect(log.info).to.have.been.calledWith(
        'GEO BRAND PRESENCE CATEGORIZATION CALLBACK: Received callback for auditId: %s, siteId: %s',
        'audit-id-456',
        'site-id-123',
      );

      expect(log.info).to.have.been.calledWith(
        'GEO BRAND PRESENCE CATEGORIZATION CALLBACK: Processing callback for auditId: %s, siteId: %s, cadence: %s',
        'audit-id-456',
        'site-id-123',
        'weekly',
      );

      expect(loadCategorizedPromptsStub).to.have.been.calledOnce;
      const callArgs = loadCategorizedPromptsStub.firstCall.args[0];
      expect(callArgs.site).to.equal(site);
      expect(callArgs.audit).to.equal(audit);
      expect(callArgs.brandPresenceCadence).to.equal('weekly');
      expect(callArgs.auditContext.calendarWeek).to.deep.equal({ year: 2025, week: 42 });
    });

    it('should process callback successfully for daily cadence', async () => {
      message.data.date = '2025-11-14';

      const response = await handler(message, context);

      expect(response.status).to.equal(200);

      expect(log.info).to.have.been.calledWith(
        'GEO BRAND PRESENCE CATEGORIZATION CALLBACK: Processing callback for auditId: %s, siteId: %s, cadence: %s',
        'audit-id-456',
        'site-id-123',
        'daily',
      );

      const callArgs = loadCategorizedPromptsStub.firstCall.args[0];
      expect(callArgs.brandPresenceCadence).to.equal('daily');
      expect(callArgs.auditContext.referenceDate).to.equal('2025-11-14');
    });

    it('should handle date in message root for daily cadence', async () => {
      delete message.data.date;
      message.date = '2025-11-15';

      const response = await handler(message, context);

      expect(response.status).to.equal(200);
      const callArgs = loadCategorizedPromptsStub.firstCall.args[0];
      expect(callArgs.brandPresenceCadence).to.equal('daily');
      expect(callArgs.auditContext.referenceDate).to.equal('2025-11-15');
    });

    it('should pass through all required context', async () => {
      await handler(message, context);

      const callArgs = loadCategorizedPromptsStub.firstCall.args[0];
      expect(callArgs).to.include({
        log,
        dataAccess,
        site,
        audit,
        brandPresenceCadence: 'weekly',
        data: message.data,
      });
      expect(callArgs.env).to.deep.equal(context.env);
      expect(callArgs.auditContext).to.deep.equal({
        calendarWeek: { year: 2025, week: 42 },
      });
    });
  });

  describe('error handling', () => {
    it('should handle categorization error from Mystique', async () => {
      message.data.error = true;
      message.data.error_message = 'Categorization failed due to LLM timeout';

      const response = await handler(message, context);

      expect(response.status).to.equal(200);

      expect(log.error).to.have.been.calledWith(
        'GEO BRAND PRESENCE CATEGORIZATION CALLBACK: Categorization failed for auditId: %s, siteId: %s, error: %s',
        'audit-id-456',
        'site-id-123',
        'Categorization failed due to LLM timeout',
      );

      expect(loadCategorizedPromptsStub).not.to.have.been.called;
    });

    it('should handle categorization error without error_message', async () => {
      message.data.error = true;
      delete message.data.error_message;

      const response = await handler(message, context);

      expect(response.status).to.equal(200);

      expect(log.error).to.have.been.calledWith(
        'GEO BRAND PRESENCE CATEGORIZATION CALLBACK: Categorization failed for auditId: %s, siteId: %s, error: %s',
        'audit-id-456',
        'site-id-123',
        'Unknown error',
      );
    });

    it('should return 404 when site not found', async () => {
      dataAccess.Site.findById.resolves(null);

      const response = await handler(message, context);

      expect(response.status).to.equal(404);
      expect(log.error).to.have.been.calledWith(
        'GEO BRAND PRESENCE CATEGORIZATION CALLBACK: Site not found for auditId: %s, siteId: %s',
        'audit-id-456',
        'site-id-123',
      );
      expect(loadCategorizedPromptsStub).not.to.have.been.called;
    });

    it('should return 404 when audit not found', async () => {
      dataAccess.Audit.findById.resolves(null);

      const response = await handler(message, context);

      expect(response.status).to.equal(404);
      expect(log.error).to.have.been.calledWith(
        'GEO BRAND PRESENCE CATEGORIZATION CALLBACK: Audit not found for auditId: %s, siteId: %s',
        'audit-id-456',
        'site-id-123',
      );
      expect(loadCategorizedPromptsStub).not.to.have.been.called;
    });

    it('should return 500 when loadCategorizedPromptsAndSendDetection returns error status', async () => {
      loadCategorizedPromptsStub.resolves({
        status: 'error',
        message: 'Failed to download categorized prompts',
      });

      const response = await handler(message, context);

      expect(response.status).to.equal(500);

      expect(log.error).to.have.been.calledWith(
        'GEO BRAND PRESENCE CATEGORIZATION CALLBACK: Failed to process callback for auditId: %s, siteId: %s, error: %s',
        'audit-id-456',
        'site-id-123',
        'Failed to download categorized prompts',
      );
    });

    it('should handle unexpected exceptions', async () => {
      const unexpectedError = new Error('Unexpected database error');
      loadCategorizedPromptsStub.rejects(unexpectedError);

      const response = await handler(message, context);

      expect(response.status).to.equal(500);

      expect(log.error).to.have.been.calledWith(
        'GEO BRAND PRESENCE CATEGORIZATION CALLBACK: Unexpected error processing callback for auditId: %s, siteId: %s',
        'audit-id-456',
        'site-id-123',
        unexpectedError,
      );
    });
  });

  describe('edge cases', () => {
    it('should handle missing week/year in message', async () => {
      delete message.week;
      delete message.year;

      const response = await handler(message, context);

      expect(response.status).to.equal(200);
      const callArgs = loadCategorizedPromptsStub.firstCall.args[0];
      expect(callArgs.auditContext.calendarWeek).to.deep.equal({
        year: undefined,
        week: undefined,
      });
    });

    it('should handle missing data object', async () => {
      delete message.data;

      const response = await handler(message, context);

      expect(response.status).to.equal(200);
      expect(loadCategorizedPromptsStub).to.have.been.calledOnce;
    });

    it('should prioritize data.date over root date for daily cadence', async () => {
      message.data.date = '2025-11-14';
      message.date = '2025-11-15'; // Should be ignored

      await handler(message, context);

      const callArgs = loadCategorizedPromptsStub.firstCall.args[0];
      expect(callArgs.auditContext.referenceDate).to.equal('2025-11-14');
    });
  });

  describe('logging', () => {
    it('should log all stages of successful processing', async () => {
      await handler(message, context);

      expect(log.info).to.have.been.calledThrice;
      expect(log.info.firstCall).to.have.been.calledWith(
        'GEO BRAND PRESENCE CATEGORIZATION CALLBACK: Received callback for auditId: %s, siteId: %s',
        'audit-id-456',
        'site-id-123',
      );
      expect(log.info.secondCall).to.have.been.calledWith(
        'GEO BRAND PRESENCE CATEGORIZATION CALLBACK: Processing callback for auditId: %s, siteId: %s, cadence: %s',
        'audit-id-456',
        'site-id-123',
        'weekly',
      );
      expect(log.info.thirdCall).to.have.been.calledWith(
        'GEO BRAND PRESENCE CATEGORIZATION CALLBACK: Successfully processed callback for auditId: %s, siteId: %s',
        'audit-id-456',
        'site-id-123',
      );
    });

    it('should not log error messages on successful processing', async () => {
      await handler(message, context);

      expect(log.error).not.to.have.been.called;
    });
  });
});

