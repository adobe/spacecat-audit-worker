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
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { log } from './util.js';
import {json} from 'mocha/lib/reporters/index.js';

const TABLE_SITES = 'spacecat-site';
const TABLE_AUDITS = 'spacecat-audit-index';

function DB(config) {
  const client = new DynamoDBClient({ region: config.region });
  const docClient = DynamoDBDocumentClient.from(client);

  /**
   * Save a record to the DynamoDB.
   * @param {object} record - The new record to save.
   * @param tableName - The name of the table to save the record to.
   */
  async function saveRecord(record, tableName) {
    try {
      const command = new PutCommand({
        TableName: tableName,
        Item: record,
      });
      await docClient.send(command);
    } catch (error) {
      log('error', 'Error saving record: ', error);
    }
  }
  /**
     * Saves an audit to the DynamoDB.
     * @param {object} site - Site object containing details of the audited site.
     * @param {object} audit - Audit object containing the type and result of the audit.
     * @returns {Promise<void>} Resolves once audit is saved.
     */
  async function saveAuditIndex(site, audit) {
    const now = new Date().toISOString();
    const uuid = Date.now().toString();

    const newAudit = {
      id: uuid,
      siteId: site.id,
      auditDate: now,
      isLive: site.isLive,
      scores: {
        mobile: {
          performance: audit.result.mobile.categories.performance.score,
          seo: audit.result.mobile.categories.seo.score,
          'best-practices': audit.result.mobile.categories['best-practices'].score,
          accessibility: audit.result.mobile.categories.accessibility.score,
        },
        desktop: {
          performance: audit.result.desktop.categories.performance.score,
          seo: audit.result.desktop.categories.seo.score,
          'best-practices': audit.result.desktop.categories['best-practices'].score,
          accessibility: audit.result.desktop.categories.accessibility.score,
        },
      },
    };
    await saveRecord(newAudit, TABLE_AUDITS);
    log('info', `Audit for domain ${site.domain} saved successfully at ${now}`);
  }

  async function saveSite(site) {
    const now = new Date().toISOString();
    await saveRecord(site, TABLE_SITES);
    log('info', `Site for domain ${site.domain} saved successfully at ${now}`);
  }
  /**
     * Save an error that occurred during a Lighthouse audit to the DynamoDB.
     * @param {object} site - site audited.
     * @param {Error} error - The error that occurred during the audit.
     */
  async function saveAuditError(site, error) {
    const now = new Date().toISOString();
    const newAudit = {
      siteId: site.id,
      auditDate: now,
      isLive: site.isLive,
      error: error.message,
      scores: {},
    };
    await saveRecord(newAudit, TABLE_AUDITS);
  }
  /**
     * Fetches a site by its ID and gets its latest audit.
     * @param {string} siteId - The ID of the site to fetch.
     * @returns {Promise<object>} Site document with its latest audit.
     */
  async function findSiteById(siteId) {
    try {
      const siteParams = {
        TableName: TABLE_SITES,
        Key: {
          id: siteId,
        },
      };
      const siteResult = await dynamoDb.get(siteParams);
      if (!siteResult.Item) return null;
      const auditParams = {
        TableName: TABLE_AUDITS,
        KeyConditionExpression: 'siteId = :siteId',
        ExpressionAttributeValues: {
          ':siteId': siteId,
        },
        Limit: 1,
        ScanIndexForward: false, // get the latest audit
      };
      const auditResult = await dynamoDb.query(auditParams);
      // eslint-disable-next-line prefer-destructuring
      siteResult.Item.latestAudit = auditResult.Items[0];

      return siteResult.Item;
    } catch (error) {
      console.error('Error getting site by site id:', error.message);
      return Error(error.message);
    }
  }
  return {
    findSiteById,
    saveAuditIndex,
    saveAuditError,
    saveSite,
  };
}

export default DB;
