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
import { DynamoDBDocumentClient, GetItemCommand, PutCommand } from '@aws-sdk/lib-dynamodb';

const TABLE_SITES = 'spacecat-site';
const TABLE_AUDITS = 'spacecat-audit-index';

export default class DB {
  constructor(context) {
    this.client = new DynamoDBClient({ region: context.runtime.region });
    this.logger = context.log;
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
      this.logger('error', 'Error saving record: ', error);
    }
  }

  /**
   * Saves an audit to the DynamoDB.
   * @param {object} site - Site object containing details of the audited site.
   * @param {object} audit - Audit object containing the type and result of the audit.
   * @returns {Promise<void>} Resolves once audit is saved.
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
    this.logger('info', `Audit for domain ${site.domain} saved successfully at ${now}`);
    await this.saveRecord(newAudit, TABLE_AUDITS);
    return Promise.resolve(newAudit);
  }

  /**
   * Save an error that occurred during a Lighthouse audit to the DynamoDB.
   * @param {object} site - site audited.
   * @param {Error} error - The error that occurred during the audit.
   */
  async saveAuditError(site, error) {
    const now = new Date().toISOString();
    const newAudit = {
      siteId: site.id,
      auditDate: now,
      isLive: site.isLive,
      error: error.message,
      scores: {},
    };
    await this.saveRecord(newAudit, TABLE_AUDITS);
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
      const command = new GetItemCommand(commandParams);
      const response = await this.client.send(command);
      const item = response.Item;
      if (item) {
        this.logger('info', `Item retrieved successfully: ${item}`);
        return item;
      } else {
        this.logger('info', 'Item not found.');
        return null;
      }
    } catch (error) {
      this.logger('error', `Error ${error}`);
      throw error;
    }
  }
}
