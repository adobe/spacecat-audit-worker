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
import ExcelJS from 'exceljs';
import { getLastNumberOfWeeks } from '@adobe/spacecat-shared-utils';
import { startOfISOWeek, addDays, format } from 'date-fns';
import { AzureOpenAIClient } from '@adobe/spacecat-shared-gpt-client';
import { createLLMOSharepointClient, saveExcelReport, readFromSharePoint } from '../utils/report-uploader.js';

function getAzureOpenAIClient(context, deploymentName) {
  const cacheKey = `azureOpenAIClient_${deploymentName}`;

  if (context[cacheKey]) {
    return context[cacheKey];
  }

  const { env, log = console } = context;

  const {
    AZURE_OPENAI_ENDPOINT: apiEndpoint,
    AZURE_OPENAI_KEY: apiKey,
    AZURE_API_VERSION: apiVersion,
  } = env;

  const config = {
    apiEndpoint,
    apiKey,
    apiVersion,
    deploymentName,
  };

  context[cacheKey] = new AzureOpenAIClient(config, log);
  return context[cacheKey];
}

export async function prompt(systemPrompt, userPrompt, context = {}, deploymentName = null) {
  try {
    const deployment = deploymentName || context.env?.AZURE_COMPLETION_DEPLOYMENT || 'gpt-4o-mini';
    const azureClient = getAzureOpenAIClient(context, deployment);

    const response = await azureClient.fetchChatCompletion(userPrompt, {
      systemPrompt,
      responseFormat: 'json_object',
    });

    return {
      content: response.choices[0].message.content,
      usage: response.usage || null,
    };
  } catch (error) {
    throw new Error(`Failed to trigger Azure LLM: ${error.message}`);
  }
}

async function createAndSaveWorkbook(config, site, context) {
  const {
    filePrefix, successMessage, worksheets, folderName,
  } = config;
  const { log } = context;

  const workbook = new ExcelJS.Workbook();

  for (const worksheetConfig of worksheets) {
    const {
      name, columns, data, emptyDataPlaceholder,
    } = worksheetConfig;
    const worksheet = workbook.addWorksheet(name);

    worksheet.columns = columns;

    if (data && data.length > 0) {
      for (const row of data) {
        worksheet.addRow(row);
      }
    } else {
      worksheet.addRow(emptyDataPlaceholder);
    }
  }

  let filename = `${filePrefix}.xlsx`;

  try {
    const sharepointClient = await createLLMOSharepointClient(context);
    const llmoFolder = site.getConfig()?.getLlmoDataFolder();
    const outputLocation = `${llmoFolder}/${folderName}`;

    try {
      await readFromSharePoint(filename, outputLocation, sharepointClient, log);
      filename = `${filePrefix}-automation.xlsx`;
      log.info(`File ${filePrefix}.xlsx already exists, using ${filename} instead`);
    } catch (e) {
      log.debug(`File ${filename} doesn't exist, proceeding with original filename`, e);
    }

    await saveExcelReport({
      sharepointClient,
      workbook,
      filename,
      outputLocation,
      log,
    });

    log.info(`${successMessage}`);
  } catch (error) {
    log.error(`Failed to upload to SharePoint: ${error.message}`);
    throw error;
  }
}

export async function uploadUrlsWorkbook(insights, site, context) {
  const worksheetData = [];

  for (const {
    category, region, topic, url,
  } of insights) {
    worksheetData.push({
      category,
      region,
      topic,
      url,
    });
  }

  const config = {
    folderName: 'prompts',
    filePrefix: 'urls',
    successMessage: 'Successfully uploaded urls Excel file to SharePoint',
    worksheets: [{
      name: 'URLs',
      columns: [
        { header: 'category', key: 'category', width: 30 },
        { header: 'region', key: 'region', width: 15 },
        { header: 'topic', key: 'topic', width: 30 },
        { header: 'url', key: 'url', width: 50 },
      ],
      data: worksheetData,
      emptyDataPlaceholder: {
        category: 'No products found',
        region: 'N/A',
        topic: 'N/A',
        url: 'N/A',
      },
    }],
  };

  await createAndSaveWorkbook(config, site, context);
}

export async function uploadPatternsWorkbook(products, pagetypes, site, context) {
  const productData = [];
  const pagetypeData = [];

  if (products && Object.keys(products).length > 0) {
    for (const [name, regex] of Object.entries(products)) {
      productData.push({ name, regex });
    }
  }

  if (pagetypes && Object.keys(pagetypes).length > 0) {
    for (const [name, regex] of Object.entries(pagetypes)) {
      pagetypeData.push({ name, regex });
    }
  }

  const config = {
    folderName: 'agentic-traffic/patterns',
    filePrefix: 'patterns',
    successMessage: 'Successfully uploaded patterns Excel file to SharePoint',
    worksheets: [
      {
        name: 'shared-products',
        columns: [
          { header: 'name', key: 'name', width: 50 },
          { header: 'regex', key: 'regex', width: 50 },
        ],
        data: productData,
        emptyDataPlaceholder: {
          name: 'No products found',
          regex: 'N/A',
        },
      },
      {
        name: 'shared-pagetype',
        columns: [
          { header: 'name', key: 'name', width: 50 },
          { header: 'regex', key: 'regex', width: 50 },
        ],
        data: pagetypeData,
        emptyDataPlaceholder: {
          name: 'No pagetypes found',
          regex: 'N/A',
        },
      },
    ],
  };

  await createAndSaveWorkbook(config, site, context);
}

export function getLastSunday() {
  const { year, week } = getLastNumberOfWeeks(1)[0];
  const weekStart = startOfISOWeek(new Date(year, 0, 4));
  const targetWeekStart = addDays(weekStart, (week - 1) * 7);
  const lastSunday = format(addDays(targetWeekStart, 6), 'yyyy-MM-dd');
  return lastSunday;
}
/* c8 ignore end */
