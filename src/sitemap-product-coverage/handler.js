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

import { composeAuditURL, prependSchema } from '@adobe/spacecat-shared-utils';
import { Site, Opportunity as Oppty, Suggestion as SuggestionDataAccess } from '@adobe/spacecat-shared-data-access';
import { AuditBuilder } from '../common/audit-builder.js';
import { getUrlWithoutPath } from '../support/utils.js';
import { requestSaaS } from '../utils/saas.js';
import { createOpportunityData } from './opportunity-data-mapper.js';
import { syncSuggestions } from '../utils/data-access.js';
import { convertToOpportunity } from '../common/opportunity.js';
import { ProductsQuery, CategoriesQuery, ProductCountQuery } from './queries.js';
import {
  ERROR_CODES,
  getSitemapUrls,
} from '../sitemap/common.js';

const auditType = 'sitemap-product-coverage';

/**
 * Maximum number of products per category.
 * CS can return up to 10000 products.
 * @type {number}
 */
const MAX_PRODUCTS_PER_CATEGORY = 10000;

/**
 * Maximum number of pages to fetch for a category.
 * One query can return up to 500 products,
 * so we can fetch up to 20 pages to cover 10000 products.
 * @type {number}
 */
const MAX_PAGES = 20;

function fillUrlTemplate(template, params) {
  return template
    .replace(/%baseUrl/g, params.baseUrl)
    .replace(/%locale/g, params.locale)
    .replace(/%urlKey/g, params.urlKey)
    .replace(/%skuLowerCase/g, params.sku ? params.sku.toLowerCase() : '')
    .replace(/%skuUpperCase/g, params.sku ? params.sku.toUpperCase() : '')
    .replace(/%sku/g, params.sku || '');
}

async function getSkus(categoryPath, params, log) {
  let productsResp = await requestSaaS(ProductsQuery, 'getProducts', { currentPage: 1, categoryPath }, params, log);
  const products = [...productsResp.data.productSearch.items.map(({ productView }) => (
    {
      urlKey: productView.urlKey,
      sku: productView.sku,
    }
  ))];
  let maxPage = productsResp.data.productSearch.page_info.total_pages;

  if (maxPage > MAX_PAGES) {
    log.warn(`Category ${categoryPath} has more than ${MAX_PRODUCTS_PER_CATEGORY} products.`);
    maxPage = MAX_PAGES;
  }

  for (let currentPage = 2; currentPage <= maxPage; currentPage += 1) {
    // eslint-disable-next-line no-await-in-loop
    productsResp = await requestSaaS(ProductsQuery, 'getProducts', { currentPage, categoryPath }, params, log);
    products.push(...productsResp.data.productSearch.items.map(({ productView }) => (
      {
        urlKey: productView.urlKey,
        sku: productView.sku,
      }
    )));
  }

  return products;
}

async function getAllCategories(params, log) {
  const categories = [];
  const categoriesResp = await requestSaaS(CategoriesQuery, 'getCategories', {}, params, log);
  const items = categoriesResp.data.categories;
  for (const { urlPath, level, name } of items) {
    const index = parseInt(level, 10);
    categories[index] = categories[index] || [];
    categories[index].push({ urlPath, name, level });
  }
  return categories;
}

async function getAllSkus(params, log) {
  const productCountResp = await requestSaaS(ProductCountQuery, 'getProductCount', { categoryPath: '' }, params, log);
  const productCount = productCountResp.data.productSearch?.page_info?.total_pages;

  if (!productCount) {
    throw new Error('Unknown product count.');
  }

  if (productCount <= MAX_PRODUCTS_PER_CATEGORY) {
    // we can get everything from the default category
    return getSkus('', params, log);
  }

  const products = new Set();
  // we have to traverse the category tree
  const categories = await getAllCategories(params, log);

  let shouldBreak = false;
  for (const category of categories) {
    if (category) {
      while (category.length && !shouldBreak) {
        const slice = category.splice(0, 50);
        // eslint-disable-next-line no-await-in-loop
        const fetchedProducts = await Promise.all(
          slice.map((cat) => getSkus(cat.urlPath, params, log)),
        );
        fetchedProducts.flatMap((skus) => skus).forEach((sku) => products.add(sku));
        if (products.size >= productCount) {
          // break if we got all products already
          shouldBreak = true;
        }
      }
      if (shouldBreak) break;
    }
  }

  if (products.size !== productCount) {
    log.warn(`Expected ${productCount} products, but got ${products.size}.`);
  }

  return [...products];
}

async function sitemapProductCoverageAudit(inputUrl, context, site) {
  if (site.getDeliveryType() !== Site.DELIVERY_TYPES.AEM_EDGE) {
    return {
      success: false,
      reasons: [{
        value: 'Now we support only AEM Edge sites.',
        error: ERROR_CODES.UNSUPPORTED_DELIVERY_TYPE,
      }],
      url: inputUrl,
      details: {},
    };
  }

  const customConfig = site.getConfig().getHandlers()?.['sitemap-product-coverage'];
  if (!customConfig?.productUrlTemplate) {
    return {
      success: false,
      reasons: [{
        value: 'Product URL template is not defined in the site configuration.',
        error: ERROR_CODES.MISSING_PRODUCT_URL_TEMPLATE,
      }],
      url: inputUrl,
      details: {},
    };
  }
  const siteMapUrlsResult = await getSitemapUrls(inputUrl);
  if (!siteMapUrlsResult.success) return siteMapUrlsResult;
  const extractedPaths = siteMapUrlsResult.details?.extractedPaths || {};
  const filteredSitemapUrls = siteMapUrlsResult.details?.filteredSitemapUrls || [];
  const notCoveredProduct = {};
  const localeErrors = {};

  const urlsFromSitemap = Object.values(extractedPaths).flat();

  if (extractedPaths && Object.keys(extractedPaths).length > 0) {
    const locales = customConfig?.locales ? customConfig.locales.split(',') : ['default'];

    await Promise.all(locales.map(async (locale) => {
      const params = {
        storeUrl: inputUrl,
        locale: locale === 'default' ? '' : `${locale}`,
        configName: customConfig?.configName,
        configSection: customConfig?.configSection,
        configSheet: customConfig?.configSheet,
        productUrlTemplate: customConfig?.productUrlTemplate,
        config: customConfig?.config?.[locale],
      };

      try {
        const allSkus = await getAllSkus(params, context.log);
        context.log.info(`Found SKUs for locale ${locale}: ${allSkus.length}`);
        const fullUrls = allSkus.map(
          ({ urlKey, sku }) => fillUrlTemplate(
            params.productUrlTemplate,
            {
              baseUrl: inputUrl, locale, urlKey, sku,
            },
          ),
        );
        const missingUrls = fullUrls.filter((url) => !urlsFromSitemap.includes(url));
        if (missingUrls.length > 0) {
          context.log.warn(`Missing URLs for locale ${locale}: ${missingUrls.length}`);
          notCoveredProduct[locale] = missingUrls;
        }
      } catch (error) {
        context.log.error(error);
        localeErrors[locale] = error.message || 'Unknown error';
      }
    }));

    if (Object.keys(localeErrors).length > 0) {
      return {
        success: false,
        reasons: [{
          value: 'Errors occurred while checking locales.',
          error: ERROR_CODES.COLLECTING_PRODUCTS_BACKEND_FAILED,
        }],
        url: inputUrl,
        details: { issues: notCoveredProduct, errors: localeErrors },
      };
    }

    return {
      success: true,
      reasons: [{ value: 'Sitemaps found and checked without errors.' }],
      url: inputUrl,
      details: { issues: notCoveredProduct },
    };
  }

  return {
    success: false,
    reasons: [{
      value: filteredSitemapUrls[0],
      error: ERROR_CODES.NO_VALID_PATHS_EXTRACTED,
    }],
    url: inputUrl,
    details: { issues: notCoveredProduct },
  };
}

export async function sitemapProductCoverageAuditRunner(baseURL, context, site) {
  const { log } = context;
  const startTime = process.hrtime();
  log.info(`Starting sitemap products coverage audit for ${baseURL}`);
  const auditResult = await sitemapProductCoverageAudit(baseURL, context, site);
  const endTime = process.hrtime(startTime);
  const elapsedSeconds = endTime[0] + endTime[1] / 1e9;
  const formattedElapsed = elapsedSeconds.toFixed(2);
  log.info(`Sitemap products coverage audit for ${baseURL} completed in ${formattedElapsed} seconds`);

  return {
    fullAuditRef: baseURL,
    auditResult,
    url: baseURL,
  };
}

export function generateSuggestions(auditUrl, auditData, context) {
  const { log } = context;

  const success = auditData?.auditResult?.success;
  const issues = auditData?.auditResult?.details?.issues || {};

  log.info(`Generating suggestions for audit URL: ${auditUrl}`);

  if (success && Object.keys(issues).length > 0) {
    log.info(`Found ${Object.keys(issues).length} locale(s) with missing products in sitemap`);

    const suggestions = [];
    Object.entries(issues).forEach(([locale, urls]) => {
      urls.forEach((url) => {
        suggestions.push({
          locale,
          recommendedAction: `Product URL missing in the sitemap for locale ${locale}. Please manually check why it happens.`,
          url,
        });
      });
    });
    return { ...auditData, suggestions };
  }

  return auditData;
}

export async function generateOpportunity(auditUrl, auditData, context) {
  const { log, dataAccess } = context;

  if (auditData.auditResult.success === false) {
    log.info(`The ${auditType} audit itself failed, skipping opportunity creation.`);
    return { ...auditData };
  }

  if (!auditData.suggestions || !auditData.suggestions.length) {
    log.info(`The ${auditType} has no suggested fixes found`);
    const { Opportunity } = dataAccess;
    let existingOpportunity;

    try {
      const opportunities = await Opportunity.allBySiteIdAndStatus(
        auditData.siteId,
        Oppty.STATUSES.NEW,
      );
      existingOpportunity = opportunities.find((oppty) => oppty.getType() === auditType);
    } catch (e) {
      log.error(`Fetching opportunities for siteId ${auditData.siteId} failed: ${e.message}`);
      return { ...auditData };
    }

    if (existingOpportunity) {
      log.info(`${auditType} issues have been resolved, updating opportunity status to RESOLVED`);

      try {
        await existingOpportunity.setStatus(Oppty.STATUSES.RESOLVED);
        const suggestions = await existingOpportunity.getSuggestions();
        if (suggestions && suggestions.length > 0) {
          const { Suggestion } = dataAccess;
          await Suggestion.bulkUpdateStatus(suggestions, SuggestionDataAccess.STATUSES.OUTDATED);
          log.info(`Updated ${suggestions.length} suggestions to OUTDATED status`);
        }

        existingOpportunity.setUpdatedBy('system');
        await existingOpportunity.save();

        log.info(`Successfully resolved opportunity ${existingOpportunity.getId()}`);
      } catch (error) {
        log.error(`Failed to resolve opportunity: ${error.message}`);
      }
    } else {
      log.info('No existing opportunity found - nothing to resolve');
    }

    return { ...auditData };
  }

  const opportunity = await convertToOpportunity(
    auditUrl,
    auditData,
    context,
    createOpportunityData,
    auditType,
  );

  const buildKey = (data) => data.url;
  await syncSuggestions({
    opportunity,
    newData: auditData.suggestions,
    context,
    buildKey,
    mapNewSuggestion: (issue) => ({
      opportunityId: opportunity.getId(),
      type: 'REDIRECT_UPDATE',
      rank: 0,
      data: issue,
    }),
    log,
  });

  return { ...auditData };
}

export default new AuditBuilder()
  .withRunner(sitemapProductCoverageAuditRunner)
  .withUrlResolver((site) => composeAuditURL(site.getBaseURL())
    .then((url) => getUrlWithoutPath(prependSchema(url))))
  .withPostProcessors([generateSuggestions, generateOpportunity])
  .build();
