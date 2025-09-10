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

import { JSDOM } from 'jsdom';
import { tracingFetch as fetch } from '@adobe/spacecat-shared-utils';
import { Audit } from '@adobe/spacecat-shared-data-access';
import { AuditBuilder } from '../common/audit-builder.js';
import { noopUrlResolver } from '../common/index.js';
import { syncSuggestions } from '../utils/data-access.js';
import { convertToOpportunity } from '../common/opportunity.js';
import { createOpportunityData } from './opportunity-data-mapper.js';
import { getTopPagesForSiteId } from '../canonical/handler.js';

const auditType = Audit.AUDIT_TYPES.HEADINGS;

export const HEADINGS_CHECKS = Object.freeze({
  HEADING_ORDER_INVALID: {
    check: 'heading-order-invalid',
    explanation: 'Heading levels should increase by one (h1→h2), not jump levels (h1→h3).',
    suggestion: 'Adjust heading levels to maintain proper hierarchy.',
  },
  HEADING_EMPTY: {
    check: 'heading-empty',
    explanation: 'Heading elements should not be empty.',
    suggestion: 'Add descriptive text or remove the empty heading.',
  },
  HEADING_MISSING_H1: {
    check: 'heading-missing-h1',
    explanation: 'Pages should have exactly one h1 element for SEO and accessibility.',
    suggestion: 'Add an h1 element describing the main content.',
  },
  HEADING_MULTIPLE_H1: {
    check: 'heading-multiple-h1',
    explanation: 'Pages should have only one h1 element.',
    suggestion: 'Change additional h1 elements to h2 or appropriate levels.',
  },
  HEADING_DUPLICATE_TEXT: {
    check: 'heading-duplicate-text',
    explanation: 'Headings should have unique text content (WCAG 2.2 2.4.6).',
    suggestion: 'Ensure each heading has unique, descriptive text.',
  },
  HEADING_NO_CONTENT: {
    check: 'heading-no-content',
    explanation: 'Headings should be followed by content before the next heading.',
    suggestion: 'Add meaningful content after each heading.',
  },
  TOPPAGES: {
    check: 'top-pages',
    explanation: 'No top pages found',
  },
});

function getHeadingLevel(tagName) {
  return Number(tagName.charAt(1));
}

/**
 * Safely extract text content from an element
 * @param {Element} element - The DOM element
 * @returns {string} - The trimmed text content, or empty string if null/undefined
 */
function getTextContent(element) {
  return (element.textContent || '').trim();
}

/**
 * Check if there is meaningful content between two DOM elements
 * @param {Element} startElement - The starting element (heading)
 * @param {Element} endElement - The ending element (next heading)
 * @returns {boolean} - True if meaningful content exists between the elements
 */
function hasContentBetweenElements(startElement, endElement) {
  const contentTags = new Set([
    'P', 'DIV', 'SPAN', 'UL', 'OL', 'DL', 'LI', 'IMG', 'FIGURE', 'VIDEO', 'AUDIO',
    'TABLE', 'FORM', 'FIELDSET', 'SECTION', 'ARTICLE', 'ASIDE', 'NAV', 'MAIN',
    'BLOCKQUOTE', 'PRE', 'CODE', 'HR', 'BR', 'CANVAS', 'SVG', 'IFRAME',
  ]);

  let currentElement = startElement.nextSibling;

  while (currentElement && currentElement !== endElement) {
    // Check if it's an element node
    if (currentElement.nodeType === 1) { // Element node
      const tagName = currentElement.tagName.toUpperCase();

      // If it's a content tag, check if it has meaningful content
      if (contentTags.has(tagName)) {
        const textContent = (currentElement.textContent || '').trim();
        // Consider it meaningful if it has text content or is a self-closing content element
        if (textContent.length > 0 || ['IMG', 'HR', 'BR', 'CANVAS', 'SVG', 'IFRAME'].includes(tagName)) {
          return true;
        }
      }

      // Recursively check child elements for content
      if (currentElement.children && currentElement.children.length > 0) {
        const hasChildContent = Array.from(currentElement.children).some((child) => {
          const childTextContent = getTextContent(child);
          const childTagName = child.tagName.toUpperCase();
          return childTextContent.length > 0
                 || ['IMG', 'HR', 'BR', 'CANVAS', 'SVG', 'IFRAME'].includes(childTagName);
        });
        if (hasChildContent) {
          return true;
        }
      }
    } else if (currentElement.nodeType === 3) { // Text node
      const textContent = getTextContent(currentElement);
      if (textContent.length > 0) {
        return true;
      }
    }

    currentElement = currentElement.nextSibling;
  }

  return false;
}

/**
 * Validate heading semantics for a single page.
 * - Ensure heading level increases by at most 1 when going deeper (no jumps, e.g., h1 → h3)
 * - Ensure headings are not empty
 *
 * @param {string} url
 * @param {Object} log
 * @returns {Promise<{url: string, checks: Array}>}
 */
export async function validatePageHeadings(url, log) {
  if (!url) {
    log.error('URL is undefined or null, cannot validate headings');
    return {
      url,
      checks: [],
    };
  }

  try {
    log.info(`Checking headings for URL: ${url}`);
    const response = await fetch(url, {
      headers: {
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'accept-language': 'en-GB,en-US;q=0.9,en;q=0.8',
        'cache-control': 'no-cache',
        pragma: 'no-cache',
        priority: 'u=0, i',
        'sec-ch-ua': '"Chromium";v="134", "Not:A-Brand";v="24", "Google Chrome";v="134"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"macOS"',
        'sec-fetch-dest': 'document',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-site': 'none',
        'sec-fetch-user': '?1',
        'upgrade-insecure-requests': '1',
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
        cookie: 'ai_ab_uid=87cdef7bf873cb1c23e8ce803feea4f2ffa89fab53391e085ab581fed09f2b48; ai_user=YLGQts5Q9/GzcJbC9D/NHz|2025-08-22T05:38:31.503Z; ai_ab_grp=4SWYC0aBqWiYD_PsGEAb_0Yi1lhI5AssfxJci9VjiW_kMaOkvXr18t8ncWCebbg=; OptanonAlertBoxClosed=2025-09-08T09:15:25.092Z; _gcl_au=1.1.44407356.1757322925; kndctr_56C628E563E65FE60A495FBA_AdobeOrg_consent=general%3Din; kndctr_56C628E563E65FE60A495FBA_AdobeOrg_identity=CiY1MjEwMjc4NjIzMzk3ODIzMzQ3MjEzODQ1Njk2NjI1ODIwMjk5MFITCNKo78SSMxABGAEqBElORDEwAPAB0qjvxJIz; _gid=GA1.2.1169931467.1757322925; _fbp=fb.1.1757322925349.957335565384139723; cjConsent=MHxOfDB8Tnww; cjUser=b16c54de-907f-47bd-8303-1e6207b9dd5d; th_external_id=2739efd40303da449e4a4f9d6e8f214db310d1a4210429a326c95d77e982e57f; _hjSessionUser_3738565=eyJpZCI6IjMyODg0YWFiLTVhZWQtNTFmYi1hZGNjLTcyNTZlNWY0NjZiYyIsImNyZWF0ZWQiOjE3NTczMjI5MjU1NjAsImV4aXN0aW5nIjp0cnVlfQ==; emcid=T-HgKx8zkXt; bm_so=FC9F5F20C6FDF7E060E2DCB3567ED94127288F68CF9E927FD49BF20A3A1A09E3~YAAQ78IRYDAP+fSYAQAAr4YaLQT/KaX8Usscd8zEI3PVgwqugAi9Oenr6xRDAIcnJM4h2YLZ5odB5fzZRLB1rbDFvJN5dBiZvEyOYUA/0mr1jgrhvbpv7/fqZZeSZsOQjTjTWrvTmXN3IaljBn+cAU7o2h1RtNgzAAc+ITPNdMDRLMv4rPKrXHSEmxS/bUINseMqeZYM++r5NcSCXAd7LcTLh5ht2PwcSf7SUudG6KsXA+SgcJs3VTr0mLNXuTR9s7N3LX4dgPIM86+DLwlSNjo215XLMmy3AUCCBQnuufZjmVipV7Fd70Twk8gFkOyGoAn4AHvg2rSWhxheQMH/a2zjJ4toOw9AF20PkEbo3R5vZ6xjVpIzbxB1AV5NkL6rIwAImQNvS5oBO11a2SdtFxogGMeC1vECEKu/okbL4MSnF8Xj/bTM6pMOHb0o/YtjFcCgH8LGPVk7fUd5xaO6Hmg=; s_nr30=1757398337969-Repeat; OptanonConsent=isGpcEnabled=0&datestamp=Tue+Sep+09+2025+11%3A42%3A18+GMT%2B0530+(India+Standard+Time)&version=202408.1.0&browserGpcFlag=0&isIABGlobal=false&hosts=&consentId=d1e48e03-f354-4e29-a685-b04b5b16a686&interactionCount=2&isAnonUser=1&landingPath=NotLandingPage&groups=C0001%3A1%2CC0004%3A1%2CC0002%3A1&AwaitingReconsent=false&intType=1&geolocation=IN%3BKA; _abck=6EAA63AAC933614B4013D7FC86F9FA7D~0~YAAQ78IRYMQP+fSYAQAAOosaLQ4qGgi5BGuzDbnpLe8Pd2/xHqtVbbFQm7+MTC9W1qzB2HobVePeuP7BRAcnGHc3Kn4oLvdjgojnmoJj1PHEzBbWhdUOrCr4pSNvga87QdeZkTOWAev403r+LlxLpimF3p9TVv1zCbxgVUbOgKi+Wryh9XMUW+TS9FLcXtSud+iCdvIW3O3+CSBZnWyDFveSd1mShqqW2tl1wJI8hRN6x1y5+UExmtBsOYR9TKRrqikFsI5iM+MGhkCF44lsioDXAMQmWE2cF5IigrzhzEMIOYJQkm+GgVj+fl4Vx2+Epcy1r/S5G3JtKbbvbhyiIh5jfRxOIySWaZXhFMznv5mt7laqQPzv7yc5Nm+oWXxVHAsk3W4OB3num15fKohGNkwWFrRCsSe7e/04mzl8rQK8GuXh5W6pscxUWaf428OvNdyAcn74iDsiTkAiJvPI6qmy3TOjt23/2BkSA72Tq+FbrBlgL90/N+zNzaDGXutDPeDtRr2Fs0VjrST0U95UsZAWngIz4jH1BUb4ZtijTVeboCJboG+EPUdYP40Afrm+CQzOEUug4phJLfuArv2+ALl7FTIPuCJOZUhF5rGUpLq6nZtpW8lVS7HkDHz3gQOVn/+/fkrdSNRmaTAMAaHJImnHiUbZ4DptB/QQolU=~-1~-1~1757401938~AAQAAAAE%2f%2f%2f%2f%2f5kocmlLUQwMRbeNOfjR5VHeffY9EviWwYP2tjcD5cLhueLhaYcR3NJ9xdpgeg0ZJvx+4wLQ8unVfiIzxO8EcubhW3uZ+gEWiyhO~-1; _ga=GA1.1.1303308552.1757322924; _uetsid=45b0a7208ca511f0bc470555388f03db; _uetvid=45b0b0e08ca511f09f6f9beb48c5b853; _ga_GP7L7ZWNDL=GS2.1.s1757398340$o2$g0$t1757398340$j60$l0$h0; _ga_XT7DLK33SZ=GS2.1.s1757398340$o3$g0$t1757398340$j60$l0$h0; bm_lso=FC9F5F20C6FDF7E060E2DCB3567ED94127288F68CF9E927FD49BF20A3A1A09E3~YAAQ78IRYDAP+fSYAQAAr4YaLQT/KaX8Usscd8zEI3PVgwqugAi9Oenr6xRDAIcnJM4h2YLZ5odB5fzZRLB1rbDFvJN5dBiZvEyOYUA/0mr1jgrhvbpv7/fqZZeSZsOQjTjTWrvTmXN3IaljBn+cAU7o2h1RtNgzAAc+ITPNdMDRLMv4rPKrXHSEmxS/bUINseMqeZYM++r5NcSCXAd7LcTLh5ht2PwcSf7SUudG6KsXA+SgcJs3VTr0mLNXuTR9s7N3LX4dgPIM86+DLwlSNjo215XLMmy3AUCCBQnuufZjmVipV7Fd70Twk8gFkOyGoAn4AHvg2rSWhxheQMH/a2zjJ4toOw9AF20PkEbo3R5vZ6xjVpIzbxB1AV5NkL6rIwAImQNvS5oBO11a2SdtFxogGMeC1vECEKu/okbL4MSnF8Xj/bTM6pMOHb0o/YtjFcCgH8LGPVk7fUd5xaO6Hmg=^1757398341282; bm_s=YAAQ78IRYCoR+fSYAQAA8JgaLQS1KYP3zjIoBQ7bhHB1Z6nwukuk631A5p7lZnjWbcX+UwjUorGDXkxwkb9HXrQYBxYEKOyAAeS6dM6iNyvECKi9oC3R+PWEP84mTUURT/0poJkDd4g0Sn1lZ7cZjCXpwpmFeaWBOsbwJ9LR9HLCjIk2Z0JXJBlJURK4oaSUIvSl3BTblEwyiAafNJgVi9bT6eQkLg1a+zrM9KjsNN2rfmEJqFeHo4RAP6xaPqK/RB55Ecd9Y4zElPbdpQ847CNAcl/LfBKeZgOva6XDlFt9kvRyB+hElqW9kjWl6viFoHlikNUSEjMTbZni+RZp2CMhToL6gB5IFjF2xsLAG4U1oto8UHaw+IjG2n7imEX8HHUO/Da6BVICvGGvRVoN8wGsEM9YsDiSKV8cOJt198UxzyisjvaDtWWFckIngzie89wwB/jUryCSPJjRESmXSmPg1nH814BMAaWS0MqwtlXdbXVzSNuTckfgAZwctLnA1xeFrplmRC9ZgeKDDGKoyCshYKP8/iG3feO3LCBbpgomIja8d6NoS5UYLcc5W+bf3ek/g9WdyYI=; _ga_KY2H50PYYH=GS2.1.s1757398338$o4$g0$t1757398524$j60$l0$h0; _ga_8Y7N6KMX5B=GS2.1.s1757398338$o4$g0$t1757398524$j60$l0$h0',
      },
    });
    const html = await response.text();
    const dom = new JSDOM(html);
    const { document } = dom.window;

    const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'));
    const checks = [];

    const h1Elements = headings.filter((h) => h.tagName === 'H1');

    if (h1Elements.length === 0) {
      checks.push({
        check: HEADINGS_CHECKS.HEADING_MISSING_H1.check,
        success: false,
        explanation: HEADINGS_CHECKS.HEADING_MISSING_H1.explanation,
        suggestion: HEADINGS_CHECKS.HEADING_MISSING_H1.suggestion,
      });
      log.info(`Missing h1 element detected at ${url}`);
    } else if (h1Elements.length > 1) {
      checks.push({
        check: HEADINGS_CHECKS.HEADING_MULTIPLE_H1.check,
        success: false,
        explanation: HEADINGS_CHECKS.HEADING_MULTIPLE_H1.explanation,
        suggestion: HEADINGS_CHECKS.HEADING_MULTIPLE_H1.suggestion,
        count: h1Elements.length,
      });
      log.info(`Multiple h1 elements detected at ${url}: ${h1Elements.length} found`);
    }

    // Check for empty headings and collect text content for duplicate detection
    const headingTexts = new Map();
    for (const heading of headings) {
      const text = getTextContent(heading);
      if (text.length === 0) {
        checks.push({
          check: HEADINGS_CHECKS.HEADING_EMPTY.check,
          success: false,
          explanation: HEADINGS_CHECKS.HEADING_EMPTY.explanation,
          suggestion: HEADINGS_CHECKS.HEADING_EMPTY.suggestion,
          tagName: heading.tagName,
        });
        log.info(`Empty heading detected (${heading.tagName}) at ${url}`);
      } else {
        // Track heading text content for duplicate detection
        const lowerText = text.toLowerCase();
        if (!headingTexts.has(lowerText)) {
          headingTexts.set(lowerText, []);
        }
        headingTexts.get(lowerText).push({
          text,
          tagName: heading.tagName,
          element: heading,
        });
      }
    }

    // Check for duplicate heading text content
    // eslint-disable-next-line no-unused-vars
    for (const [lowerText, headingsWithSameText] of headingTexts) {
      if (headingsWithSameText.length > 1) {
        checks.push({
          check: HEADINGS_CHECKS.HEADING_DUPLICATE_TEXT.check,
          success: false,
          explanation: HEADINGS_CHECKS.HEADING_DUPLICATE_TEXT.explanation,
          suggestion: HEADINGS_CHECKS.HEADING_DUPLICATE_TEXT.suggestion,
          text: headingsWithSameText[0].text,
          duplicates: headingsWithSameText.map((h) => h.tagName),
          count: headingsWithSameText.length,
        });
        log.info(`Duplicate heading text detected at ${url}: "${headingsWithSameText[0].text}" found in ${headingsWithSameText.map((h) => h.tagName).join(', ')}`);
      }
    }

    // Check for headings without content before the next heading
    for (let i = 0; i < headings.length - 1; i += 1) {
      const currentHeading = headings[i];
      const nextHeading = headings[i + 1];

      if (!hasContentBetweenElements(currentHeading, nextHeading)) {
        checks.push({
          check: HEADINGS_CHECKS.HEADING_NO_CONTENT.check,
          success: false,
          explanation: HEADINGS_CHECKS.HEADING_NO_CONTENT.explanation,
          suggestion: HEADINGS_CHECKS.HEADING_NO_CONTENT.suggestion,
          heading: currentHeading.tagName,
          nextHeading: nextHeading.tagName,
        });
        log.info(`Heading without content detected at ${url}: ${currentHeading.tagName} has no content before ${nextHeading.tagName}`);
      }
    }

    if (headings.length > 1) {
      for (let i = 1; i < headings.length; i += 1) {
        const prev = headings[i - 1];
        const cur = headings[i];
        const prevLevel = getHeadingLevel(prev.tagName);
        const curLevel = getHeadingLevel(cur.tagName);
        if (curLevel - prevLevel > 1) {
          checks.push({
            check: HEADINGS_CHECKS.HEADING_ORDER_INVALID.check,
            success: false,
            explanation: HEADINGS_CHECKS.HEADING_ORDER_INVALID.explanation,
            suggestion: HEADINGS_CHECKS.HEADING_ORDER_INVALID.suggestion,
            previous: `h${prevLevel}`,
            current: `h${curLevel}`,
          });
          log.info(`Heading level jump detected at ${url}: h${prevLevel} → h${curLevel}`);
        }
      }
    }

    return { url, checks };
  } catch (error) {
    log.error(`Error validating headings for ${url}: ${error.message}`);
    return {
      url,
      checks: [],
    };
  }
}

/**
 * Main headings audit runner
 * @param {string} baseURL
 * @param {Object} context
 * @param {Object} site
 * @returns {Promise<Object>}
 */
export async function headingsAuditRunner(baseURL, context, site) {
  const siteId = site.getId();
  const { log, dataAccess } = context;
  log.info(`Starting Headings Audit with siteId: ${siteId}`);

  try {
    // Get top 200 pages
    const allTopPages = await getTopPagesForSiteId(dataAccess, siteId, context, log);
    const topPages = allTopPages.slice(0, 200);

    log.info(`Processing ${topPages.length} top pages for headings audit (limited to 200)`);

    if (topPages.length === 0) {
      log.info('No top pages found, ending audit.');
      return {
        fullAuditRef: baseURL,
        auditResult: {
          check: HEADINGS_CHECKS.TOPPAGES.check,
          success: false,
          explanation: HEADINGS_CHECKS.TOPPAGES.explanation,
        },
      };
    }

    // Validate headings for each page
    const auditPromises = topPages
      .map(async (page) => validatePageHeadings(page.url, log));
    const auditResults = await Promise.allSettled(auditPromises);

    // Aggregate results by check type
    const aggregatedResults = {};
    let totalIssuesFound = 0;

    auditResults.forEach((result) => {
      if (result.status === 'fulfilled' && result.value) {
        const { url, checks } = result.value;

        checks.forEach((check) => {
          if (!check.success) {
            totalIssuesFound += 1;
            const checkType = check.check;

            if (!aggregatedResults[checkType]) {
              aggregatedResults[checkType] = {
                success: false,
                explanation: check.explanation,
                suggestion: check.suggestion,
                urls: [],
              };
            }

            // Add URL if not already present
            if (!aggregatedResults[checkType].urls.includes(url)) {
              aggregatedResults[checkType].urls.push(url);
            }
          }
        });
      }
    });

    log.info(`Successfully completed Headings Audit for site: ${baseURL}. Found ${totalIssuesFound} issues across ${Object.keys(aggregatedResults).length} check types.`);

    // Return success if no issues found, otherwise return the aggregated results
    if (totalIssuesFound === 0) {
      return {
        fullAuditRef: baseURL,
        auditResult: { status: 'success', message: 'No heading issues detected' },
      };
    }

    return {
      fullAuditRef: baseURL,
      auditResult: aggregatedResults,
    };
  } catch (error) {
    log.error(`Headings audit failed: ${error.message}`);
    return {
      fullAuditRef: baseURL,
      auditResult: { error: `Audit failed with error: ${error.message}`, success: false },
    };
  }
}

export function generateSuggestions(auditUrl, auditData, context) {
  const { log } = context;
  if (auditData.auditResult?.status === 'success' || auditData.auditResult?.error) {
    log.info(`Headings audit for ${auditUrl} has no issues or failed, skipping suggestions generation`);
    return { ...auditData };
  }

  const suggestions = [];

  Object.entries(auditData.auditResult).forEach(([checkType, checkResult]) => {
    if (checkResult.success === false && Array.isArray(checkResult.urls)) {
      checkResult.urls.forEach((url) => {
        suggestions.push({
          type: 'CODE_CHANGE',
          checkType,
          explanation: checkResult.explanation,
          url,
          // eslint-disable-next-line no-use-before-define
          recommendedAction: generateRecommendedAction(checkType),
        });
      });
    }
  });

  log.info(`Generated ${suggestions.length} headings suggestions for ${auditUrl}`);
  return { ...auditData, suggestions };
}

function generateRecommendedAction(checkType) {
  switch (checkType) {
    case HEADINGS_CHECKS.HEADING_ORDER_INVALID.check:
      return 'Adjust heading levels to avoid skipping levels (for example, change h3 to h2 after an h1).';
    case HEADINGS_CHECKS.HEADING_EMPTY.check:
      return 'Provide meaningful text content for the empty heading or remove the element.';
    case HEADINGS_CHECKS.HEADING_DUPLICATE_TEXT.check:
      return 'Ensure each heading has unique, descriptive text content that clearly identifies its section.';
    case HEADINGS_CHECKS.HEADING_NO_CONTENT.check:
      return 'Add meaningful content (paragraphs, lists, images, etc.) after the heading before the next heading.';
    default:
      return 'Review heading structure and content to follow heading best practices.';
  }
}

export async function opportunityAndSuggestions(auditUrl, auditData, context) {
  const { log } = context;
  if (!auditData.suggestions?.length) {
    log.info('Headings audit has no issues, skipping opportunity creation');
    return { ...auditData };
  }

  const opportunity = await convertToOpportunity(
    auditUrl,
    auditData,
    context,
    createOpportunityData,
    auditType,
  );

  const buildKey = (suggestion) => `${suggestion.checkType}|${suggestion.url}`;

  await syncSuggestions({
    opportunity,
    newData: auditData.suggestions,
    context,
    buildKey,
    mapNewSuggestion: (suggestion) => ({
      opportunityId: opportunity.getId(),
      type: suggestion.type,
      rank: 0,
      data: {
        type: 'url',
        url: suggestion.url,
        checkType: suggestion.checkType,
        explanation: suggestion.explanation,
        recommendedAction: suggestion.recommendedAction,
      },
    }),
    log,
  });

  log.info(`Headings opportunity created and ${auditData.suggestions.length} suggestions synced for ${auditUrl}`);
  return { ...auditData };
}

export default new AuditBuilder()
  .withUrlResolver(noopUrlResolver)
  .withRunner(headingsAuditRunner)
  .withPostProcessors([generateSuggestions, opportunityAndSuggestions])
  .build();
