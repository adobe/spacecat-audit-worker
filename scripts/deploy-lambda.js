#!/usr/bin/env node

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

import { execSync } from 'child_process';
import { readFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Configuration constants
const LAMBDA_CONFIG = {
  functionName: 'spacecat-services--audit-worker',
  runtime: 'nodejs22.x',
  handler: 'index.lambda',
  role: 'arn:aws:iam::000000000000:role/spacecat-role-lambda-generic',
  timeout: 900,
  memorySize: 6144,
  aliasName: 'latest',
};

const QUEUE_ARNS = {
  auditJobs: 'arn:aws:sqs:us-east-1:000000000000:spacecat-audit-jobs',
  mystiqueToSpacecat: 'arn:aws:sqs:us-east-1:000000000000:mystique-to-spacecat',
};

const SECRET_NAMES = {
  auditWorker: '/helix-deploy/spacecat-services/audit-worker/latest',
  all: '/helix-deploy/spacecat-services/all',
};

function checkAwsLocal() {
  try {
    execSync('which awslocal', { stdio: 'pipe' });
    return true;
  } catch (error) {
    return false;
  }
}

function secretExists(secretName) {
  try {
    execSync(`awslocal secretsmanager get-secret-value --secret-id "${secretName}"`, {
      stdio: 'pipe',
    });
    return true;
  } catch (error) {
    return false;
  }
}

function lambdaExists(functionName) {
  try {
    execSync(`awslocal lambda get-function --function-name ${functionName}`, {
      stdio: 'pipe',
    });
    return true;
  } catch (error) {
    return false;
  }
}

function aliasExists(functionName, aliasName) {
  try {
    execSync(`awslocal lambda get-alias --function-name ${functionName} --name ${aliasName}`, {
      stdio: 'pipe',
    });
    return true;
  } catch (error) {
    return false;
  }
}

function eventSourceMappingExists(functionName, queueArn) {
  try {
    const output = execSync(
      `awslocal lambda list-event-source-mappings --function-name ${functionName}`,
      { encoding: 'utf-8' },
    );
    const mappings = JSON.parse(output);
    return mappings.EventSourceMappings.some((mapping) => mapping.EventSourceArn === queueArn);
  } catch (error) {
    return false;
  }
}

async function main() {
  console.log('🚀 Starting Lambda deployment to LocalStack...');

  // Check if awslocal is available
  if (!checkAwsLocal()) {
    console.error('❌ Error: awslocal CLI is not available');
    console.error('  Please install awslocal CLI following the instructions at:');
    console.error('  https://github.com/localstack/awscli-local');
    process.exit(1);
  }

  console.log('✅ awslocal CLI is available');

  // Parse version from package.json
  const packageJsonPath = join(__dirname, '..', 'package.json');
  const packageJsonContent = await readFile(packageJsonPath, 'utf-8');
  const packageJson = JSON.parse(packageJsonContent);
  const { version } = packageJson;

  console.log(`📦 Package version: ${version}`);

  // Check if secrets exist
  console.log('🔐 Checking for required secrets...');
  for (const secretName of Object.values(SECRET_NAMES)) {
    if (!secretExists(secretName)) {
      console.error(`❌ Error: Secret ${secretName} does not exist`);
      console.error('   Please create this secret in LocalStack first.');
      process.exit(1);
    }
    console.log(`✅ Secret ${secretName} exists`);
  }

  // Build Lambda function with helix-deploy
  console.log('🔨 Building Lambda function...');
  try {
    execSync('npm run localstack:build', {
      stdio: 'inherit',
      cwd: join(__dirname, '..'),
    });
    console.log('✅ Build completed successfully');
  } catch (error) {
    console.error('❌ Build failed');
    process.exit(1);
  }

  // Determine zip file path
  const zipFilePath = join(__dirname, '..', 'dist', 'spacecat-services', `audit-worker@${version}.zip`);
  console.log(`📦 Using deployment package: ${zipFilePath}`);

  // Check if lambda function already exists
  const functionExists = lambdaExists(LAMBDA_CONFIG.functionName);
  if (!functionExists) {
    // Create Lambda function
    console.log(`🚀 Creating Lambda function ${LAMBDA_CONFIG.functionName}...`);
    try {
      execSync(
        `awslocal lambda create-function \
          --function-name ${LAMBDA_CONFIG.functionName} \
          --runtime ${LAMBDA_CONFIG.runtime} \
          --zip-file fileb://${zipFilePath} \
          --handler ${LAMBDA_CONFIG.handler} \
          --role ${LAMBDA_CONFIG.role} \
          --timeout ${LAMBDA_CONFIG.timeout} \
          --memory-size ${LAMBDA_CONFIG.memorySize} \
          --no-cli-pager`,
        { stdio: 'inherit' },
      );
      console.log('✅ Lambda function created successfully');
    } catch (error) {
      console.error('❌ Failed to create Lambda function');
      process.exit(1);
    }
  } else {
    // Update Lambda function code
    console.log(`🔄 Updating Lambda function code for ${LAMBDA_CONFIG.functionName}...`);
    try {
      execSync(
        `awslocal lambda update-function-code \
          --function-name ${LAMBDA_CONFIG.functionName} \
          --zip-file fileb://${zipFilePath} \
          --no-cli-pager`,
        { stdio: 'inherit' },
      );
      console.log('✅ Lambda function code updated successfully');
    } catch (error) {
      console.error('❌ Failed to update Lambda function code');
      process.exit(1);
    }
  }

  // Check and create alias if needed
  const hasAlias = aliasExists(LAMBDA_CONFIG.functionName, LAMBDA_CONFIG.aliasName);
  if (!hasAlias) {
    console.log(`🏷️  Creating alias ${LAMBDA_CONFIG.aliasName}...`);
    try {
      execSync(
        `awslocal lambda create-alias \
          --function-name ${LAMBDA_CONFIG.functionName} \
          --name ${LAMBDA_CONFIG.aliasName} \
          --function-version '$LATEST' \
          --no-cli-pager`,
        { stdio: 'inherit' },
      );
      console.log('✅ Alias created successfully');
    } catch (error) {
      console.error('❌ Failed to create alias');
      process.exit(1);
    }
  } else {
    console.log(`✅ Alias ${LAMBDA_CONFIG.aliasName} already exists`);
  }

  // Create event source mappings for all queues
  for (const [queueName, queueArn] of Object.entries(QUEUE_ARNS)) {
    const hasMapping = eventSourceMappingExists(
      `${LAMBDA_CONFIG.functionName}:${LAMBDA_CONFIG.aliasName}`,
      queueArn,
    );

    if (!hasMapping) {
      console.log(`📥 Creating event source mapping for ${queueName} queue...`);
      try {
        execSync(
          `awslocal lambda create-event-source-mapping \
            --function-name ${LAMBDA_CONFIG.functionName}:${LAMBDA_CONFIG.aliasName} \
            --event-source-arn ${queueArn} \
            --batch-size 1 \
            --maximum-batching-window-in-seconds 0 \
            --scaling-config MaximumConcurrency=50 \
            --enabled \
            --no-cli-pager`,
          { stdio: 'inherit' },
        );
        console.log(`✅ Event source mapping for ${queueName} created successfully`);
      } catch (error) {
        console.error(`❌ Failed to create event source mapping for ${queueName}`);
        process.exit(1);
      }
    } else {
      console.log(`✅ Event source mapping for ${queueName} already exists`);
    }
  }

  console.log('🎉 Lambda deployment completed successfully!');
}

main().catch((error) => {
  console.error('❌ Deployment failed:', error.message);
  process.exit(1);
});

