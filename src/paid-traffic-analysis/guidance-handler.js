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
import { DATA_SOURCES } from '../common/constants.js';

const GUIDANCE_TYPE = 'guidance:traffic-analysis';
const TRAFFIC_OPP_TYPE = 'paid-traffic';
const ORIGIN = 'ESS_OPS';

function buildPaidTrafficTitle({ year, week, month }) {
  if (week != null) {
    return `Paid Traffic Analysis Week ${String(week)} / ${year}`;
  }
  return `Paid Traffic Analysis Month ${String(month)} / ${year}`;
}

function mapToPaidOpportunity(siteId, audit, { year, month, week }) {
  return {
    siteId,
    id: randomUUID(),
    auditId: audit.getAuditId(),
    type: TRAFFIC_OPP_TYPE,
    data: {
      year,
      // Keep only one of week/month depending on period; ensure string as in spec
      ...(week != null ? { week: Number(week) } : {}),
      ...(month != null ? { month: Number(month) } : {}),
      dataSources: [DATA_SOURCES.RUM],
    },
    origin: ORIGIN,
    title: buildPaidTrafficTitle({ year, week, month }),
    status: 'NEW',
    tags: ['Engagement'],
  };
}

function mapToAIInsightsSuggestions(opportunityId, guidanceArr) {
  // Expect guidanceArr[0].body to be an array of sections with reportType and recommendations[]
  const root = guidanceArr[0] || {};
  const body = Array.isArray(root.body) ? root.body : [];
  return body.map((section) => ({
    opportunityId,
    type: 'AI_INSIGHTS',
    rank: 1,
    status: 'NEW',
    data: {
      parentReport: section.reportType,
      recommendations: Array.isArray(section.recommendations)
        ? section.recommendations.map((r) => ({ id: randomUUID(), recommendation: r.markdown }))
        : [],
    },
  }));
}

async function ignorePreviousOpportunitiesForPeriod(Opportunity, siteId, _period, log, newOpptyId) {
  const existing = await Opportunity.allBySiteId(siteId);
  const candidates = existing
    .filter((oppty) => oppty.getType() === TRAFFIC_OPP_TYPE)
    .filter((oppty) => oppty.getStatus() === 'NEW')
    .filter((oppty) => oppty.getId() !== newOpptyId);

  await Promise.all(candidates.map(async (oppty) => {
    const data = oppty.getData();
    const title = oppty.getTitle();
    const weekVal = data?.week;
    const monthVal = data?.month;
    const id = oppty.getId();
    log.info(`Setting existing paid-traffic opportunity id=${id} title="${title}" week=${weekVal} month=${monthVal} to IGNORED`);
    oppty.setStatus('IGNORED');
    oppty.setUpdatedBy('system');
    await oppty.save();
  }));
  log.info(`Ignored ${candidates.length ?? 0} existing paid-traffic opportunities for siteId=${siteId}`);
}

export default async function handler(message, context) {
  const { log, dataAccess } = context;
  const { Audit, Opportunity, Suggestion } = dataAccess;
  const { auditId, siteId, data } = message;
  const {
    url, guidance,
  } = data;

  log.info(`Message received for ${GUIDANCE_TYPE} handler site: ${siteId} url: ${url} message: ${JSON.stringify(message)}`);
  const audit = await Audit.findById(auditId);
  if (!audit) {
    log.warn(`No audit found for auditId: ${auditId}`);
    return notFound();
  }

  // Derive period from audit result (source of truth)
  const auditResult = audit.getAuditResult();
  const period = {
    year: auditResult.year,
    week: auditResult.week ?? null,
    month: auditResult.month ?? null,
  };

  // Create new paid-traffic opportunity for this period
  const entity = mapToPaidOpportunity(siteId, audit, period);
  const opportunity = await Opportunity.create(entity);

  // Map AI Insights suggestions from guidance (already in expected structure)
  const suggestions = mapToAIInsightsSuggestions(opportunity.getId(), guidance);
  if (suggestions.length) {
    // Create all suggestions in parallel
    await Promise.all(suggestions.map((s) => Suggestion.create(s)));
  }

  // Only after successful opportunity and suggestions creation, ignore previous ones
  await ignorePreviousOpportunitiesForPeriod(
    Opportunity,
    siteId,
    period,
    log,
    opportunity.getId(),
  );

  log.info(`Finished mapping [${GUIDANCE_TYPE}] -> OpportunityType [${TRAFFIC_OPP_TYPE}] for site: ${siteId} period: ${period.week != null ? `W${period.week}/Y${period.year}` : `M${period.month}/Y${period.year}`} opportunityId: ${opportunity.getId?.()}`);
  return ok();
}
