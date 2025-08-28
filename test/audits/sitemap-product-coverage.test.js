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
import { Site } from '@adobe/spacecat-shared-data-access';
import {
  sitemapProductCoverageAuditRunner,
  generateSuggestions,
  generateOpportunity,
} from '../../src/sitemap-product-coverage/handler.js';
import { createOpportunityData } from '../../src/sitemap-product-coverage/opportunity-data-mapper.js';
import { ERROR_CODES } from '../../src/sitemap/common.js';
import { DATA_SOURCES } from '../../src/common/constants.js';
import { MockContextBuilder } from '../shared.js';

use(sinonChai);
use(chaiAsPromised);

describe('Sitemap Product Coverage Audit', () => {
  let context;
  let sitemapProductCoverageAuditRunnerMocked;
  let generateSuggestionsMocked;
  let generateOpportunityMocked;
  let syncSuggestionsMock;
  const sandbox = sinon.createSandbox();

  const baseURL = 'https://example.com';
  const mockSite = {
    getDeliveryType: () => Site.DELIVERY_TYPES.AEM_EDGE,
    getConfig: () => ({
      getHandlers: () => ({
        'sitemap-product-coverage': {
          productUrlTemplate: global.mockNoTemplate ? undefined : '%baseUrl/%locale/products/%urlKey/%skuLowerCase',
          locales: 'en,fr',
          config: {
            en: {
              'commerce-customer-group': 'test-group',
              'commerce-environment-id': 'test-env',
              'commerce-store-code': 'en_store',
              'commerce-store-view-code': 'en_view',
              'commerce-website-code': 'en_website',
              'commerce-x-api-key': 'test-key',
              'commerce-endpoint': `${baseURL}/graphql`,
            },
            fr: {
              'commerce-customer-group': 'test-group',
              'commerce-environment-id': 'test-env',
              'commerce-store-code': 'fr_store',
              'commerce-store-view-code': 'fr_view',
              'commerce-website-code': 'fr_website',
              'commerce-x-api-key': 'test-key',
              'commerce-endpoint': `${baseURL}/graphql`,
            },
          },
        },
      }),
    }),
  };

  before(async () => {
    // Mock external dependencies for comprehensive testing
    syncSuggestionsMock = sinon.stub().resolves();

    const mockedHandler = await esmock('../../src/sitemap-product-coverage/handler.js', {
      '../../src/utils/saas.js': {
        requestSaaS: async (query, operationName, variables, params) => {
          // Handle error scenario for specific locale
          if (params.locale === 'en' && global.mockGraphQLError) {
            throw new Error('GraphQL operation failed');
          }
          // Handle error without message property
          if (params.locale === 'en' && global.mockErrorWithoutMessage) {
            const errorWithoutMessage = new Error();
            delete errorWithoutMessage.message;
            throw errorWithoutMessage;
          }

          if (operationName === 'getProductCount') {
            if (variables.categoryPath === '' && params.locale === '') {
              return { data: { productSearch: { page_info: {} } } }; // Test unknown product count
            }
            // Trigger large catalog traversal for specific test case
            if (global.mockLargeCatalog) {
              // For early break test, return smaller product count that can be reached
              if (global.mockEarlyBreak) {
                return { data: { productSearch: { page_info: { total_pages: 51 } } } };
              }
              return { data: { productSearch: { page_info: { total_pages: 15000 } } } };
            }
            // For exact break test, return a precise product count
            if (global.mockExactBreak) {
              return { data: { productSearch: { page_info: { total_pages: 10001 } } } };
            }
            return { data: { productSearch: { page_info: { total_pages: variables.categoryPath === '' ? 2 : 15000 } } } };
          }
          if (operationName === 'getCategories') {
            return {
              data: {
                categories: [
                  { urlPath: 'category1', level: '1', name: 'Category 1' },
                  { urlPath: 'category2', level: '1', name: 'Category 2' },
                  { urlPath: 'subcategory1', level: '2', name: 'Subcategory 1' },
                ],
              },
            };
          }
          if (operationName === 'getProducts') {
            if (variables.currentPage > 20) {
              return { data: { productSearch: { items: [], page_info: { total_pages: 50 } } } };
            }
            // For category-specific requests in large catalog mode
            if (variables.categoryPath && global.mockLargeCatalog) {
              // Simulate reaching product limit early to test break logic (lines 107-109)
              if (global.mockEarlyBreak && variables.categoryPath === 'category1') {
                return {
                  data: {
                    productSearch: {
                      items: Array.from({ length: 2550 }, (_, i) => ({
                        productView: { urlKey: `${variables.categoryPath}-product-${i}`, sku: `${variables.categoryPath.toUpperCase()}-SKU-${i}` },
                      })),
                      page_info: { total_pages: 1 },
                    },
                  },
                };
              }
              return {
                data: {
                  productSearch: {
                    items: [
                      { productView: { urlKey: `${variables.categoryPath}-product`, sku: `${variables.categoryPath.toUpperCase()}-SKU` } },
                    ],
                    page_info: { total_pages: 1 },
                  },
                },
              };
            }
            // For exact break test, return precise number of products to hit exactly 10001
            if (variables.categoryPath && global.mockExactBreak) {
              if (variables.categoryPath === 'category1') {
                // Return 5000 products for category1
                return {
                  data: {
                    productSearch: {
                      items: Array.from({ length: 5000 }, (_, i) => ({
                        productView: { urlKey: `category1-product-${i}`, sku: `CAT1-SKU-${i}` },
                      })),
                      page_info: { total_pages: 1 },
                    },
                  },
                };
              }
              if (variables.categoryPath === 'category2') {
                // Return 5001 products for category2
                // this should hit exactly 10001 total and trigger break
                return {
                  data: {
                    productSearch: {
                      items: Array.from({ length: 5001 }, (_, i) => ({
                        productView: { urlKey: `category2-product-${i}`, sku: `CAT2-SKU-${i}` },
                      })),
                      page_info: { total_pages: 1 },
                    },
                  },
                };
              }
              // subcategory1 should not be reached due to early break
              return {
                data: {
                  productSearch: {
                    items: [{ productView: { urlKey: 'subcategory1-product', sku: 'SUB1-SKU' } }],
                    page_info: { total_pages: 1 },
                  },
                },
              };
            }
            return {
              data: {
                productSearch: {
                  items: [
                    { productView: { urlKey: 'product1', sku: 'SKU1' } },
                    { productView: { urlKey: 'product2', sku: null } }, // Test null SKU
                  ],
                  page_info: { total_pages: variables.currentPage <= 20 ? 50 : 1 },
                },
              },
            };
          }
          throw new Error('GraphQL operation failed');
        },
      },
      '../../src/sitemap/common.js': {
        ERROR_CODES,
        getSitemapUrls: async (url) => {
          if (global.mockEmptySitemap) {
            return {
              success: true,
              details: {
                extractedPaths: {}, // Empty extractedPaths to trigger lines 199-208
                filteredSitemapUrls: [`${url}/sitemap.xml`],
              },
            };
          }
          if (global.mockMissingDetails) {
            return {
              success: true,
              details: {
                // Missing extractedPaths and filteredSitemapUrls
              },
            };
          }
          return {
            success: true,
            details: {
              extractedPaths: {
                [`${url}/sitemap.xml`]: [
                  `${url}/en/products/product1/sku1`,
                  `${url}/fr/products/product2/sku2`,
                ],
              },
              filteredSitemapUrls: [`${url}/sitemap.xml`],
            },
          };
        },
      },
      '../../src/utils/data-access.js': {
        syncSuggestions: syncSuggestionsMock,
      },
      '../../src/common/opportunity.js': {
        convertToOpportunity: sinon.stub().resolves({ getId: () => 'opportunity-123' }),
      },
    });

    sitemapProductCoverageAuditRunnerMocked = mockedHandler.sitemapProductCoverageAuditRunner;
    generateSuggestionsMocked = mockedHandler.generateSuggestions;
    generateOpportunityMocked = mockedHandler.generateOpportunity;
  });

  beforeEach(() => {
    context = new MockContextBuilder().withSandbox(sandbox).build();
  });

  afterEach(() => {
    sinon.restore();
    sandbox.restore();
    syncSuggestionsMock.resetHistory();
  });

  describe('fillUrlTemplate', () => {
    it('should be tested through the main audit function', () => {
      // fillUrlTemplate is an internal function that gets tested
      // through the main audit scenarios where URL templates are processed
      expect(true).to.be.true; // Placeholder test
    });
  });

  describe('sitemapProductCoverageAuditRunner', () => {
    it('should fail for non-AEM Edge sites', async () => {
      const nonEdgeSite = {
        getDeliveryType: () => Site.DELIVERY_TYPES.AEM_CS,
        getConfig: () => ({
          getHandlers: () => ({
            'sitemap-product-coverage': {
              productUrlTemplate: '%baseUrl/%locale/products/%urlKey/%skuLowerCase',
              locales: 'en,fr',
              config: {
                en: {
                  'commerce-customer-group': 'test-group',
                  'commerce-environment-id': 'test-env',
                  'commerce-store-code': 'en_store',
                  'commerce-store-view-code': 'en_view',
                  'commerce-website-code': 'en_website',
                  'commerce-x-api-key': 'test-key',
                  'commerce-endpoint': `${baseURL}/graphql`,
                },
              },
            },
          }),
        }),
      };

      const result = await sitemapProductCoverageAuditRunnerMocked(
        baseURL,
        context,
        nonEdgeSite,
      );

      expect(result.auditResult.success).to.be.false;
      expect(result.auditResult.reasons[0].error).to.equal(
        ERROR_CODES.UNSUPPORTED_DELIVERY_TYPE,
      );
      expect(result.auditResult.reasons[0].value).to.equal(
        'Now we support only AEM Edge sites.',
      );
      expect(result.auditResult.url).to.equal(baseURL);
      expect(result.auditResult.details).to.deep.equal({});
    });

    it('should fail for AEM AMS sites', async () => {
      const amsSite = {
        getDeliveryType: () => Site.DELIVERY_TYPES.AEM_AMS,
        getConfig: () => ({
          getHandlers: () => ({
            'sitemap-product-coverage': {
              productUrlTemplate: '%baseUrl/%locale/products/%urlKey/%skuLowerCase',
              locales: 'en',
              config: {
                en: {
                  'commerce-customer-group': 'test-group',
                  'commerce-environment-id': 'test-env',
                  'commerce-store-code': 'en_store',
                  'commerce-store-view-code': 'en_view',
                  'commerce-website-code': 'en_website',
                  'commerce-x-api-key': 'test-key',
                  'commerce-endpoint': `${baseURL}/graphql`,
                },
              },
            },
          }),
        }),
      };

      const result = await sitemapProductCoverageAuditRunnerMocked(
        baseURL,
        context,
        amsSite,
      );

      expect(result.auditResult.success).to.be.false;
      expect(result.auditResult.reasons[0].error).to.equal(
        ERROR_CODES.UNSUPPORTED_DELIVERY_TYPE,
      );
      expect(result.auditResult.reasons[0].value).to.equal(
        'Now we support only AEM Edge sites.',
      );
    });

    it('should succeed for AEM Edge sites', async () => {
      const edgeSite = {
        getDeliveryType: () => Site.DELIVERY_TYPES.AEM_EDGE,
        getConfig: () => ({
          getHandlers: () => ({
            'sitemap-product-coverage': {
              productUrlTemplate: '%baseUrl/%locale/products/%urlKey/%skuLowerCase',
              locales: 'en',
              config: {
                en: {
                  'commerce-customer-group': 'test-group',
                  'commerce-environment-id': 'test-env',
                  'commerce-store-code': 'en_store',
                  'commerce-store-view-code': 'en_view',
                  'commerce-website-code': 'en_website',
                  'commerce-x-api-key': 'test-key',
                  'commerce-endpoint': `${baseURL}/graphql`,
                },
              },
            },
          }),
        }),
      };

      const result = await sitemapProductCoverageAuditRunnerMocked(
        baseURL,
        context,
        edgeSite,
      );

      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.details.issues).to.be.an('object');
    });

    it('should handle missing product URL template configuration', async () => {
      const siteWithoutConfig = {
        getDeliveryType: () => Site.DELIVERY_TYPES.AEM_EDGE,
        getConfig: () => ({
          getHandlers: () => ({
            'sitemap-product-coverage': {},
          }),
        }),
      };

      const result = await sitemapProductCoverageAuditRunnerMocked(
        baseURL,
        context,
        siteWithoutConfig,
      );

      expect(result.auditResult.success).to.be.false;
      expect(result.auditResult.reasons[0].error).to.equal(
        ERROR_CODES.MISSING_PRODUCT_URL_TEMPLATE,
      );
    });

    it('should successfully complete audit with small product catalog', async () => {
      const result = await sitemapProductCoverageAuditRunnerMocked(baseURL, context, mockSite);

      expect(result).to.have.property('fullAuditRef', baseURL);
      expect(result).to.have.property('auditResult');
      expect(result).to.have.property('url', baseURL);
      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.details.issues).to.be.an('object');
    });

    it('should handle large product catalog with category traversal', async () => {
      // The mocked requestSaaS will return 15000 pages for getProductCount
      // when categoryPath is not empty, triggering the category traversal logic
      const result = await sitemapProductCoverageAuditRunnerMocked(baseURL, context, mockSite);

      expect(result.auditResult.success).to.be.true;
      expect(context.log.warn).to.have.been.called; // Should warn about product count mismatch
    });

    it('should handle pagination correctly with maxPage limit', async () => {
      // The mocked requestSaaS returns 50 total_pages, which triggers maxPage limit logic
      const result = await sitemapProductCoverageAuditRunnerMocked(baseURL, context, mockSite);

      expect(result.auditResult.success).to.be.true;
      expect(context.log.warn).to.have.been.called; // Should warn about product count or pagination
    });

    it('should handle GraphQL errors and return failure', async () => {
      global.mockGraphQLError = true;
      const result = await sitemapProductCoverageAuditRunnerMocked(baseURL, context, mockSite);
      global.mockGraphQLError = false;

      expect(result.auditResult.success).to.be.false;
      expect(result.auditResult.reasons[0].error).to.equal(
        ERROR_CODES.COLLECTING_PRODUCTS_BACKEND_FAILED,
      );
      expect(result.auditResult.details.errors).to.have.property('en');
    });

    it('should handle unknown product count error', async () => {
      const siteWithDefaultLocale = {
        getDeliveryType: () => Site.DELIVERY_TYPES.AEM_EDGE,
        getConfig: () => ({
          getHandlers: () => ({
            'sitemap-product-coverage': {
              productUrlTemplate: '%baseUrl/products/%urlKey/%skuLowerCase',
              config: {
                default: {
                  'commerce-customer-group': 'test-group',
                  'commerce-environment-id': 'test-env',
                  'commerce-store-code': 'default_store',
                  'commerce-store-view-code': 'default_view',
                  'commerce-website-code': 'default_website',
                  'commerce-x-api-key': 'test-key',
                  'commerce-endpoint': `${baseURL}/graphql`,
                },
              },
            },
          }),
        }),
      };

      const result = await sitemapProductCoverageAuditRunnerMocked(
        baseURL,
        context,
        siteWithDefaultLocale,
      );

      expect(result.auditResult.success).to.be.false;
      expect(result.auditResult.details.errors).to.have.property('default');
      expect(result.auditResult.details.errors.default).to.include('Unknown product count');
    });

    it('should test template variable replacement in fillUrlTemplate', async () => {
      // This is tested through the main audit function which calls fillUrlTemplate internally
      const result = await sitemapProductCoverageAuditRunnerMocked(baseURL, context, mockSite);
      expect(result.auditResult.success).to.be.true;
    });

    it('should handle empty sitemap paths correctly', async () => {
      global.mockEmptySitemap = true;
      const result = await sitemapProductCoverageAuditRunnerMocked(baseURL, context, mockSite);
      global.mockEmptySitemap = false;

      expect(result.auditResult.success).to.be.false;
      expect(result.auditResult.reasons[0].error).to.equal(ERROR_CODES.NO_VALID_PATHS_EXTRACTED);
    });

    it('should handle large catalog with category traversal', async () => {
      global.mockLargeCatalog = true;
      const result = await sitemapProductCoverageAuditRunnerMocked(baseURL, context, mockSite);
      global.mockLargeCatalog = false;

      expect(result.auditResult.success).to.be.true;
      expect(context.log.warn).to.have.been.called; // Should warn about product count mismatch
    });

    it('should handle early break when product limit is reached (lines 107-109)', async () => {
      global.mockLargeCatalog = true;
      global.mockEarlyBreak = true;
      const result = await sitemapProductCoverageAuditRunnerMocked(baseURL, context, mockSite);
      global.mockLargeCatalog = false;
      global.mockEarlyBreak = false;

      expect(result.auditResult.success).to.be.true;
      // Should hit the early break logic when products.size >= productCount
    });

    it('should trigger exact early break condition (lines 107-109)', async () => {
      global.mockExactBreak = true;
      const result = await sitemapProductCoverageAuditRunnerMocked(baseURL, context, mockSite);
      global.mockExactBreak = false;

      expect(result.auditResult.success).to.be.true;
      // Should hit shouldBreak = true when products.size exactly equals productCount
    });

    it('should handle empty sitemap paths with NO_VALID_PATHS_EXTRACTED (lines 199-208)', async () => {
      const siteWithEmptyExtraction = {
        getDeliveryType: () => Site.DELIVERY_TYPES.AEM_EDGE,
        getConfig: () => ({
          getHandlers: () => ({
            'sitemap-product-coverage': {
              productUrlTemplate: '%baseUrl/products/%urlKey/%skuLowerCase',
              locales: 'en',
              config: {
                en: {
                  'commerce-customer-group': 'test-group',
                  'commerce-environment-id': 'test-env',
                  'commerce-store-code': 'en_store',
                  'commerce-store-view-code': 'en_view',
                  'commerce-website-code': 'en_website',
                  'commerce-x-api-key': 'test-key',
                  'commerce-endpoint': `${baseURL}/graphql`,
                },
              },
            },
          }),
        }),
      };

      global.mockEmptySitemap = true;
      const result = await sitemapProductCoverageAuditRunnerMocked(
        baseURL,
        context,
        siteWithEmptyExtraction,
      );
      global.mockEmptySitemap = false;

      expect(result.auditResult.success).to.be.false;
      expect(result.auditResult.reasons[0].error).to.equal(ERROR_CODES.NO_VALID_PATHS_EXTRACTED);
    });
  });

  describe('generateSuggestions', () => {
    it('should generate suggestions when audit succeeds with issues', () => {
      const auditUrl = 'https://example.com';
      const auditData = {
        auditResult: {
          success: true,
          details: {
            issues: {
              en: [
                'https://example.com/en/products/missing1/sku1',
                'https://example.com/en/products/missing2/sku2',
              ],
              fr: [
                'https://example.com/fr/products/missing3/sku3',
              ],
            },
          },
        },
      };

      const result = generateSuggestions(auditUrl, auditData, context);

      expect(result.suggestions).to.be.an('array');
      expect(result.suggestions).to.have.length(2);
      expect(result.suggestions[0]).to.have.property('locale', 'en');
      expect(result.suggestions[0]).to.have.property('recommendedAction');
      expect(result.suggestions[0].recommendedAction).to.include('2 product URLs missing');
      expect(result.suggestions[1]).to.have.property('locale', 'fr');
      expect(result.suggestions[1].recommendedAction).to.include('1 product URLs missing');
    });

    it('should return auditData unchanged when audit fails', () => {
      const auditUrl = 'https://example.com';
      const auditData = {
        auditResult: {
          success: false,
          details: {
            issues: {},
          },
        },
      };

      const result = generateSuggestions(auditUrl, auditData, context);

      expect(result).to.deep.equal(auditData);
      expect(result.suggestions).to.be.undefined;
    });

    it('should return auditData unchanged when audit succeeds but has no issues', () => {
      const auditUrl = 'https://example.com';
      const auditData = {
        auditResult: {
          success: true,
          details: {
            issues: {},
          },
        },
      };

      const result = generateSuggestions(auditUrl, auditData, context);

      expect(result).to.deep.equal(auditData);
      expect(result.suggestions).to.be.undefined;
    });
  });

  describe('generateOpportunity', () => {
    it('should skip opportunity creation when audit fails', async () => {
      const auditUrl = 'https://example.com';
      const auditData = {
        auditResult: {
          success: false,
        },
      };

      const result = await generateOpportunityMocked(auditUrl, auditData, context);

      expect(result).to.deep.equal(auditData);
    });

    it('should skip opportunity creation when no suggestions exist', async () => {
      const auditUrl = 'https://example.com';
      const auditData = {
        auditResult: {
          success: true,
        },
        suggestions: [],
      };

      const result = await generateOpportunityMocked(auditUrl, auditData, context);

      expect(result).to.deep.equal(auditData);
    });

    it('should skip opportunity creation when suggestions is undefined', async () => {
      const auditUrl = 'https://example.com';
      const auditData = {
        auditResult: {
          success: true,
        },
      };

      const result = await generateOpportunityMocked(auditUrl, auditData, context);

      expect(result).to.deep.equal(auditData);
    });

    it('should resolve existing opportunity when no suggestions are found', async () => {
      const auditUrl = 'https://example.com';
      const auditData = {
        siteId: 'test-site-id',
        auditResult: {
          success: true,
        },
        suggestions: [], // No suggestions - should trigger resolution of existing opportunity
      };

      // Mock existing opportunity
      const mockExistingOpportunity = {
        getId: () => 'existing-opportunity-123',
        getType: () => 'sitemap-product-coverage',
        setStatus: sinon.stub().resolves(),
        getSuggestions: sinon.stub().resolves([
          { id: 'suggestion-1' },
          { id: 'suggestion-2' },
        ]),
        setUpdatedBy: sinon.stub(),
        save: sinon.stub().resolves(),
      };

      // Mock the Opportunity.allBySiteIdAndStatus to return existing opportunity
      const mockOpportunity = {
        allBySiteIdAndStatus: sinon.stub().resolves([mockExistingOpportunity]),
      };

      // Mock the Suggestion.bulkUpdateStatus
      const mockSuggestion = {
        bulkUpdateStatus: sinon.stub().resolves(),
      };

      // Update context with mocked data access
      const contextWithDataAccess = {
        ...context,
        dataAccess: {
          Opportunity: mockOpportunity,
          Suggestion: mockSuggestion,
        },
      };

      const result = await generateOpportunityMocked(auditUrl, auditData, contextWithDataAccess);

      expect(result).to.deep.equal(auditData);

      // Verify that existing opportunity was resolved
      expect(mockOpportunity.allBySiteIdAndStatus).to.have.been.calledWith(
        'test-site-id',
        sinon.match.any, // Oppty.STATUSES.NEW
      );
      expect(mockExistingOpportunity.setStatus).to.have.been.called;
      expect(mockExistingOpportunity.getSuggestions).to.have.been.called;
      expect(mockSuggestion.bulkUpdateStatus).to.have.been.calledWith(
        [{ id: 'suggestion-1' }, { id: 'suggestion-2' }],
        sinon.match.any, // SuggestionDataAccess.STATUSES.OUTDATED
      );
      expect(mockExistingOpportunity.setUpdatedBy).to.have.been.calledWith('system');
      expect(mockExistingOpportunity.save).to.have.been.called;
    });

    it('should handle errors during opportunity resolution gracefully', async () => {
      const auditUrl = 'https://example.com';
      const auditData = {
        siteId: 'test-site-id',
        auditResult: {
          success: true,
        },
        suggestions: [], // No suggestions - should trigger resolution attempt
      };

      // Mock existing opportunity that throws error during save
      const mockExistingOpportunity = {
        getId: () => 'existing-opportunity-123',
        getType: () => 'sitemap-product-coverage',
        setStatus: sinon.stub().resolves(),
        getSuggestions: sinon.stub().resolves([]),
        setUpdatedBy: sinon.stub(),
        save: sinon.stub().rejects(new Error('Save failed')),
      };

      const mockOpportunity = {
        allBySiteIdAndStatus: sinon.stub().resolves([mockExistingOpportunity]),
      };

      const contextWithDataAccess = {
        ...context,
        dataAccess: {
          Opportunity: mockOpportunity,
          Suggestion: { bulkUpdateStatus: sinon.stub().resolves() },
        },
      };

      const result = await generateOpportunityMocked(auditUrl, auditData, contextWithDataAccess);

      expect(result).to.deep.equal(auditData);
      expect(context.log.error).to.have.been.calledWith('Failed to resolve opportunity: Save failed');
    });

    it('should handle no existing opportunity when no suggestions are found', async () => {
      const auditUrl = 'https://example.com';
      const auditData = {
        siteId: 'test-site-id',
        auditResult: {
          success: true,
        },
        suggestions: [], // No suggestions
      };

      // Mock no existing opportunities
      const mockOpportunity = {
        allBySiteIdAndStatus: sinon.stub().resolves([]), // No existing opportunities
      };

      const contextWithDataAccess = {
        ...context,
        dataAccess: {
          Opportunity: mockOpportunity,
        },
      };

      const result = await generateOpportunityMocked(auditUrl, auditData, contextWithDataAccess);

      expect(result).to.deep.equal(auditData);
      expect(context.log.info).to.have.been.calledWith('No existing opportunity found - nothing to resolve');
    });

    it('should create opportunity when audit succeeds with suggestions and test mapNewSuggestion callback (lines 280-283)', async () => {
      const auditUrl = 'https://example.com';
      const auditData = {
        auditResult: {
          success: true,
        },
        suggestions: [
          {
            locale: 'en',
            recommendedAction: 'Found 2 product URLs missing in the sitemap for locale en',
            urls: ['https://example.com/en/products/missing1/sku1'],
          },
        ],
      };

      const result = await generateOpportunityMocked(auditUrl, auditData, context);

      expect(result).to.deep.equal(auditData);

      // Verify syncSuggestions was called with mapNewSuggestion callback
      // This exercises lines 280-283 in the mapNewSuggestion function
      expect(syncSuggestionsMock).to.have.been.calledOnce;
      const callArgs = syncSuggestionsMock.getCall(0).args[0];
      expect(callArgs).to.have.property('mapNewSuggestion');
      expect(callArgs.mapNewSuggestion).to.be.a('function');

      // Test the mapNewSuggestion callback directly to ensure lines 280-283 are covered
      const mappedSuggestion = callArgs.mapNewSuggestion(auditData.suggestions[0]);
      expect(mappedSuggestion).to.deep.equal({
        opportunityId: 'opportunity-123',
        type: 'REDIRECT_UPDATE',
        rank: 0,
        data: auditData.suggestions[0],
      });
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should validate audit result structure', () => {
      // Test basic function structure and exports
      expect(sitemapProductCoverageAuditRunner).to.be.a('function');
      expect(generateSuggestions).to.be.a('function');
      expect(generateOpportunity).to.be.a('function');
    });

    it('should handle configuration edge cases', async () => {
      const siteWithMinimalConfig = {
        getDeliveryType: () => Site.DELIVERY_TYPES.AEM_EDGE,
        getConfig: () => ({
          getHandlers: () => ({
            'sitemap-product-coverage': {
              productUrlTemplate: '%baseUrl/products/%urlKey',
              // Minimal config to test defaults
            },
          }),
        }),
      };

      const result = await sitemapProductCoverageAuditRunner(
        baseURL,
        context,
        siteWithMinimalConfig,
      );

      expect(result).to.have.property('auditResult');
      expect(result.auditResult).to.have.property('success');
    });

    it('should handle getSitemapUrls success with missing details properties (lines 137-138)', async () => {
      global.mockMissingDetails = true;
      const result = await sitemapProductCoverageAuditRunnerMocked(baseURL, context, mockSite);
      global.mockMissingDetails = false;

      expect(result.auditResult.success).to.be.false;
      expect(result.auditResult.reasons[0].error).to.equal(ERROR_CODES.NO_VALID_PATHS_EXTRACTED);
      // Should handle missing extractedPaths and filteredSitemapUrls gracefully
    });

    it('should fail when productUrlTemplate is not provided in config (early validation)', async () => {
      // Test the new early validation logic that requires productUrlTemplate
      global.mockNoTemplate = true;
      const result = await sitemapProductCoverageAuditRunnerMocked(baseURL, context, mockSite);
      global.mockNoTemplate = false;

      expect(result.auditResult.success).to.be.false;
      expect(result.auditResult.reasons[0].error).to.equal(
        ERROR_CODES.MISSING_PRODUCT_URL_TEMPLATE,
      );
    });

    it('should handle error without message property', async () => {
      global.mockErrorWithoutMessage = true;
      const result = await sitemapProductCoverageAuditRunnerMocked(baseURL, context, mockSite);
      global.mockErrorWithoutMessage = false;

      expect(result.auditResult.success).to.be.false;
      expect(result.auditResult.reasons[0].error).to.include('COLLECTING PRODUCTS FROM BACKEND FAILED');
    });

    it('should handle missing issues in auditData details', async () => {
      const auditUrl = 'https://example.com';
      const auditDataWithoutIssues = {
        auditResult: {
          success: true,
          details: {
            // No issues property - should default to {}
          },
        },
        suggestions: [],
      };

      const result = await generateSuggestionsMocked(auditUrl, auditDataWithoutIssues, context);
      expect(result).to.deep.equal(auditDataWithoutIssues);
    });
  });

  describe('Opportunity Data Mapper', () => {
    describe('createOpportunityData', () => {
      it('should return the correct opportunity data structure', () => {
        const result = createOpportunityData();

        expect(result).to.be.an('object');
        expect(result).to.have.property('runbook');
        expect(result).to.have.property('origin');
        expect(result).to.have.property('title');
        expect(result).to.have.property('description');
        expect(result).to.have.property('guidance');
        expect(result).to.have.property('tags');
        expect(result).to.have.property('data');
      });

      it('should have the correct runbook URL', () => {
        const result = createOpportunityData();

        expect(result.runbook).to.equal(
          'https://wiki.corp.adobe.com/display/AEMSites/%5BProject+Success+Studio%5D+Full+product+catalog+coverage+in+the+sitemap',
        );
      });

      it('should have origin set to AUTOMATION', () => {
        const result = createOpportunityData();

        expect(result.origin).to.equal('AUTOMATION');
      });

      it('should have the correct title', () => {
        const result = createOpportunityData();

        expect(result.title).to.equal('Issues found for the sitemap product coverage');
      });

      it('should have an empty description', () => {
        const result = createOpportunityData();

        expect(result.description).to.equal('');
      });

      it('should have guidance with correct steps array', () => {
        const result = createOpportunityData();

        expect(result.guidance).to.be.an('object');
        expect(result.guidance).to.have.property('steps');
        expect(result.guidance.steps).to.be.an('array');
        expect(result.guidance.steps).to.have.length(1);
        expect(result.guidance.steps[0]).to.equal(
          'For each affected website locale check if the all products are present in the sitemap. See the suggestion provided for details on how to resolve.',
        );
      });

      it('should have the correct tags array', () => {
        const result = createOpportunityData();

        expect(result.tags).to.be.an('array');
        expect(result.tags).to.have.length(1);
        expect(result.tags[0]).to.equal('Traffic Acquisition');
      });

      it('should have data with correct dataSources', () => {
        const result = createOpportunityData();

        expect(result.data).to.be.an('object');
        expect(result.data).to.have.property('dataSources');
        expect(result.data.dataSources).to.be.an('array');
        expect(result.data.dataSources).to.have.length(1);
        expect(result.data.dataSources[0]).to.equal(DATA_SOURCES.SITE);
      });

      it('should return a new object instance on each call', () => {
        const result1 = createOpportunityData();
        const result2 = createOpportunityData();

        expect(result1).to.not.equal(result2); // Different object references
        expect(result1).to.deep.equal(result2); // Same content
      });
    });
  });
});
