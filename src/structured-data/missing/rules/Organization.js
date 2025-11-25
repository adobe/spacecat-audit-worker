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
import * as cheerio from 'cheerio';

import { isOrganizationSubtype } from '../lib.js';

/**
 * Detect if page has missing Organization entity
 */
async function detect(page) {
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

/**
 * Statically analyze page and suggest Organization entity
 */
async function suggest(context, entityWithPages, topPages) {
  const { finalUrl, log } = context;

  const data = {
    // Hardcode for now, let LLM determine more specific entity type
    '@type': 'Organization',
    url: finalUrl.startsWith('https://') ? finalUrl : `https://${finalUrl}`,
    name: new Map(),
    logo: new Map(),
  };

  // TODO: Potentially limit number of pages to analyze?
  const { pages } = entityWithPages;
  for (const page of pages) {
    const selectedPage = topPages.find((p) => p.url === page.pageUrl);

    // Try to extract organization name from title
    const title = selectedPage?.scrapeResult?.scrapeResult?.tags?.title;
    // Split on |, -, •, ·, –., take the first element and trim
    const titleParts = title?.split(/[||-•·–.].*/);
    if (titleParts?.length > 0) {
      const name = titleParts[0].trim();
      data.name.set(name, (data.name.get(name) || 0) + 1);
    }

    try {
      const $ = cheerio.load(selectedPage?.scrapeResult?.scrapeResult?.rawBody);

      // Remove consent content
      const elements = $('#onetrust-consent-sdk, #onetrust-banner-sdk, .onetrust-pc-dark-filter, [id*="cookie-consent"], [class*="gdpr-banner"]');
      elements.each((i, el) => $(el).remove());

      // Find logos
      $('img[class*="logo"]').each((i, el) => {
        const absoluteUrl = new URL($(el).attr('src'), data.url).toString();
        data.logo.set(absoluteUrl, (data.logo.get(absoluteUrl) || 0) + 1);
      });
      $('img[src*="logo"]').each((i, el) => {
        const absoluteUrl = new URL($(el).attr('src'), data.url).toString();
        data.logo.set(absoluteUrl, (data.logo.get(absoluteUrl) || 0) + 1);
      });
    } catch (error) {
      log.error(`[MSDA] Could not parse page with cheerio to extract Organization logo ${page.pageUrl}: ${error}`);
    }
  }

  if (data.name.size === 1) {
    data.name = data.name.keys().next().value;
  } else {
    const sum = Array.from(data.name.values()).reduce((acc, curr) => acc + curr, 0);
    const [maxName, maxValue] = Array.from(data.name.entries()).reduce((acc, [key, value]) => (value > acc[1] ? [key, value] : acc), ['', 0]);
    // If item is more than 50% of the total, use it, otherwise use all items
    if (maxValue / sum > 0.5) {
      data.name = maxName;
    } else {
      data.name = Object.fromEntries(data.name);
    }
  }
  if (data.logo.size === 1) {
    data.logo = data.logo.keys().next().value;
  } else {
    const sum = Array.from(data.logo.values()).reduce((acc, curr) => acc + curr, 0);
    const [maxLogo, maxValue] = Array.from(data.logo.entries()).reduce((acc, [key, value]) => (value > acc[1] ? [key, value] : acc), ['', 0]);
    // If item is more than 50% of the total, use it, otherwise use all items
    if (maxValue / sum > 0.5) {
      data.logo = maxLogo;
    } else {
      data.logo = Object.fromEntries(data.logo);
    }
  }

  // log.info(`[MSDA] Data: ${JSON.stringify(data)}`);

  return { ...entityWithPages, data };
}

/**
 * Improve suggestion from earlier step using Mystique response
 */
async function guidance(page, data) {
  const requiredFields = ['name', 'url'];
  for (const field of requiredFields) {
    if (!data[field]) {
      throw new Error(`Missing required field: ${field}`);
    }
  }

  const output = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    url: data.url,
    name: data.name,
  };

  // Add only non-null and non-undefined optional fields to the output object
  [
    'logo',
    'sameAs',
    'description',
    'email',
    'telephone',
    'address',
    'vatID',
  ].forEach((field) => {
    if (data[field] != null) {
      output[field] = data[field];
    }
  });

  return output;
}

export default {
  detect,
  suggest,
  guidance,
};
