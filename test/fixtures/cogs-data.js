/*
 * Copyright 2024 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

export const expectedCogsResult = {
  DimensionValueAttributes: [],
  GroupDefinitions: [
    {
      Key: 'SERVICE',
      Type: 'DIMENSION',
    },
    {
      Key: 'Environment',
      Type: 'TAG',
    },
  ],
  NextPageToken: null,
  ResultsByTime: [
    {
      Estimated: false,
      Groups: [
        {
          Keys: [
            'AWS Lambda',
            'Environment$',
          ],
          Metrics: {
            UnblendedCost: {
              Amount: '14.6732180628',
              Unit: 'USD',
            },
          },
        },
        {
          Keys: [
            'AWS Secrets Manager',
            'Environment$',
          ],
          Metrics: {
            UnblendedCost: {
              Amount: '0.093415',
              Unit: 'USD',
            },
          },
        },
        {
          Keys: [
            'Amazon DynamoDB',
            'Environment$',
          ],
          Metrics: {
            UnblendedCost: {
              Amount: '0.095706623',
              Unit: 'USD',
            },
          },
        },
        {
          Keys: [
            'Amazon Simple Queue Service',
            'Environment$',
          ],
          Metrics: {
            UnblendedCost: {
              Amount: '0.17150958',
              Unit: 'USD',
            },
          },
        },
        {
          Keys: [
            'Amazon Simple Storage Service',
            'Environment$',
          ],
          Metrics: {
            UnblendedCost: {
              Amount: '0.0007143178',
              Unit: 'USD',
            },
          },
        },
        {
          Keys: [
            'AmazonCloudWatch',
            'Environment$',
          ],
          Metrics: {
            UnblendedCost: {
              Amount: '0.049616647',
              Unit: 'USD',
            },
          },
        },
      ],
      TimePeriod: {
        End: '2024-01-01',
        Start: '2023-12-01',
      },
      Total: {},
    },
  ],
  ResultMetadata: {},
};
export const expectedCOGSValue = {
  type: 'cogs',
  monthYear: 'Dec-23',
  usageCost: {
    LAMBDA: '14.67',
    'SECRETS MANAGER': '0.09',
    DYNAMODB: '0.10',
    SQS: '0.17',
    S3: '0.00',
    CLOUDWATCH: '0.05',
  },
};
