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

export interface Site {
  getId(): string;
  getBaseURL(): string;
  getIsLive(): boolean;
}

export interface JobMessage {
  type: string;
  url: string;
  siteId: string;
  auditContext?: {
    next?: string;
    auditId?: string;
    finalUrl?: string;
    fullAuditRef?: string;
  };
}

export interface AuditResult {
  auditResult: object;
  fullAuditRef: string;
}

export type SiteProvider = (siteId: string, context: UniversalContext) => Promise<Site>;
export type OrgProvider = (orgId: string, context: UniversalContext) => Promise<object>;
export type UrlResolver = (site: Site) => Promise<string>;
export type Runner = (
  finalUrl: string,
  context: UniversalContext,
  site: Site,
) => Promise<AuditResult>;
export type Persister = (auditData: object, context: UniversalContext) => Promise<object>;
export type MessageSender = (message: object, context: UniversalContext) => Promise<void>;
export type PostProcessor = (
  finalUrl: string,
  auditData: object,
  context: UniversalContext,
  site: Site,
) => Promise<object>;

export abstract class BaseAudit {
  protected constructor(
    siteProvider: SiteProvider,
    orgProvider: OrgProvider,
    urlResolver: UrlResolver,
    persister: Persister,
    messageSender: MessageSender,
    postProcessors: PostProcessor[],
  );

  abstract run(message: JobMessage, context: UniversalContext): Promise<object>;
}

export class RunnerAudit extends BaseAudit {
  constructor(
    siteProvider: SiteProvider,
    orgProvider: OrgProvider,
    urlResolver: UrlResolver,
    runner: Runner,
    persister: Persister,
    messageSender: MessageSender,
    postProcessors: PostProcessor[],
  );

  run(message: JobMessage, context: UniversalContext): Promise<object>;
}

export interface AuditStep {
  name: string;
  handler: (context: UniversalContext) => Promise<object>;
  destination?: keyof typeof Audit.AUDIT_STEP_DESTINATIONS;
}

export class StepAudit extends BaseAudit {
  constructor(
    siteProvider: SiteProvider,
    orgProvider: OrgProvider,
    urlResolver: UrlResolver,
    persister: Persister,
    messageSender: MessageSender,
    postProcessors: PostProcessor[],
    steps: Record<string, AuditStep>,
  );

  run(message: JobMessage, context: UniversalContext): Promise<object>;
}

export class AuditBuilder {
  withSiteProvider(siteProvider: SiteProvider): AuditBuilder;

  withOrgProvider(orgProvider: OrgProvider): AuditBuilder;

  withUrlResolver(urlResolver: UrlResolver): AuditBuilder;

  withRunner(runner: Runner): AuditBuilder;

  withPersister(persister: Persister): AuditBuilder;

  withMessageSender(messageSender: MessageSender): AuditBuilder;

  withPostProcessors(postProcessors: PostProcessor[]): AuditBuilder;

  addStep(name: string, handler: AuditStep['handler'], destination?: keyof typeof AuditModel.AUDIT_STEP_DESTINATIONS): AuditBuilder;

  build(): RunnerAudit | StepAudit;
}

// Default implementations
export const defaultMessageSender: MessageSender;
export const defaultPersister: Persister;
export const noopPersister: Persister;
export const defaultSiteProvider: SiteProvider;
export const defaultOrgProvider: OrgProvider;
export const defaultUrlResolver: UrlResolver;
export const wwwUrlResolver: UrlResolver;
export const noopUrlResolver: UrlResolver;
export const defaultPostProcessors: PostProcessor[];
