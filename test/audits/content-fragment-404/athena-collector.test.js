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

import {
  TEST_DATABASE,
  TEST_TABLE,
  TEST_IMS_ORG,
  TEST_HOSTNAME,
  TEST_BASE_URL_SITE as TEST_BASE_URL,
  TEST_ORG_ID,
  TEST_AWS_ENV,
  CUSTOM_AWS_ENV,
  TEST_STANDARD_BUCKET,
  CUSTOM_STANDARD_BUCKET,
  TEST_PATH_1,
  TEST_PATH_2,
  TEST_ASSET_PATH,
  TEST_YEAR,
  TEST_MONTH,
  TEST_DAY,
  TEST_DAY_PREVIOUS,
  TEST_MONTH_MAR,
  TEST_DAY_5,
  TEST_MONTH_DEC,
  TEST_DAY_25,
  TEST_DAY_31,
  TEST_USER_AGENT_1,
  TEST_USER_AGENT_2,
  TEST_USER_AGENT_3,
  TEST_USER_AGENT_4,
  TEST_USER_AGENT_5,
  REQUEST_COUNT_SMALL,
  REQUEST_COUNT_MEDIUM,
  REQUEST_COUNT_TINY,
  REQUEST_COUNT_HIGH,
  REQUEST_COUNT_LOW_1,
  REQUEST_COUNT_LOW_2,
  REQUEST_COUNT_LOW_3,
  REQUEST_COUNT_LOW_4,
  REQUEST_COUNT_LOW_5,
  REQUEST_COUNT_MID_1,
  REQUEST_COUNT_MID_2,
  REQUEST_COUNT_MID_3,
  REQUEST_COUNT_HIGH_1,
  REQUEST_COUNT_HIGH_2,
  REQUEST_COUNT_NONE,
  TEST_DATE_2025_01_14,
  TEST_DATE_2025_01_15,
  TEST_DATE_2025_02_01,
  TEST_DATE_2025_03_05,
  TEST_DATE_2025_12_25,
  DEFAULT_DATABASE_NAME,
  DEFAULT_TABLE_NAME,
  S3_PATH_AGGREGATED_404,
  S3_PATH_TEMP_ATHENA_RESULTS,
  TEST_DATABASE_NAME,
  TEST_SQL_RESULT,
  ATHENA_QUERY_PREFIX,
  CUSTOM_IMS_ORG,
  TEST_PATH_FRAGMENT,
  TEST_PATH_IMAGE_JPG,
  TEST_PATH_DOCUMENT_PDF,
  TEST_PATH_VIDEO_MP4,
  TEST_PATH_FONT_WOFF,
  TEST_PATH_ARCHIVE_ZIP,
  TEST_PATH_ANOTHER_FRAGMENT,
  TEST_PATH_ANOTHER,
  TEST_PATH_VALID_FRAGMENT,
  TEST_PATH_ANOTHER_FRAGMENT_2,
  TEST_PATH_FRAGMENT1,
  TEST_PATH_FRAGMENT2,
  TEST_PATH_FRAGMENT3,
  TEST_PATH_FRAGMENT4,
  TEST_PATH_FRAGMENT5,
} from './test-constants.js';

describe('AthenaCollector', () => {
  let sandbox;
  let context;
  let athenaClientStub;
  let getStaticContentStub;
  let AthenaCollector;
  let generateStandardBucketNameStub;
  let extractCustomerDomainStub;

  // Helper to set test config on collector
  const setTestConfig = (collector) => {
    collector.config = {
      database: TEST_DATABASE,
      tableName: TEST_TABLE,
      location: collector.config.location,
      tempLocation: collector.config.tempLocation,
    };
  };

  beforeEach(async () => {
    sandbox = sinon.createSandbox();

    extractCustomerDomainStub = sandbox.stub().returns(TEST_HOSTNAME);
    generateStandardBucketNameStub = sandbox.stub().callsFake((envValue) => `cdn-logs-adobe-${envValue}`);

    athenaClientStub = {
      execute: sandbox.stub().resolves(),
      query: sandbox.stub().resolves([
        { url: TEST_PATH_1, request_user_agent: TEST_USER_AGENT_1, request_count: String(REQUEST_COUNT_SMALL) },
        { url: TEST_ASSET_PATH, request_user_agent: TEST_USER_AGENT_1, request_count: String(REQUEST_COUNT_TINY) }, // Asset URL should be filtered
        { url: null }, // Null URL should be filtered
        { url: TEST_PATH_2, request_user_agent: TEST_USER_AGENT_2, request_count: String(REQUEST_COUNT_MEDIUM) },
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
          AWS_ENV: TEST_AWS_ENV,
        },
        site: {
          getBaseURL: () => TEST_BASE_URL,
          getOrganizationId: () => TEST_ORG_ID,
        },
        dataAccess: {
          Organization: {
            findById: sandbox.stub().resolves({
              getImsOrgId: () => TEST_IMS_ORG,
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
        extractCustomerDomain: extractCustomerDomainStub,
        generateStandardBucketName: generateStandardBucketNameStub,
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
      collector.imsOrg = TEST_IMS_ORG;
      collector.sanitizedHostname = TEST_HOSTNAME;
      collector.initialize();
      setTestConfig(collector);

      expect(collector.context).to.equal(context);
      expect(collector.imsOrg).to.equal(TEST_IMS_ORG);
      expect(collector.config).to.exist;
      expect(collector.config.location).to.include('s3://');
      expect(collector.config.tempLocation).to.include('s3://');
    });

    it('should create athena client with correct temp location', () => {
      const collector = new AthenaCollector(context);
      collector.imsOrg = TEST_IMS_ORG;
      collector.sanitizedHostname = TEST_HOSTNAME;
      collector.initialize();
      setTestConfig(collector);

      expect(collector.athenaClient).to.equal(athenaClientStub);
    });
  });

  describe('validate', () => {
    it('should throw error when AWS_ENV is missing', () => {
      const collector = new AthenaCollector({
        ...context,
        env: {
          AWS_ENV: undefined,
        },
      });
      collector.imsOrg = TEST_IMS_ORG;
      collector.sanitizedHostname = TEST_HOSTNAME;

      expect(() => collector.validate())
        .to.throw('AWS environment is required');
    });

    it('should throw error when imsOrg is missing', () => {
      const collector = new AthenaCollector(context);
      collector.sanitizedHostname = TEST_HOSTNAME;

      expect(() => collector.validate())
        .to.throw('IMS organization is required');
    });

    it('should throw error when sanitizedHostname is missing', () => {
      const collector = new AthenaCollector(context);
      collector.imsOrg = TEST_IMS_ORG;
      // Don't set sanitizedHostname - testing that it throws when missing

      expect(() => collector.validate())
        .to.throw('Sanitized hostname is required');
    });

    it('should not throw when all requirements are met', () => {
      const collector = new AthenaCollector(context);
      collector.imsOrg = TEST_IMS_ORG;
      collector.sanitizedHostname = TEST_HOSTNAME;

      expect(() => collector.validate()).to.not.throw();
      expect(collector.awsEnv).to.equal(TEST_AWS_ENV);
    });

    it('should normalize AWS_ENV by trimming and lower-casing', () => {
      const collector = new AthenaCollector({
        ...context,
        env: {
          AWS_ENV: ' Dev ',
        },
      });
      collector.imsOrg = TEST_IMS_ORG;
      collector.sanitizedHostname = TEST_HOSTNAME;

      collector.validate();

      expect(collector.awsEnv).to.equal(CUSTOM_AWS_ENV);
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
      expect(collector.imsOrg).to.equal(TEST_IMS_ORG);
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
      collector.imsOrg = TEST_IMS_ORG;
      collector.sanitizedHostname = TEST_HOSTNAME;
      collector.validate();
      const config = collector.getAthenaConfig();

      // Verify actual implementation behavior
      expect(config.database).to.equal(DEFAULT_DATABASE_NAME);
      expect(config.tableName).to.equal(DEFAULT_TABLE_NAME);
      expect(config.location).to.equal(`s3://${TEST_STANDARD_BUCKET}/${TEST_IMS_ORG}/${S3_PATH_AGGREGATED_404}`);
      expect(config.tempLocation).to.equal(`s3://${TEST_STANDARD_BUCKET}/${S3_PATH_TEMP_ATHENA_RESULTS}`);
      expect(generateStandardBucketNameStub).to.have.been.calledWith(TEST_AWS_ENV);
    });
  
    it('should handle different AWS environments and IMS org values', () => {
      const customContext = {
        ...context,
        env: {
          AWS_ENV: CUSTOM_AWS_ENV,
        },
      };

      const collector = new AthenaCollector(customContext);
      collector.imsOrg = CUSTOM_IMS_ORG;
      collector.sanitizedHostname = TEST_HOSTNAME;
      collector.validate();
      const config = collector.getAthenaConfig();

      expect(config.location).to.equal(`s3://${CUSTOM_STANDARD_BUCKET}/${CUSTOM_IMS_ORG}/${S3_PATH_AGGREGATED_404}`);
      expect(config.tempLocation).to.equal(`s3://${CUSTOM_STANDARD_BUCKET}/${S3_PATH_TEMP_ATHENA_RESULTS}`);
      expect(generateStandardBucketNameStub).to.have.been.calledWith(CUSTOM_AWS_ENV);
    });
  });

  describe('getPreviousDayParts static method', () => {
    it('should return previous day parts', () => {
      const mockDate = TEST_DATE_2025_01_15;
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
          year: TEST_YEAR,
          month: TEST_MONTH,
          day: TEST_DAY_PREVIOUS, // Previous day
        });
      } finally {
        global.Date = originalDate;
      }
    });

    it('should handle month boundary correctly', () => {
      // Mock Date to return first day of month
      const mockDate = TEST_DATE_2025_02_01;
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
          year: TEST_YEAR,
          month: TEST_MONTH,
          day: TEST_DAY_31, // Last day of previous month (hardcoded as it's relative to TEST_DATE_2025_02_01)
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
        year: TEST_YEAR,
        month: TEST_MONTH,
        day: TEST_DAY,
      });
    });

    it('should pad single digit months and days with zero', () => {
      const testDate = TEST_DATE_2025_03_05;
      const parts = AthenaCollector.getDateParts(testDate);

      expect(parts).to.deep.equal({
        year: TEST_YEAR,
        month: TEST_MONTH_MAR,
        day: TEST_DAY_5,
      });
    });

    it('should use current date when no date provided', () => {
      const mockDate = TEST_DATE_2025_12_25;
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
          year: TEST_YEAR,
          month: TEST_MONTH_DEC,
          day: TEST_DAY_25,
        });
      } finally {
        global.Date = originalDate;
      }
    });
  });

  describe('loadSql static method', () => {
    it('should load SQL file with variables', async () => {
      const variables = { database: TEST_DATABASE_NAME, table: TEST_TABLE };
      const result = await AthenaCollector.loadSql('create-database', variables);

      expect(getStaticContentStub).to.have.been.calledWith(
        variables,
        './src/content-fragment-404/sql/create-database.sql',
      );
      expect(result).to.equal(TEST_SQL_RESULT);
    });

    it('should handle different SQL file names', async () => {
      const variables = { database: TEST_DATABASE_NAME };
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
      collector.imsOrg = TEST_IMS_ORG;
      collector.sanitizedHostname = TEST_HOSTNAME;
      collector.initialize();
      setTestConfig(collector);
      setTestConfig(collector);

      await collector.ensureDatabase();

      expect(getStaticContentStub).to.have.been.calledWith(
        { database: TEST_DATABASE },
        './src/content-fragment-404/sql/create-database.sql',
      );
      expect(athenaClientStub.execute).to.have.been.calledWith(
        TEST_SQL_RESULT,
        TEST_DATABASE,
        `${ATHENA_QUERY_PREFIX} Create database ${TEST_DATABASE}`,
      );
    });

    it('should handle SQL loading errors', async () => {
      getStaticContentStub.rejects(new Error('SQL file not found'));
      const collector = new AthenaCollector(context);
      collector.imsOrg = TEST_IMS_ORG;
      collector.sanitizedHostname = TEST_HOSTNAME;
      collector.initialize();
      setTestConfig(collector);

      await expect(collector.ensureDatabase())
        .to.be.rejectedWith('SQL file not found');
    });

    it('should handle athena execution errors', async () => {
      athenaClientStub.execute.rejects(new Error('Athena execution failed'));
      const collector = new AthenaCollector(context);
      collector.imsOrg = TEST_IMS_ORG;
      collector.sanitizedHostname = TEST_HOSTNAME;
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
      collector.imsOrg = TEST_IMS_ORG;
      collector.sanitizedHostname = TEST_HOSTNAME;
      collector.initialize();
      setTestConfig(collector);
      setTestConfig(collector);

      await collector.ensureTable();

      expect(getStaticContentStub).to.have.been.calledWith(
        {
          database: TEST_DATABASE,
          tableName: TEST_TABLE,
          location: `s3://${TEST_STANDARD_BUCKET}/${TEST_IMS_ORG}/${S3_PATH_AGGREGATED_404}`,
        },
        './src/content-fragment-404/sql/create-table.sql',
      );
      expect(athenaClientStub.execute).to.have.been.calledWith(
        TEST_SQL_RESULT,
        TEST_DATABASE,
      );
    });

    it('should handle SQL loading errors', async () => {
      getStaticContentStub.rejects(new Error('Table SQL not found'));
      const collector = new AthenaCollector(context);
      collector.imsOrg = TEST_IMS_ORG;
      collector.sanitizedHostname = TEST_HOSTNAME;
      collector.initialize();
      setTestConfig(collector);
      setTestConfig(collector);

      await expect(collector.ensureTable())
        .to.be.rejectedWith('Table SQL not found');
    });

    it('should handle athena execution errors', async () => {
      athenaClientStub.execute.rejects(new Error('Table creation failed'));
      const collector = new AthenaCollector(context);
      collector.imsOrg = TEST_IMS_ORG;
      collector.sanitizedHostname = TEST_HOSTNAME;
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
        { url: TEST_PATH_1, request_user_agent: TEST_USER_AGENT_1, request_count: String(REQUEST_COUNT_SMALL) },
        { url: TEST_ASSET_PATH, request_user_agent: TEST_USER_AGENT_1, request_count: String(REQUEST_COUNT_TINY) }, // Asset should be filtered
        { url: null }, // Should be filtered
        { url: TEST_PATH_2, request_user_agent: TEST_USER_AGENT_2, request_count: String(REQUEST_COUNT_HIGH) },
      ]);

      const collector = new AthenaCollector(context);
      collector.imsOrg = TEST_IMS_ORG;
      collector.sanitizedHostname = TEST_HOSTNAME;
      collector.initialize();
      setTestConfig(collector);
      const result = await collector.queryContentFragment404s(TEST_YEAR, TEST_MONTH, TEST_DAY);

      expect(getStaticContentStub).to.have.been.calledWith(
        {
          database: TEST_DATABASE,
          tableName: TEST_TABLE,
          year: TEST_YEAR,
          month: TEST_MONTH,
          day: TEST_DAY,
        },
        './src/content-fragment-404/sql/daily-query.sql',
      );

      expect(athenaClientStub.query).to.have.been.calledOnce;
      expect(athenaClientStub.query.getCall(0).args[0]).to.equal(TEST_SQL_RESULT);
      expect(athenaClientStub.query.getCall(0).args[1]).to.equal(TEST_DATABASE);

      expect(result).to.deep.equal([
        {
          url: TEST_PATH_1,
          requestUserAgents: [{ userAgent: TEST_USER_AGENT_1, count: REQUEST_COUNT_SMALL }],
          requestCount: REQUEST_COUNT_SMALL,
        },
        {
          url: TEST_PATH_2,
          requestUserAgents: [{ userAgent: TEST_USER_AGENT_2, count: REQUEST_COUNT_HIGH }],
          requestCount: REQUEST_COUNT_HIGH,
        },
      ]);
    });

    it('should filter out asset URLs (images, documents, media)', async () => {
      athenaClientStub.query.resolves([
        { url: TEST_PATH_FRAGMENT, request_user_agent: TEST_USER_AGENT_1, request_count: String(REQUEST_COUNT_LOW_1) },
        { url: TEST_PATH_IMAGE_JPG, request_user_agent: TEST_USER_AGENT_1, request_count: String(REQUEST_COUNT_MID_2) },
        { url: TEST_PATH_DOCUMENT_PDF, request_user_agent: TEST_USER_AGENT_1, request_count: String(REQUEST_COUNT_LOW_4) },
        { url: TEST_PATH_VIDEO_MP4, request_user_agent: TEST_USER_AGENT_1, request_count: String(REQUEST_COUNT_MID_1) },
        { url: TEST_PATH_FONT_WOFF, request_user_agent: TEST_USER_AGENT_1, request_count: String(REQUEST_COUNT_LOW_5) },
        { url: TEST_PATH_ARCHIVE_ZIP, request_user_agent: TEST_USER_AGENT_1, request_count: String(REQUEST_COUNT_TINY) },
        { url: TEST_PATH_ANOTHER_FRAGMENT, request_user_agent: TEST_USER_AGENT_2, request_count: String(REQUEST_COUNT_LOW_3) },
      ]);

      const collector = new AthenaCollector(context);
      collector.imsOrg = TEST_IMS_ORG;
      collector.sanitizedHostname = TEST_HOSTNAME;
      collector.initialize();
      setTestConfig(collector);
      const result = await collector.queryContentFragment404s(TEST_YEAR, TEST_MONTH, TEST_DAY);

      expect(result).to.deep.equal([
        {
          url: TEST_PATH_FRAGMENT,
          requestUserAgents: [{ userAgent: TEST_USER_AGENT_1, count: REQUEST_COUNT_LOW_1 }],
          requestCount: REQUEST_COUNT_LOW_1,
        },
        {
          url: TEST_PATH_ANOTHER_FRAGMENT,
          requestUserAgents: [{ userAgent: TEST_USER_AGENT_2, count: REQUEST_COUNT_LOW_3 }],
          requestCount: REQUEST_COUNT_LOW_3,
        },
      ]);
    });

    it('should filter out null URLs from results', async () => {
      athenaClientStub.query.resolves([
        { url: TEST_PATH_VALID_FRAGMENT, request_user_agent: TEST_USER_AGENT_1, request_count: String(REQUEST_COUNT_LOW_2) },
        { url: null },
        { url: '' },
        { url: TEST_PATH_ANOTHER_FRAGMENT_2, request_user_agent: TEST_USER_AGENT_2, request_count: String(REQUEST_COUNT_MID_1) },
      ]);

      const collector = new AthenaCollector(context);
      collector.imsOrg = TEST_IMS_ORG;
      collector.sanitizedHostname = TEST_HOSTNAME;
      collector.initialize();
      setTestConfig(collector);
      const result = await collector.queryContentFragment404s(TEST_YEAR, TEST_MONTH, TEST_DAY);

      expect(result).to.deep.equal([
        {
          url: TEST_PATH_VALID_FRAGMENT,
          requestUserAgents: [{ userAgent: TEST_USER_AGENT_1, count: REQUEST_COUNT_LOW_2 }],
          requestCount: REQUEST_COUNT_LOW_2,
        },
        {
          url: TEST_PATH_ANOTHER_FRAGMENT_2,
          requestUserAgents: [{ userAgent: TEST_USER_AGENT_2, count: REQUEST_COUNT_MID_1 }],
          requestCount: REQUEST_COUNT_MID_1,
        },
      ]);
    });

    it('should group multiple user agents for the same URL', async () => {
      athenaClientStub.query.resolves([
        { url: TEST_PATH_FRAGMENT, request_user_agent: TEST_USER_AGENT_1, request_count: String(REQUEST_COUNT_MID_3) },
        { url: TEST_PATH_FRAGMENT, request_user_agent: TEST_USER_AGENT_2, request_count: String(REQUEST_COUNT_SMALL) },
        { url: TEST_PATH_FRAGMENT, request_user_agent: TEST_USER_AGENT_3, request_count: String(REQUEST_COUNT_TINY) },
        { url: TEST_PATH_ANOTHER, request_user_agent: TEST_USER_AGENT_1, request_count: String(REQUEST_COUNT_MEDIUM) },
      ]);

      const collector = new AthenaCollector(context);
      collector.imsOrg = TEST_IMS_ORG;
      collector.sanitizedHostname = TEST_HOSTNAME;
      collector.initialize();
      setTestConfig(collector);
      const result = await collector.queryContentFragment404s(TEST_YEAR, TEST_MONTH, TEST_DAY);

      expect(result).to.deep.equal([
        {
          url: TEST_PATH_FRAGMENT,
          requestUserAgents: [
            { userAgent: TEST_USER_AGENT_1, count: REQUEST_COUNT_MID_3 },
            { userAgent: TEST_USER_AGENT_2, count: REQUEST_COUNT_SMALL },
            { userAgent: TEST_USER_AGENT_3, count: REQUEST_COUNT_TINY },
          ],
          requestCount: REQUEST_COUNT_HIGH_2,
        },
        {
          url: TEST_PATH_ANOTHER,
          requestUserAgents: [{ userAgent: TEST_USER_AGENT_1, count: REQUEST_COUNT_MEDIUM }],
          requestCount: REQUEST_COUNT_MEDIUM,
        },
      ]);
    });

    it('should aggregate counts for duplicate user agents on the same URL', async () => {
      athenaClientStub.query.resolves([
        { url: TEST_PATH_FRAGMENT, request_user_agent: TEST_USER_AGENT_1, request_count: String(REQUEST_COUNT_MID_2) },
        { url: TEST_PATH_FRAGMENT, request_user_agent: TEST_USER_AGENT_1, request_count: String(REQUEST_COUNT_MEDIUM) },
        { url: TEST_PATH_FRAGMENT, request_user_agent: TEST_USER_AGENT_2, request_count: String(REQUEST_COUNT_TINY) },
      ]);

      const collector = new AthenaCollector(context);
      collector.imsOrg = TEST_IMS_ORG;
      collector.sanitizedHostname = TEST_HOSTNAME;
      collector.initialize();
      setTestConfig(collector);
      const result = await collector.queryContentFragment404s(TEST_YEAR, TEST_MONTH, TEST_DAY);

      expect(result).to.deep.equal([
        {
          url: TEST_PATH_FRAGMENT,
          requestUserAgents: [
            { userAgent: TEST_USER_AGENT_1, count: REQUEST_COUNT_HIGH }, // REQUEST_COUNT_MID_2 + REQUEST_COUNT_MEDIUM aggregated
            { userAgent: TEST_USER_AGENT_2, count: REQUEST_COUNT_TINY },
          ],
          requestCount: REQUEST_COUNT_HIGH_1, // Total: REQUEST_COUNT_HIGH + REQUEST_COUNT_TINY
        },
      ]);
    });

    it('should clean GraphQL suffixes from URLs', async () => {
      const TEST_PATH_FRAGMENT_CFM_JSON = '/content/dam/fragment.cfm.json';
      const TEST_PATH_FRAGMENT_CFM_MODEL_JSON = '/content/dam/fragment.cfm.model.json';
      const TEST_PATH_ANOTHER_CFM_GQL_JSON = '/content/dam/another.cfm.gql.json';

      athenaClientStub.query.resolves([
        { url: TEST_PATH_FRAGMENT_CFM_JSON, request_user_agent: TEST_USER_AGENT_1, request_count: String(REQUEST_COUNT_SMALL) },
        { url: TEST_PATH_FRAGMENT_CFM_MODEL_JSON, request_user_agent: TEST_USER_AGENT_2, request_count: String(REQUEST_COUNT_TINY) },
        { url: TEST_PATH_ANOTHER_CFM_GQL_JSON, request_user_agent: TEST_USER_AGENT_3, request_count: String(REQUEST_COUNT_LOW_4) },
      ]);

      const collector = new AthenaCollector(context);
      collector.imsOrg = TEST_IMS_ORG;
      collector.sanitizedHostname = TEST_HOSTNAME;
      collector.initialize();
      setTestConfig(collector);
      const result = await collector.queryContentFragment404s(TEST_YEAR, TEST_MONTH, TEST_DAY);

      expect(result).to.deep.equal([
        {
          url: TEST_PATH_FRAGMENT,
          requestUserAgents: [
            { userAgent: TEST_USER_AGENT_1, count: REQUEST_COUNT_SMALL },
            { userAgent: TEST_USER_AGENT_2, count: REQUEST_COUNT_TINY },
          ],
          requestCount: REQUEST_COUNT_MID_3,
        },
        {
          url: TEST_PATH_ANOTHER,
          requestUserAgents: [{ userAgent: TEST_USER_AGENT_3, count: REQUEST_COUNT_LOW_4 }],
          requestCount: REQUEST_COUNT_LOW_4,
        },
      ]);
    });

    it('should handle empty query results', async () => {
      athenaClientStub.query.resolves([]);

      const collector = new AthenaCollector(context);
      collector.imsOrg = TEST_IMS_ORG;
      collector.sanitizedHostname = TEST_HOSTNAME;
      collector.initialize();
      setTestConfig(collector);
      const result = await collector.queryContentFragment404s(TEST_YEAR, TEST_MONTH, TEST_DAY);

      expect(result).to.deep.equal([]);
    });

    it('should handle SQL loading errors', async () => {
      getStaticContentStub.rejects(new Error('Query SQL not found'));
      const collector = new AthenaCollector(context);
      collector.imsOrg = TEST_IMS_ORG;
      collector.sanitizedHostname = TEST_HOSTNAME;
      collector.initialize();
      setTestConfig(collector);

      await expect(collector.queryContentFragment404s(TEST_YEAR, TEST_MONTH, TEST_DAY))
        .to.be.rejectedWith('Query SQL not found');
    });

    it('should handle athena query errors', async () => {
      athenaClientStub.query.rejects(new Error('Query execution failed'));
      const collector = new AthenaCollector(context);
      collector.imsOrg = TEST_IMS_ORG;
      collector.sanitizedHostname = TEST_HOSTNAME;
      collector.initialize();
      setTestConfig(collector);

      await expect(collector.queryContentFragment404s(TEST_YEAR, TEST_MONTH, TEST_DAY))
        .to.be.rejectedWith('Query execution failed');
    });

    it('should handle invalid request_count values and default to 0', async () => {
      athenaClientStub.query.resolves([
        { url: TEST_PATH_FRAGMENT1, request_user_agent: TEST_USER_AGENT_1, request_count: 'invalid' },
        { url: TEST_PATH_FRAGMENT2, request_user_agent: TEST_USER_AGENT_2, request_count: null },
        { url: TEST_PATH_FRAGMENT3, request_user_agent: TEST_USER_AGENT_3, request_count: undefined },
        { url: TEST_PATH_FRAGMENT4, request_user_agent: TEST_USER_AGENT_4, request_count: '' },
        { url: TEST_PATH_FRAGMENT5, request_user_agent: TEST_USER_AGENT_5, request_count: String(REQUEST_COUNT_SMALL) },
      ]);

      const collector = new AthenaCollector(context);
      collector.imsOrg = TEST_IMS_ORG;
      collector.sanitizedHostname = TEST_HOSTNAME;
      collector.initialize();
      setTestConfig(collector);
      const result = await collector.queryContentFragment404s(TEST_YEAR, TEST_MONTH, TEST_DAY);

      expect(result).to.deep.equal([
        {
          url: TEST_PATH_FRAGMENT1,
          requestUserAgents: [{ userAgent: TEST_USER_AGENT_1, count: REQUEST_COUNT_NONE }],
          requestCount: REQUEST_COUNT_NONE,
        },
        {
          url: TEST_PATH_FRAGMENT2,
          requestUserAgents: [{ userAgent: TEST_USER_AGENT_2, count: REQUEST_COUNT_NONE }],
          requestCount: REQUEST_COUNT_NONE,
        },
        {
          url: TEST_PATH_FRAGMENT3,
          requestUserAgents: [{ userAgent: TEST_USER_AGENT_3, count: REQUEST_COUNT_NONE }],
          requestCount: REQUEST_COUNT_NONE,
        },
        {
          url: TEST_PATH_FRAGMENT4,
          requestUserAgents: [{ userAgent: TEST_USER_AGENT_4, count: REQUEST_COUNT_NONE }],
          requestCount: REQUEST_COUNT_NONE,
        },
        {
          url: TEST_PATH_FRAGMENT5,
          requestUserAgents: [{ userAgent: TEST_USER_AGENT_5, count: REQUEST_COUNT_SMALL }],
          requestCount: REQUEST_COUNT_SMALL,
        },
      ]);
    });
  });

  describe('fetchContentFragment404s', () => {
    it('should fetch broken paths successfully and exclude assets', async () => {
      // Mock getPreviousDayParts to return specific date
      const originalGetPreviousDayParts = AthenaCollector.getPreviousDayParts;
      AthenaCollector.getPreviousDayParts = sandbox.stub().returns({
        year: TEST_YEAR,
        month: TEST_MONTH,
        day: TEST_DAY_PREVIOUS,
      });

      try {
        const collector = new AthenaCollector(context);
        collector.imsOrg = TEST_IMS_ORG;
      collector.sanitizedHostname = TEST_HOSTNAME;
        collector.initialize();
      setTestConfig(collector);
        const result = await collector.fetchContentFragment404s();

        expect(result).to.deep.equal([
          {
            url: TEST_PATH_1,
            requestUserAgents: [{ userAgent: TEST_USER_AGENT_1, count: REQUEST_COUNT_SMALL }],
            requestCount: REQUEST_COUNT_SMALL,
          },
          {
            url: TEST_PATH_2,
            requestUserAgents: [{ userAgent: TEST_USER_AGENT_2, count: REQUEST_COUNT_MEDIUM }],
            requestCount: REQUEST_COUNT_MEDIUM,
          },
        ]);
      } finally {
        AthenaCollector.getPreviousDayParts = originalGetPreviousDayParts;
      }
    });

    it('should handle database creation errors', async () => {
      athenaClientStub.execute.onFirstCall().rejects(new Error('Database creation failed'));

      const collector = new AthenaCollector(context);
      collector.imsOrg = TEST_IMS_ORG;
      collector.sanitizedHostname = TEST_HOSTNAME;
      collector.initialize();
      setTestConfig(collector);

      await expect(collector.fetchContentFragment404s())
        .to.be.rejectedWith('Athena query failed: Database creation failed');

      expect(context.log.error).to.have.been.calledWith('Athena query failed: Database creation failed');
    });

    it('should handle table creation errors', async () => {
      athenaClientStub.execute.onSecondCall().rejects(new Error('Table creation failed'));

      const collector = new AthenaCollector(context);
      collector.imsOrg = TEST_IMS_ORG;
      collector.sanitizedHostname = TEST_HOSTNAME;
      collector.initialize();
      setTestConfig(collector);

      await expect(collector.fetchContentFragment404s())
        .to.be.rejectedWith('Athena query failed: Table creation failed');

      expect(context.log.error).to.have.been.calledWith('Athena query failed: Table creation failed');
    });

    it('should handle query execution errors', async () => {
      athenaClientStub.query.rejects(new Error('Query failed'));

      const collector = new AthenaCollector(context);
      collector.imsOrg = TEST_IMS_ORG;
      collector.sanitizedHostname = TEST_HOSTNAME;
      collector.initialize();
      setTestConfig(collector);

      await expect(collector.fetchContentFragment404s())
        .to.be.rejectedWith('Athena query failed: Query failed');

      expect(context.log.error).to.have.been.calledWith('Athena query failed: Query failed');
    });

    it('should call ensureDatabase and ensureTable in correct order', async () => {
      const collector = new AthenaCollector(context);
      collector.imsOrg = TEST_IMS_ORG;
      collector.sanitizedHostname = TEST_HOSTNAME;
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
      collector.imsOrg = TEST_IMS_ORG;
      collector.sanitizedHostname = TEST_HOSTNAME;
      collector.initialize();
      setTestConfig(collector);
      const result = await collector.fetchContentFragment404s();

      expect(result).to.deep.equal([]);
    });
  });

});
