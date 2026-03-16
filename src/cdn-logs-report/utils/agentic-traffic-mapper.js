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
/* c8 ignore start */
import { joinBaseAndPath } from '../../utils/url-utils.js';
import { validateCountryCode } from './report-utils.js';
import { inferProviderFromUserAgent } from '../../common/user-agent-classification.js';

const capitalizeFirstLetter = (str) => {
  if (!str || typeof str !== 'string') return '';
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
};

function inferContentType(urlPath = '') {
  const path = String(urlPath).toLowerCase();
  if (/\.xml$/.test(path)) return 'XML';
  if (/\.pdf$/.test(path)) return 'PDF';
  if (/\.(html|htm)$/.test(path)) return 'HTML';
  if (/\.txt$/.test(path)) return 'TXT';
  if (!path || path.endsWith('/') || !path.split('/').pop().includes('.')) return 'HTML';
  return 'OTHER';
}

function buildCitabilityMap(citabilityScores = []) {
  return citabilityScores.reduce((acc, score) => {
    const { pathname } = new URL(score.getUrl());
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

function normalizeCategoryName(name) {
  return String(name || '').trim().toLowerCase();
}

function resolveCategoriesEndpoint(context) {
  const env = context?.env || process.env;
  const baseEndpoint = env.AGENTIC_API_BASE_ENDPOINT;
  if (!baseEndpoint) {
    return null;
  }

  try {
    const url = new URL(baseEndpoint);
    const basePath = url.pathname.replace(/\/+$/, '');
    url.pathname = `${basePath}/categories`;
    return url.toString();
  } catch {
    return null;
  }
}

function buildCategoryHeaders(context) {
  const env = context?.env || process.env;
  const headers = {};

  if (env.AGENTIC_TRAFFIC_API_KEY) {
    headers['x-api-key'] = env.AGENTIC_TRAFFIC_API_KEY;
  }

  if (env.AGENTIC_TRAFFIC_AUTH_TOKEN) {
    headers.Authorization = `Bearer ${env.AGENTIC_TRAFFIC_AUTH_TOKEN}`;
  }

  return headers;
}

async function fetchCategoryMap(siteId, context) {
  const endpoint = resolveCategoriesEndpoint(context);
  if (!endpoint) {
    context?.log?.warn?.('Category endpoint not configured; category_id will remain null');
    return new Map();
  }

  try {
    const url = new URL(endpoint);
    url.searchParams.set('site_id', `eq.${siteId}`);
    url.searchParams.set('select', 'id,name');

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: buildCategoryHeaders(context),
    });

    if (!response.ok) {
      const body = await response.text();
      context?.log?.warn?.(`Failed to fetch categories for site ${siteId}: ${response.status} ${body}`);
      return new Map();
    }

    const payload = await response.json();
    let categories = [];
    if (Array.isArray(payload)) {
      categories = payload;
    } else if (Array.isArray(payload?.data)) {
      categories = payload.data;
    }
    const map = new Map();
    categories.forEach((category) => {
      const key = normalizeCategoryName(category?.name);
      if (key && category?.id && !map.has(key)) {
        map.set(key, category.id);
      }
    });
    return map;
  } catch (error) {
    context?.log?.warn?.(`Error fetching categories for site ${siteId}: ${error.message}`);
    return new Map();
  }
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

export async function mapToAgenticTrafficRows(rows, site, context, trafficDate) {
  if (!Array.isArray(rows) || !site || !trafficDate) {
    return [];
  }

  const citabilityScores = await getCitabilityScores(site, context);
  const citabilityMap = buildCitabilityMap(citabilityScores);
  const categoryMap = await fetchCategoryMap(site.getId(), context);
  const baseURL = site.getConfig()?.getFetchConfig?.()?.overrideBaseURL || site.getBaseURL();

  return rows
    .map((row) => {
      const agentType = row.agent_type;
      if (!agentType || agentType === 'Other') {
        return null;
      }

      const hits = Number(row.number_of_hits) || 0;
      if (hits <= 0) {
        return null;
      }

      const urlPath = row.url === '-' ? '/' : (row.url || '');
      const { pathname } = new URL(joinBaseAndPath(baseURL, urlPath || '/'));
      const citability = citabilityMap[pathname];
      const dimensions = {};

      if (citability?.score !== undefined && citability?.score !== null) {
        dimensions.citability_score = citability.score;
      }

      if (citability?.isDeployedAtEdge !== undefined) {
        dimensions.deployed_at_edge = citability.isDeployedAtEdge;
      }

      const avgTtfb = Number(row.avg_ttfb_ms);

      const categoryName = capitalizeFirstLetter(row.product);
      const categoryId = categoryMap.get(normalizeCategoryName(categoryName)) || null;

      return {
        site_id: site.getId(),
        traffic_date: trafficDate,
        host: row.host || '',
        platform: inferProviderFromUserAgent(row.user_agent_display),
        agent_type: agentType,
        user_agent: row.user_agent_display || 'Unknown',
        http_status: Number(row.status) || 0,
        region: validateCountryCode(row.country_code),
        url_path: urlPath || '/',
        page_type: row.category || '',
        category_id: categoryId,
        category_name: categoryName,
        content_type: inferContentType(urlPath),
        hits,
        avg_ttfb_ms: Number.isFinite(avgTtfb) ? avgTtfb : null,
        dimensions,
        metrics: {},
        updated_by: 'system',
      };
    })
    .filter(Boolean);
}
/* c8 ignore end */
