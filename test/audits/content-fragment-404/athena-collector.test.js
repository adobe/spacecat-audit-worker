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

describe('AthenaCollector', () => {
  let sandbox;
  let context;
  let athenaClientStub;
  let getStaticContentStub;
  let AthenaCollector;

  // Helper to set test config on collector
  const setTestConfig = (collector) => {
    collector.config = {
      database: 'test_database',
      tableName: 'test_table',
      location: collector.config.location,
      tempLocation: collector.config.tempLocation,
    };
  };

  beforeEach(async () => {
    sandbox = sinon.createSandbox();

    athenaClientStub = {
      execute: sandbox.stub().resolves(),
      query: sandbox.stub().resolves([
        { url: '/content/dam/test/fragment1', request_user_agent: 'Mozilla/5.0', request_count: '10' },
        { url: '/content/dam/test/asset.jpg', request_user_agent: 'Mozilla/5.0', request_count: '5' }, // Asset should be filtered
        { url: null }, // Should be filtered
        { url: '/content/dam/test/fragment2', request_user_agent: 'Chrome/91.0', request_count: '8' },
      ]),
    };

    getStaticContentStub = sandbox.stub().resolves('SELECT * FROM test_table;');

    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        log: {
          info: sandbox.spy(),
          debug: sandbox.spy(),
          warn: sandbox.spy(),
          error: sandbox.spy(),
        },
        env: {
          S3_BUCKET: 'test-raw-bucket',
        },
        site: {
          getBaseURL: () => 'https://test-site.com',
          getOrganizationId: () => 'test-org-id',
        },
        dataAccess: {
          Organization: {
            findById: sandbox.stub().resolves({
              getImsOrgId: () => 'test-ims-org',
            }),
          },
        },
      })
      .build();

    const module = await esmock('../../../src/content-fragment-404/collectors/athena-collector.js', {
      '@adobe/spacecat-shared-utils': {
        getStaticContent: getStaticContentStub,
      },
      '@adobe/spacecat-shared-athena-client': {
        AWSAthenaClient: {
          fromContext: sandbox.stub().returns(athenaClientStub),
        },
      },
      '../../../src/utils/cdn-utils.js': {
        extractCustomerDomain: sandbox.stub().returns('test'),
      },
    });

    AthenaCollector = module.AthenaCollector;
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('constructor', () => {
    it('should initialize with context', () => {
      const collector = new AthenaCollector(context);
      collector.imsOrg = 'test-ims-org';
      collector.sanitizedHostname = 'test';
      collector.initialize();
      setTestConfig(collector);

      expect(collector.context).to.equal(context);
      expect(collector.imsOrg).to.equal('test-ims-org');
      expect(collector.config).to.exist;
      expect(collector.config.location).to.include('s3://');
      expect(collector.config.tempLocation).to.include('s3://');
    });

    it('should create athena client with correct temp location', () => {
      const collector = new AthenaCollector(context);
      collector.imsOrg = 'test-ims-org';
      collector.sanitizedHostname = 'test';
      collector.initialize();
      setTestConfig(collector);

      expect(collector.athenaClient).to.equal(athenaClientStub);
    });
  });

  describe('validate', () => {
    it('should throw error when S3_BUCKET is missing', () => {
      const collector = new AthenaCollector({
        ...context,
        env: {
          S3_BUCKET: undefined,
        },
      });
      collector.imsOrg = 'test-ims-org';
      collector.sanitizedHostname = 'test';

      expect(() => collector.validate())
        .to.throw('Raw bucket is required');
    });

    it('should throw error when imsOrg is missing', () => {
      const collector = new AthenaCollector(context);
      collector.sanitizedHostname = 'test';

      expect(() => collector.validate())
        .to.throw('IMS organization is required');
    });

    it('should throw error when sanitizedHostname is missing', () => {
      const collector = new AthenaCollector(context);
      collector.imsOrg = 'test-ims-org';
      // Don't set sanitizedHostname - testing that it throws when missing

      expect(() => collector.validate())
        .to.throw('Sanitized hostname is required');
    });

    it('should not throw when all requirements are met', () => {
      const collector = new AthenaCollector(context);
      collector.imsOrg = 'test-ims-org';
      collector.sanitizedHostname = 'test';

      expect(() => collector.validate()).to.not.throw();
    });
  });

  describe('static constants', () => {
    it('should have GraphQL suffix regex', () => {
      expect(AthenaCollector.GRAPHQL_SUFFIX).to.be.a('regexp');
      expect(AthenaCollector.GRAPHQL_SUFFIX.test('/content/dam/test.cfm.json')).to.be.true;
      expect(AthenaCollector.GRAPHQL_SUFFIX.test('/content/dam/test.cfm.model.json')).to.be.true;
      expect(AthenaCollector.GRAPHQL_SUFFIX.test('/content/dam/test.cfm.variant.json')).to.be.true;
      expect(AthenaCollector.GRAPHQL_SUFFIX.test('/content/dam/test.cfm.gql.json')).to.be.true;
      expect(AthenaCollector.GRAPHQL_SUFFIX.test('/content/dam/test.jpg')).to.be.false;
      expect(AthenaCollector.GRAPHQL_SUFFIX.test('/content/dam/test.json')).to.be.false;
    });
  });

  describe('cleanPath static method', () => {
    it('should remove GraphQL suffix from paths', () => {
      expect(AthenaCollector.cleanPath('/content/dam/test.cfm.json')).to.equal('/content/dam/test');
      expect(AthenaCollector.cleanPath('/content/dam/test.cfm.model.json')).to.equal('/content/dam/test');
      expect(AthenaCollector.cleanPath('/content/dam/folder/item.cfm.variant.json')).to.equal('/content/dam/folder/item');
      expect(AthenaCollector.cleanPath('/content/dam/test.cfm.gql.json')).to.equal('/content/dam/test');
    });

    it('should return original path if no GraphQL suffix', () => {
      expect(AthenaCollector.cleanPath('/content/dam/test.jpg')).to.equal('/content/dam/test.jpg');
      expect(AthenaCollector.cleanPath('/content/dam/test')).to.equal('/content/dam/test');
      expect(AthenaCollector.cleanPath('/content/dam/test.json')).to.equal('/content/dam/test.json');
    });

    it('should handle edge cases', () => {
      expect(AthenaCollector.cleanPath('')).to.equal('');
      expect(AthenaCollector.cleanPath('/content/dam/.cfm.json')).to.equal('/content/dam/');
      expect(AthenaCollector.cleanPath('/content/dam/test.cfm')).to.equal('/content/dam/test.cfm');
    });
  });

  describe('createFrom static method', () => {
    it('should create new AthenaCollector instance', async () => {
      const collector = await AthenaCollector.createFrom(context);

      expect(collector).to.be.instanceOf(AthenaCollector);
      expect(collector.context).to.equal(context);
      expect(collector.imsOrg).to.equal('test-ims-org');
    });

    it('should throw error when IMS org cannot be retrieved', async () => {
      const invalidContext = {
        ...context,
        site: {
          getBaseURL: () => 'https://test-site.com',
        },
      };

      await expect(AthenaCollector.createFrom(invalidContext))
        .to.be.rejectedWith('Unable to retrieve IMS organization ID');
    });
  });

  describe('getAthenaConfig', () => {
    it('should generate correct configuration from context', () => {
      const collector = new AthenaCollector(context);
      collector.imsOrg = 'test-ims-org';
      collector.sanitizedHostname = 'test';
      const config = collector.getAthenaConfig();

      // Verify actual implementation behavior
      expect(config.database).to.equal('cdn_logs_test');
      expect(config.tableName).to.equal('content_fragment_404');
      expect(config.location).to.equal('s3://test-raw-bucket/test-ims-org/aggregated-404');
      expect(config.tempLocation).to.equal('s3://test-raw-bucket/temp/athena-results/');
    });
  
    it('should handle different bucket and IMS org values', () => {
      const customContext = {
        ...context,
        env: {
          S3_BUCKET: 'custom-bucket',
        },
      };

      const collector = new AthenaCollector(customContext);
      collector.imsOrg = 'custom-ims';
      const config = collector.getAthenaConfig();

      expect(config.location).to.equal('s3://custom-bucket/custom-ims/aggregated-404');
      expect(config.tempLocation).to.equal('s3://custom-bucket/temp/athena-results/');
    });
  });

  describe('getPreviousDayParts static method', () => {
    it('should return previous day parts', () => {
      // Mock Date to return a specific date
      const mockDate = new Date('2025-01-15T10:30:00Z');
      const originalDate = global.Date;
      global.Date = function MockDate(...args) {
        if (args.length === 0) {
          return mockDate;
        }
        return Reflect.construct(originalDate, args);
      };
      global.Date.prototype = originalDate.prototype;
      global.Date.UTC = originalDate.UTC;

      try {
        const parts = AthenaCollector.getPreviousDayParts();

        expect(parts).to.deep.equal({
          year: '2025',
          month: '01',
          day: '14', // Previous day
        });
      } finally {
        global.Date = originalDate;
      }
    });

    it('should handle month boundary correctly', () => {
      // Mock Date to return first day of month
      const mockDate = new Date('2025-02-01T10:30:00Z');
      const originalDate = global.Date;
      global.Date = function MockDate(...args) {
        if (args.length === 0) {
          return mockDate;
        }
        return Reflect.construct(originalDate, args);
      };
      global.Date.prototype = originalDate.prototype;
      global.Date.UTC = originalDate.UTC;

      try {
        const parts = AthenaCollector.getPreviousDayParts();

        expect(parts).to.deep.equal({
          year: '2025',
          month: '01', // Previous month
          day: '31', // Last day of previous month
        });
      } finally {
        global.Date = originalDate;
      }
    });
  });

  describe('getDateParts static method', () => {
    it('should return correct date parts for given date', () => {
      const testDate = new Date('2025-01-15T10:30:00Z');
      const parts = AthenaCollector.getDateParts(testDate);

      expect(parts).to.deep.equal({
        year: '2025',
        month: '01',
        day: '15',
      });
    });

    it('should pad single digit months and days with zero', () => {
      const testDate = new Date('2025-03-05T10:30:00Z');
      const parts = AthenaCollector.getDateParts(testDate);

      expect(parts).to.deep.equal({
        year: '2025',
        month: '03',
        day: '05',
      });
    });

    it('should use current date when no date provided', () => {
      const mockDate = new Date('2025-12-25T10:30:00Z');
      const originalDate = global.Date;
      global.Date = function MockDate(...args) {
        if (args.length === 0) {
          return mockDate;
        }
        return Reflect.construct(originalDate, args);
      };
      global.Date.prototype = originalDate.prototype;
      global.Date.UTC = originalDate.UTC;

      try {
        const parts = AthenaCollector.getDateParts();

        expect(parts).to.deep.equal({
          year: '2025',
          month: '12',
          day: '25',
        });
      } finally {
        global.Date = originalDate;
      }
    });
  });

  describe('loadSql static method', () => {
    it('should load SQL file with variables', async () => {
      const variables = { database: 'test_db', table: 'test_table' };
      const result = await AthenaCollector.loadSql('create-database', variables);

      expect(getStaticContentStub).to.have.been.calledWith(
        variables,
        './src/content-fragment-404/sql/create-database.sql',
      );
      expect(result).to.equal('SELECT * FROM test_table;');
    });

    it('should handle different SQL file names', async () => {
      const variables = { database: 'test_db' };
      await AthenaCollector.loadSql('daily-query', variables);

      expect(getStaticContentStub).to.have.been.calledWith(
        variables,
        './src/content-fragment-404/sql/daily-query.sql',
      );
    });

    it('should handle getStaticContent errors', async () => {
      getStaticContentStub.rejects(new Error('File not found'));

      await expect(AthenaCollector.loadSql('invalid-file', {}))
        .to.be.rejectedWith('File not found');
    });
  });

  describe('ensureDatabase', () => {
    it('should create database with correct SQL and description', async () => {
      const collector = new AthenaCollector(context);
      collector.imsOrg = 'test-ims-org';
      collector.sanitizedHostname = 'test';
      collector.initialize();
      setTestConfig(collector);
      setTestConfig(collector);

      await collector.ensureDatabase();

      expect(getStaticContentStub).to.have.been.calledWith(
        { database: 'test_database' },
        './src/content-fragment-404/sql/create-database.sql',
      );
      expect(athenaClientStub.execute).to.have.been.calledWith(
        'SELECT * FROM test_table;',
        'test_database',
        '[Athena Query] Create database test_database',
      );
    });

    it('should handle SQL loading errors', async () => {
      getStaticContentStub.rejects(new Error('SQL file not found'));
      const collector = new AthenaCollector(context);
      collector.imsOrg = 'test-ims-org';
      collector.sanitizedHostname = 'test';
      collector.initialize();
      setTestConfig(collector);

      await expect(collector.ensureDatabase())
        .to.be.rejectedWith('SQL file not found');
    });

    it('should handle athena execution errors', async () => {
      athenaClientStub.execute.rejects(new Error('Athena execution failed'));
      const collector = new AthenaCollector(context);
      collector.imsOrg = 'test-ims-org';
      collector.sanitizedHostname = 'test';
      collector.initialize();
      setTestConfig(collector);
      setTestConfig(collector);

      await expect(collector.ensureDatabase())
        .to.be.rejectedWith('Athena execution failed');
    });
  });

  describe('ensureTable', () => {
    it('should create table with correct SQL and description', async () => {
      const collector = new AthenaCollector(context);
      collector.imsOrg = 'test-ims-org';
      collector.sanitizedHostname = 'test';
      collector.initialize();
      setTestConfig(collector);
      setTestConfig(collector);

      await collector.ensureTable();

      expect(getStaticContentStub).to.have.been.calledWith(
        {
          database: 'test_database',
          tableName: 'test_table',
          location: 's3://test-raw-bucket/test-ims-org/aggregated-404',
        },
        './src/content-fragment-404/sql/create-table.sql',
      );
        expect(athenaClientStub.execute).to.have.been.calledWith(
          'SELECT * FROM test_table;',
          'test_database',
          '[Athena Query] Create table test_database.test_table',
        );
    });

    it('should handle SQL loading errors', async () => {
      getStaticContentStub.rejects(new Error('Table SQL not found'));
      const collector = new AthenaCollector(context);
      collector.imsOrg = 'test-ims-org';
      collector.sanitizedHostname = 'test';
      collector.initialize();
      setTestConfig(collector);
      setTestConfig(collector);

      await expect(collector.ensureTable())
        .to.be.rejectedWith('Table SQL not found');
    });

    it('should handle athena execution errors', async () => {
      athenaClientStub.execute.rejects(new Error('Table creation failed'));
      const collector = new AthenaCollector(context);
      collector.imsOrg = 'test-ims-org';
      collector.sanitizedHostname = 'test';
      collector.initialize();
      setTestConfig(collector);
      setTestConfig(collector);

      await expect(collector.ensureTable())
        .to.be.rejectedWith('Table creation failed');
    });
  });

  describe('queryContentFragment404s', () => {
    it('should query broken paths with correct parameters and filter assets', async () => {
      athenaClientStub.query.resolves([
        { url: '/content/dam/test/fragment1', request_user_agent: 'Mozilla/5.0', request_count: '10' },
        { url: '/content/dam/test/asset.jpg', request_user_agent: 'Mozilla/5.0', request_count: '5' }, // Asset should be filtered
        { url: null }, // Should be filtered
        { url: '/content/dam/test/fragment2', request_user_agent: 'Chrome/91.0', request_count: '20' },
      ]);

      const collector = new AthenaCollector(context);
      collector.imsOrg = 'test-ims-org';
      collector.sanitizedHostname = 'test';
      collector.initialize();
      setTestConfig(collector);
      const result = await collector.queryContentFragment404s('2025', '01', '15');

      expect(getStaticContentStub).to.have.been.calledWith(
        {
          database: 'test_database',
          tableName: 'test_table',
          year: '2025',
          month: '01',
          day: '15',
        },
        './src/content-fragment-404/sql/daily-query.sql',
      );

      expect(athenaClientStub.query).to.have.been.calledOnce;
      expect(athenaClientStub.query.getCall(0).args[0]).to.equal('SELECT * FROM test_table;');
      expect(athenaClientStub.query.getCall(0).args[1]).to.equal('test_database');

      expect(result).to.deep.equal([
        {
          url: '/content/dam/test/fragment1',
          requestUserAgents: [{ userAgent: 'Mozilla/5.0', count: 10 }],
          requestCount: 10,
        },
        {
          url: '/content/dam/test/fragment2',
          requestUserAgents: [{ userAgent: 'Chrome/91.0', count: 20 }],
          requestCount: 20,
        },
      ]);
    });

    it('should filter out asset URLs (images, documents, media)', async () => {
      athenaClientStub.query.resolves([
        { url: '/content/dam/fragment', request_user_agent: 'Mozilla/5.0', request_count: '7' },
        { url: '/content/dam/image.jpg', request_user_agent: 'Mozilla/5.0', request_count: '12' }, // Image asset
        { url: '/content/dam/document.pdf', request_user_agent: 'Mozilla/5.0', request_count: '3' }, // Document asset
        { url: '/content/dam/video.mp4', request_user_agent: 'Mozilla/5.0', request_count: '9' }, // Media asset
        { url: '/content/dam/font.woff', request_user_agent: 'Mozilla/5.0', request_count: '2' }, // Font asset
        { url: '/content/dam/archive.zip', request_user_agent: 'Mozilla/5.0', request_count: '5' }, // Archive asset
        { url: '/content/dam/another-fragment', request_user_agent: 'Chrome/91.0', request_count: '4' },
      ]);

      const collector = new AthenaCollector(context);
      collector.imsOrg = 'test-ims-org';
      collector.sanitizedHostname = 'test';
      collector.initialize();
      setTestConfig(collector);
      const result = await collector.queryContentFragment404s('2025', '01', '15');

      expect(result).to.deep.equal([
        {
          url: '/content/dam/fragment',
          requestUserAgents: [{ userAgent: 'Mozilla/5.0', count: 7 }],
          requestCount: 7,
        },
        {
          url: '/content/dam/another-fragment',
          requestUserAgents: [{ userAgent: 'Chrome/91.0', count: 4 }],
          requestCount: 4,
        },
      ]);
    });

    it('should filter out null URLs from results', async () => {
      athenaClientStub.query.resolves([
        { url: '/content/dam/test/valid-fragment', request_user_agent: 'Mozilla/5.0', request_count: '6' },
        { url: null },
        { url: '' },
        { url: '/content/dam/test/another-fragment', request_user_agent: 'Chrome/91.0', request_count: '9' },
      ]);

      const collector = new AthenaCollector(context);
      collector.imsOrg = 'test-ims-org';
      collector.sanitizedHostname = 'test';
      collector.initialize();
      setTestConfig(collector);
      const result = await collector.queryContentFragment404s('2025', '01', '15');

      expect(result).to.deep.equal([
        {
          url: '/content/dam/test/valid-fragment',
          requestUserAgents: [{ userAgent: 'Mozilla/5.0', count: 6 }],
          requestCount: 6,
        },
        {
          url: '/content/dam/test/another-fragment',
          requestUserAgents: [{ userAgent: 'Chrome/91.0', count: 9 }],
          requestCount: 9,
        },
      ]);
    });

    it('should group multiple user agents for the same URL', async () => {
      athenaClientStub.query.resolves([
        { url: '/content/dam/fragment', request_user_agent: 'Mozilla/5.0', request_count: '15' },
        { url: '/content/dam/fragment', request_user_agent: 'Chrome/91.0', request_count: '10' },
        { url: '/content/dam/fragment', request_user_agent: 'Safari/14.0', request_count: '5' },
        { url: '/content/dam/another', request_user_agent: 'Mozilla/5.0', request_count: '8' },
      ]);

      const collector = new AthenaCollector(context);
      collector.imsOrg = 'test-ims-org';
      collector.sanitizedHostname = 'test';
      collector.initialize();
      setTestConfig(collector);
      const result = await collector.queryContentFragment404s('2025', '01', '15');

      expect(result).to.deep.equal([
        {
          url: '/content/dam/fragment',
          requestUserAgents: [
            { userAgent: 'Mozilla/5.0', count: 15 },
            { userAgent: 'Chrome/91.0', count: 10 },
            { userAgent: 'Safari/14.0', count: 5 },
          ],
          requestCount: 30,
        },
        {
          url: '/content/dam/another',
          requestUserAgents: [{ userAgent: 'Mozilla/5.0', count: 8 }],
          requestCount: 8,
        },
      ]);
    });

    it('should aggregate counts for duplicate user agents on the same URL', async () => {
      athenaClientStub.query.resolves([
        { url: '/content/dam/fragment', request_user_agent: 'Mozilla/5.0', request_count: '12' },
        { url: '/content/dam/fragment', request_user_agent: 'Mozilla/5.0', request_count: '8' },
        { url: '/content/dam/fragment', request_user_agent: 'Chrome/91.0', request_count: '5' },
      ]);

      const collector = new AthenaCollector(context);
      collector.imsOrg = 'test-ims-org';
      collector.sanitizedHostname = 'test';
      collector.initialize();
      setTestConfig(collector);
      const result = await collector.queryContentFragment404s('2025', '01', '15');

      expect(result).to.deep.equal([
        {
          url: '/content/dam/fragment',
          requestUserAgents: [
            { userAgent: 'Mozilla/5.0', count: 20 }, // 12 + 8 aggregated
            { userAgent: 'Chrome/91.0', count: 5 },
          ],
          requestCount: 25, // Total: 20 + 5
        },
      ]);
    });

    it('should clean GraphQL suffixes from URLs', async () => {
      athenaClientStub.query.resolves([
        { url: '/content/dam/fragment.cfm.json', request_user_agent: 'Mozilla/5.0', request_count: '10' },
        { url: '/content/dam/fragment.cfm.model.json', request_user_agent: 'Chrome/91.0', request_count: '5' },
        { url: '/content/dam/another.cfm.gql.json', request_user_agent: 'Safari/14.0', request_count: '3' },
      ]);

      const collector = new AthenaCollector(context);
      collector.imsOrg = 'test-ims-org';
      collector.sanitizedHostname = 'test';
      collector.initialize();
      setTestConfig(collector);
      const result = await collector.queryContentFragment404s('2025', '01', '15');

      expect(result).to.deep.equal([
        {
          url: '/content/dam/fragment',
          requestUserAgents: [
            { userAgent: 'Mozilla/5.0', count: 10 },
            { userAgent: 'Chrome/91.0', count: 5 },
          ],
          requestCount: 15,
        },
        {
          url: '/content/dam/another',
          requestUserAgents: [{ userAgent: 'Safari/14.0', count: 3 }],
          requestCount: 3,
        },
      ]);
    });

    it('should handle empty query results', async () => {
      athenaClientStub.query.resolves([]);

      const collector = new AthenaCollector(context);
      collector.imsOrg = 'test-ims-org';
      collector.sanitizedHostname = 'test';
      collector.initialize();
      setTestConfig(collector);
      const result = await collector.queryContentFragment404s('2025', '01', '15');

      expect(result).to.deep.equal([]);
    });

    it('should handle SQL loading errors', async () => {
      getStaticContentStub.rejects(new Error('Query SQL not found'));
      const collector = new AthenaCollector(context);
      collector.imsOrg = 'test-ims-org';
      collector.sanitizedHostname = 'test';
      collector.initialize();
      setTestConfig(collector);

      await expect(collector.queryContentFragment404s('2025', '01', '15'))
        .to.be.rejectedWith('Query SQL not found');
    });

    it('should handle athena query errors', async () => {
      athenaClientStub.query.rejects(new Error('Query execution failed'));
      const collector = new AthenaCollector(context);
      collector.imsOrg = 'test-ims-org';
      collector.sanitizedHostname = 'test';
      collector.initialize();
      setTestConfig(collector);

      await expect(collector.queryContentFragment404s('2025', '01', '15'))
        .to.be.rejectedWith('Query execution failed');
    });

    it('should handle invalid request_count values and default to 0', async () => {
      athenaClientStub.query.resolves([
        { url: '/content/dam/fragment1', request_user_agent: 'Mozilla/5.0', request_count: 'invalid' },
        { url: '/content/dam/fragment2', request_user_agent: 'Chrome/91.0', request_count: null },
        { url: '/content/dam/fragment3', request_user_agent: 'Safari/14.0', request_count: undefined },
        { url: '/content/dam/fragment4', request_user_agent: 'Edge/90.0', request_count: '' },
        { url: '/content/dam/fragment5', request_user_agent: 'Opera/80.0', request_count: '10' },
      ]);

      const collector = new AthenaCollector(context);
      collector.imsOrg = 'test-ims-org';
      collector.sanitizedHostname = 'test';
      collector.initialize();
      setTestConfig(collector);
      const result = await collector.queryContentFragment404s('2025', '01', '15');

      expect(result).to.deep.equal([
        {
          url: '/content/dam/fragment1',
          requestUserAgents: [{ userAgent: 'Mozilla/5.0', count: 0 }],
          requestCount: 0,
        },
        {
          url: '/content/dam/fragment2',
          requestUserAgents: [{ userAgent: 'Chrome/91.0', count: 0 }],
          requestCount: 0,
        },
        {
          url: '/content/dam/fragment3',
          requestUserAgents: [{ userAgent: 'Safari/14.0', count: 0 }],
          requestCount: 0,
        },
        {
          url: '/content/dam/fragment4',
          requestUserAgents: [{ userAgent: 'Edge/90.0', count: 0 }],
          requestCount: 0,
        },
        {
          url: '/content/dam/fragment5',
          requestUserAgents: [{ userAgent: 'Opera/80.0', count: 10 }],
          requestCount: 10,
        },
      ]);
    });
  });

  describe('fetchContentFragment404s', () => {
    it('should fetch broken paths successfully and exclude assets', async () => {
      // Mock getPreviousDayParts to return specific date
      const originalGetPreviousDayParts = AthenaCollector.getPreviousDayParts;
      AthenaCollector.getPreviousDayParts = sandbox.stub().returns({
        year: '2025',
        month: '01',
        day: '14',
      });

      try {
        const collector = new AthenaCollector(context);
        collector.imsOrg = 'test-ims-org';
      collector.sanitizedHostname = 'test';
        collector.initialize();
      setTestConfig(collector);
        const result = await collector.fetchContentFragment404s();

        expect(result).to.deep.equal([
          {
            url: '/content/dam/test/fragment1',
            requestUserAgents: [{ userAgent: 'Mozilla/5.0', count: 10 }],
            requestCount: 10,
          },
          {
            url: '/content/dam/test/fragment2',
            requestUserAgents: [{ userAgent: 'Chrome/91.0', count: 8 }],
            requestCount: 8,
          },
        ]);
      } finally {
        AthenaCollector.getPreviousDayParts = originalGetPreviousDayParts;
      }
    });

    it('should handle database creation errors', async () => {
      athenaClientStub.execute.onFirstCall().rejects(new Error('Database creation failed'));

      const collector = new AthenaCollector(context);
      collector.imsOrg = 'test-ims-org';
      collector.sanitizedHostname = 'test';
      collector.initialize();
      setTestConfig(collector);

      await expect(collector.fetchContentFragment404s())
        .to.be.rejectedWith('Athena query failed: Database creation failed');

      expect(context.log.error).to.have.been.calledWith('Athena query failed: Database creation failed');
    });

    it('should handle table creation errors', async () => {
      athenaClientStub.execute.onSecondCall().rejects(new Error('Table creation failed'));

      const collector = new AthenaCollector(context);
      collector.imsOrg = 'test-ims-org';
      collector.sanitizedHostname = 'test';
      collector.initialize();
      setTestConfig(collector);

      await expect(collector.fetchContentFragment404s())
        .to.be.rejectedWith('Athena query failed: Table creation failed');

      expect(context.log.error).to.have.been.calledWith('Athena query failed: Table creation failed');
    });

    it('should handle query execution errors', async () => {
      athenaClientStub.query.rejects(new Error('Query failed'));

      const collector = new AthenaCollector(context);
      collector.imsOrg = 'test-ims-org';
      collector.sanitizedHostname = 'test';
      collector.initialize();
      setTestConfig(collector);

      await expect(collector.fetchContentFragment404s())
        .to.be.rejectedWith('Athena query failed: Query failed');

      expect(context.log.error).to.have.been.calledWith('Athena query failed: Query failed');
    });

    it('should call ensureDatabase and ensureTable in correct order', async () => {
      const collector = new AthenaCollector(context);
      collector.imsOrg = 'test-ims-org';
      collector.sanitizedHostname = 'test';
      collector.initialize();
      setTestConfig(collector);
      const ensureDatabaseSpy = sandbox.spy(collector, 'ensureDatabase');
      const ensureTableSpy = sandbox.spy(collector, 'ensureTable');
      const queryContentFragment404sSpy = sandbox.spy(collector, 'queryContentFragment404s');

      await collector.fetchContentFragment404s();

      expect(ensureDatabaseSpy).to.have.been.calledBefore(ensureTableSpy);
      expect(ensureTableSpy).to.have.been.calledBefore(queryContentFragment404sSpy);
    });

    it('should handle empty results gracefully', async () => {
      athenaClientStub.query.resolves([]);

      const collector = new AthenaCollector(context);
      collector.imsOrg = 'test-ims-org';
      collector.sanitizedHostname = 'test';
      collector.initialize();
      setTestConfig(collector);
      const result = await collector.fetchContentFragment404s();

      expect(result).to.deep.equal([]);
    });
  });

});
