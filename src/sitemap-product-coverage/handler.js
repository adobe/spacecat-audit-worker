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
import { AuditBuilder } from '../common/audit-builder.js';
import { getUrlWithoutPath } from '../support/utils.js';
import { requestSaaS } from '../utils/saas.js';
import { ProductsQuery, CategoriesQuery, ProductCountQuery } from './queries.js';
import {
  ERROR_CODES,
  getSitemapUrls,
} from '../sitemap/common.js';

function fillUrlTemplate(template, params) {
  return template
    .replace(/%baseUrl/g, params.baseUrl)
    .replace(/%locale/g, params.locale)
    .replace(/%urlKey/g, params.urlKey)
    .replace(/%skuLowerCase/g, params.sku ? params.sku.toLowerCase() : '')
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

  if (maxPage > 20) {
    log.warn(`Category ${categoryPath} has more than 10000 products.`);
    maxPage = 20;
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

  if (productCount <= 10000) {
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
  const siteMapUrlsResult = await getSitemapUrls(inputUrl);
  if (!siteMapUrlsResult.success) return siteMapUrlsResult;
  const extractedPaths = siteMapUrlsResult.details?.extractedPaths || {};
  const filteredSitemapUrls = siteMapUrlsResult.details?.filteredSitemapUrls || [];
  const notCoveredProduct = {};

  const urlsFromSitemap = Object.values(extractedPaths).flat();

  if (extractedPaths && Object.keys(extractedPaths).length > 0) {
    const customConfig = site.getConfig().getHandlers()?.['sitemap-product-coverage'];
    const locales = customConfig.locales ? customConfig.locales.split(',') : ['default'];

    await Promise.all(locales.map(async (locale) => {
      const params = {
        storeUrl: inputUrl,
        contentUrl: inputUrl + (locale !== 'default' ? `/${locale}` : ''),
        configName: customConfig.configName,
        configSection: customConfig.configSection,
        cookies: customConfig.cookies,
        config: customConfig.config,
      };

      try {
        const allSkus = await getAllSkus(params, context.log);
        context.log.info(`Found SKUs for locale ${locale}: ${allSkus.length}`);
        const fullUrls = allSkus.map(
          ({ urlKey, sku }) => fillUrlTemplate(
            customConfig.productUrlTemplate,
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
      }
    }));
  }

  // Return final result
  if (extractedPaths && Object.keys(extractedPaths).length > 0) {
    return {
      success: true,
      reasons: [{ value: 'Sitemaps found and checked.' }],
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

  log.info(`Running custom audit for ${baseURL}`);

  const auditResult = await sitemapProductCoverageAudit(baseURL, context, site);

  log.info(`Finished custom audit for ${baseURL}`);

  return {
    fullAuditRef: baseURL,
    auditResult,
    url: baseURL,
  };
}

export default new AuditBuilder()
  .withRunner(sitemapProductCoverageAuditRunner)
  .withUrlResolver((site) => composeAuditURL(site.getBaseURL())
    .then((url) => getUrlWithoutPath(prependSchema(url))))
  .build();
