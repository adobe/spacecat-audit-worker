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

// eslint-disable-next-line max-classes-per-file
import type { UniversalContext } from '@adobe/helix-universal';

export interface JobMessage {
    type: string;
    url: string;
}

export class Audit {
  run(message: JobMessage, context: UniversalContext);
}

export class AuditBuilder {
  withSiteProvider(siteProvider): AuditBuilder;

  withUrlResolver(urlResolver): AuditBuilder;

  withRunner(runner): AuditBuilder;

  withPersister(persister): AuditBuilder;

  withMessageSender(messageSender): AuditBuilder;

  build(): Audit;
}

export const DESTINATIONS: {
  readonly IMPORT_WORKER: 'IMPORT_WORKER';
  readonly CONTENT_SCRAPER: 'CONTENT_SCRAPER';
};

export type Destination = typeof DESTINATIONS[keyof typeof DESTINATIONS];
