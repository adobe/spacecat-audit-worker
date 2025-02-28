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

function calculateOpptyImpact(organicTraffic, siteAverageCTR, pageCTR) {
  // assume oppty cannot go over site average CTR
  if (pageCTR > siteAverageCTR) return 0;

  // total margin in the potential impact
  return (siteAverageCTR - pageCTR) * organicTraffic;
}

export function convertToOpportunityEntity(siteId, auditId, rawOppty = {}, guidance = []) {
  const {
    page = '',
    pageViews = 0,
    samples = 0,
    trackedKPISiteAverage = 0,
    trackedPageKPIName = '',
    trackedPageKPIValue = 0,
    metrics = [],
  } = rawOppty;

  /* c8 ignore next 1 */
  const organicTraffic = metrics.find((m) => m.type === 'traffic' && m.vendor === '*')?.value?.earned || 0;

  const opportunityImpact = calculateOpptyImpact(
    organicTraffic,
    trackedKPISiteAverage,
    trackedPageKPIValue,
  );

  return {
    siteId,
    auditId,
    runbook:
      'https://adobe.sharepoint.com/:w:/r/sites/aemsites-engineering/_layouts/15/Doc.aspx?sourcedoc=%7B19613D9B-93D4-4112-B7C8-DBE0D9DCC55B%7D&file=Experience_Success_Studio_High_Organic_Traffic_Low_CTR_Runbook.docx&action=default&mobileredirect=true',
    type: 'high-organic-low-ctr',
    origin: 'AUTOMATION',
    title: 'Page with high organic traffic but low click through rate detected',
    description:
      'Adjusting the wording, images and/or layout on the page to resonate more with a specific audience should increase the overall engagement on the page and ultimately bump conversion.',
    status: 'NEW',
    guidance: {
      recommendations: guidance,
    },
    tags: ['Engagement'],
    data: {
      page,
      pageViews,
      samples,
      trackedKPISiteAverage,
      trackedPageKPIName,
      trackedPageKPIValue,
      opportunityImpact,
      metrics,
    },
  };
}
