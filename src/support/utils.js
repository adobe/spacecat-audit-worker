/*
 * Copyright 2023 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */
import { context as h2, h1 } from '@adobe/fetch';

/* c8 ignore next 3 */
export const { fetch } = process.env.HELIX_FETCH_FORCE_HTTP1
  ? h1()
  : h2();

// weekly pageview threshold to eliminate urls with lack of samples

export async function getRUMUrl(url) {
  const urlWithScheme = url.startsWith('http') ? url : `https://${url}`;
  const resp = await fetch(urlWithScheme);
  const finalUrl = resp.url.split('://')[1];
  return finalUrl.endsWith('/') ? finalUrl.slice(0, -1) : /* c8 ignore next */ finalUrl;
}

/**
 * Extracts the domain and protocol from a given URL.
 *
 * @param {string} inputUrl - The URL to extract domain and protocol from.
 * @returns {{ domain: string, protocol: string }|null} - An object containing
 * the domain and protocol if successfully extracted,
 * or null if the URL is invalid.
 */
export function extractDomainAndProtocol(inputUrl) {
  try {
    const parsedUrl = new URL(inputUrl);
    return { domain: parsedUrl.hostname, protocol: parsedUrl.protocol };
  } catch (error) {
    return null;
  }
}
