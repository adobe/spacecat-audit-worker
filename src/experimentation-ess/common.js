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

/* c8 ignore start */
import RUMAPIClient from '@adobe/spacecat-shared-rum-api-client';
import { JSDOM } from 'jsdom';
import { getRUMDomainkey } from '../support/utils.js';

const EXPERIMENT_PLUGIN_OPTIONS = {
  experimentsRoot: '/experiments',
  experimentsConfigFile: 'manifest.json',
  experimentsMetaTag: 'experiment',
  experimentsQueryParameter: 'experiment',
};

const METRIC_CHECKPOINTS = ['click', 'convert', 'formsubmit'];

let log = console;

/**
 * Retrieves the content of metadata tags.
 * @param {string} name The metadata name (or property)
 * @param {Document} doc Document object to query for metadata. Defaults to the window's document
 * @returns {string} The metadata value(s)
 */
function getMetadata(name, doc) {
  const attr = name && name.includes(':') ? 'property' : 'name';
  const meta = [...doc.head.querySelectorAll(`meta[${attr}="${name}"]`)]
    .map((m) => m.content)
    .join(', ');
  return meta || '';
}

function toClassName(name) {
  return typeof name === 'string'
    ? name.toLowerCase().replace(/[^0-9a-z]/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
    : '';
}

/**
 * Sanitizes a string for use as a js property name.
 * @param {string} name The unsanitized string
 * @returns {string} The camelCased name
 */
function toCamelCase(name) {
  return toClassName(name).replace(/-([a-z])/g, (g) => g[1].toUpperCase());
}

/**
 * Calculates percentage split for variants where the percentage split is not
 * explicitly configured.
 * Substracts from 100 the explicitly configured percentage splits,
 * and divides the remaining percentage, among the variants without explicit
 * percentage split configured
 * @param {Array} variant objects
 */
function inferEmptyPercentageSplits(variants) {
  const variantsWithoutPercentage = [];

  const remainingPercentage = variants.reduce((result, variant) => {
    if (!variant.percentageSplit) {
      variantsWithoutPercentage.push(variant);
    }
    const newResult = result - parseFloat(variant.percentageSplit || 0);
    return newResult;
  }, 1);
  if (variantsWithoutPercentage.length) {
    const missingPercentage = remainingPercentage / variantsWithoutPercentage.length;
    variantsWithoutPercentage.forEach((v) => {
      // eslint-disable-next-line no-param-reassign
      v.percentageSplit = missingPercentage.toFixed(4);
    });
  }
}

/**
 * Parses the experimentation configuration sheet and creates an internal model.
 *
 * Output model is expected to have the following structure:
 *      {
 *        id: <string>,
 *        label: <string>,
 *        blocks: <string>,
 *        audiences: [<string>],
 *        status: Active | Inactive,
 *        variantNames: [<string>],
 *        variants: {
 *          [variantName]: {
 *            label: <string>
 *            percentageSplit: <number 0-1>,
 *            pages: <string>,
 *            blocks: <string>,
 *          }
 *        }
 *      };
 */
function parseExperimentConfig(json) {
  const config = {};
  try {
    json.settings.data.forEach((line) => {
      const key = toCamelCase(line.Name);
      if (key === 'audience' || key === 'audiences') {
        config.audiences = line.Value ? line.Value.split(',').map((str) => str.trim()) : [];
      } else if (key === 'experimentName') {
        config.label = line.Value;
      } else {
        config[key] = line.Value;
      }
    });
    const variants = {};
    let variantNames = Object.keys(json.experiences.data[0]);
    variantNames.shift();
    variantNames = variantNames.map((vn) => toCamelCase(vn));
    variantNames.forEach((variantName) => {
      variants[variantName] = {};
    });
    let lastKey = 'default';
    json.experiences.data.forEach((line) => {
      let key = toCamelCase(line.Name);
      if (!key) key = lastKey;
      lastKey = key;
      const vns = Object.keys(line);
      vns.shift();
      vns.forEach((vn) => {
        const camelVN = toCamelCase(vn);
        if (key === 'pages' || key === 'blocks') {
          variants[camelVN][key] = variants[camelVN][key] || [];
          if (key === 'pages') variants[camelVN][key].push(new URL(line[vn]).pathname);
          else variants[camelVN][key].push(line[vn]);
        } else {
          variants[camelVN][key] = line[vn];
        }
      });
    });
    config.variants = variants;
    config.variantNames = variantNames;
    return config;
  } catch (e) {
    log.error('error parsing experiment config:', e, json);
  }
  return null;
}

/**
 * Gets experiment config from the metadata.
 *
 * @param {string} experimentId The experiment identifier
 * @param {string} instantExperiment The list of varaints
 * @returns {object} the experiment manifest
 */
function getConfigForInstantExperiment(
  experimentId,
  url,
  instantExperiment,
  pluginOptions,
  doc,
) {
  const audience = getMetadata(`${pluginOptions.experimentsMetaTag}-audience`, doc);
  const config = {
    label: `Instant Experiment: ${experimentId}`,
    audiences: audience ? audience.split(',').map(toClassName) : [],
    status: getMetadata(`${pluginOptions.experimentsMetaTag}-status`, doc) || 'Active',
    startDate: getMetadata(`${pluginOptions.experimentsMetaTag}-start-date`, doc),
    endDate: getMetadata(`${pluginOptions.experimentsMetaTag}-end-date`, doc),
    id: experimentId,
    variants: {},
    variantNames: [],
  };

  const nbOfVariants = Number(instantExperiment);
  const pages = Number.isNaN(nbOfVariants)
    ? instantExperiment.split(',').map((p) => new URL(p.trim(), url).pathname)
    : new Array(nbOfVariants).fill(new URL(url).pathname);

  const splitString = getMetadata(`${pluginOptions.experimentsMetaTag}-split`, doc);
  const splits = splitString
    // custom split
    ? splitString.split(',').map((i) => parseFloat(i) / 100)
    // even split fallback
    : [...new Array(pages.length)].map(() => 1 / (pages.length + 1));

  config.variantNames.push('control');
  config.variants.control = {
    percentageSplit: '',
    pages: [new URL(url).pathname],
    blocks: [],
    label: 'Control',
  };

  pages.forEach((page, i) => {
    const vname = `challenger-${i + 1}`;
    config.variantNames.push(vname);
    config.variants[vname] = {
      percentageSplit: `${splits[i].toFixed(4)}`,
      pages: [page],
      blocks: [],
      label: `Challenger ${i + 1}`,
    };
  });
  inferEmptyPercentageSplits(Object.values(config.variants));
  return (config);
}

/**
 * Gets experiment config from the manifest and transforms it to more easily
 * consumable structure.
 *
 * the manifest consists of two sheets "settings" and "experiences", by default
 *
 * "settings" is applicable to the entire test and contains information
 * like "Audience", "Status" or "Blocks".
 *
 * "experience" hosts the experiences in rows, consisting of:
 * a "Percentage Split", "Label" and a set of "Links".
 *
 *
 * @param {string} experimentId The experiment identifier
 * @param {object} pluginOptions The plugin options
 * @returns {object} containing the experiment manifest
 */
async function getConfigForFullExperiment(experimentId, url, pluginOptions, doc) {
  let path;
  if (experimentId.includes(`/${pluginOptions.experimentsConfigFile}`)) {
    path = new URL(experimentId, url).href;
    // eslint-disable-next-line no-param-reassign
    [experimentId] = path.split('/').splice(-2, 1);
  } else {
    path = `${pluginOptions.experimentsRoot}/${experimentId}/${pluginOptions.experimentsConfigFile}`;
  }
  try {
    const { origin } = new URL(url);
    const resp = await fetch(`${origin}${path}`);
    if (!resp.ok) {
      log.error('error loading experiment config:', resp);
      return null;
    }
    const json = await resp.json();
    const config = parseExperimentConfig(json);
    if (!config) {
      return null;
    }
    config.id = experimentId;
    config.manifest = path;
    config.basePath = `${pluginOptions.experimentsRoot}/${experimentId}`;
    inferEmptyPercentageSplits(Object.values(config.variants));
    config.status = getMetadata(`${pluginOptions.experimentsMetaTag}-status`, doc) || config.status;
    return config;
  } catch (e) {
    log.error(`error loading experiment manifest: ${path}`, e);
  }
  return null;
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
    const doc = dom.window.document;

    const experimentId = getMetadata(EXPERIMENT_PLUGIN_OPTIONS.experimentsMetaTag, doc);
    if (experimentId !== id) {
      return data;
    }
    const variants = getMetadata('instant-experiment', doc)
    || getMetadata(`${EXPERIMENT_PLUGIN_OPTIONS.experimentsMetaTag}-variants`, doc);

    const experimentConfig = variants
      ? await getConfigForInstantExperiment(
        experimentId,
        url,
        variants,
        EXPERIMENT_PLUGIN_OPTIONS,
        doc,
      ) : await getConfigForFullExperiment(experimentId, url, EXPERIMENT_PLUGIN_OPTIONS, doc);
    const experimentStartDate = getMetadata('experiment-start-date', doc);
    const experimentEndDate = getMetadata('experiment-end-date', doc);
    const conversionEventName = getMetadata('experiment-conversion-event-name', doc);
    const conversionEventValue = getMetadata('experiment-conversion-event-value', doc);
    const experimentType = getMetadata('experiment-type', doc);
    const updatedVariants = [];
    for (const variant of Object.keys(experimentConfig.variants)) {
      const variantConfig = experimentConfig.variants[variant];
      updatedVariants.push({
        name: variant,
        label: variantConfig.label,
        url: variantConfig.pages[0],
        split: variantConfig.percentageSplit,
      });
    }
    data = {
      id,
      label: experimentConfig.label || '',
      type: experimentType,
      url,
      status: experimentConfig.status,
      startDate: experimentStartDate,
      endDate: experimentEndDate,
      conversionEventName,
      conversionEventValue,
      variants: updatedVariants,
    };
  } catch (e) {
    log.error(`Error fetching data from ${url}: ${e}`);
  }
  return data;
}

function mergeData(experiment, experimentMetadata, url) {
  if (!experimentMetadata) {
    return experiment;
  }
  if (!experiment) {
    // eslint-disable-next-line no-param-reassign
    experiment = {};
  }
  const { origin } = new URL(url);
  for (const key of Object.keys(experimentMetadata)) {
    if (!experiment[key]) {
      // eslint-disable-next-line no-param-reassign
      experiment[key] = experimentMetadata[key];
    }
  }
  // variants
  if (experiment?.variants && experimentMetadata?.variants) {
    for (const variant of experimentMetadata.variants) {
      const experimentVariant = experiment.variants.find((v) => v.name === variant.name);
      if (experimentVariant) {
        experimentVariant.url = `${origin}${variant.url}`;
        experimentVariant.split = variant.split;
        experimentVariant.label = variant.label;
      }
    }
  }
  return experiment;
}

function addPValues(experiment) {
  for (const variant of experiment.variants) {
    variant.p_value = 'coming soon';
  }
  return experiment;
}

function getObjectByProperty(array, name, value) {
  return array.find((e) => e[name] === value);
}

async function convertToExperimentsSchema(experimentInsights) {
  const experiments = [];
  for (const url of Object.keys(experimentInsights)) {
    const urlInsights = experimentInsights[url];
    for (const exp of urlInsights) {
      const id = exp.experiment;
      // eslint-disable-next-line
      const experimentMetadataFromPage = await getExperimentMetaDataFromExperimentPage(url, id);
      const experiment = mergeData(getObjectByProperty(experiments, 'id', id), experimentMetadataFromPage, url) || {};
      const variants = experiment?.variants || [];
      for (const expVariant of exp.variants) {
        const variantName = expVariant.name;
        // eslint-disable-next-line
        const variant = getObjectByProperty(variants, 'name', variantName);
        const views = variant ? (variant.views || 0) + expVariant.views : expVariant.views;
        const metrics = variant?.metrics || [];
        for (const metricCheckPoint of METRIC_CHECKPOINTS) {
          for (const selector of Object.keys(expVariant[metricCheckPoint])) {
            const existingMetric = metrics.find(
              (m) => m.type === metricCheckPoint && m.selector === selector,
            );
            if (existingMetric) {
              existingMetric.value += expVariant[metricCheckPoint][selector];
            } else {
              metrics.push({
                type: metricCheckPoint,
                value: expVariant[metricCheckPoint][selector],
                selector,
              });
            }
          }
        }
        if (!variant) {
          variants.push({
            name: variantName,
            views,
            url,
            metrics,
          });
        } else if (variant && !variant.metrics) {
          variant.metrics = metrics;
          variant.views = views;
        }
      }
      const existingExperiment = getObjectByProperty(experiments, 'id', id);
      const controlUrl = variants.find((v) => v.name === 'control')?.url;
      if (!existingExperiment) {
        const experimentUrl = controlUrl || url;
        experiments.push({
          id,
          url: experimentUrl,
          variants,
        });
      } else if (controlUrl) {
        existingExperiment.url = controlUrl;
      }
    }
  }
  return experiments;
}

async function processExperimentRUMData(experimentInsights) {
  const experimentData = await convertToExperimentsSchema(experimentInsights);
  for (const experiment of experimentData) {
    addPValues(experiment);
  }
  return experimentData;
}

export async function processAudit(auditURL, context, site, days) {
  log = context.log;
  const rumAPIClient = RUMAPIClient.createFrom(context);
  const domainkey = await getRUMDomainkey(site.getBaseURL(), context);
  const options = {
    domain: auditURL,
    domainkey,
    interval: days,
    granularity: 'hourly',
  };
  const experimentData = await rumAPIClient.query('experiment', options);
  return processExperimentRUMData(experimentData);
}

/* c8 ignore stop */
