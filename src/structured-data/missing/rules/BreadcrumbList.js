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
/* eslint-disable no-await-in-loop */
import { removeLanguageFromPath } from '../lib.js';

async function hasMissingBreadcrumb(page) {
  const BREADCRUMB_LIST_ENTITY = 'BreadcrumbList';
  const result = [];

  // Requirement: if page already has breadcrumb list, skip
  if (page.structuredDataEntities.includes(BREADCRUMB_LIST_ENTITY)) {
    return result;
  }

  // Requirement: no breadcrumb on homepages or landing pages
  const isHomepage = page.pathname === '/' || page.pageType === 'homepage';
  const isLandingPage = page.pageType === 'landingpage';
  if (isHomepage || isLandingPage) {
    return result;
  }

  // TODO: Validate this, bulk does it correctly
  // Requirement: at least two levels deep path, otherwise skip
  const pathWithoutLanguage = removeLanguageFromPath(page.pathname).replace(/^\/|\/$/g, '');
  const pathSegments = pathWithoutLanguage.split('/');
  if (pathSegments.length < 2) {
    // TODO: Remove
    console.log(`path ${page.pathname} has less than two levels deep, skipping`);
    return result;
  }

  // Accept to add breadcrumbs to product, product list and blog pages
  const isProductPage = page.structuredDataEntities.includes('Product')
    || page.structuredDataEntities.includes('ProductGroup')
    || page.pageType === 'productdetailpage'
    || page.cssBlocks.some((cssBlock) => cssBlock.includes('product-details'))
    || page.cssClasses.some((cssClass) => cssClass.includes('product-details'));
  const isProductListPage = page.pageType === 'productlistpage'
    || page.cssBlocks.some((cssBlock) => cssBlock.includes('product-list-page'))
    || page.cssClasses.some((cssClass) => cssClass.includes('product-list-page'));
  const isBlogPost = page.pageType === 'blog';

  let pageTypeString = '';
  if (isProductPage) {
    pageTypeString = 'product page';
  } else if (isProductListPage) {
    pageTypeString = 'product list page';
  } else if (isBlogPost) {
    pageTypeString = 'blog post';
  }

  if (isProductPage || isProductListPage || isBlogPost) {
    result.push({
      entity: BREADCRUMB_LIST_ENTITY,
      rationale: `Page is of type "${pageTypeString}"`,
      confidence: 'accepted',
    });
    return result;
  }

  // Candidate if breadcrumb is present on the page
  const hasBreadcrumbComponent = page.cssClasses.some((cssClass) => cssClass.includes('breadcrumb'));
  if (hasBreadcrumbComponent) {
    result.push({
      entity: BREADCRUMB_LIST_ENTITY,
      rationale: 'A DOM element with CSS class "breadcrumb" is present on the page',
      confidence: 'candidate',
    });
    return result;
  }
  const hasBreadcrumbBlock = page.cssBlocks.some((cssBlock) => cssBlock.includes('breadcrumb'));
  if (hasBreadcrumbBlock) {
    result.push({
      entity: BREADCRUMB_LIST_ENTITY,
      rationale: 'An AEM block component with CSS class "breadcrumb" is present on the page',
      confidence: 'candidate',
    });
    return result;
  }

  // Candidate if links on page that lead to upper segments are present
  const pathnameSegments = page.pathname.split('/');
  const fullPaths = pathnameSegments.reduce((acc, segment, index) => {
    const fullPath = pathnameSegments.slice(0, index + 1).join('/');
    if (fullPath.length > 1 && fullPath !== page.pathname) {
      acc.push(fullPath);
    }
    return acc;
  }, []);
  const allLinksPresent = fullPaths
    .every((path) => page.clickableElementsHref.some((href) => href.startsWith(path)));
  if (allLinksPresent) {
    result.push({
      entity: BREADCRUMB_LIST_ENTITY,
      rationale: 'Links to all upper URL segments were found on the page',
      confidence: 'candidate',
    });
    return result;
  }

  return result;
}

export default hasMissingBreadcrumb;
