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

import ExcelJS from 'exceljs';
import fs from 'fs/promises';
import path from 'path';
import { AuditBuilder } from '../common/audit-builder.js';
import { wwwUrlResolver } from '../common/index.js';
// import { createLLMOSharepointClient, saveExcelReport } from '../utils/report-uploader.js';
import { CustomerAnalysis } from './customer-analysis-flow.js';

/* c8 ignore start */
async function getCustomerAnalysisDomain(auditUrl, context, site) {
  const { log } = context;
  const baseURL = site.getBaseURL();

  log.info(`Starting customer analysis audit for site: ${site.getSiteId()}, domain: ${baseURL}`);

  // Customer analysis is always tied to the main domain
  const domain = baseURL;

  log.info(`Customer analysis domain identified: ${domain}`);

  try {
    // Run the customer analysis flow using Azure OpenAI
    log.info('Running customer analysis flow with Azure OpenAI...');
    const analysis = new CustomerAnalysis(domain, context);
    const analysisResult = await analysis.runAnalysis();

    log.info(`Customer analysis completed. Found ${analysisResult.products.length} product-market combinations for ${analysisResult.company_name}.`);

    // Log token usage information
    if (analysisResult.tokenUsage) {
      log.info(`Token Usage: ${analysisResult.tokenUsage.totalTokens.toLocaleString()} total tokens across ${analysisResult.tokenUsage.apiCalls} API calls`);
      log.info(`Duration: ${analysisResult.tokenUsage.durationSeconds}s`);
    }

    // Create Excel workbook with customer analysis data
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Customer Analysis');

    // Add headers
    worksheet.columns = [
      { header: 'Category', key: 'category', width: 30 },
      { header: 'Region', key: 'region', width: 15 },
      { header: 'Topic', key: 'topic', width: 30 },
      { header: 'URL', key: 'url', width: 50 },
    ];

    // Add data rows from analysis results
    if (analysisResult.products && analysisResult.products.length > 0) {
      for (const entry of analysisResult.products) {
        worksheet.addRow({
          category: entry.product || 'N/A',
          region: entry.market || 'N/A',
          topic: entry.topic || 'N/A',
          url: entry.url || 'N/A',
        });
      }
    } else {
      // Add placeholder row if no results
      worksheet.addRow({
        product: 'No products found',
        market: 'N/A',
        confidence: 'N/A',
        evidence: 'N/A',
        url: domain,
      });
    }

    // Save Excel file locally for testing
    const outputDir = './output';
    const filename = `customer-analysis-${site.getSiteId()}-${Date.now()}.xlsx`;
    const outputPath = path.join(outputDir, filename);

    // Debug: Show current working directory
    const cwd = process.cwd();
    log.info(`🔍 Current working directory: ${cwd}`);

    // Ensure output directory exists
    try {
      await fs.mkdir(outputDir, { recursive: true });
      log.info(`📁 Output directory created/verified: ${path.resolve(outputDir)}`);
    } catch (error) {
      log.warn(`Could not create output directory: ${error.message}`);
    }

    // Save the workbook
    try {
      await workbook.xlsx.writeFile(outputPath);
      const absolutePath = path.resolve(outputPath);
      log.info('✅ Successfully saved customer analysis Excel file locally:');
      log.info(`   📄 Filename: ${filename}`);
      log.info(`   📁 Relative Path: ${outputPath}`);
      log.info(`   🔗 Absolute Path: ${absolutePath}`);
    } catch (error) {
      log.error(`Failed to save Excel file: ${error.message}`);
      throw error;
    }

    // await saveExcelReport({
    //   sharepointClient,
    //   workbook,
    //   filename,
    //   outputLocation,
    //   log,
    // });
    //
    // log.info(`Successfully stored customer analysis results in SharePoint
    // : ${outputLocation}/${filename}`);

    // Send message to Mystique for any additional processing if needed
    // const mystiqueMessage = {
    //  type: CUSTOMER_ANALYSIS_FLOW,
    //  siteId: site.getSiteId(),
    //  domain,
    //  deliveryType: site.getDeliveryType(),
    //  time: new Date().toISOString(),
    //  data: {
    //    productsFound: analysisResult.products.length,
    //    analysisCompleted: true,
    //    timestamp: new Date().toISOString(),
    //    localFilePath: outputPath,
    //  },
    // };

    // await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, mystiqueMessage);
    // log.info(`Sent customer analysis completion message for domain: ${domain}`);

    // Final summary of where the file is located
    const absolutePath = path.resolve(outputPath);
    log.info('🎯 CUSTOMER ANALYSIS COMPLETE - EXCEL FILE LOCATION:');
    log.info(`   📄 File: ${filename}`);
    log.info(`   📁 Directory: ${path.resolve(outputDir)}`);
    log.info(`   🔗 Full Path: ${absolutePath}`);

    return {
      auditResult: {
        filename,
        outputPath,
        // outputLocation, // TODO: Re-enable when SharePoint is active
        domain,
        status: 'completed',
        productsFound: analysisResult.products.length,
        analysisCompleted: true,
        tokenUsage: analysisResult.tokenUsage,
      },
      fullAuditRef: auditUrl,
    };
  } catch (error) {
    log.error(`Error during customer analysis: ${error.message}`);

    return {
      auditResult: {
        filename: 'N/A',
        outputPath: 'N/A',
        // outputLocation, // TODO: Re-enable when SharePoint is active
        domain,
        status: 'error',
        error: error.message,
      },
      fullAuditRef: auditUrl,
    };
  }
} /* c8 ignore end */

export default new AuditBuilder()
  .withUrlResolver(wwwUrlResolver)
  .withRunner(getCustomerAnalysisDomain)
  .build();
