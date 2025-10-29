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

// ex: https://github.com/adobe/aem-boilerplate/blob/main/404.html
const PATTERNS_FOR_404_PAGES = ['/404', '/404/', '/404.html', '/404.htm'];

// ----- utils (stand-alone) -----------------------------------------------------------------------

/**
 * Returns true if the URL ends with any common 404-page patterns.
 * @param {string} url - The URL to check
 * @returns {boolean} true if the URL ends with a 404 pattern, false otherwise
 */
export function is404page(url) {
  return PATTERNS_FOR_404_PAGES.some((pattern) => url.endsWith(pattern));
}

/**
 * Checks if a URL has a protocol.
 * Examples of protocols: {http, https, ftp, mailto, telnet, file, ...}
 *
 * @param {string} url - The URL to check
 * @returns {boolean} true if the URL has a protocol, false otherwise
 */
export function hasProtocol(url) {
  try {
    return Boolean(new URL(url).protocol);
  } catch {
    return false;
  }
}

/**
 * Adds 'www.' to the beginning of the hostname of a URL if it is not already present AND if
 * the hostname doesn't already have a subdomain.
 * Preserves any protocol that is present, but does not add 'http://' or 'https://' if missing.
 *
 * Examples:
 *    given:   adobe.com
 *    returns: www.adobe.com          // since no protocol was specified, none is returned
 *
 *    given:   https://adobe.com
 *    returns: https://www.adobe.com  // keeps the protocol
 *
 *    given:   foo.adobe.com
 *    returns: foo.adobe.com          // no 'www.' added because URL already has subdomain
 *
 *    given:   www.adobe.com
 *    returns: www.adobe.com          // no change needed
 *
 *    given:   https://www.adobe.com
 *    returns: https://www.adobe.com  // no change needed
 *
 * @param {string} url - The URL to modify, if needed
 * @returns {string} The modified URL
 */
export function addWWW(url) {
  try {
    let theUrl = url;

    let removeProtocol = false; // assume we do not need to remove the protocol
    const keepTrailingSlash = theUrl.endsWith('/');

    if (!hasProtocol(theUrl)) {
      // if the URL does not have a protocol, we need to add it
      theUrl = `https://${theUrl}`;
      removeProtocol = true; // we will remove the protocol later
    }

    const urlObj = new URL(theUrl);
    const hostnameParts = urlObj.hostname.split('.');

    // Only add 'www.' if all the following are true:
    // 1. Hostname does not already start with 'www.'
    // 2. Hostname has exactly 2 parts (like: example.com)
    if (!urlObj.hostname.startsWith('www.') && hostnameParts.length === 2) {
      urlObj.hostname = `www.${urlObj.hostname}`;
    }

    theUrl = urlObj.toString(); // will be the original URL if no changes were made
    if (removeProtocol) {
      theUrl = theUrl.replace(/^https:\/\//, '');
    }
    if (!keepTrailingSlash) {
      theUrl = theUrl.replace(/\/$/, '');
    }
    return theUrl;
  } catch {
    return url; // return the original URL if invalid
  }
}

/**
 * Returns a reasonable URL.
 * * If missing a domain, add the given domain
 * * If missing a protocol, add 'https://'
 * * Ensure the URL's hostname starts with 'www.' as needed.
 *
 * Examples:
 *    url:     adobe.com
 *    domain:  (not specified)
 *    returns: https://www.adobe.com
 *  *
 *    url:    /patents
 *    domain: main--example--aemsites.hlx.page
 *    return: https://main--example--aemsites.hlx.page/patents
 *  *
 * @param {string} url - The URL to possibly transform
 * @param {string} domain - Optional. The domain to prepend if missing
 * @returns {string} A reasonable URL
 */
export function ensureFullUrl(url, domain = '') {
  let addWwwSubdomain = !domain; // if no domain is specified, we might need to add 'www.'
  let reasonableUrl = url;

  if (domain && !reasonableUrl.startsWith(domain) && !hasProtocol(reasonableUrl)) {
    // Ensure exactly one forward slash between the domain and reasonableUrl
    const domainEndsWithSlash = domain.endsWith('/');
    const urlStartsWithSlash = reasonableUrl.startsWith('/');

    if (domainEndsWithSlash && urlStartsWithSlash) {
      // Both have slashes, so remove one to avoid double slash
      reasonableUrl = domain + reasonableUrl.substring(1);
    } else if (!domainEndsWithSlash && !urlStartsWithSlash) {
      // Neither has a slash, so add one
      reasonableUrl = `${domain}/${reasonableUrl}`;
    } else {
      // Only one has a slash, so concatenate directly
      reasonableUrl = domain + reasonableUrl;
    }
    addWwwSubdomain = true; // add 'www.' if needed
  }

  if (hasProtocol(reasonableUrl)) {
    addWwwSubdomain = false; // do not add 'www.' if the URL already has a protocol
  } else {
    reasonableUrl = `https://${reasonableUrl}`;
  }

  if (addWwwSubdomain) {
    reasonableUrl = addWWW(reasonableUrl);
  }
  return reasonableUrl;
}

/**
 * Calculates the byte length of a string in UTF-8 encoding.
 * This is a utility function to standardize the calculation of string sizes.
 *
 * @param {string} theString - The string to measure
 * @returns {number} The byte length of the string in UTF-8 encoding
 */
export function getStringByteLength(theString) {
  return Buffer.byteLength(theString, 'utf8');
}
