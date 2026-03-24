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

import { isValidUrl } from '@adobe/spacecat-shared-utils';
import { wwwUrlResolver } from '../common/base-audit.js';

export function getInternalLinksFetchConfig(site) {
  const siteConfig = site?.getConfig?.();
  return siteConfig?.getFetchConfig?.()
    || siteConfig?.fetchConfig
    || siteConfig?.config?.fetchConfig
    || {};
}

export function resolveInternalLinksBaseURL(site) {
  const overrideBaseURL = getInternalLinksFetchConfig(site)?.overrideBaseURL;
  if (isValidUrl(overrideBaseURL)) {
    return overrideBaseURL;
  }

  return site?.getBaseURL?.() || '';
}

export async function resolveInternalLinksRumDomain(site, context) {
  return wwwUrlResolver({
    getBaseURL: () => site?.getBaseURL?.(),
    getConfig: () => ({
      getFetchConfig: () => ({}),
    }),
  }, context);
}
