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

export function getSitePathPattern(baseUrl) {
  try {
    const url = new URL(baseUrl.startsWith('http') ? baseUrl : `https://${baseUrl}`);
    const pathname = url.pathname.replace(/\/+$/, '');
    return pathname.length > 1 ? `${pathname}/*` : '/*';
  } catch {
    return '/*';
  }
}

export function isUrlUnderSiteBase(url, baseUrl) {
  try {
    const parsedTarget = new URL(url);
    const resolvedBase = baseUrl.startsWith('http') ? baseUrl : `https://${baseUrl}`;
    const parsedBase = new URL(resolvedBase);

    const targetPath = parsedTarget.pathname;
    const basePath = parsedBase.pathname.replace(/\/+$/, '');

    if (basePath === '' || basePath === '/') {
      return true;
    }

    // Only enforce hostname match for subpath sites — root-domain bases accept any hostname
    // (e.g. www-variant URLs that will be rebased by the caller).
    if (parsedTarget.hostname !== parsedBase.hostname) {
      return false;
    }

    return targetPath === basePath || targetPath.startsWith(`${basePath}/`);
  } catch {
    return false;
  }
}
