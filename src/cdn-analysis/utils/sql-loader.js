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
/* eslint-disable no-underscore-dangle */

/* c8 ignore start */
import { promises as fs } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

/**
 * Load a .sql file from /sql/{provider}/{name}.sql and replace ${tokens}.
 *
 * @param {string} provider – e.g. 'akamai' or 'fastly'
 * @param {string} name     – filename without “.sql”
 * @param {Record<string,string>} vars – map of placeholder→value
 */
export async function loadSql(provider, name, vars) {
  // resolve path relative to this module
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  const filePath = path.join(__dirname, '..', 'sql', provider, `${name}.sql`);
  let sql = await fs.readFile(filePath, 'utf8');

  // simple ${key} → value replacement
  for (const [key, val] of Object.entries(vars)) {
    sql = sql.replace(new RegExp(`\\$\\{${key}\\}`, 'g'), val);
  }

  return sql;
}
/* c8 ignore stop */
