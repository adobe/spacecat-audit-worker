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

import { isOrganizationSubtype, removeLanguageFromPath } from './missing/lib.js';

async function hasMissingOrganization(page) {
  const result = {
    candidate: [],
    accepted: [],
  };

  // Check if page already has organization or subtype
  for (const entity of page.structuredDataEntities) {
    const isSubtype = await isOrganizationSubtype(entity);
    if (isSubtype) {
      return result;
    }
  }

  // Check if homepage, about us or landing page
  const isHomepage = page.pathname === '/' || page.pageType === 'homepage';
  const isAboutUs = page.pageType === 'about';
  const isLandingPage = page.pageType === 'landingpage';

  if (isHomepage || isAboutUs || isLandingPage) {
    result.accepted.push('Organization');
  }

  return result;
}

async function hasMissingBreadcrumb(page) {
  const result = {
    candidate: [],
    accepted: [],
  };

  // If page already has breadcrumb list, skip
  if (page.structuredDataEntities.includes('BreadcrumbList')) {
    return result;
  }

  // No breadcrumb on homepages or landing pages
  const isHomepage = page.pathname === '/' || page.pageType === 'homepage';
  const isLandingPage = page.pageType === 'landingpage';
  if (isHomepage || isLandingPage) {
    return result;
  }

  // TODO: Validate this, bulk does it correctly
  // At least two levels deep path, otherwise skip
  const pathWithoutLanguage = removeLanguageFromPath(page.pathname).replace(/^\/|\/$/g, '');
  const pathSegments = pathWithoutLanguage.split('/');
  if (pathSegments.length < 2) {
    console.log(`path ${page.pathname} has less than two levels deep, skipping`);
    return result;
  }

  // TODO: Accepted: If breadcrumb css class is present on the page

  // Recommend to add breadcrumbs to product, product list and blog pages
  const isProductPage = page.structuredDataEntities.includes('Product') || page.structuredDataEntities.includes('ProductGroup') || page.pageType === 'productdetailpage';
  const isProductListPage = page.pageType === 'productlistpage';
  const isBlogPost = page.pageType === 'blog';
  if (isProductPage || isProductListPage || isBlogPost) {
    result.accepted.push('BreadcrumbList');
    return result;
  }

  // TODO: Candidate: if links pointing to parent pages are present on the page
  return result;
}

export default [
  hasMissingOrganization,
  hasMissingBreadcrumb,
];
