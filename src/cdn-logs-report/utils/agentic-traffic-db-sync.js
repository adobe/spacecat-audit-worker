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
function resolveTableEndpoint(context) {
  const env = context?.env || process.env;
  const baseEndpoint = env.AGENTIC_API_BASE_ENDPOINT;

  if (!baseEndpoint) {
    throw new Error('Missing AGENTIC_API_BASE_ENDPOINT');
  }

  const url = new URL(baseEndpoint);
  const basePath = url.pathname.replace(/\/+$/, '');
  url.pathname = `${basePath}/agentic_traffic`;

  return url.toString();
}

function buildHeaders(context) {
  const env = context?.env || process.env;
  const headers = { 'Content-Type': 'application/json' };

  if (env.AGENTIC_TRAFFIC_API_KEY) {
    headers['x-api-key'] = env.AGENTIC_TRAFFIC_API_KEY;
  }

  if (env.AGENTIC_TRAFFIC_AUTH_TOKEN) {
    headers.Authorization = `Bearer ${env.AGENTIC_TRAFFIC_AUTH_TOKEN}`;
  }

  return headers;
}

function withPostgrestDateSiteFilters(urlString, siteId, trafficDate) {
  const url = new URL(urlString);
  url.searchParams.set('site_id', `eq.${siteId}`);
  url.searchParams.set('traffic_date', `eq.${trafficDate}`);
  return url.toString();
}

function extractCount(data) {
  if (Array.isArray(data)) return data.length;
  if (Array.isArray(data?.data)) return data.data.length;
  if (typeof data?.count === 'number') return data.count;
  return 0;
}

function getChunkSize(context, auditContext = {}) {
  const fromAuditContext = Number(auditContext?.agenticTrafficChunkSize);
  const fromEnv = Number((context?.env || process.env).AGENTIC_TRAFFIC_CHUNK_SIZE);
  const raw = Number.isInteger(fromAuditContext) && fromAuditContext > 0
    ? fromAuditContext
    : fromEnv;

  return Number.isInteger(raw) && raw > 0 ? raw : 2000;
}

function splitIntoChunks(rows, chunkSize) {
  const chunks = [];
  for (let i = 0; i < rows.length; i += chunkSize) {
    chunks.push(rows.slice(i, i + chunkSize));
  }
  return chunks;
}

async function readExistingRows({
  getEndpoint, headers, siteId, trafficDate,
}) {
  const url = new URL(withPostgrestDateSiteFilters(getEndpoint, siteId, trafficDate));
  url.searchParams.set('select', 'id');
  url.searchParams.set('limit', '1');

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GET failed (${response.status}): ${body}`);
  }

  const payload = await response.json();
  return extractCount(payload);
}

async function deleteExistingRows({
  deleteEndpoint, headers, siteId, trafficDate,
}) {
  const response = await fetch(withPostgrestDateSiteFilters(deleteEndpoint, siteId, trafficDate), {
    method: 'DELETE',
    headers: {
      ...headers,
      Prefer: 'return=minimal',
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`DELETE failed (${response.status}): ${body}`);
  }
}

async function insertRows({ postEndpoint, headers, rows }) {
  if (!rows || rows.length === 0) {
    return { insertedRows: 0, chunkCount: 0 };
  }

  const response = await fetch(postEndpoint, {
    method: 'POST',
    headers: {
      ...headers,
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(rows),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`POST failed (${response.status}): ${body}`);
  }

  return { insertedRows: rows.length, chunkCount: 1 };
}

export async function syncAgenticTrafficToDb({
  context,
  auditContext,
  siteId,
  trafficDate,
  rows,
}) {
  const tableEndpoint = resolveTableEndpoint(context);
  const headers = buildHeaders(context);

  const existingCount = await readExistingRows({
    getEndpoint: tableEndpoint,
    headers,
    siteId,
    trafficDate,
  });

  const shouldDelete = existingCount > 0;
  if (shouldDelete) {
    await deleteExistingRows({
      deleteEndpoint: tableEndpoint,
      headers,
      siteId,
      trafficDate,
    });
  }

  const chunkSize = getChunkSize(context, auditContext);
  const chunks = splitIntoChunks(rows, chunkSize);
  let insertedRows = 0;

  for (const chunk of chunks) {
    // eslint-disable-next-line no-await-in-loop
    const result = await insertRows({
      postEndpoint: tableEndpoint,
      headers,
      rows: chunk,
    });
    insertedRows += result.insertedRows;
  }

  return {
    source: 'db-endpoints',
    existingRows: existingCount,
    deletedExisting: shouldDelete,
    insertedRows,
    chunkSize,
    chunkCount: chunks.length,
  };
}
/* c8 ignore end */
