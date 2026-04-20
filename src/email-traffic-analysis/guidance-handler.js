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
import { ok, notFound } from '@adobe/spacecat-shared-http-utils';
import { randomUUID } from 'crypto';
import { Suggestion as SuggestionModel } from '@adobe/spacecat-shared-data-access';
import { DATA_SOURCES } from '../common/constants.js';
import { createTrafficLogger } from '../common/traffic-log.js';
import { warnOnInvalidSuggestionData } from '../utils/data-access.js';

const GUIDANCE_TYPE = 'guidance:email-traffic-analysis';
const EMAIL_TRAFFIC_OPP_TYPE = 'email-traffic';
const ORIGIN = 'ESS_OPS';

function buildEmailTrafficTitle({ year, week, month }) {
  if (week != null) {
    return `Email Traffic Weekly Report – Week ${String(week)} / ${year}`;
  }
  return `Email Traffic Monthly Report – Month ${String(month)} / ${year}`;
}

function mapToEmailOpportunity(siteId, audit, { year, month, week }) {
  return {
    siteId,
    id: randomUUID(),
    auditId: audit.getAuditId(),
    type: EMAIL_TRAFFIC_OPP_TYPE,
    data: {
      year,
      ...(week != null ? { week: Number(week) } : {}),
      ...(month != null ? { month: Number(month) } : {}),
      dataSources: [DATA_SOURCES.RUM],
    },
    origin: ORIGIN,
    title: buildEmailTrafficTitle({ year, week, month }),
    status: 'NEW',
    tags: ['Engagement'],
  };
}

function mapToAIInsightsSuggestions(opportunityId, guidanceArr) {
  const root = guidanceArr[0] || {};
  const body = root.body || {};
  const reports = Array.isArray(body.reports) ? body.reports : [];
  return reports.map((section) => ({
    opportunityId,
    type: 'AI_INSIGHTS',
    rank: 1,
    data: {
      parentReport: section.reportType,
      recommendations: Array.isArray(section.recommendations)
        ? section.recommendations.map((r) => ({ id: randomUUID(), recommendation: r.markdown }))
        : [],
    },
  }));
}

async function ignorePreviousOpportunitiesForPeriod(Opportunity, siteId, period, log, newOpptyId) {
  const existing = await Opportunity.allBySiteId(siteId);
  const candidates = existing
    .filter((oppty) => oppty.getType() === EMAIL_TRAFFIC_OPP_TYPE)
    .filter((oppty) => oppty.getStatus() === 'NEW')
    .filter((oppty) => oppty.getId() !== newOpptyId)
    .filter((oppty) => {
      const data = oppty.getData() || {};
      if (period.week != null) {
        return data.week != null;
      }
      if (period.month != null) {
        return data.week == null && data.month != null;
      }
      return false;
    });

  candidates.forEach((oppty) => {
    const data = oppty.getData();
    const title = oppty.getTitle();
    const weekVal = data?.week;
    const monthVal = data?.month;
    const id = oppty.getId();
    log.debug(`Setting existing email-traffic opportunity id=${id} title="${title}" week=${weekVal} month=${monthVal} to IGNORED`);
    oppty.setStatus('IGNORED');
    oppty.setUpdatedBy('system');
  });
  if (candidates.length > 0) {
    await Opportunity.saveMany(candidates);
  }
  log.debug(`Ignored ${candidates.length} existing email-traffic opportunities for siteId=${siteId}`);
}

export default async function handler(message, context) {
  const { log, dataAccess } = context;
  const { Audit, Opportunity, Suggestion } = dataAccess;
  const { auditId, siteId, data } = message;
  const { url, guidance } = data;
  const emailLog = createTrafficLogger(log, '[email-audit]', GUIDANCE_TYPE);

  emailLog.received(siteId, url, auditId);

  const audit = await Audit.findById(auditId);
  if (!audit) {
    emailLog.failed('no audit found', siteId, url, auditId);
    return notFound();
  }

  // Derive period from audit result (source of truth)
  const auditResult = audit.getAuditResult();
  const period = {
    year: auditResult.year,
    week: auditResult.week ?? null,
    month: auditResult.month ?? null,
  };

  // Create new email-traffic opportunity for this period
  const entity = mapToEmailOpportunity(siteId, audit, period);
  emailLog.creatingOpportunity(siteId, url, auditId);
  const opportunity = await Opportunity.create(entity);

  // Map AI Insights suggestions from guidance
  const suggestions = mapToAIInsightsSuggestions(opportunity.getId(), guidance);
  if (suggestions.length) {
    const requiresValidation = Boolean(context.site?.requiresValidation);
    const opportunityType = opportunity.getType();
    const status = opportunityType !== 'email-traffic' && requiresValidation
      ? SuggestionModel.STATUSES.PENDING_VALIDATION
      : SuggestionModel.STATUSES.NEW;

    await Promise.all(
      suggestions.map((s) => {
        warnOnInvalidSuggestionData(s.data, opportunityType, log);
        return Suggestion.create({
          ...s,
          status,
        });
      }),
    );
  }

  // Only after successful opportunity and suggestions creation, ignore previous ones
  await ignorePreviousOpportunitiesForPeriod(Opportunity, siteId, period, log, opportunity.getId());

  return ok();
}
