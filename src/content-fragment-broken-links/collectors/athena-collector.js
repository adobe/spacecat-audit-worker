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

export class AthenaCollector {
  static DATABASE_NAME = 'broken_content_paths_db';

  static TABLE_NAME = 'broken_content_paths_test';

  constructor(context) {
    this.context = context;
    this.config = this.getAthenaConfig();
    this.athenaClient = AWSAthenaClient.fromContext(context, this.config.tempLocation);
  }

  static createFrom(context) {
    return new AthenaCollector(context);
  }

  getAthenaConfig() {
    const { rawBucket, imsOrg, tenant } = this.context;
    const bucket = `${rawBucket}/${imsOrg}`;

    return {
      database: AthenaCollector.DATABASE_NAME,
      tableName: AthenaCollector.TABLE_NAME,
      location: `s3://${bucket}/aggregated-404`,
      tempLocation: `s3://${rawBucket}/temp/athena-results/`,
      tenant,
    };
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
      tenant: this.config.tenant,
    });

    const sqlQueryDescription = `[Athena Query] Fetch broken content paths for ${year}-${month}-${day}`;
    const result = await this.athenaClient.query(
      sqlQuery,
      this.config.database,
      sqlQueryDescription,
    );

    const urls = result.map((row) => row.url).filter(Boolean);
    return urls;
  }
}
