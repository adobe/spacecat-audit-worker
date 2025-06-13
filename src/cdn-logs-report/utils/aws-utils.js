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
import {
  CreateDatabaseCommand,
  GetDatabaseCommand,
  CreateCrawlerCommand,
  GetCrawlerCommand,
  StartCrawlerCommand,
  GetTablesCommand,
} from '@aws-sdk/client-glue';
import {
  REGEX_PATTERNS,
  TABLE_PREFIX,
  CRAWLER_PREFIX,
  CDN_LOGS_PREFIX,
  DATABASE_CONFIG,
  CRAWLER_CONFIG,
} from '../constants/index.js';

const PARTITION_PROJECTIONS = {
  'projection.enabled': 'true',
  'projection.year.type': 'integer',
  'projection.year.range': '2024,2030',
  'projection.month.type': 'integer',
  'projection.month.range': '1,12',
  'projection.month.digits': '2',
  'projection.day.type': 'integer',
  'projection.day.range': '1,31',
  'projection.day.digits': '2',
  'projection.hour.type': 'integer',
  'projection.hour.range': '0,23',
  'projection.hour.digits': '2',
  has_encrypted_data: 'false',
};

const sanitizeForDomain = (text) => text.replace(REGEX_PATTERNS.URL_SANITIZATION, '_').toLowerCase();
const sanitizeForBucket = (text) => text.replace(REGEX_PATTERNS.BUCKET_SANITIZATION, '-');

export function extractCustomerDomain(site) {
  return sanitizeForDomain(new URL(site.getBaseURL()).host);
}

export function getAnalysisBucket(customerDomain) {
  const bucketCustomer = sanitizeForBucket(customerDomain);
  return `${CDN_LOGS_PREFIX}${bucketCustomer}`;
}

export function getS3Config(site) {
  const customerDomain = extractCustomerDomain(site);
  const bucket = getAnalysisBucket(customerDomain);

  return {
    bucket,
    customerDomain,
    aggregatedLocation: `s3://${bucket}/aggregated/`,
    databaseName: `cdn_logs_${customerDomain}`,
    getAthenaTempLocation: () => `s3://${bucket}/temp/athena-results/`,
  };
}

async function handleGlueCommand(command, operation, log) {
  try {
    return await command;
  } catch (error) {
    log.error(`${operation} failed: ${error.message}`);
    throw error;
  }
}

export async function ensureDatabaseExists(glueClient, databaseName, log) {
  try {
    await glueClient.send(new GetDatabaseCommand({ Name: databaseName }));
    log.info(`Database ${databaseName} already exists`);
    return true;
  } catch (error) {
    if (error.name === 'EntityNotFoundException') {
      log.info(`Creating database ${databaseName}`);
      await handleGlueCommand(
        glueClient.send(new CreateDatabaseCommand({
          DatabaseInput: {
            Name: databaseName,
            Description: DATABASE_CONFIG.DESCRIPTION,
          },
        })),
        'Database creation',
        log,
      );
      log.info(`Database ${databaseName} created successfully`);
      return true;
    }
    throw error;
  }
}

function buildCrawlerConfiguration(crawlerName, databaseName, s3Location) {
  const locationTemplate = `${s3Location}aggregated/analysis_type=\${analysis_type}/year=\${year}/month=\${month}/day=\${day}/hour=\${hour}/`;
  const roleArn = `${CRAWLER_CONFIG.ROLE_PREFIX}${process.env.AWS_ACCOUNT_ID}${CRAWLER_CONFIG.ROLE_SUFFIX}`;

  return {
    Name: crawlerName,
    Description: CRAWLER_CONFIG.DESCRIPTION,
    Role: roleArn,
    DatabaseName: databaseName,
    Targets: {
      S3Targets: [{ Path: s3Location }],
    },
    TablePrefix: TABLE_PREFIX,
    SchemaChangePolicy: CRAWLER_CONFIG.SCHEMA_CHANGE_POLICY,
    RecrawlPolicy: CRAWLER_CONFIG.RECRAWL_POLICY,
    Configuration: JSON.stringify({
      Version: CRAWLER_CONFIG.CONFIG_VERSION,
      CrawlerOutput: {
        Partitions: { AddOrUpdateBehavior: 'InheritFromTable' },
        Tables: { AddOrUpdateBehavior: 'MergeNewColumns' },
      },
      Grouping: { TableGroupingPolicy: 'CombineCompatibleSchemas' },
    }),
    TableLevelConfiguration: {
      '*': {
        Parameters: {
          'storage.location.template': locationTemplate,
          ...PARTITION_PROJECTIONS,
        },
      },
    },
  };
}

async function ensureCrawlerExists(glueClient, crawlerName, databaseName, s3Location, log) {
  const crawlerInput = buildCrawlerConfiguration(crawlerName, databaseName, s3Location);

  try {
    await glueClient.send(new GetCrawlerCommand({ Name: crawlerName }));
    log.info(`Crawler ${crawlerName} already exists`);
  } catch (error) {
    if (error.name === 'EntityNotFoundException') {
      log.info(`Creating crawler ${crawlerName}`);
      await handleGlueCommand(
        glueClient.send(new CreateCrawlerCommand(crawlerInput)),
        'Crawler creation',
        log,
      );
      log.info(`Crawler ${crawlerName} created successfully`);
    } else {
      throw error;
    }
  }

  return crawlerName;
}

async function runCrawler(glueClient, crawlerName, log) {
  log.info(`Starting crawler ${crawlerName}`);

  try {
    await glueClient.send(new StartCrawlerCommand({ Name: crawlerName }));
    log.info(`Crawler ${crawlerName} started successfully`);

    return {
      status: 'started',
      message: 'Crawler started - it will discover tables and schema automatically',
    };
  } catch (error) {
    if (error.name === 'CrawlerRunningException') {
      log.info(`Crawler ${crawlerName} is already running`);
      return {
        status: 'already_running',
        message: 'Crawler is already running',
      };
    }
    throw error;
  }
}

async function checkExistingAggregatedTables(glueClient, databaseName, log) {
  try {
    const response = await glueClient.send(new GetTablesCommand({
      DatabaseName: databaseName,
    }));

    const aggregatedTables = response.TableList
      ?.filter((table) => table.Name.startsWith(TABLE_PREFIX)) || [];

    log.info(`Found ${aggregatedTables.length} existing aggregated tables in database ${databaseName}`);
    return aggregatedTables.length > 0;
  } catch (error) {
    if (error.name === 'EntityNotFoundException') {
      log.info(`Database ${databaseName} not found, no existing tables`);
      return false;
    }
    log.warn(`Error checking existing tables: ${error.message}`);
    return false;
  }
}

export async function setupCrawlerBasedDiscovery(glueClient, databaseName, s3Config, log) {
  const crawlerName = `${CRAWLER_PREFIX}${s3Config.customerDomain}`;

  log.info(`Setting up crawler-based discovery for ${s3Config.aggregatedLocation}`);

  try {
    const hasExistingTables = await checkExistingAggregatedTables(glueClient, databaseName, log);
    if (hasExistingTables) {
      log.info(`Aggregated tables already exist in database ${databaseName}, skipping crawler run`);
    } else {
      await ensureCrawlerExists(
        glueClient,
        crawlerName,
        databaseName,
        s3Config.aggregatedLocation,
        log,
      );
      await runCrawler(glueClient, crawlerName, log);
    }

    log.info(`Crawler setup completed for ${s3Config.customerDomain}`);
  } catch (error) {
    log.error(`Failed to setup crawler: ${error.message}`);
    throw error;
  }
}

/* c8 ignore end */
