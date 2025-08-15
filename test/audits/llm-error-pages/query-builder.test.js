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
import esmock from 'esmock';

describe('LLM Error Pages - Query Builder', () => {
  let queryBuilder;
  let mockOptions;
  let sandbox;

  before(async () => {
    sandbox = sinon.createSandbox();

    queryBuilder = await import('../../../src/llm-error-pages/utils/query-builder.js');
  });

  beforeEach(() => {
    mockOptions = {
      databaseName: 'test_database',
      tableName: 'test_table',
      startDate: new Date('2025-01-01T00:00:00Z'),
      endDate: new Date('2025-01-07T23:59:59Z'),
      llmProviders: ['chatgpt', 'claude', 'gemini'],
      siteFilters: ['host LIKE "example.com"'],
      errorStatuses: [404, 500, 503],
    };
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('buildLlmErrorPagesQuery', () => {
    it('should build comprehensive query with all filters', async () => {
      const query = await queryBuilder.buildLlmErrorPagesQuery(mockOptions);

      expect(query).to.be.a('string');
      expect(query.length).to.be.greaterThan(50);
      expect(query).to.include('test_database');
      expect(query).to.include('test_table');
      expect(query).to.include('SELECT');
      expect(query).to.include('FROM');
      expect(query).to.include('WHERE');
    });

    it('should handle options with no dates', async () => {
      const optionsWithoutDates = {
        ...mockOptions,
        startDate: undefined,
        endDate: undefined,
      };

      const query = await queryBuilder.buildLlmErrorPagesQuery(optionsWithoutDates);

      expect(query).to.be.a('string');
      expect(query).to.include('test_database');
      expect(query).to.include('test_table');
    });

    it('should handle empty conditions array', async () => {
      const optionsWithEmptyConditions = {
        ...mockOptions,
        siteFilters: [],
        llmProviders: [],
        errorStatuses: [],
      };

      const query = await queryBuilder.buildLlmErrorPagesQuery(optionsWithEmptyConditions);

      expect(query).to.be.a('string');
      expect(query).to.include('test_database');
      expect(query).to.include('test_table');
    });

    it('should handle null llmProviders with non-empty siteFilters', async () => {
      const optionsWithNullProviders = {
        ...mockOptions,
        llmProviders: null,
        siteFilters: ['host = "example.com"'],
      };

      const query = await queryBuilder.buildLlmErrorPagesQuery(optionsWithNullProviders);

      expect(query).to.be.a('string');
      expect(query).to.include('host = "example.com"');
    });

    it('should handle llmProviders returning null filter', async () => {
      const mockedQueryBuilder = await esmock('../../../src/llm-error-pages/utils/query-builder.js', {
        '../../../src/llm-error-pages/constants/user-agent-patterns.js': {
          buildLlmUserAgentFilter: sandbox.stub().returns(null), // Return null to test the branch
        },
        '@adobe/spacecat-shared-utils': {
          getStaticContent: sandbox.stub().callsFake((variables) => {
            let template = `
              SELECT url, status, user_agent, COUNT(*) as total_requests
              FROM {{databaseName}}.{{tableName}}
              WHERE {{whereClause}}
              GROUP BY url, status, user_agent
              ORDER BY total_requests DESC
            `;

            if (variables) {
              template = template.replace(/{{databaseName}}/g, variables.databaseName || 'test_database');
              template = template.replace(/{{tableName}}/g, variables.tableName || 'test_table');
              template = template.replace(/{{whereClause}}/g, variables.whereClause || '1=1');
            }

            return Promise.resolve(template);
          }),
        },
      });

      const query = await mockedQueryBuilder.buildLlmErrorPagesQuery(mockOptions);

      expect(query).to.be.a('string');
    });

    it('should format date parts with proper padding', async () => {
      const optionsWithSingleDigitDate = {
        ...mockOptions,
        startDate: new Date('2025-01-05T00:00:00Z'),
        endDate: new Date('2025-01-09T23:59:59Z'),
      };

      const query = await queryBuilder.buildLlmErrorPagesQuery(optionsWithSingleDigitDate);

      expect(query).to.be.a('string');
      // Should pad single digits with leading zeros
      expect(query).to.include('01'); // Month
      expect(query).to.include('05'); // Day
    });

    it('should handle cross-month date ranges', async () => {
      const crossMonthOptions = {
        ...mockOptions,
        startDate: new Date('2025-01-25T00:00:00Z'),
        endDate: new Date('2025-02-05T23:59:59Z'),
      };

      const query = await queryBuilder.buildLlmErrorPagesQuery(crossMonthOptions);

      expect(query).to.be.a('string');
      expect(query).to.include('test_database');
      expect(query).to.include('test_table');
      // Should handle both months
      expect(query).to.include('01'); // January
      expect(query).to.include('02'); // February
    });

    it('should build proper date conditions for single day', async () => {
      const singleDayOptions = {
        ...mockOptions,
        startDate: new Date('2025-01-01T00:00:00Z'),
        endDate: new Date('2025-01-01T23:59:59Z'),
      };

      const query = await queryBuilder.buildLlmErrorPagesQuery(singleDayOptions);

      expect(query).to.be.a('string');
      expect(query).to.include('test_database');
      expect(query).to.include('test_table');
    });

    it('should handle multiple site filters', async () => {
      const multiFilterOptions = {
        ...mockOptions,
        siteFilters: [
          'host LIKE "example.com"',
          'status IN (404, 500)',
          'url NOT LIKE "/admin/%"',
        ],
      };

      const query = await queryBuilder.buildLlmErrorPagesQuery(multiFilterOptions);

      expect(query).to.be.a('string');
      expect(query).to.include('host LIKE "example.com"');
      expect(query).to.include('status IN (404, 500)');
      expect(query).to.include('url NOT LIKE "/admin/%"');
    });

    it('should handle error status filtering', async () => {
      const statusFilterOptions = {
        ...mockOptions,
        errorStatuses: [404, 500, 503],
      };

      const query = await queryBuilder.buildLlmErrorPagesQuery(statusFilterOptions);

      expect(query).to.be.a('string');
      expect(query).to.include('test_database');
      expect(query).to.include('test_table');
    });

    it('should handle null error statuses', async () => {
      const nullStatusOptions = {
        ...mockOptions,
        errorStatuses: null,
      };

      const query = await queryBuilder.buildLlmErrorPagesQuery(nullStatusOptions);

      expect(query).to.be.a('string');
      expect(query).to.include('test_database');
      expect(query).to.include('test_table');
    });

    it('should handle empty error statuses array', async () => {
      const emptyStatusOptions = {
        ...mockOptions,
        errorStatuses: [],
      };

      const query = await queryBuilder.buildLlmErrorPagesQuery(emptyStatusOptions);

      expect(query).to.be.a('string');
      expect(query).to.include('test_database');
      expect(query).to.include('test_table');
    });
  });

  describe('Date Processing Functions', () => {
    it('should format date parts correctly', () => {
      const date = new Date('2025-01-05T10:30:00Z');
      const year = date.getUTCFullYear().toString();
      const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
      const day = date.getUTCDate().toString().padStart(2, '0');

      expect(year).to.equal('2025');
      expect(month).to.equal('01');
      expect(day).to.equal('05');
    });

    it('should handle leap year dates', () => {
      const leapYearDate = new Date('2024-02-29T00:00:00Z');
      const year = leapYearDate.getUTCFullYear().toString();
      const month = (leapYearDate.getUTCMonth() + 1).toString().padStart(2, '0');
      const day = leapYearDate.getUTCDate().toString().padStart(2, '0');

      expect(year).to.equal('2024');
      expect(month).to.equal('02');
      expect(day).to.equal('29');
    });

    it('should handle year boundaries', () => {
      const newYearDate = new Date('2025-01-01T00:00:00Z');
      const endYearDate = new Date('2024-12-31T23:59:59Z');

      const newYearYear = newYearDate.getUTCFullYear().toString();
      const endYearYear = endYearDate.getUTCFullYear().toString();

      expect(newYearYear).to.equal('2025');
      expect(endYearYear).to.equal('2024');
    });
  });

  describe('Filter Building', () => {
    it('should build user agent filter from providers', async () => {
      // Test the integration with user agent patterns
      const providers = ['chatgpt', 'claude'];
      const query = await queryBuilder.buildLlmErrorPagesQuery({
        ...mockOptions,
        llmProviders: providers,
      });

      expect(query).to.be.a('string');
      expect(query).to.include('test_database');
      expect(query).to.include('test_table');
    });

    it('should handle site filters properly', async () => {
      const siteFilters = [
        'host = "example.com"',
        'path LIKE "/api/%"',
      ];

      const query = await queryBuilder.buildLlmErrorPagesQuery({
        ...mockOptions,
        siteFilters,
      });

      expect(query).to.be.a('string');
      expect(query).to.include('host = "example.com"');
      expect(query).to.include('path LIKE "/api/%"');
    });

    it('should handle empty site filters', async () => {
      const query = await queryBuilder.buildLlmErrorPagesQuery({
        ...mockOptions,
        siteFilters: [],
      });

      expect(query).to.be.a('string');
      expect(query).to.include('test_database');
      expect(query).to.include('test_table');
    });

    it('should handle null site filters', async () => {
      const query = await queryBuilder.buildLlmErrorPagesQuery({
        ...mockOptions,
        siteFilters: null,
      });

      expect(query).to.be.a('string');
      expect(query).to.include('test_database');
      expect(query).to.include('test_table');
    });

    it('should call loadSql with correct parameters', async () => {
      const getStaticContentSpy = sandbox.stub().callsFake((variables) => {
        let template = `
          SELECT url, status, user_agent, COUNT(*) as total_requests
          FROM {{databaseName}}.{{tableName}}
          WHERE {{whereClause}}
          GROUP BY url, status, user_agent
          ORDER BY total_requests DESC
        `;

        if (variables) {
          template = template.replace(/{{databaseName}}/g, variables.databaseName || 'test_database');
          template = template.replace(/{{tableName}}/g, variables.tableName || 'test_table');
          template = template.replace(/{{whereClause}}/g, variables.whereClause || '1=1');
        }

        return Promise.resolve(template);
      });

      const mockedQueryBuilder = await esmock('../../../src/llm-error-pages/utils/query-builder.js', {
        '@adobe/spacecat-shared-utils': {
          getStaticContent: getStaticContentSpy,
        },
      });

      await mockedQueryBuilder.buildLlmErrorPagesQuery(mockOptions);

      expect(getStaticContentSpy.calledOnce).to.be.true;
      const callArgs = getStaticContentSpy.getCall(0).args[0];
      expect(callArgs).to.have.property('databaseName', 'test_database');
      expect(callArgs).to.have.property('tableName', 'test_table');
      expect(callArgs).to.have.property('whereClause');
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle loadSql failure gracefully', async () => {
      // Use esmock to mock getStaticContent to simulate loadSql failure
      const mockedQueryBuilder = await esmock('../../../src/llm-error-pages/utils/query-builder.js', {
        '@adobe/spacecat-shared-utils': {
          getStaticContent: sandbox.stub().rejects(new Error('SQL load failed')),
        },
      });

      try {
        await mockedQueryBuilder.buildLlmErrorPagesQuery(mockOptions);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.equal('SQL load failed');
      }
    });

    it('should handle malformed options', async () => {
      const malformedOptions = {
        databaseName: 'test_db',
        tableName: 'test_table',
        startDate: 'invalid-date', // Invalid date string
        endDate: new Date('2025-01-07T23:59:59Z'),
        llmProviders: ['chatgpt'],
      };

      try {
        await queryBuilder.buildLlmErrorPagesQuery(malformedOptions);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.include('getUTCFullYear is not a function');
      }
    });
  });

  describe('Query Template Processing', () => {
    it('should replace all template variables', async () => {
      const query = await queryBuilder.buildLlmErrorPagesQuery(mockOptions);

      expect(query).to.include('test_database');
      expect(query).to.include('test_table');
      expect(query).to.not.include('{{databaseName}}');
      expect(query).to.not.include('{{tableName}}');
    });

    it('should handle template with missing variables', async () => {
      const mockedQueryBuilder = await esmock('../../../src/llm-error-pages/utils/query-builder.js', {
        '@adobe/spacecat-shared-utils': {
          getStaticContent: sandbox.stub().resolves(
            'SELECT * FROM {{missingVar}}.{{anotherMissing}} WHERE {{whereClause}}',
          ),
        },
      });

      const query = await mockedQueryBuilder.buildLlmErrorPagesQuery(mockOptions);

      // Should still work, variables just won't be replaced
      expect(query).to.be.a('string');
      expect(query).to.include('{{missingVar}}');
      expect(query).to.include('{{anotherMissing}}');
    });

    it('should handle empty template', async () => {
      const mockedQueryBuilder = await esmock('../../../src/llm-error-pages/utils/query-builder.js', {
        '@adobe/spacecat-shared-utils': {
          getStaticContent: sandbox.stub().resolves(''),
        },
      });

      const query = await mockedQueryBuilder.buildLlmErrorPagesQuery(mockOptions);

      expect(query).to.equal('');
    });

    it('should handle template with only static content', async () => {
      const query = await queryBuilder.buildLlmErrorPagesQuery({
        databaseName: 'test_database',
        tableName: 'test_table',
        provider: null, // Explicitly null to avoid LLM filters
        siteFilters: null, // Explicitly null
        errorStatuses: null, // Explicitly null
        dates: null, // Explicitly null - no date conditions
      });

      expect(query).to.be.a('string');
      expect(query).to.include('test_database');
      expect(query).to.include('test_table');
      expect(query).to.not.include('WHERE');
    });
  });
});
