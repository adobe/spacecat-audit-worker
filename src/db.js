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
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';

const TABLE_SITES = 'spacecat-site';
const TABLE_AUDITS = 'spacecat-audit-index';

export default class DB {
  constructor(context) {
    this.client = new DynamoDBClient({ region: context.runtime.region });
    this.log = context.log;
    this.docClient = DynamoDBDocumentClient.from(this.client);
  }

  /**
   * Save a record to the DynamoDB.
   * @param {object} record - The new record to save.
   * @param tableName - The name of the table to save the record to.
   */
  async saveRecord(record, tableName) {
    try {
      const command = new PutCommand({
        TableName: tableName,
        Item: record,
      });
      await this.docClient.send(command);
    } catch (error) {
      this.log.error(`Error saving record:  ${error}`);
    }
  }

  /**
   * Saves an audit to the DynamoDB.
   * @param {object} site - Site object containing details of the audited site.
   * @param {object} audit - Audit object containing the type and result of the audit.
   * @typedef {Object} audit
   * @property {string} uuid - Audit unique identifier
   * @property {string} siteId - Site unique identifier composed of domain and path.
   * @property {string} auditDate - Date when audit was run.
   * @property {string} type - Type of the run audit (default psi)
   * @property {boolean} isLive - Indicates if the site is live at the time of the audit
   * @property {string} git_hashes - Git commit hashes since the last audit was run.
   * @property {string} tag_manager - Tag manager used for the site and the version.
   * @property {string} error - The error if auditing returned an error.
   * @property {Object[]} auditResults - The minified audit results from the psi checks
   * @param {string} auditResults[].strategy - The psi audit strategy can be desktop or mobile.
   * @param {object} auditResults[].scores - The minified results of the psi audit for the strategy.
   * @param {object} auditResults[].score.performance - The performance score of psi check for
   * the site strategy.
   * @param {object} auditResults[].scores.seo - The seo score of psi check for the site strategy.
   * @param {object} auditResults[].scores.best-practices - The best-practices score of psi check
   * for the site strategy.
   * @param {object} auditResults[].scores.accessibility - The accessibility score of psi check for
   * the site strategy.
   * @returns {Promise<object>} Resolves the new saved audit.
   */
  async saveAuditIndex(site, audit) {
    const now = new Date().toISOString();
    const uuid = Date.now()
      .toString();

    const newAudit = {
      id: uuid,
      siteId: `${site.domain}/${site.path}`,
      audit_date: now,
      type: 'psi',
      is_live: false,
      content_publication_date: '',
      git_hashes: [],
      tag_manager: '',
      error: '',
      auditResults: [
        {
          strategy: 'mobile',
          scores: {
            performance: audit.result.mobile.categories.performance.score,
            seo: audit.result.mobile.categories.seo.score,
            'best-practices': audit.result.mobile.categories['best-practices'].score,
            accessibility: audit.result.mobile.categories.accessibility.score,
          },
        },
        {
          strategy: 'desktop',
          scores: {
            performance: audit.result.desktop.categories.performance.score,
            seo: audit.result.desktop.categories.seo.score,
            'best-practices': audit.result.desktop.categories['best-practices'].score,
            accessibility: audit.result.desktop.categories.accessibility.score,
          },
        },
      ],
    };
    await this.saveRecord(newAudit, TABLE_AUDITS);
    this.log.info(`Saving successful audit for domain ${site.domain} saved successfully`);
    return newAudit;
  }

  /**
   * Save an error that occurred during a Lighthouse audit to the DynamoDB.
   * @param {object} site - site audited.
   * @param {Error} error - The error that occurred during the audit.
   */
  async saveAuditError(site, error) {
    const now = new Date().toISOString();
    const newAudit = {
      siteId: `${site.domain}/${site.path}`,
      auditDate: now,
      error: error.message,
      scores: {},
    };
    await this.saveRecord(newAudit, TABLE_AUDITS);
    this.log.info(`Saving error audit for domain ${site.domain} saved successfully`);
  }

  /**
   * Fetches a site by its ID and gets its latest audit.
   * @param {string} domain - The domain of the site to fetch.
   * @param {string} path - The path of the site to fetch.
   * @returns {Promise<object>} Site document with its latest audit.
   */
  async getSite(domain, path) {
    const commandParams = {
      TableName: TABLE_SITES, // Replace with your table name
      Key: {
        Domain: { S: domain }, // Partition key
        Path: { S: path }, // Sort key
      },
    };

    try {
      const command = new GetCommand(commandParams);
      const response = await this.docClient.send(command);
      const item = response.Item;
      if (item) {
        this.log.info(`Item retrieved successfully: ${item}`);
        return item;
      } else {
        this.log.info('Item not found.');
        return null;
      }
    } catch (error) {
      this.log.error(`Error ${error}`);
      throw error;
    }
  }

  destroy() {
    this.docClient.destroy();
    this.client.destroy();
  }
}
