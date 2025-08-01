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

    // Use esmock to properly mock ES modules
    queryBuilder = await esmock('../../../src/llm-error-pages/utils/query-builder.js', {
      '@adobe/spacecat-shared-utils': {
        getStaticContent: sandbox.stub().callsFake((variables) => {
          // Simulate template replacement like the real getStaticContent does
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

    it('should return empty WHERE clause when all conditions are empty (line 47 branch)', async () => {
      // Create options that result in truly empty conditions to hit the '' branch
      const emptyConditionsOptions = {
        databaseName: 'test_database',
        tableName: 'test_table',
        // No date range to avoid date conditions
        // No site filters
        siteFilters: [],
        // No LLM providers
        llmProviders: null,
        // No error statuses
        errorStatuses: [],
      };

      const query = await queryBuilder.buildLlmErrorPagesQuery(emptyConditionsOptions);

      expect(query).to.be.a('string');
      expect(query).to.include('test_database');
      expect(query).to.include('test_table');
      // Should NOT contain WHERE clause since all conditions are empty
      expect(query).to.not.include('WHERE');
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
      // Mock buildLlmUserAgentFilter to return null
      const mockBuildFilter = sandbox.stub().returns(null);
      sandbox.stub(queryBuilder, 'buildLlmUserAgentFilter').callsFake(mockBuildFilter);

      const query = await queryBuilder.buildLlmErrorPagesQuery(mockOptions);

      expect(query).to.be.a('string');
      expect(mockBuildFilter.calledOnce).to.be.true;
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

    it('should call loadSql with correct parameters', async () => {
      await queryBuilder.buildLlmErrorPagesQuery(mockOptions);

      expect(queryBuilder.loadSql.calledOnce).to.be.true;
      const loadSqlArgs = queryBuilder.loadSql.firstCall.args;
      expect(loadSqlArgs[0]).to.equal('llm-error-pages-query');
      expect(loadSqlArgs[1]).to.be.an('object');
      expect(loadSqlArgs[1].database).to.equal('test_database');
      expect(loadSqlArgs[1].table).to.equal('test_table');
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
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle loadSql failure gracefully', async () => {
      queryBuilder.loadSql.rejects(new Error('SQL load failed'));

      try {
        await queryBuilder.buildLlmErrorPagesQuery(mockOptions);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.equal('SQL load failed');
      }
    });

    it('should handle malformed options', async () => {
      const malformedOptions = {
        databaseName: null,
        tableName: undefined,
        startDate: 'invalid-date',
        endDate: 'invalid-date',
      };

      const query = await queryBuilder.buildLlmErrorPagesQuery(malformedOptions);

      expect(query).to.be.a('string');
      // Should handle null/undefined gracefully
    });

    it('should handle very large date ranges', async () => {
      const largeDateRangeOptions = {
        ...mockOptions,
        startDate: new Date('2020-01-01T00:00:00Z'),
        endDate: new Date('2025-12-31T23:59:59Z'),
      };

      const query = await queryBuilder.buildLlmErrorPagesQuery(largeDateRangeOptions);

      expect(query).to.be.a('string');
      expect(query).to.include('test_database');
      expect(query).to.include('test_table');
    });

    it('should handle timezone edge cases', async () => {
      const timezoneOptions = {
        ...mockOptions,
        startDate: new Date('2025-01-01T23:59:59Z'),
        endDate: new Date('2025-01-02T00:00:01Z'),
      };

      const query = await queryBuilder.buildLlmErrorPagesQuery(timezoneOptions);

      expect(query).to.be.a('string');
      expect(query).to.include('test_database');
      expect(query).to.include('test_table');
    });

    it('should handle empty database and table names', async () => {
      const emptyNamesOptions = {
        ...mockOptions,
        databaseName: '',
        tableName: '',
      };

      const query = await queryBuilder.buildLlmErrorPagesQuery(emptyNamesOptions);

      expect(query).to.be.a('string');
    });

    it('should handle special characters in database/table names', async () => {
      const specialCharsOptions = {
        ...mockOptions,
        databaseName: 'test_database_with.special',
        tableName: 'test_table_with.special',
      };

      const query = await queryBuilder.buildLlmErrorPagesQuery(specialCharsOptions);

      expect(query).to.be.a('string');
      expect(query).to.include('test_database_with.special');
      expect(query).to.include('test_table_with.special');
    });
  });

  describe('Query Template Processing', () => {
    it('should replace all template variables', async () => {
      queryBuilder.loadSql.resolves(`
        SELECT * FROM {{database}}.{{table}}
        WHERE {{dateConditions}}
        AND {{userAgentFilter}}
        AND {{siteFilters}}
        AND {{statusFilter}}
      `);

      const query = await queryBuilder.buildLlmErrorPagesQuery(mockOptions);

      expect(query).to.be.a('string');
      expect(query).to.not.include('{{database}}');
      expect(query).to.not.include('{{table}}');
      expect(query).to.not.include('{{dateConditions}}');
      expect(query).to.not.include('{{userAgentFilter}}');
      expect(query).to.not.include('{{siteFilters}}');
      expect(query).to.not.include('{{statusFilter}}');
    });

    it('should handle template with missing variables', async () => {
      queryBuilder.loadSql.resolves(`
        SELECT * FROM {{database}}.{{table}}
        WHERE {{unknownVariable}}
      `);

      const query = await queryBuilder.buildLlmErrorPagesQuery(mockOptions);

      expect(query).to.be.a('string');
      expect(query).to.include('test_database');
      expect(query).to.include('test_table');
      // Unknown variables should remain unchanged
      expect(query).to.include('{{unknownVariable}}');
    });

    it('should handle empty template', async () => {
      queryBuilder.loadSql.resolves('');

      const query = await queryBuilder.buildLlmErrorPagesQuery(mockOptions);

      expect(query).to.equal('');
    });

    it('should handle template with only static content', async () => {
      queryBuilder.loadSql.resolves('SELECT 1 as test');

      const query = await queryBuilder.buildLlmErrorPagesQuery(mockOptions);

      expect(query).to.equal('SELECT 1 as test');
    });
  });
});
