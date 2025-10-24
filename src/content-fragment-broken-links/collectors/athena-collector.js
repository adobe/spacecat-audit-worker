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

import { getStaticContent } from '@adobe/spacecat-shared-utils';
import { AWSAthenaClient } from '@adobe/spacecat-shared-athena-client';
import { getImsOrgId } from '../../utils/data-access.js';
import { isAssetUrl } from '../../utils/asset-utils.js';
import { extractCustomerDomain } from '../../utils/cdn-utils.js';

export class AthenaCollector {
  // TODO: Change to a dynamic database name
  static DATABASE_NAME = 'broken_content_paths_db';

  // TODO: Change to a dynamic table name
  static TABLE_NAME = 'broken_content_paths_test';

  constructor(context) {
    this.context = context;
  }

  static async createFrom(context) {
    const { site, dataAccess, log } = context;

    const imsOrg = await getImsOrgId(site, dataAccess, log);
    if (!imsOrg) {
      throw new Error('Unable to retrieve IMS organization ID');
    }

    const collector = new AthenaCollector(context);
    collector.imsOrg = imsOrg;
    collector.sanitizedHostname = extractCustomerDomain(site);
    collector.initialize();
    return collector;
  }

  static getPreviousDayParts() {
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    return AthenaCollector.getDateParts(yesterday);
  }

  static getDateParts(date = new Date()) {
    const year = date.getUTCFullYear().toString();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');

    return { year, month, day };
  }

  static async loadSql(filename, variables) {
    return getStaticContent(variables, `./src/content-fragment-broken-links/sql/${filename}.sql`);
  }

  initialize() {
    this.validate();
    this.config = this.getAthenaConfig();
    this.athenaClient = AWSAthenaClient.fromContext(this.context, this.config.tempLocation);
  }

  validate() {
    const { env } = this.context;

    if (!env.S3_BUCKET) {
      throw new Error('Raw bucket is required');
    }

    if (!this.imsOrg) {
      throw new Error('IMS organization is required');
    }

    if (!this.sanitizedHostname) {
      throw new Error('Sanitized hostname is required');
    }
  }

  getAthenaConfig() {
    const { env } = this.context;
    const bucket = `${env.S3_BUCKET}/${this.imsOrg}`;

    return {
      database: AthenaCollector.DATABASE_NAME,
      tableName: AthenaCollector.TABLE_NAME,
      location: `s3://${bucket}/aggregated-404`,
      tempLocation: `s3://${env.S3_BUCKET}/temp/athena-results/`,
    };
  }

  async ensureDatabase() {
    const sqlDb = await AthenaCollector.loadSql('create-database', {
      database: this.config.database,
    });

    const sqlDbDescription = `[Athena Query] Create database ${this.config.database}`;
    await this.athenaClient.execute(sqlDb, this.config.database, sqlDbDescription);
  }

  async ensureTable() {
    const sqlTable = await AthenaCollector.loadSql('create-table', {
      database: this.config.database,
      tableName: this.config.tableName,
      location: this.config.location,
    });

    const sqlTableDescription = `[Athena Query] Create table ${this.config.database}.${this.config.tableName}`;
    await this.athenaClient.execute(sqlTable, this.config.database, sqlTableDescription);
  }

  async fetchBrokenPaths() {
    const { log } = this.context;
    const { year, month, day } = AthenaCollector.getPreviousDayParts();

    log.info(`Fetching broken content paths for ${year}-${month}-${day} from Athena`);

    try {
      await this.ensureDatabase();
      await this.ensureTable();

      const brokenPaths = await this.queryBrokenPaths(year, month, day);

      log.info(`Found ${brokenPaths.length} broken content paths from Athena`);
      return brokenPaths;
    } catch (error) {
      log.error(`Athena query failed: ${error.message}`);
      throw new Error(`Athena query failed: ${error.message}`);
    }
  }

  async queryBrokenPaths(year, month, day) {
    const sqlQuery = await AthenaCollector.loadSql('daily-query', {
      database: this.config.database,
      tableName: this.config.tableName,
      year,
      month,
      day,
    });

    const sqlQueryDescription = `[Athena Query] Fetch broken content paths for ${year}-${month}-${day}`;
    const result = await this.athenaClient.query(
      sqlQuery,
      this.config.database,
      sqlQueryDescription,
    );

    // Group by URL and collect all user agents for each URL, excluding assets (for now)
    const urlMap = new Map();
    result.filter((row) => row.url && !isAssetUrl(row.url)).forEach((row) => {
      const { url, request_user_agent: userAgent } = row;
      if (!urlMap.has(url)) {
        urlMap.set(url, []);
      }
      if (userAgent && !urlMap.get(url).includes(userAgent)) {
        urlMap.get(url).push(userAgent);
      }
    });

    const brokenPaths = Array.from(urlMap.entries()).map(([url, userAgents]) => ({
      url,
      requestUserAgents: userAgents,
    }));

    return brokenPaths;
  }
}
