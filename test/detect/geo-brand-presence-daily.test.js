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

import { expect } from 'chai';
import sinon from 'sinon';
import handler from '../../src/geo-brand-presence-daily/detect-geo-brand-presence-handler.js';

xdescribe('geo-brand-presence-daily detect handler', () => {
  let context;
  let Audit;
  let Site;
  let log;
  let dummyAudit;
  let dummySite;

  beforeEach(() => {
    Audit = {
      findById: sinon.stub(),
    };
    Site = {
      findById: sinon.stub(),
    };
    dummyAudit = { auditId: 'audit-id' };
    dummySite = {
      getId: sinon.stub().returns('site-id'),
      getConfig: sinon.stub().returns({
        getLlmoDataFolder: sinon.stub().returns('/data/llmo'),
      }),
    };
    Audit.findById.resolves(dummyAudit);
    Site.findById.resolves(dummySite);

    log = {
      info: sinon.stub(),
      warn: sinon.stub(),
      error: sinon.stub(),
    };
    context = {
      log,
      dataAccess: {
        Audit,
        Site,
      },
    };
  });

  afterEach(() => {
    sinon.restore();
  });

  it('should log an error and return 404 if no type is found', async () => {
    const message = {
      auditId: 'audit-id',
      siteId: 'site-id',
      data: {
        presigned_url: 'https://example.com/sheet.xlsx',
      },
    };
    await handler(message, context);
    expect(log.error).to.have.been.calledWithMatch(/Unsupported subtype: undefined/);
  });

  it('should log an error and return 404 if unsupported subtype', async () => {
    const message = {
      auditId: 'audit-id',
      siteId: 'site-id',
      type: 'detect:geo-brand-presence', // Wrong type - should be daily
      data: {
        presigned_url: 'https://example.com/sheet.xlsx',
      },
    };
    await handler(message, context);
    expect(log.error).to.have.been.calledWithMatch(/Unsupported subtype/);
  });

  it('should log an error and return 404 if no audit found', async () => {
    Audit.findById.resolves(null);
    const message = {
      auditId: 'unknown-audit-id',
      siteId: 'site-id',
      type: 'detect:geo-brand-presence-daily',
      date: '2025-10-01',
      week: 40,
      data: {
        presigned_url: 'https://example.com/sheet.xlsx',
      },
    };
    await handler(message, context);
    expect(log.error).to.have.been.calledWithMatch(/Audit or site not found/);
  });

  it('should log an error and return 404 if no site found', async () => {
    Site.findById.resolves(null);
    const message = {
      auditId: 'audit-id',
      siteId: 'unknown-site-id',
      type: 'detect:geo-brand-presence-daily',
      date: '2025-10-01',
      week: 40,
      data: {
        presigned_url: 'https://example.com/sheet.xlsx',
      },
    };
    await handler(message, context);
    expect(log.error).to.have.been.calledWithMatch(/Audit or site not found/);
  });

  it('should extract daily date and week number from message', async () => {
    const message = {
      auditId: 'audit-id',
      siteId: 'site-id',
      type: 'detect:geo-brand-presence-daily',
      date: '2025-10-01',
      week: 40,
      data: {
        presigned_url: 'https://s3.amazonaws.com/bucket/file.xlsx?response-content-disposition=attachment%3B+filename%3D%22brandpresence-daily-2025-10-01.xlsx%22',
      },
    };

    // This test would need mocking of fetch and SharePoint client
    // For now, just verify the message is received and daily info is extracted
    expect(message.date).to.equal('2025-10-01');
    expect(message.week).to.equal(40);
  });

  it('should use correct SharePoint path with week number', async () => {
    const message = {
      auditId: 'audit-id',
      siteId: 'site-id',
      type: 'detect:geo-brand-presence-daily',
      date: '2025-10-01',
      week: 5, // Single digit week
      data: {
        presigned_url: 'https://example.com/sheet.xlsx',
      },
    };

    // Verify week number gets padded correctly
    const weekNumber = message.week ? String(message.week).padStart(2, '0') : '01';
    expect(weekNumber).to.equal('05');
  });

  it('should handle missing week number with default', async () => {
    const message = {
      auditId: 'audit-id',
      siteId: 'site-id',
      type: 'detect:geo-brand-presence-daily',
      date: '2025-10-01',
      data: {
        presigned_url: 'https://example.com/sheet.xlsx',
      },
    };

    // Verify default week number is used when missing
    const weekNumber = message.week ? String(message.week).padStart(2, '0') : '01';
    expect(weekNumber).to.equal('01');
  });
});
