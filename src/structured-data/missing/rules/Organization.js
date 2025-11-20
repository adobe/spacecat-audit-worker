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
import { isOrganizationSubtype } from '../lib.js';

async function hasMissingOrganization(page) {
  const ORGANIZATION_ENTITY = 'Organization';

  const result = [];

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

  let pageTypeString = '';
  if (isHomepage) {
    pageTypeString = 'homepage';
  } else if (isAboutUs) {
    pageTypeString = 'about us';
  } else if (isLandingPage) {
    pageTypeString = 'landing page';
  }

  if (isHomepage || isAboutUs || isLandingPage) {
    result.push({
      entity: ORGANIZATION_ENTITY,
      rationale: `Page is of type "${pageTypeString}"`,
      confidence: 'accepted',
    });
    return result;
  }

  return result;
}

export default hasMissingOrganization;
