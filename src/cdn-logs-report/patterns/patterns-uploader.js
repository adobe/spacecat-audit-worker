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
import { analyzeProducts } from './product-analysis.js';
import { analyzePageTypes } from './page-type-analysis.js';
import { weeklyBreakdownQueries } from '../utils/query-builder.js';
import { createExcelReport } from '../utils/excel-generator.js';
import { saveExcelReport } from '../../utils/report-uploader.js';

export async function generatePatternsWorkbook(options) {
  const {
    site,
    context,
    athenaClient,
    s3Config,
    periods,
    sharepointClient,
    configCategories = [],
    existingPatterns = null,
  } = options;
  const { log } = context;

  try {
    log.info(existingPatterns ? 'Generating patterns.xlsx with merge of existing patterns...' : 'patterns.json not found, generating patterns.xlsx...');

    const query = await weeklyBreakdownQueries.createTopUrlsQuery({
      periods,
      databaseName: s3Config.databaseName,
      tableName: s3Config.tableName,
      site,
    });

    const rows = await athenaClient.query(query, s3Config.databaseName, '[Athena Query] Fetch top URLs from CDN logs for pattern generation');
    const paths = rows?.map((row) => row.url).filter(Boolean) || [];

    if (paths.length === 0) {
      log.warn('No URLs fetched from Athena for pattern generation');
      return false;
    }

    log.info(`Fetched ${paths.length} URLs for pattern generation`);

    // Extract domain from site
    const baseURL = site.getBaseURL();
    const domain = new URL(baseURL).hostname;

    // Skip page type analysis if patterns already exist
    const pagetypeRegexes = existingPatterns?.pagePatterns?.length
      ? (log.info('Reusing existing page type patterns'), {})
      : await analyzePageTypes(domain, paths, context);

    // Filter new categories and skip product analysis if all exist
    const existingCategories = existingPatterns?.topicPatterns?.map(
      (p) => p.name.toLowerCase(),
    ) || [];
    const newCategories = configCategories.filter(
      (cat) => !existingCategories.includes(cat.toLowerCase()),
    );
    const categoriesToAnalyze = newCategories.length ? newCategories : configCategories;

    let productRegexes;
    if (!existingPatterns?.topicPatterns?.length || newCategories.length) {
      if (newCategories.length) {
        log.info(`Analyzing ${newCategories.length} new categories`);
      }
      productRegexes = await analyzeProducts(domain, paths, context, categoriesToAnalyze);
    } else {
      log.info('Reusing existing product patterns');
      productRegexes = {};
    }

    // Merge with existing patterns
    const mergedProductRegexes = { ...productRegexes };
    const mergedPagetypeRegexes = { ...pagetypeRegexes };

    if (existingPatterns) {
      log.info('Merging with existing patterns...');

      // Merge existing product patterns
      if (existingPatterns.topicPatterns && Array.isArray(existingPatterns.topicPatterns)) {
        const existingProductCount = existingPatterns.topicPatterns.length;
        existingPatterns.topicPatterns.forEach((pattern) => {
          if (pattern.name && pattern.regex) {
            mergedProductRegexes[pattern.name] = pattern.regex;
          }
        });
        log.info(`Preserved ${existingProductCount} existing product patterns`);
      }

      // Merge existing page type patterns
      if (existingPatterns.pagePatterns && Array.isArray(existingPatterns.pagePatterns)) {
        const existingPageTypeCount = existingPatterns.pagePatterns.length;
        existingPatterns.pagePatterns.forEach((pattern) => {
          if (pattern.name && pattern.regex) {
            mergedPagetypeRegexes[pattern.name] = pattern.regex;
          }
        });
        log.info(`Preserved ${existingPageTypeCount} existing page type patterns`);
      }
    }

    // Prepare data for workbook with unique lowercase names
    const productData = Array.from(
      new Map(Object.entries(mergedProductRegexes).map(([name, regex]) => [
        name.toLowerCase(),
        { name: name.toLowerCase(), regex },
      ])).values(),
    );

    const pagetypeData = Array.from(
      new Map(Object.entries(mergedPagetypeRegexes).map(([name, regex]) => [
        name.toLowerCase(),
        { name: name.toLowerCase(), regex },
      ])).values(),
    );

    // Return early if both arrays are empty
    if (productData.length === 0 && pagetypeData.length === 0) {
      log.warn('No pattern data available to generate report');
      return false;
    }

    const reportData = {
      'shared-products': productData,
      'shared-pagetype': pagetypeData,
    };

    const excelConfig = {
      workbookCreator: 'Spacecat Patterns',
      sheets: [
        {
          name: 'shared-products',
          dataKey: 'shared-products',
          type: 'patterns',
        },
        {
          name: 'shared-pagetype',
          dataKey: 'shared-pagetype',
          type: 'patterns',
        },
      ],
    };

    // Create and upload workbook
    const workbook = await createExcelReport(reportData, excelConfig, site);
    const llmoFolder = site.getConfig()?.getLlmoDataFolder();
    const outputLocation = `${llmoFolder}/agentic-traffic/patterns`;
    const filename = 'patterns.xlsx';

    await saveExcelReport({
      sharepointClient,
      workbook,
      filename,
      outputLocation,
      log,
    });

    log.info('Successfully generated and uploaded patterns.xlsx');

    // Wait for the file to be published
    await new Promise((resolve) => {
      setTimeout(resolve, 3000);
    });

    return true;
  } catch (error) {
    log.error(`Failed to generate patterns: ${error.message}`);
    return false;
  }
}
