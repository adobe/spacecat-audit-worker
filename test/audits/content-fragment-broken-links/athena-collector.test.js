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

  beforeEach(async () => {
    sandbox = sinon.createSandbox();

    athenaClientStub = {
      execute: sandbox.stub().resolves(),
      query: sandbox.stub().resolves([
        { url: '/content/dam/test/broken1.jpg' },
        { url: '/content/dam/test/broken2.pdf' },
        { url: null }, // Should be filtered out
        { url: '/content/dam/test/broken3.png' },
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
        rawBucket: 'test-raw-bucket',
        imsOrg: 'test-ims-org',
        tenant: 'test-tenant',
      })
      .build();

    const module = await esmock('../../../src/content-fragment-broken-links/collectors/athena-collector.js', {
      '@adobe/spacecat-shared-utils': {
        getStaticContent: getStaticContentStub,
      },
      '@adobe/spacecat-shared-athena-client': {
        AWSAthenaClient: {
          fromContext: sandbox.stub().returns(athenaClientStub),
        },
      },
    });

    AthenaCollector = module.AthenaCollector;
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('constructor', () => {
    it('should initialize with correct configuration', () => {
      const collector = new AthenaCollector(context);

      expect(collector.context).to.equal(context);
      expect(collector.config).to.deep.equal({
        database: 'broken_content_paths_db',
        tableName: 'broken_content_paths_test',
        location: 's3://test-raw-bucket/test-ims-org/aggregated-404',
        tempLocation: 's3://test-raw-bucket/temp/athena-results/',
        tenant: 'test-tenant',
      });
    });

    it('should create athena client with correct temp location', () => {
      const collector = new AthenaCollector(context);

      expect(collector.athenaClient).to.equal(athenaClientStub);
    });
  });

  describe('createFrom static method', () => {
    it('should create new AthenaCollector instance', () => {
      const collector = AthenaCollector.createFrom(context);

      expect(collector).to.be.instanceOf(AthenaCollector);
      expect(collector.context).to.equal(context);
    });
  });

  describe('getAthenaConfig', () => {
    it('should generate correct configuration from context', () => {
      const collector = new AthenaCollector(context);
      const config = collector.getAthenaConfig();

      expect(config).to.deep.equal({
        database: 'broken_content_paths_db',
        tableName: 'broken_content_paths_test',
        location: 's3://test-raw-bucket/test-ims-org/aggregated-404',
        tempLocation: 's3://test-raw-bucket/temp/athena-results/',
        tenant: 'test-tenant',
      });
    });

    it('should handle different bucket and IMS org values', () => {
      const customContext = {
        ...context,
        rawBucket: 'custom-bucket',
        imsOrg: 'custom-ims',
        tenant: 'custom-tenant',
      };

      const collector = new AthenaCollector(customContext);
      const config = collector.getAthenaConfig();

      expect(config.location).to.equal('s3://custom-bucket/custom-ims/aggregated-404');
      expect(config.tempLocation).to.equal('s3://custom-bucket/temp/athena-results/');
      expect(config.tenant).to.equal('custom-tenant');
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
        './src/content-fragment-broken-links/sql/create-database.sql',
      );
      expect(result).to.equal('SELECT * FROM test_table;');
    });

    it('should handle different SQL file names', async () => {
      const variables = { database: 'test_db' };
      await AthenaCollector.loadSql('daily-query', variables);

      expect(getStaticContentStub).to.have.been.calledWith(
        variables,
        './src/content-fragment-broken-links/sql/daily-query.sql',
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

      await collector.ensureDatabase();

      expect(getStaticContentStub).to.have.been.calledWith(
        { database: 'broken_content_paths_db' },
        './src/content-fragment-broken-links/sql/create-database.sql',
      );
      expect(athenaClientStub.execute).to.have.been.calledWith(
        'SELECT * FROM test_table;',
        'broken_content_paths_db',
        '[Athena Query] Create database broken_content_paths_db',
      );
    });

    it('should handle SQL loading errors', async () => {
      getStaticContentStub.rejects(new Error('SQL file not found'));
      const collector = new AthenaCollector(context);

      await expect(collector.ensureDatabase())
        .to.be.rejectedWith('SQL file not found');
    });

    it('should handle athena execution errors', async () => {
      athenaClientStub.execute.rejects(new Error('Athena execution failed'));
      const collector = new AthenaCollector(context);

      await expect(collector.ensureDatabase())
        .to.be.rejectedWith('Athena execution failed');
    });
  });

  describe('ensureTable', () => {
    it('should create table with correct SQL and description', async () => {
      const collector = new AthenaCollector(context);

      await collector.ensureTable();

      expect(getStaticContentStub).to.have.been.calledWith(
        {
          database: 'broken_content_paths_db',
          tableName: 'broken_content_paths_test',
          location: 's3://test-raw-bucket/test-ims-org/aggregated-404',
        },
        './src/content-fragment-broken-links/sql/create-table.sql',
      );
      expect(athenaClientStub.execute).to.have.been.calledWith(
        'SELECT * FROM test_table;',
        'broken_content_paths_db',
        '[Athena Query] Create table broken_content_paths_db.broken_content_paths_test',
      );
    });

    it('should handle SQL loading errors', async () => {
      getStaticContentStub.rejects(new Error('Table SQL not found'));
      const collector = new AthenaCollector(context);

      await expect(collector.ensureTable())
        .to.be.rejectedWith('Table SQL not found');
    });

    it('should handle athena execution errors', async () => {
      athenaClientStub.execute.rejects(new Error('Table creation failed'));
      const collector = new AthenaCollector(context);

      await expect(collector.ensureTable())
        .to.be.rejectedWith('Table creation failed');
    });
  });

  describe('queryBrokenPaths', () => {
    it('should query broken paths with correct parameters', async () => {
      const collector = new AthenaCollector(context);
      const result = await collector.queryBrokenPaths('2025', '01', '15');

      expect(getStaticContentStub).to.have.been.calledWith(
        {
          database: 'broken_content_paths_db',
          tableName: 'broken_content_paths_test',
          year: '2025',
          month: '01',
          day: '15',
          tenant: 'test-tenant',
        },
        './src/content-fragment-broken-links/sql/daily-query.sql',
      );

      expect(athenaClientStub.query).to.have.been.calledWith(
        'SELECT * FROM test_table;',
        'broken_content_paths_db',
        '[Athena Query] Fetch broken content paths for 2025-01-15',
      );

      expect(result).to.deep.equal([
        '/content/dam/test/broken1.jpg',
        '/content/dam/test/broken2.pdf',
        '/content/dam/test/broken3.png',
      ]);
    });

    it('should filter out null URLs from results', async () => {
      athenaClientStub.query.resolves([
        { url: '/content/dam/test/valid.jpg' },
        { url: null },
        { url: '' },
        { url: '/content/dam/test/another.pdf' },
      ]);

      const collector = new AthenaCollector(context);
      const result = await collector.queryBrokenPaths('2025', '01', '15');

      expect(result).to.deep.equal([
        '/content/dam/test/valid.jpg',
        '/content/dam/test/another.pdf',
      ]);
    });

    it('should handle empty query results', async () => {
      athenaClientStub.query.resolves([]);

      const collector = new AthenaCollector(context);
      const result = await collector.queryBrokenPaths('2025', '01', '15');

      expect(result).to.deep.equal([]);
    });

    it('should handle SQL loading errors', async () => {
      getStaticContentStub.rejects(new Error('Query SQL not found'));
      const collector = new AthenaCollector(context);

      await expect(collector.queryBrokenPaths('2025', '01', '15'))
        .to.be.rejectedWith('Query SQL not found');
    });

    it('should handle athena query errors', async () => {
      athenaClientStub.query.rejects(new Error('Query execution failed'));
      const collector = new AthenaCollector(context);

      await expect(collector.queryBrokenPaths('2025', '01', '15'))
        .to.be.rejectedWith('Query execution failed');
    });
  });

  describe('fetchBrokenPaths', () => {
    it('should fetch broken paths successfully', async () => {
      // Mock getPreviousDayParts to return specific date
      const originalGetPreviousDayParts = AthenaCollector.getPreviousDayParts;
      AthenaCollector.getPreviousDayParts = sandbox.stub().returns({
        year: '2025',
        month: '01',
        day: '14',
      });

      try {
        const collector = new AthenaCollector(context);
        const result = await collector.fetchBrokenPaths();

        expect(context.log.info).to.have.been.calledWith('Fetching broken content paths for 2025-01-14 from Athena');
        expect(context.log.info).to.have.been.calledWith('Found 3 broken content paths from Athena');

        expect(result).to.deep.equal([
          '/content/dam/test/broken1.jpg',
          '/content/dam/test/broken2.pdf',
          '/content/dam/test/broken3.png',
        ]);
      } finally {
        AthenaCollector.getPreviousDayParts = originalGetPreviousDayParts;
      }
    });

    it('should handle database creation errors', async () => {
      athenaClientStub.execute.onFirstCall().rejects(new Error('Database creation failed'));

      const collector = new AthenaCollector(context);

      await expect(collector.fetchBrokenPaths())
        .to.be.rejectedWith('Athena query failed: Database creation failed');

      expect(context.log.error).to.have.been.calledWith('Athena query failed: Database creation failed');
    });

    it('should handle table creation errors', async () => {
      athenaClientStub.execute.onSecondCall().rejects(new Error('Table creation failed'));

      const collector = new AthenaCollector(context);

      await expect(collector.fetchBrokenPaths())
        .to.be.rejectedWith('Athena query failed: Table creation failed');

      expect(context.log.error).to.have.been.calledWith('Athena query failed: Table creation failed');
    });

    it('should handle query execution errors', async () => {
      athenaClientStub.query.rejects(new Error('Query failed'));

      const collector = new AthenaCollector(context);

      await expect(collector.fetchBrokenPaths())
        .to.be.rejectedWith('Athena query failed: Query failed');

      expect(context.log.error).to.have.been.calledWith('Athena query failed: Query failed');
    });

    it('should call ensureDatabase and ensureTable in correct order', async () => {
      const collector = new AthenaCollector(context);
      const ensureDatabaseSpy = sandbox.spy(collector, 'ensureDatabase');
      const ensureTableSpy = sandbox.spy(collector, 'ensureTable');
      const queryBrokenPathsSpy = sandbox.spy(collector, 'queryBrokenPaths');

      await collector.fetchBrokenPaths();

      expect(ensureDatabaseSpy).to.have.been.calledBefore(ensureTableSpy);
      expect(ensureTableSpy).to.have.been.calledBefore(queryBrokenPathsSpy);
    });

    it('should handle empty results gracefully', async () => {
      athenaClientStub.query.resolves([]);

      const collector = new AthenaCollector(context);
      const result = await collector.fetchBrokenPaths();

      expect(context.log.info).to.have.been.calledWith('Found 0 broken content paths from Athena');
      expect(result).to.deep.equal([]);
    });
  });

  describe('static constants', () => {
    it('should have correct database name', () => {
      expect(AthenaCollector.DATABASE_NAME).to.equal('broken_content_paths_db');
    });

    it('should have correct table name', () => {
      expect(AthenaCollector.TABLE_NAME).to.equal('broken_content_paths_test');
    });
  });
});
