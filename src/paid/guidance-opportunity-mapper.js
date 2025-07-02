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

import { randomUUID } from 'crypto';
import { DATA_SOURCES } from '../common/constants.js';

function sanitizeMarkdown(markdown) {
  if (typeof markdown === 'string' && markdown.includes('\\n')) {
    return markdown.replace(/\\n/g, '\n');
  }
  return markdown;
}

function appendScreenshots(env, siteId, markdown, url) {
  const apiBase = env.SPACECAT_API_URI || 'https://spacecat.experiencecloud.live/api/v1';
  const urlPath = new URL(url).pathname;
  const suffix = urlPath === '/' ? '' : urlPath;

  const desktopScreenshot = `${apiBase}/sites/${siteId}/files?key=scrapes/${siteId}${suffix}/consent-banner-on/screenshot-desktop-viewport.png`;
  const mobileScreenshot = `${apiBase}/sites/${siteId}/files?key=scrapes/${siteId}${suffix}/consent-banner-on/screenshot-iphone-6-viewport.png`;

  const appendedSection = `
### Screenshots

| Mobile | Desktop |
|--------|---------|
| ![Mobile Screenshot](${mobileScreenshot}) | ![Desktop Screenshot](${desktopScreenshot}) |
`;

  return `${sanitizeMarkdown(markdown)}\n\n${appendedSection.trim()}\n`;
}

export function isLowSeverityGuidanceBody(body) {
  if (body.issueSeverity) {
    const sev = body.issueSeverity.toLowerCase();
    return sev === 'none' || sev === 'low';
  }

  return false;
}

export function mapToPaidOpportunity(siteId, url, audit, pageGuidance) {
  const stats = audit.getAuditResult();
  const urlSegment = stats.find((item) => item.key === 'url');
  const pageStats = urlSegment?.value.find((item) => item.url === url) || {};
  const pageTypeSegment = stats.find((item) => item.key === 'pageType');
  const pageTypeStats = pageTypeSegment?.value.find((item) => item.topURLs.includes(url)) || {};
  return {
    siteId,
    id: randomUUID(),
    auditId: audit.getAuditId(),
    type: 'generic-opportunity',
    origin: 'AUTOMATION',
    title: 'Cookie Consent Banner',
    description: `Insight: ${pageGuidance.insight}. Recommendation: ${pageGuidance.recommendation}`,
    guidance: {
      recommendations: [
        {
          insight: pageGuidance.insight,
          rationale: pageGuidance.rationale,
          recommendation: pageGuidance.recommendation,
          type: 'guidance',
        },
      ],
    },
    data: {
      dataSources: [
        DATA_SOURCES.SITE,
        DATA_SOURCES.RUM,
        DATA_SOURCES.PAGE,
      ],
      opportunityType: 'paid-cookie-consent',
      page: url,
      pageViews: pageStats.pageViews || 0,
      ctr: pageStats.ctr || 0,
      bounceRate: pageStats.bounceRate || 0,
      pageType: pageTypeStats?.type || 'unknown',
    },
    status: 'NEW',
    tags: [
      'Engagement',
    ],
  };
}

export function mapToPaidSuggestion(env, siteId, opportunityId, url, pageGuidance = []) {
  return {
    opportunityId,
    type: 'CONTENT_UPDATE',
    rank: 1,
    status: 'NEW',
    data: {
      recommendations: [
        {
          id: randomUUID(),
          pageUrl: url,
        },
      ],
      suggestionValue: appendScreenshots(env, siteId, pageGuidance.body.markdown, url),
    },
  };
}
