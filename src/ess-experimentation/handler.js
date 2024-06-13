/*
 * Copyright 2023 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */
import RUMAPIClient from '@adobe/spacecat-shared-rum-api-client';
import { JSDOM } from 'jsdom';
import { AuditBuilder } from '../common/audit-builder.js';
import { getRUMDomainkey } from '../support/utils.js';

const SPACECAT_RUM_API_ENDPOINT = 'https://spacecat.experiencecloud.live/api/v1/rum';
const DAYS = 7;

function getEssExperimentationURL(url) {
  return `${SPACECAT_RUM_API_ENDPOINT}/experiments?domain=${url}&interval=30&granularity=hourly`;
}

async function getExperimentMetaDataFromExperimentPage(url, id) {
  let data = {};
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch URL: ${url}, status: ${response.status}`);
    }
    const html = await response.text();
    const dom = new JSDOM(html);

    const experimentEl = dom.window.document.querySelector('meta[name="experiment"]');
    const experimentId = experimentEl ? experimentEl.getAttribute('content') : null;
    if (experimentId !== id) {
      return data;
    }
    const pages = dom.window.document.querySelector('meta[name="experiment-variants"]').getAttribute('content').split(',').map((p) => new URL(p.trim()).pathname);
    const splitString = dom.window.document.querySelector('meta[name="experiment-split"]');
    const splits = splitString ? splitString.split(',').map((i) => parseInt(i, 10) / 100) : [...new Array(pages.length)].map(() => 1 / (pages.length + 1));
    const experimentStartDate = dom.window.document.querySelector('meta[name="experiment-start-date"]').getAttribute('content') || '';
    const experimentEndDate = dom.window.document.querySelector('meta[name="experiment-end-date"]').getAttribute('content') || '';
    const conversionEventName = dom.window.document.querySelector('meta[name="experiment-conversion-event-name"]').getAttribute('content') || '';
    const conversionEventValue = dom.window.document.querySelector('meta[name="experiment-conversion-event-value"]').getAttribute('content') || '';
    const experimentStatus = dom.window.document.querySelector('meta[name="experiment-status"]').getAttribute('content') || '';
    const experimentType = dom.window.document.querySelector('meta[name="experiment-type"]').getAttribute('content') || '';
    data = {
      id,
      type: experimentType,
      url,
      status: experimentStatus,
      startDate: experimentStartDate,
      endDate: experimentEndDate,
      conversionEventName,
      conversionEventValue,
      variants: [...pages.map((page, index) => ({
        name: `challenger-${index + 1}`,
        url: page,
        split: splits[index],
      }))],
    };
  } catch (e) {
    console.error(`Error fetching data from ${url}: ${e}`);
  }
  return data;
}

function mergeData(experiment, experimentMetadata) {
  for (const key of Object.keys(experimentMetadata)) {
    if (!experiment[key]) {
      // eslint-disable-next-line no-param-reassign
      experiment[key] = experimentMetadata[key];
    }
  }
  // variants
  for (const variant of experimentMetadata.variants) {
    const experimentVariant = experiment.variants.find((v) => v.name === variant.name);
    if (experimentVariant) {
      experimentVariant.url = variant.url;
      experimentVariant.split = variant.split;
    }
  }
  return experiment;
}

function addPValues(experiment) {
  return experiment;
}

async function processExperimentRUMData(experimentData) {
  // connect to each page in the data and obtain the experiment data and fill the gaps
  for (const experiment of experimentData) {
    const { url } = experiment;
    // eslint-disable-next-line no-await-in-loop
    const experimentMetadata = await getExperimentMetaDataFromExperimentPage(url, experiment.id);
    mergeData(experiment, experimentMetadata);
    addPValues(experiment);
  }
  return experimentData;
}

async function processAudit(auditURL, context, site) {
  const rumAPIClient = RUMAPIClient.createFrom(context);
  const domainkey = await getRUMDomainkey(site.getBaseURL(), context);
  const options = {
    domain: auditURL,
    domainkey,
    interval: DAYS,
    granularity: 'hourly',
  };
  const experimentData = await rumAPIClient.query('experiment', options);
  return {
    auditResult: processExperimentRUMData(experimentData),
    fullAuditRef: getEssExperimentationURL(auditURL),
  };
}

export async function essExperimentationAuditRunner(auditUrl, context, site) {
  const { log } = context;
  log.info(`Received ESS Experimentation audit request for ${auditUrl}`);
  const startTime = process.hrtime();

  const auditData = await processAudit(
    auditUrl,
    context,
    site,
  );

  const endTime = process.hrtime(startTime);
  const elapsedSeconds = endTime[0] + endTime[1] / 1e9;
  const formattedElapsed = elapsedSeconds.toFixed(2);

  log.info(`ESS Experimentation Audit completed in ${formattedElapsed} seconds for ${auditUrl}`);
  return auditData;
}

export default new AuditBuilder()
  .withRunner(essExperimentationAuditRunner)
  .build();
