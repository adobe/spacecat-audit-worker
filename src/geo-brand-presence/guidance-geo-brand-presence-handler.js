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
/* c8 ignore start */

import { badRequest, notFound, ok } from '@adobe/spacecat-shared-http-utils';
import { tracingFetch as fetch } from '@adobe/spacecat-shared-utils';
import { OPPTY_TYPES } from './handler.js';
import { createLLMOSharepointClient, uploadAndPublishFile } from '../utils/report-uploader.js';

// TODO(aurelio): remove when we agreed on what comes back from mystique
const ACCEPTED_TYPES = [...OPPTY_TYPES, 'guidance:geo-brand-presence'];

export default async function handler(message, context) {
  const { log, dataAccess } = context;
  const { Audit, Site } = dataAccess;
  const {
    auditId, siteId, type: subType, data,
  } = message;

  log.info('GEO BRAND PRESENCE GUIDANCE: Message received:', message);

  if (!subType || !ACCEPTED_TYPES.includes(subType)) {
    log.error(`GEO BRAND PRESENCE GUIDANCE: Unsupported subtype: ${subType}`);
    return notFound();
  }

  const [audit, site] = await Promise.all([Audit.findById(auditId), Site.findById(siteId)]);
  if (!audit || !site) {
    log.error(`GEO BRAND PRESENCE GUIDANCE: Audit or site not found for auditId: ${auditId}, siteId: ${siteId}`);
    return notFound();
  }

  const sheetUrl = URL.parse(data.presigned_url);
  if (!sheetUrl || !sheetUrl.href) {
    log.error(`GEO BRAND PRESENCE GUIDANCE: Invalid presigned URL: ${data.presigned_url}`);
    return badRequest('Invalid presigned URL');
  }

  /** @type {Response} */
  const res = await fetch(sheetUrl);
  const sheet = await res.arrayBuffer();

  // upload to sharepoint & publish via hlx admin api
  const sharepointClient = await createLLMOSharepointClient(context);
  const outputLocation = `${site.getConfig().getLlmoDataFolder()}/brand-presence`;
  const xlsxName = (
    /;\s*content=(brandpresence-.*$)/.exec(sheetUrl.searchParams.get('response-content-disposition') ?? '')?.[1]
    ?? sheetUrl.pathname.replace(/.*[/]/, '')
  );
  await uploadAndPublishFile(sheet, xlsxName, outputLocation, sharepointClient, log);

  return ok();
}
