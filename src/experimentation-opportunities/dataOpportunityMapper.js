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

export class OpportunityData {
  constructor(oppty) {
    this.runbook = 'https://adobe.sharepoint.com/:w:/r/sites/aemsites-engineering/_layouts/15/Doc.aspx?sourcedoc=%7B19613D9B-93D4-4112-B7C8-DBE0D9DCC55B%7D&file=Experience_Success_Studio_High_Organic_Traffic_Low_CTR_Runbook.docx&action=default&mobileredirect=true';
    this.origin = 'AUTOMATION';
    this.title = 'page with high organic traffic but low click through rate detected';
    this.description = 'Adjusting the wording, images and/or layout on the page to resonate more with a specific audience should increase the overall engagement on the page and ultimately bump conversion.';
    this.status = 'NEW';
    this.guidance = {
      recommendations: oppty.recommendations,
    };
    this.tags = ['Engagement'];
    this.data = {
      page: oppty.page,
      pageViews: oppty.pageViews,
      samples: oppty.samples,
      screenshot: oppty.screenshot,
      thumbnail: oppty.thumbnail,
      trackedKPISiteAverage: oppty.trackedKPISiteAverage,
      trackedPageKPIName: oppty.trackedPageKPIName,
      trackedPageKPIValue: oppty.trackedPageKPIValue,
      opportunityImpact: oppty.opportunityImpact,
      metrics: oppty.metrics,
    };
  }
}
