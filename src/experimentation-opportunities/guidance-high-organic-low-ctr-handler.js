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

function convertToOpportunityEntity(siteId, auditId, rawOppty = {}, guidance = []) {
  const {
    page = '',
    pageViews = 0,
    samples = 0,
    screenshot = null,
    thumbnail = null,
    trackedKPISiteAverage = 0,
    trackedPageKPIName = '',
    trackedPageKPIValue = 0,
    opportunityImpact = 0,
    metrics = [],
  } = rawOppty;

  return {
    siteId,
    auditId,
    runbook:
      'https://adobe.sharepoint.com/:w:/r/sites/aemsites-engineering/_layouts/15/Doc.aspx?sourcedoc=%7B19613D9B-93D4-4112-B7C8-DBE0D9DCC55B%7D&file=Experience_Success_Studio_High_Organic_Traffic_Low_CTR_Runbook.docx&action=default&mobileredirect=true',
    type: 'high-organic-low-ctr',
    origin: 'AUTOMATION',
    title: 'page with high organic traffic but low click through rate detected',
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
      screenshot,
      thumbnail,
      trackedKPISiteAverage,
      trackedPageKPIName,
      trackedPageKPIValue,
      opportunityImpact,
      metrics,
    },
  };
}

export default async function handler(message, context) {
  const { log, dataAccess } = context;
  const { Audit, Opportunity, Suggestion } = dataAccess;
  const { auditId, siteId, data } = message;
  const { url, guidance, suggestions } = data;

  const audit = await Audit.findById(auditId);
  if (!audit) {
    log.warn(`No audit found for auditId: ${auditId}`);
    return;
  }

  const rawOpportunity = audit.auditResult.experimentationOpportunities
    .filter((oppty) => oppty.type === 'high-organic-low-ctr')
    .find((oppty) => oppty.page === url);

  if (!rawOpportunity) {
    log.info(
      `No raw opportunity found of type 'high-organic-low-ctr' for URL: ${url}. Nothing to process.`,
    );
    return;
  }

  const entity = convertToOpportunityEntity(siteId, auditId, rawOpportunity, guidance);

  const existingOpportunities = await Opportunity.allBySiteId(siteId);
  let existingOpportunity = existingOpportunities.find(
    (oppty) => oppty.getData()?.page === url,
  );

  if (!existingOpportunity) {
    log.info(`No existing Opportunity found for page: ${url}. Creating a new one.`);
    await Opportunity.create(entity);
  } else {
    log.info(`Existing Opportunity found for page: ${url}. Updating it with new data.`);
    existingOpportunity.setAuditId(auditId);
    existingOpportunity.setData({
      ...existingOpportunity.getData(),
      ...entity.data,
    });
    existingOpportunity.setGuidance(entity.guidance);
    existingOpportunity = await existingOpportunity.save();

    const existingSuggestions = await existingOpportunity.getSuggestions();

    await Promise.all(existingSuggestions.map((suggestion) => suggestion.remove()));

    const variants = suggestions.map((suggestion, index) => ({
      name: `Variation ${index + 1}`,
      changes: [],
      variationEditPageUrl: `https://example.com/edit/variation-${index + 1}`,
      id: `variation-${index + 1}`,
      variationPageUrl: suggestion.previewUrl,
      explanation: 'more to come soon...',
      projectedImpact: 0.08,
      previewImage: suggestion.screenshotUrl,
    }));

    const suggestionData = {
      opportunityId: existingOpportunity.getId(),
      type: 'CONTENT_UPDATE',
      rank: 1,
      status: 'NEW',
      data: {
        variations: variants,
      },
      kpiDeltas: {
        estimatedKPILift: 0,
      },
    };

    await Suggestion.create(suggestionData);
  }
}
