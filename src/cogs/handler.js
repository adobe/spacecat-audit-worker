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
import { CostExplorerClient, GetCostAndUsageCommand } from '@aws-sdk/client-cost-explorer';
import { internalServerError, noContent, notFound } from '@adobe/spacecat-shared-http-utils';

/**
 * This function builds the input for AWS Cost Explorer API
 * @param {string} startDate start date in YYYY/MM/DD format like 2021/01/01
 * @param {string} endDate end date in YYYY/MM/DD format like 2021/01/31
 * @returns {Object} input
 */
function buildAWSInput(startDate, endDate) {
  return {
    TimePeriod: {
      End: endDate,
      Start: startDate,
    },
    Granularity: 'MONTHLY',
    Filter: {
      Tags: {
        Key: 'Adobe.ArchPath',
        Values: ['EC.SpaceCat.Services'],
        MatchOptions: ['EQUALS'],
      },
    },
    Metrics: [
      'UnblendedCost',
    ],
    GroupBy: [
      {
        Key: 'SERVICE',
        Type: 'DIMENSION',
      },
      {
        Key: 'Environment',
        Type: 'TAG',
      },
    ],
  };
}

/**
 * This function parses the date in YYYY/MM/DD format like 2021/01/01 and return the date in
 * @param {string} date format like 2021-01-01
 * @returns string like Jan-21
 */
const parseYearDate = (date) => {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthYear = new Date(date);
  return `${months[monthYear.getMonth()]}-${monthYear.getFullYear().toString().substring(2)}`;
};

/**
 * This function maps the AWS service name to the service name used in SpaceCat
 * @param {string} service AWS service name
 * @returns string like LAMBDA
 */
const serviceMap = (service) => {
  switch (service) {
    case 'AWS Lambda':
      return 'LAMBDA';
    case 'AWS Secrets Manager':
      return 'SECRETS MANAGER';
    case 'Amazon DynamoDB':
      return 'DYNAMODB';
    case 'Amazon Simple Storage Service':
      return 'S3';
    case 'Amazon Simple Queue Service':
      return 'SQS';
    case 'AmazonCloudWatch':
      return 'CLOUDWATCH';
    default:
      return service;
  }
};

/**
 * This function processes the response from AWS Cost Explorer API
 * @param {Object} data response from AWS Cost Explorer API
 * @returns {Object} results by month and Year wise.
 */
function processAWSResponse(data) {
  if (data && data.ResultsByTime && data.ResultsByTime.length > 0) {
    const result = {};
    data.ResultsByTime.forEach((r) => {
      if (r.Groups && r.Groups.length > 0) {
        const granularity = {};
        r.Groups.forEach((group) => {
          const key = group.Keys[0];
          if (group.Metrics && group.Metrics.UnblendedCost) {
            // eslint-disable-next-line max-len
            granularity[serviceMap(key)] = parseFloat(group.Metrics.UnblendedCost.Amount).toFixed(2);
          }
        });
        result[parseYearDate(r.TimePeriod.Start)] = granularity;
      }
    });
    return result;
  }
  return {};
}
export default async function auditCOGs(message, context) {
  const { type, startDate, endDate } = message;
  const { log, sqs } = context;
  const { awsRegion } = context.runtime;
  const {
    COGS_AWS_ACCESS_KEY: cogsAwsAccessKey,
    COGS_AWS_SECRET_ACCESS_KEY: cogsAwsSecretKey,
  } = context.env;

  log.info(`Fetching Cost Usage from ${startDate} to ${endDate}`);

  try {
    const client = new CostExplorerClient(
      {
        region: awsRegion,
        credentials: {
          accessKeyId: cogsAwsAccessKey,
          secretAccessKey: cogsAwsSecretKey,
        },
      },
    );
    const input = buildAWSInput(startDate, endDate);
    const command = new GetCostAndUsageCommand(input);
    const response = await client.send(command);
    const usageCost = processAWSResponse(response);
    if (Object.keys(usageCost).length === 0) {
      log.info(`No Cost Usage found from ${startDate} to ${endDate}`);
      return notFound('No Cost Usage found');
    }
    Object.keys(usageCost).forEach(async (monthYear) => {
      await sqs.sendMessage(monthYear, {
        type,
        ...usageCost[monthYear],
      });
    });

    log.info(`Successfully fetched Cost Usage from ${startDate} to ${endDate}`);
    return noContent();
  } catch (e) {
    return internalServerError(e.message);
  }
}
