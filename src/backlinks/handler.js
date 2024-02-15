/*
 * Copyright 2024 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

import AhrefsAPIClient from '../support/ahrefs-client.js';
import { toggleWWW } from '../apex/handler.js';
import { AuditBuilder } from '../common/audit-builder.js';

async function backlinkAuditRunner(finalUrl, context) {
  const { log } = context;

  const ahrefsAPIClient = AhrefsAPIClient.createFrom(context);
  const urls = [...new Set([finalUrl, toggleWWW(finalUrl)])];

  const results = await Promise.all(urls.map(async (url) => {
    try {
      const {
        result,
        fullAuditRef,
      } = await ahrefsAPIClient.getBrokenBacklinks(url);

      log.info(`Found ${result?.backlinks?.length} broken backlinks for ${url}`);

      return {
        url,
        brokenBacklinks: result.backlinks,
        fullAuditRef,
      };
    } catch (e) {
      log.error(`Broken backlinks audit for ${url} failed with error: ${e.message}`, e);
      return {
        url,
        error: `Broken backlinks audit for ${url} failed with error`,
      };
    }
  }));

  const auditResult = results.reduce((acc, item) => {
    const { url, ...rest } = item;
    acc[url] = rest;
    return acc;
  }, {});

  return {
    auditResult,
    fullAuditRef: results?.[0]?.fullAuditRef,
  };
}

export default function handler() {
  return new AuditBuilder()
    .withRunner(backlinkAuditRunner)
    .build();
}
