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

import { createUnloadQuery } from './query-helpers.js';
import { executeAthenaQuery } from '../utils/athena-client.js';

export class BaseQuery {
  static analysisType = 'baseQuery';

  constructor(hourToProcess, tableName, s3Config) {
    this.hourToProcess = hourToProcess;
    this.tableName = tableName;
    this.s3Config = s3Config;
  }

  getFullTableName() {
    return `cdn_logs_${this.s3Config.customerDomain}.${this.tableName}`;
  }

  // eslint-disable-next-line class-methods-use-this
  getSelectQuery() {
    throw new Error('getSelectQuery() must be implemented in subclass');
  }

  buildUnloadQuery() {
    const selectQuery = this.getSelectQuery();
    const { analysisType } = this.constructor;
    return createUnloadQuery(selectQuery, analysisType, this.hourToProcess, this.s3Config);
  }

  async run(athenaClient, log, databaseName) {
    const unloadQuery = this.buildUnloadQuery();
    await executeAthenaQuery(athenaClient, unloadQuery, this.s3Config, log, databaseName);
    log.info(`${this.constructor.analysisType} UNLOAD completed`);
  }
}
