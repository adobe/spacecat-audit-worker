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
import esmock from 'esmock';
import { MockContextBuilder } from '../../shared.js';

use(sinonChai);
use(chaiAsPromised);

describe('Content Fragment Unused Handler', () => {
  let sandbox;
  let context;
  let mockAemAnalyzer;
  let mockConvertToOpportunity;
  let mockGetImsOrgId;
  let mockSyncSuggestions;
  let mockUploadFragmentsToS3;
  let mockDownloadFragmentsFromS3;
  let mockBuildStoragePath;
  let contentFragmentUnusedAuditRunner;
  let createContentFragmentUnusedSuggestions;
  let createStatusSummary;
  let AUDIT_TYPE;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();

    context = new MockContextBuilder().withSandbox(sandbox).build();
    context.env = { AWS_ENV: 'test' };
    context.s3Client = { send: sandbox.stub().resolves() };

    mockAemAnalyzer = {
      findUnusedFragments: sandbox.stub(),
    };

    mockConvertToOpportunity = sandbox.stub();
    mockGetImsOrgId = sandbox.stub().resolves('test-ims-org-id');
    mockSyncSuggestions = sandbox.stub().resolves();
    mockUploadFragmentsToS3 = sandbox.stub().resolves();
    mockDownloadFragmentsFromS3 = sandbox.stub().resolves([]);
    mockBuildStoragePath = sandbox.stub().returns('s3://test-bucket/test-path/file.json');

    const handlerModule = await esmock(
      '../../../src/content-fragment-unused/handler.js',
      {
        '../../../src/content-fragment-insights/aem-analyzer.js': {
          AemAnalyzer: {
            createFrom: sandbox.stub().resolves(mockAemAnalyzer),
          },
        },
        '../../../src/common/opportunity.js': {
          convertToOpportunity: mockConvertToOpportunity,
        },
        '../../../src/utils/data-access.js': {
          getImsOrgId: mockGetImsOrgId,
          syncSuggestions: mockSyncSuggestions,
        },
        '../../../src/content-fragment-unused/storage/s3-storage.js': {
          uploadFragmentsToS3: mockUploadFragmentsToS3,
          downloadFragmentsFromS3: mockDownloadFragmentsFromS3,
          buildStoragePath: mockBuildStoragePath,
        },
      },
    );

    contentFragmentUnusedAuditRunner = handlerModule.contentFragmentUnusedAuditRunner;
    createContentFragmentUnusedSuggestions = handlerModule.createContentFragmentUnusedSuggestions;
    createStatusSummary = handlerModule.createStatusSummary;
    AUDIT_TYPE = handlerModule.AUDIT_TYPE;
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('AUDIT_TYPE', () => {
    it('should have correct audit type', () => {
      expect(AUDIT_TYPE).to.equal('content-fragment-unused');
    });
  });

  describe('createStatusSummary', () => {
    it('should create summary for empty fragments', () => {
      const result = createStatusSummary(0, []);

      expect(result).to.have.lengthOf(4);
      result.forEach((status) => {
        expect(status.count).to.equal(0);
        expect(status.percentage).to.equal(0);
        expect(status.averageAge).to.equal(0);
        expect(status.oldest).to.equal(0);
      });
    });

    it('should create summary for NEW status fragments', () => {
      const fragments = [
        {
          status: 'NEW',
          ageInDays: 100,
        },
        {
          status: 'NEW',
          ageInDays: 150,
        },
      ];

      const result = createStatusSummary(10, fragments);

      const newStatus = result.find((s) => s.status === 'NEW');
      expect(newStatus.count).to.equal(2);
      expect(newStatus.percentage).to.equal(20);
      expect(newStatus.averageAge).to.equal(125);
      expect(newStatus.oldest).to.equal(150);
    });

    it('should create summary for DRAFT status fragments', () => {
      const fragments = [
        {
          status: 'DRAFT',
          ageInDays: 90,
        },
      ];

      const result = createStatusSummary(5, fragments);

      const draftStatus = result.find((s) => s.status === 'DRAFT');
      expect(draftStatus.count).to.equal(1);
      expect(draftStatus.percentage).to.equal(20);
      expect(draftStatus.averageAge).to.equal(90);
      expect(draftStatus.oldest).to.equal(90);
    });

    it('should create summary for UNPUBLISHED status fragments', () => {
      const fragments = [
        {
          status: 'UNPUBLISHED',
          ageInDays: 120,
        },
        {
          status: 'UNPUBLISHED',
          ageInDays: 180,
        },
        {
          status: 'UNPUBLISHED',
          ageInDays: 200,
        },
      ];

      const result = createStatusSummary(10, fragments);

      const unpublishedStatus = result.find((s) => s.status === 'UNPUBLISHED');
      expect(unpublishedStatus.count).to.equal(3);
      expect(unpublishedStatus.percentage).to.equal(30);
      expect(unpublishedStatus.averageAge).to.equal(167);
      expect(unpublishedStatus.oldest).to.equal(200);
    });

    it('should create summary for MODIFIED status fragments', () => {
      const fragments = [
        {
          status: 'MODIFIED',
          ageInDays: 95,
        },
      ];

      const result = createStatusSummary(20, fragments);

      const modifiedStatus = result.find((s) => s.status === 'MODIFIED');
      expect(modifiedStatus.count).to.equal(1);
      expect(modifiedStatus.percentage).to.equal(5);
      expect(modifiedStatus.averageAge).to.equal(95);
      expect(modifiedStatus.oldest).to.equal(95);
    });

    it('should handle mixed status fragments', () => {
      const fragments = [
        { status: 'NEW', ageInDays: 100 },
        { status: 'DRAFT', ageInDays: 120 },
        { status: 'UNPUBLISHED', ageInDays: 150 },
        { status: 'MODIFIED', ageInDays: 200 },
      ];

      const result = createStatusSummary(10, fragments);

      expect(result).to.have.lengthOf(4);
      result.forEach((status) => {
        expect(status.count).to.be.at.least(0);
      });
    });

    it('should return all statuses even when no fragments match', () => {
      const fragments = [
        { status: 'NEW', ageInDays: 100 },
      ];

      const result = createStatusSummary(10, fragments);

      expect(result).to.have.lengthOf(4);
      expect(result.map((s) => s.status)).to.deep.equal([
        'NEW',
        'DRAFT',
        'UNPUBLISHED',
        'MODIFIED',
      ]);
    });

    it('should calculate percentage correctly', () => {
      const fragments = [
        { status: 'NEW', ageInDays: 100 },
        { status: 'NEW', ageInDays: 110 },
      ];

      const result = createStatusSummary(10, fragments);

      const newStatus = result.find((s) => s.status === 'NEW');
      expect(newStatus.percentage).to.equal(20);
    });

    it('should handle zero total fragments', () => {
      const fragments = [];

      const result = createStatusSummary(0, fragments);

      result.forEach((status) => {
        expect(status.percentage).to.equal(0);
      });
    });

    it('should round average age', () => {
      const fragments = [
        { status: 'NEW', ageInDays: 100 },
        { status: 'NEW', ageInDays: 101 },
        { status: 'NEW', ageInDays: 102 },
      ];

      const result = createStatusSummary(10, fragments);

      const newStatus = result.find((s) => s.status === 'NEW');
      expect(newStatus.averageAge).to.equal(101);
    });
  });

  describe('contentFragmentUnusedAuditRunner', () => {
    const baseURL = 'https://example.com';
    const site = {
      getId: () => 'test-site-id',
      getBaseURL: () => baseURL,
    };

    beforeEach(() => {
      context.site = site;
    });

    it('should run audit successfully', async () => {
      mockAemAnalyzer.findUnusedFragments.resolves({
        totalFragments: 10,
        totalUnused: 2,
        data: [
          { status: 'NEW', ageInDays: 100 },
          { status: 'DRAFT', ageInDays: 120 },
        ],
      });

      const result = await contentFragmentUnusedAuditRunner(baseURL, context, site);

      expect(result).to.have.property('fullAuditRef', baseURL);
      expect(result).to.have.property('auditResult');
      expect(result.auditResult.totalFragments).to.equal(10);
      expect(result.auditResult.totalUnused).to.equal(2);
      expect(result.auditResult.statusSummary).to.be.an('array');
      expect(result.auditResult.s3Path).to.be.a('string');
    });

    it('should include status summary in result', async () => {
      mockAemAnalyzer.findUnusedFragments.resolves({
        totalFragments: 5,
        totalUnused: 1,
        data: [
          { status: 'MODIFIED', ageInDays: 95 },
        ],
      });

      const result = await contentFragmentUnusedAuditRunner(baseURL, context, site);

      expect(result.auditResult.statusSummary).to.have.lengthOf(4);
      const modifiedStatus = result.auditResult.statusSummary.find(
        (s) => s.status === 'MODIFIED',
      );
      expect(modifiedStatus.count).to.equal(1);
    });

    it('should pass site to context', async () => {
      mockAemAnalyzer.findUnusedFragments.resolves({
        totalFragments: 0,
        totalUnused: 0,
        data: [],
      });

      await contentFragmentUnusedAuditRunner(baseURL, context, site);

      expect(mockAemAnalyzer.findUnusedFragments).to.have.been.called;
    });

    it('should handle no unused fragments', async () => {
      mockAemAnalyzer.findUnusedFragments.resolves({
        totalFragments: 10,
        totalUnused: 0,
        data: [],
      });

      const result = await contentFragmentUnusedAuditRunner(baseURL, context, site);

      expect(result.auditResult.totalUnused).to.equal(0);
    });

    it('should throw error when IMS org ID is missing', async () => {
      mockGetImsOrgId.resolves(null);

      await expect(
        contentFragmentUnusedAuditRunner(baseURL, context, site),
      ).to.be.rejected;
    });

    it('should throw error when AWS_ENV is missing', async () => {
      context.env = {};

      await expect(
        contentFragmentUnusedAuditRunner(baseURL, context, site),
      ).to.be.rejected;
    });

    it('should upload fragments to S3', async () => {
      const fragments = [
        { status: 'NEW', ageInDays: 100 },
      ];
      mockAemAnalyzer.findUnusedFragments.resolves({
        totalFragments: 10,
        totalUnused: 1,
        data: fragments,
      });

      await contentFragmentUnusedAuditRunner(baseURL, context, site);

      expect(mockUploadFragmentsToS3).to.have.been.calledOnce;
      expect(mockUploadFragmentsToS3).to.have.been.calledWith(
        fragments,
        sinon.match.string,
        context.s3Client,
        context.log,
      );
    });
  });

  describe('createContentFragmentUnusedSuggestions', () => {
    const auditUrl = 'https://example.com';

    it('should create suggestions with valid audit data', async () => {
      const fragments = [
        { fragmentPath: '/content/dam/fragment1', status: 'NEW', ageInDays: 100 },
      ];
      mockDownloadFragmentsFromS3.resolves(fragments);

      const mockOpportunity = {
        getId: sandbox.stub().returns('opp-123'),
      };
      mockConvertToOpportunity.resolves(mockOpportunity);

      const auditData = {
        siteId: 'test-site-id',
        id: 'audit-123',
        auditResult: {
          totalFragments: 10,
          totalUnused: 1,
          s3Path: 's3://test-bucket/test-path/file.json',
          statusSummary: [],
        },
      };

      await createContentFragmentUnusedSuggestions(auditUrl, auditData, context);

      expect(mockConvertToOpportunity).to.have.been.calledOnce;
      expect(mockSyncSuggestions).to.have.been.calledOnce;
    });

    it('should skip suggestions creation when audit result is missing', async () => {
      const auditData = {
        siteId: 'test-site-id',
        id: 'audit-123',
      };

      await createContentFragmentUnusedSuggestions(auditUrl, auditData, context);

      expect(mockConvertToOpportunity).to.not.have.been.called;
    });

    it('should skip suggestions creation when audit data is null', async () => {
      await createContentFragmentUnusedSuggestions(auditUrl, null, context);

      expect(mockConvertToOpportunity).to.not.have.been.called;
    });

    it('should skip suggestions creation when auditResult is null', async () => {
      const auditData = {
        siteId: 'test-site-id',
        id: 'audit-123',
        auditResult: null,
      };

      await createContentFragmentUnusedSuggestions(auditUrl, auditData, context);

      expect(mockConvertToOpportunity).to.not.have.been.called;
    });

    it('should skip suggestions creation when s3Path is missing', async () => {
      const auditData = {
        siteId: 'test-site-id',
        id: 'audit-123',
        auditResult: {
          totalFragments: 10,
          totalUnused: 2,
          statusSummary: [],
        },
      };

      await createContentFragmentUnusedSuggestions(auditUrl, auditData, context);

      expect(mockConvertToOpportunity).to.not.have.been.called;
    });

    it('should skip suggestions creation when no fragments downloaded', async () => {
      mockDownloadFragmentsFromS3.resolves([]);

      const auditData = {
        siteId: 'test-site-id',
        id: 'audit-123',
        auditResult: {
          totalFragments: 10,
          totalUnused: 0,
          s3Path: 's3://test-bucket/test-path/file.json',
          statusSummary: [],
        },
      };

      await createContentFragmentUnusedSuggestions(auditUrl, auditData, context);

      expect(mockConvertToOpportunity).to.not.have.been.called;
    });

    it('should pass correct parameters to convertToOpportunity', async () => {
      const fragments = [
        { fragmentPath: '/content/dam/fragment1', status: 'NEW', ageInDays: 100 },
      ];
      mockDownloadFragmentsFromS3.resolves(fragments);

      const mockOpportunity = {
        getId: sandbox.stub().returns('opp-123'),
      };
      mockConvertToOpportunity.resolves(mockOpportunity);

      const auditData = {
        siteId: 'test-site-id',
        id: 'audit-123',
        auditResult: {
          totalFragments: 10,
          totalUnused: 1,
          s3Path: 's3://test-bucket/test-path/file.json',
          statusSummary: [],
        },
      };

      await createContentFragmentUnusedSuggestions(auditUrl, auditData, context);

      expect(mockConvertToOpportunity).to.have.been.calledWith(
        auditUrl,
        sinon.match.object,
        context,
        sinon.match.func,
        'content-fragment-unused',
      );
    });

    it('should build correct suggestion from mapNewSuggestion callback', async () => {
      const fragments = [
        { fragmentPath: '/content/dam/fragment1', status: 'NEW', ageInDays: 100 },
      ];
      mockDownloadFragmentsFromS3.resolves(fragments);

      const mockOpportunity = {
        getId: sandbox.stub().returns('opp-123'),
      };
      mockConvertToOpportunity.resolves(mockOpportunity);

      const auditData = {
        siteId: 'test-site-id',
        id: 'audit-123',
        auditResult: {
          totalFragments: 10,
          totalUnused: 1,
          s3Path: 's3://test-bucket/test-path/file.json',
          statusSummary: [],
        },
      };

      await createContentFragmentUnusedSuggestions(auditUrl, auditData, context);

      // Get the mapNewSuggestion callback from the syncSuggestions call
      const syncCall = mockSyncSuggestions.firstCall;
      const { mapNewSuggestion, buildKey } = syncCall.args[0];

      // Test buildKey function
      const testFragment = { fragmentPath: '/content/dam/test-fragment' };
      expect(buildKey(testFragment)).to.equal('/content/dam/test-fragment');

      // Test mapNewSuggestion function
      const suggestion = mapNewSuggestion(fragments[0]);
      expect(suggestion).to.deep.equal({
        opportunityId: 'opp-123',
        type: 'CONTENT_UPDATE',
        rank: 0,
        data: fragments[0],
      });
    });
  });

  describe('default export', () => {
    it('should export an audit builder', async () => {
      const handlerModule = await import(
        '../../../src/content-fragment-unused/handler.js'
      );

      expect(handlerModule.default).to.exist;
      expect(handlerModule.default).to.be.an('object');
    });
  });
});

