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

/**
 * CDN detection from HTTP headers, DNS (resolver and DNS-over-HTTPS), ASN lookup (ipinfo),
 * PTR records, and keyword matching on hostnames and header-derived strings.
 */
import dns from 'node:dns';
import { SPACECAT_USER_AGENT } from '@adobe/spacecat-shared-utils';

const dnsPromises = dns.promises;

/**
 * CDN identification by CNAME domain suffix (used when headers are missing).
 * Order matters: first match wins. Use lowercase domain fragments.
 */
const CDN_DOMAIN_SIGNATURES = [
  { domains: ['cloudflare.com'], cdn: 'Cloudflare' },
  { domains: ['fastly.net'], cdn: 'Fastly' },
  { domains: ['cloudfront.net'], cdn: 'CloudFront' },
  { domains: ['akamai.net', 'akamaized.net', 'edgesuite.net', 'akamaitechnologies.com', 'akamaiedge.net'], cdn: 'Akamai' },
  { domains: ['azureedge.net', 'msecnd.net'], cdn: 'Azure Front Door / Azure CDN' },
  { domains: ['googleusercontent.com'], cdn: 'Google Cloud CDN' },
  { domains: ['alicdn.com', 'yundunwaf3.com'], cdn: 'Alibaba Cloud CDN' },
];

/**
 * CDN identification by ASN when the CNAME chain does not match a known provider domain.
 */
const CDN_ASN_SIGNATURES = [
  { asns: [13335], cdn: 'Cloudflare' },
  { asns: [54113], cdn: 'Fastly' },
  { asns: [16509], cdn: 'CloudFront' },
  { asns: [20940, 16625, 21342], cdn: 'Akamai' },
  { asns: [8075], cdn: 'Azure Front Door / Azure CDN' },
  { asns: [15169], cdn: 'Google Cloud CDN' },
  { asns: [24429, 37963], cdn: 'Alibaba Cloud CDN' },
];

/**
 * Substring keywords matched against lowercased DNS names, header-derived text, and PTR names.
 * First matching pattern wins.
 */
const CDN_KEYWORD_SIGNATURES = [
  { patterns: ['clever-cloud', 'clever cloud'], cdn: 'Clever Cloud' },
  { patterns: ['cloudflare'], cdn: 'Cloudflare' },
  { patterns: ['incapsula', 'imperva'], cdn: 'Imperva' },
  { patterns: ['cloudfront'], cdn: 'CloudFront' },
  { patterns: ['akamai', 'akamaiedge', 'edgesuite', 'edgekey', 'akamaitechnologies'], cdn: 'Akamai' },
  { patterns: ['airee'], cdn: 'Airee' },
  { patterns: ['cachefly'], cdn: 'CacheFly' },
  { patterns: ['edgecast'], cdn: 'EdgeCast' },
  { patterns: ['maxcdn', 'netdna'], cdn: 'StackPath' },
  { patterns: ['beluga'], cdn: 'BelugaCDN' },
  { patterns: ['limelight', 'llnw'], cdn: 'Limelight' },
  { patterns: ['fastly'], cdn: 'Fastly' },
  { patterns: ['myracloud', 'myrasec'], cdn: 'Myra' },
  { patterns: ['msecnd'], cdn: 'Azure Front Door / Azure CDN' },
];

/**
 * Detects CDN by substring match; input is lowercased before matching.
 *
 * @param {string} text - Hostnames, joined header values, or similar.
 * @returns {string|null} CDN name or null.
 */
export function matchCdnByKeywords(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    return null;
  }
  const lower = text.toLowerCase();
  for (const { patterns, cdn } of CDN_KEYWORD_SIGNATURES) {
    if (patterns.some((p) => lower.includes(p))) {
      return cdn;
    }
  }
  return null;
}

/**
 * Detects CDN from HTTP response headers. Expects lowercase header names in `headers`.
 *
 * @param {Record<string, string>} headers - Lowercase header name to value.
 * @returns {string} CDN name or 'unknown'.
 */
export function detectCdnFromHeaders(headers) {
  if (!headers || typeof headers !== 'object') {
    return 'unknown';
  }

  const get = (name) => {
    const v = headers[name];
    return typeof v === 'string' ? v : '';
  };

  const has = (name) => get(name).length > 0;
  const match = (name, re) => re.test(get(name));
  const hasKey = (prefix) => Object.keys(headers).some((k) => k.toLowerCase().startsWith(prefix));

  if (has('cf-ray') || match('cf-cache-status', /./) || match('server', /cloudflare/i)) {
    return 'Cloudflare';
  }
  if (hasKey('x-akamai-') || has('akamai-origin-hop') || match('server', /akamaighost/i) || has('x-akamai-transformed')) {
    return 'Akamai';
  }
  if (has('x-served-by') || has('x-fastly-request-id') || has('fastly-ff') || has('fastly-debug-digest') || match('via', /fastly/i)) {
    return 'Fastly';
  }
  if (has('x-amz-cf-id') || has('x-amz-cf-pop') || match('via', /cloudfront/i)) {
    return 'CloudFront';
  }
  if (has('x-azure-ref')) {
    return 'Azure Front Door / Azure CDN';
  }
  if (has('x-ec-debug')) {
    return 'Azure CDN';
  }
  if (has('x-fd-healthprobe')) {
    return 'Azure Front Door';
  }
  if (match('via', /google/i) || hasKey('x-goog-')) {
    return 'Google Cloud CDN';
  }
  if (has('x-iinfo') || match('x-cdn', /incapsula|imperva/i)) {
    return 'Imperva';
  }
  if (has('x-vercel-id') || match('server', /vercel/i)) {
    return 'Vercel';
  }
  if (has('x-nf-request-id') || match('server', /netlify/i)) {
    return 'Netlify';
  }
  if (has('x-edge-location') || match('server', /keycdn/i)) {
    return 'KeyCDN';
  }
  if (has('x-llid') || has('x-llrid')) {
    return 'Limelight';
  }
  if (has('x-cdn-request-id')) {
    return 'CDNetworks';
  }
  if (hasKey('x-bunny-')) {
    return 'Bunny CDN';
  }
  if (match('server', /netdna/i)) {
    return 'StackPath';
  }
  if (has('x-sucuri-id')) {
    return 'Sucuri';
  }

  const keywordBlob = [
    get('server'),
    get('via'),
    get('x-cache'),
    get('x-cdn'),
    get('x-cdn-forward'),
    get('x-powered-by'),
  ]
    .filter(Boolean)
    .join(' ');
  const fromKeywords = matchCdnByKeywords(keywordBlob);
  if (fromKeywords) {
    return fromKeywords;
  }

  return 'unknown';
}

/**
 * Builds a lowercase header map from a fetch Response and runs CDN detection.
 * For GET responses, cancels the body stream so the full response is not downloaded.
 *
 * @param {Response} response - Fetch Response (HEAD or GET).
 * @returns {{ cdn: string }}
 */
function headersFromResponse(response) {
  const headers = {};
  response.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });
  const cdn = detectCdnFromHeaders(headers);
  if (response.body && typeof response.body.cancel === 'function') {
    response.body.cancel();
  }
  return { cdn };
}

/** Google Public DNS JSON API over HTTPS; used when the system resolver fails or times out. */
const DOH_GOOGLE_RESOLVE = 'https://dns.google/resolve';

/**
 * @param {string} name - Hostname to query.
 * @param {number} typeNum - DNS type (1=A, 5=CNAME).
 * @param {Function} fetchFn - Fetch implementation.
 * @param {object} [opts] - timeout, log.
 * @returns {Promise<{ Answer?: Array<{ type: number, data: string }> }>}
 */
async function dohQuery(name, typeNum, fetchFn, opts = {}) {
  const { timeout = 5000, log } = opts;
  const url = `${DOH_GOOGLE_RESOLVE}?name=${encodeURIComponent(name)}&type=${typeNum}`;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetchFn(url, {
      signal: controller.signal,
      headers: { Accept: 'application/dns-json' },
    });
    clearTimeout(id);
    if (!response.ok) {
      return { Answer: [] };
    }
    const data = await response.json();
    return data && Array.isArray(data.Answer) ? data : { Answer: [] };
  } catch (err) {
    clearTimeout(id);
    log?.warn?.('[detect-cdn] DoH query failed', { name, type: typeNum, message: err?.message });
    return { Answer: [] };
  }
}

function normalizeDohName(data) {
  if (typeof data !== 'string') {
    return '';
  }
  return data.replace(/\.$/, '').trim();
}

/**
 * CNAME chain resolution via DNS-over-HTTPS (Google Public DNS JSON API).
 * @param {string} hostname - Hostname to resolve.
 * @param {Function} fetchFn - Fetch implementation.
 * @param {object} [log] - Optional logger.
 * @returns {Promise<string[]>} Hostnames in the CNAME chain (including original).
 */
export async function getCnameChainDoh(hostname, fetchFn, log) {
  const chain = [];
  let current = hostname.replace(/\.$/, '');
  const maxHops = 10;

  /* eslint-disable no-await-in-loop -- Each CNAME hop depends on the previous answer. */
  for (let hop = 0; hop < maxHops; hop += 1) {
    chain.push(current);
    const { Answer = [] } = await dohQuery(current, 5, fetchFn, { timeout: 5000, log });
    const cname = Answer.find((a) => a.type === 5);
    if (!cname?.data) {
      break;
    }
    current = normalizeDohName(cname.data);
    if (!current) {
      break;
    }
  }
  /* eslint-enable no-await-in-loop */

  return chain;
}

/**
 * First IPv4 from A-record lookup via DNS-over-HTTPS.
 * @param {string} hostname - Hostname to resolve.
 * @param {Function} fetchFn - Fetch implementation.
 * @param {object} [log] - Optional logger.
 * @returns {Promise<string|null>}
 */
export async function getOneIpDoh(hostname, fetchFn, log) {
  const { Answer = [] } = await dohQuery(hostname, 1, fetchFn, { timeout: 5000, log });
  const ipv4 = /^(\d{1,3}\.){3}\d{1,3}$/;
  for (const a of Answer) {
    if (a.type === 1 && typeof a.data === 'string' && ipv4.test(a.data)) {
      return a.data;
    }
  }
  return null;
}

/**
 * Resolves CNAME chain for a hostname (max 10 hops). Returns list of hostnames in the chain.
 * @param {string} hostname - Hostname to resolve.
 * @param {object} [log] - Optional logger.
 * @returns {Promise<string[]>} Hostnames in the CNAME chain (including original).
 */
export async function getCnameChain(hostname, log) {
  const chain = [];
  let current = hostname.replace(/\.$/, '');
  const maxHops = 10;

  /* eslint-disable no-await-in-loop -- Each CNAME hop depends on the previous answer. */
  for (let hop = 0; hop < maxHops; hop += 1) {
    chain.push(current);
    try {
      const results = await dnsPromises.resolve(current, 'CNAME');
      if (!results || results.length === 0) {
        break;
      }
      current = results[0].replace(/\.$/, '');
    } catch (err) {
      if (err?.code === 'ENODATA' || err?.code === 'ENOTFOUND') {
        break;
      }
      log?.warn?.('[detect-cdn] CNAME resolve error', { hostname: current, code: err?.code });
      break;
    }
  }
  /* eslint-enable no-await-in-loop */

  return chain;
}

/**
 * Resolves hostname to one IPv4 address for ASN lookup.
 * @param {string} hostname - Hostname to resolve.
 * @param {object} [log] - Optional logger.
 * @returns {Promise<string|null>} One IP or null.
 */
export async function getOneIp(hostname, log) {
  try {
    const addresses = await dnsPromises.resolve4(hostname);
    return addresses && addresses.length > 0 ? addresses[0] : null;
  } catch (err) {
    log?.warn?.('[detect-cdn] resolve4 error', { hostname, code: err?.code });
    return null;
  }
}

/**
 * Reverse DNS (PTR) lookup for an IPv4 address; used when ASN does not map to a known CDN.
 *
 * @param {string} ip - IPv4 address.
 * @param {object} [log] - Optional logger.
 * @returns {Promise<string[]>} PTR hostnames (may be empty).
 */
export async function getPtrHostnames(ip, log) {
  try {
    const hosts = await dnsPromises.reverse(ip);
    return Array.isArray(hosts) && hosts.length > 0 ? hosts : [];
  } catch (err) {
    log?.warn?.('[detect-cdn] reverse DNS failed', { ip, code: err?.code });
    return [];
  }
}

/**
 * Looks up ASN for an IP via ipinfo.io (free tier). Returns ASN number or null.
 * @param {string} ip - IPv4 address.
 * @param {Function} fetchFn - Fetch implementation.
 * @param {object} [options] - Optional timeout, log.
 * @returns {Promise<number|null>} ASN or null.
 */
export async function getAsnForIp(ip, fetchFn, options = {}) {
  const { timeout = 10000, log } = options;
  const url = `https://ipinfo.io/${ip}/json`;

  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetchFn(url, { signal: controller.signal });
    clearTimeout(id);
    if (!response.ok) {
      return null;
    }
    const data = await response.json();
    const org = data?.org;
    if (typeof org !== 'string') {
      return null;
    }
    const match = org.match(/^AS(\d+)/);
    return match ? parseInt(match[1], 10) : null;
  } catch (err) {
    clearTimeout(id);
    log?.warn?.('[detect-cdn] ASN lookup failed', { ip, message: err?.message });
    return null;
  }
}

/**
 * Matches a CNAME chain against known CDN domain signatures.
 * @param {string[]} cnameChain - Hostnames from getCnameChain.
 * @returns {string|null} CDN name or null.
 */
export function matchCdnByCname(cnameChain) {
  if (!Array.isArray(cnameChain) || cnameChain.length === 0) {
    return null;
  }
  for (const { domains, cdn } of CDN_DOMAIN_SIGNATURES) {
    for (const hostname of cnameChain) {
      const lower = hostname.toLowerCase();
      if (domains.some((d) => lower.includes(d))) {
        return cdn;
      }
    }
  }
  return null;
}

/**
 * Matches an ASN number against known CDN ASN signatures.
 * @param {number} asn - Autonomous System Number.
 * @returns {string|null} CDN name or null.
 */
export function matchCdnByAsn(asn) {
  if (typeof asn !== 'number' || Number.isNaN(asn)) {
    return null;
  }
  for (const { asns, cdn } of CDN_ASN_SIGNATURES) {
    if (asns.includes(asn)) {
      return cdn;
    }
  }
  return null;
}

/**
 * Fallback CDN detection using DNS (CNAME chain) and optionally ASN when headers
 * did not identify the CDN. Used only when detectCdnFromHeaders returns 'unknown'.
 *
 * @param {string} url - URL (hostname is extracted for DNS lookups).
 * @param {Function} fetchFn - Fetch implementation (for ASN lookup).
 * @param {object} [options] - Optional timeout, log.
 * @returns {Promise<{ cdn: string }>} Detected CDN or { cdn: 'unknown' }.
 */
export async function detectCdnFromDnsFallback(url, fetchFn, options = {}) {
  const { log } = options;
  let hostname;
  try {
    const toParse = (url.startsWith('http') || url.startsWith('file:')) ? url : `https://${url}`;
    const u = new URL(toParse);
    hostname = u.hostname;
  } catch {
    return { cdn: 'unknown' };
  }

  if (!hostname || hostname.trim() === '') {
    return { cdn: 'unknown' };
  }

  const cnameChainSystem = await getCnameChain(hostname, log);
  let cdnFromCname = matchCdnByCname(cnameChainSystem);
  if (cdnFromCname) {
    log?.info?.('[detect-cdn] Fallback: detected by CNAME', { cdn: cdnFromCname, hostname });
    return { cdn: cdnFromCname };
  }
  const cdnFromChainKw = matchCdnByKeywords(cnameChainSystem.join(' '));
  if (cdnFromChainKw) {
    log?.info?.('[detect-cdn] Fallback: detected by DNS name keywords', { cdn: cdnFromChainKw, hostname });
    return { cdn: cdnFromChainKw };
  }

  const cnameChainDoh = await getCnameChainDoh(hostname, fetchFn, log);
  cdnFromCname = matchCdnByCname(cnameChainDoh);
  if (cdnFromCname) {
    log?.info?.('[detect-cdn] Fallback: detected by CNAME (DoH)', { cdn: cdnFromCname, hostname });
    return { cdn: cdnFromCname };
  }
  const cdnFromDohKw = matchCdnByKeywords(cnameChainDoh.join(' '));
  if (cdnFromDohKw) {
    log?.info?.('[detect-cdn] Fallback: detected by DNS name keywords (DoH)', { cdn: cdnFromDohKw, hostname });
    return { cdn: cdnFromDohKw };
  }

  const ip = (await getOneIp(hostname, log)) || (await getOneIpDoh(hostname, fetchFn, log));
  if (ip) {
    const asn = await getAsnForIp(ip, fetchFn, { timeout: 10000, log });
    const cdnFromAsn = asn !== null ? matchCdnByAsn(asn) : null;
    if (cdnFromAsn) {
      log?.info?.('[detect-cdn] Fallback: detected by ASN', { cdn: cdnFromAsn, asn });
      return { cdn: cdnFromAsn };
    }

    const ptrHostnames = await getPtrHostnames(ip, log);
    for (const ptr of ptrHostnames) {
      const fromPtrKw = matchCdnByKeywords(ptr);
      if (fromPtrKw) {
        // String log line with JSON payload (mirrors the PTR CNAME branch).
        log?.info?.(
          `[detect-cdn] Fallback: detected by PTR keywords ${JSON.stringify({ cdn: fromPtrKw, ip, ptr })}`,
        );
        return { cdn: fromPtrKw };
      }
      const fromPtrCname = matchCdnByCname([ptr]);
      if (fromPtrCname) {
        log?.info?.(
          `[detect-cdn] Fallback: detected by PTR CNAME signature ${JSON.stringify({ cdn: fromPtrCname, ip, ptr })}`,
        );
        return { cdn: fromPtrCname };
      }
    }
  }

  return { cdn: 'unknown' };
}

/**
 * Fetches the URL (HEAD, then GET on failure), detects CDN from headers, then DNS/ASN fallback.
 * GET retry covers servers that close or truncate HEAD; only response headers are used from GET.
 *
 * @param {string} url - URL to request (redirects followed).
 * @param {Function} fetchFn - Fetch implementation.
 * @param {object} [options] - Optional timeout, userAgent, log.
 * @returns {Promise<{ cdn: string, error?: string }>} Detected CDN or error.
 */
export async function detectCdnFromUrl(url, fetchFn, options = {}) {
  const { timeout = 10000, userAgent = SPACECAT_USER_AGENT, log } = options;

  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  const fetchOptions = {
    redirect: 'follow',
    headers: { 'User-Agent': userAgent },
    signal: controller.signal,
  };

  let result;
  try {
    const response = await fetchFn(url, { ...fetchOptions, method: 'HEAD' });
    clearTimeout(id);
    result = headersFromResponse(response);
  } catch (headError) {
    clearTimeout(id);
    const headMessage = headError?.message || String(headError);
    log?.warn?.('[detect-cdn] HEAD request failed (%s), retrying with GET: %s', headMessage, url);

    const getController = new AbortController();
    const getTimeoutId = setTimeout(() => getController.abort(), timeout);
    try {
      const response = await fetchFn(url, { ...fetchOptions, method: 'GET', signal: getController.signal });
      clearTimeout(getTimeoutId);
      result = headersFromResponse(response);
    } catch (getError) {
      clearTimeout(getTimeoutId);
      const message = getError?.message || String(getError);
      result = { cdn: 'unknown', error: message };
    }
  }

  if (result.cdn === 'unknown') {
    const fallback = await detectCdnFromDnsFallback(url, fetchFn, { log });
    if (fallback.cdn !== 'unknown') {
      return { cdn: fallback.cdn, error: result.error };
    }
  }

  return result;
}
