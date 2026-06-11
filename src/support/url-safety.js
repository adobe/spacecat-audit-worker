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

import dns from 'dns/promises';

/**
 * SSRF-related URL safety helpers. Lifted from src/site-detection/handler.js so
 * additional audits (e.g. llm-error-pages HEAD probes) can apply the same
 * private/loopback/link-local block list before fetching outbound URLs.
 *
 * NOTE: the site-detection module currently still uses its own private copies
 * of these helpers; both versions are kept in sync by hand for now to avoid
 * cross-audit churn.
 */

const IPV4_REGEX = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
// IPv4 dotted-quad OR IPv6 (8-group, basic — we also accept bracketed form below).
const IP_LITERAL_HOSTNAME_REGEX = /^(\d{1,3}(\.\d{1,3}){3})$|^([0-9a-fA-F:]+)$/;

/**
 * Detects IP literals that point at private / loopback / link-local / CGNAT
 * ranges, or at IPv6 equivalents. Used to block SSRF via hostnames that
 * DNS-resolve to internal addresses (e.g. corp hosts, AWS metadata at
 * 169.254.169.254, Docker bridge networks).
 *
 * Treats non-string input as private (conservative default).
 *
 * @param {string} address
 * @returns {boolean}
 */
export function isPrivateIP(address) {
  if (typeof address !== 'string') {
    return true;
  }

  // IPv4
  const v4 = address.match(IPV4_REGEX);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    return a === 10
      || a === 127
      || a === 0
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 100 && b >= 64 && b <= 127)
      || a >= 224;
  }

  // IPv6 — reject loopback, link-local, ULA, and v4-mapped addresses whose
  // embedded v4 is private.
  const lower = address.toLowerCase();
  if (lower === '::1' || lower === '::') {
    return true;
  }
  // Link-local is fe80::/10 (fe80–febf). Multicast is ff00::/8.
  if (/^fe[89ab][0-9a-f]:/.test(lower) || lower.startsWith('ff')) {
    return true;
  }
  if (lower.startsWith('fc') || lower.startsWith('fd')) {
    return true;
  }
  const v4Mapped = lower.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (v4Mapped) {
    return isPrivateIP(v4Mapped[1]);
  }

  return false;
}

/**
 * Resolves all A/AAAA records for a hostname and returns true if every resolved
 * address is public. Logs (but does not surface) the reason on rejection.
 *
 * @param {string} hostname
 * @param {Object} log
 * @returns {Promise<boolean>}
 */
export async function resolvesToPublicAddress(hostname, log) {
  let addresses;
  try {
    addresses = await dns.lookup(hostname, { all: true });
  } catch (e) {
    log.warn(`[url-safety] DNS lookup failed for ${hostname}: ${e.message}`);
    return false;
  }

  if (!Array.isArray(addresses) || addresses.length === 0) {
    log.warn(`[url-safety] No addresses resolved for ${hostname}`);
    return false;
  }

  for (const { address } of addresses) {
    if (isPrivateIP(address)) {
      log.warn(`[url-safety] ${hostname} resolves to a non-public address; rejecting`);
      return false;
    }
  }

  return true;
}

/**
 * Convenience guard for outbound HTTP probes. Rejects:
 *  - non-http(s) URLs (file:, gopher:, ftp:, javascript:, data:, etc.)
 *  - malformed URLs
 *  - URLs whose host is an IP literal in a private/loopback/link-local range
 *  - URLs whose hostname resolves to a non-public address
 *
 * @param {string} url
 * @param {Object} log
 * @returns {Promise<boolean>}
 */
export async function isUrlSafeToFetch(url, log) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch (e) {
    log.warn?.(`[url-safety] invalid URL ${url}: ${e.message}`);
    return false;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    log.warn?.(`[url-safety] rejecting non-http(s) URL: ${url}`);
    return false;
  }

  // WHATWG URL keeps the brackets on IPv6 literal hostnames (e.g. "[::1]"); strip them.
  // http(s) URLs always carry a non-empty hostname after WHATWG parsing — the URL
  // constructor throws on `http://` with no host — so we don't re-check for empty here.
  const rawHost = parsed.hostname;
  const host = rawHost.startsWith('[') && rawHost.endsWith(']')
    ? rawHost.slice(1, -1)
    : rawHost;

  // If the host is itself an IP literal, skip DNS and check directly. Otherwise
  // a private IP in URL form would still pass resolvesToPublicAddress (because
  // dns.lookup happily returns the literal back).
  if (IP_LITERAL_HOSTNAME_REGEX.test(host)) {
    if (isPrivateIP(host)) {
      log.warn?.(`[url-safety] rejecting URL with private IP literal host: ${url}`);
      return false;
    }
    return true;
  }

  return resolvesToPublicAddress(host, log);
}
