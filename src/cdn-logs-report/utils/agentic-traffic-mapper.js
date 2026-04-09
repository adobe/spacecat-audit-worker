/*
 * Copyright 2026 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

import { joinBaseAndPath } from '../../utils/url-utils.js';
import { validateCountryCode } from './report-utils.js';
import { inferProviderFromUserAgent } from '../../common/user-agent-classification.js';

function normalizeText(value, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function normalizeLabel(value) {
  if (typeof value !== 'string') {
    return '';
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function inferContentType(urlPath = '') {
  const path = String(urlPath).toLowerCase();
  if (/\.(png|apng)$/.test(path)) {
    return 'png';
  }
  if (/\.(jpg|jpeg|jpe|jfif|pjpeg|pjp)$/.test(path)) {
    return 'jpg';
  }
  if (/\.gif$/.test(path)) {
    return 'gif';
  }
  if (/\.webp$/.test(path)) {
    return 'webp';
  }
  if (/\.svg$/.test(path)) {
    return 'svg';
  }
  if (/\.ico$/.test(path)) {
    return 'ico';
  }
  if (/\.bmp$/.test(path)) {
    return 'bmp';
  }
  if (/\.avif$/.test(path)) {
    return 'avif';
  }
  if (/\.xml$/.test(path)) {
    return 'xml';
  }
  if (/\.pdf$/.test(path)) {
    return 'pdf';
  }
  if (/\.(html|htm)$/.test(path)) {
    return 'html';
  }
  if (/\.txt$/.test(path)) {
    return 'txt';
  }
  if (!path || path.endsWith('/') || !path.split('/').pop().includes('.')) {
    return 'html';
  }
  return 'other';
}

function buildCitabilityMap(citabilityScores, log) {
  return (citabilityScores || []).reduce((acc, score) => {
    let pathname;
    try {
      ({ pathname } = new URL(score.getUrl()));
    } catch (error) {
      log?.warn?.(`Skipping malformed citability URL during agentic mapping: ${error.message}`);
      return acc;
    }
    const existingScore = acc[pathname];

    if (!existingScore || new Date(score.getUpdatedAt()) > new Date(existingScore.updatedAt)) {
      acc[pathname] = {
        score: score.getCitabilityScore(),
        isDeployedAtEdge: score.getIsDeployedAtEdge(),
        updatedAt: score.getUpdatedAt(),
      };
    }

    return acc;
  }, {});
}

async function getCitabilityScores(site, context) {
  const pageCitability = context?.dataAccess?.PageCitability;
  if (!pageCitability?.allBySiteId) {
    return [];
  }

  try {
    return await pageCitability.allBySiteId(site.getId());
  } catch (error) {
    context?.log?.warn?.(`Failed to fetch citability scores for agentic mapping: ${error.message}`);
    return [];
  }
}

export async function mapToAgenticTrafficBundle(rows, site, context, trafficDate) {
  if (!Array.isArray(rows) || !site || !trafficDate) {
    return {
      trafficRows: [],
      classificationRows: [],
    };
  }

  const siteIgnoreList = site.getConfig?.()?.getLlmoCountryCodeIgnoreList?.() || [];
  const citabilityScores = await getCitabilityScores(site, context);
  const citabilityMap = buildCitabilityMap(citabilityScores, context?.log);
  const baseURL = site.getConfig?.()?.getFetchConfig?.()?.overrideBaseURL || site.getBaseURL();
  const defaultHost = new URL(baseURL).host;
  const classificationMap = new Map();
  const trafficRows = rows
    .map((row) => {
      if (row.agent_type === 'Other') {
        return null;
      }

      const hits = Number(row.number_of_hits) || 0;
      if (hits <= 0) {
        return null;
      }

      const rawPath = row.url === '-' ? '/' : normalizeText(row.url, '/');
      const canonicalUrl = new URL(joinBaseAndPath(baseURL, rawPath || '/'));
      const urlPath = canonicalUrl.pathname;
      const host = normalizeText(row.host, defaultHost) || defaultHost;
      const citability = citabilityMap[urlPath];
      const dimensions = {};

      if (citability?.score !== undefined && citability?.score !== null) {
        dimensions.citability_score = citability.score;
      }

      if (citability?.isDeployedAtEdge !== undefined) {
        dimensions.deployed_at_edge = citability.isDeployedAtEdge;
      }

      const classificationKey = `${host}|${urlPath}`;
      if (!classificationMap.has(classificationKey)) {
        classificationMap.set(classificationKey, {
          host,
          url_path: urlPath,
          region: validateCountryCode(row.country_code, siteIgnoreList),
          category_name: normalizeLabel(row.product),
          page_type: normalizeText(row.category),
          content_type: inferContentType(urlPath),
          updated_by: 'audit-worker:agentic-daily-export',
        });
      }

      const avgTtfb = Number(row.avg_ttfb_ms);

      return {
        traffic_date: trafficDate,
        host,
        platform: inferProviderFromUserAgent(row.user_agent_display),
        agent_type: normalizeText(row.agent_type, 'Unknown'),
        user_agent: normalizeText(row.user_agent_display, 'Unknown'),
        http_status: Number(row.status) || 0,
        url_path: urlPath,
        hits,
        avg_ttfb_ms: Number.isFinite(avgTtfb) ? avgTtfb : null,
        dimensions,
        metrics: {},
        updated_by: 'audit-worker:agentic-daily-export',
      };
    })
    .filter(Boolean);

  return {
    trafficRows,
    classificationRows: Array.from(classificationMap.values()),
  };
}
