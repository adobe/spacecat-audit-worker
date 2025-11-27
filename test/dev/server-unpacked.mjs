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
import { DevelopmentServer } from '@adobe/helix-universal-devserver';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';

// eslint-disable-next-line no-underscore-dangle
const rootdir = resolve(fileURLToPath(import.meta.url), '..', '..', '..');

// Load environment variables from .env file in project root
const envPath = resolve(rootdir, '.env');
const result = config({ path: envPath, override: true });

if (result.error) {
  // eslint-disable-next-line no-console
  console.warn('Warning: Could not load .env file:', result.error.message);
} else {
  // eslint-disable-next-line no-console
  console.log('✓ Loaded .env from:', envPath);
}

async function run() {
  try {
    // Import the unpacked version (same as what Lambda runs)
    const unpackedPath = resolve(rootdir, 'dist/spacecat-services/unpacked/index.js');

    // eslint-disable-next-line no-console
    console.log('Loading unpacked bundle from:', unpackedPath);
    // eslint-disable-next-line no-console
    console.log('Working directory:', rootdir);

    // Dynamic import of the unpacked bundle
    const bundle = await import(unpackedPath);

    // The bundle exports an object with runtime adapters: { openwhisk, lambda, google }
    // For local dev, we use the lambda adapter (same as esm-adapter does)
    const { default: exports } = bundle;
    const main = exports?.lambda || exports?.openwhisk || exports?.google;

    if (!main) {
      const availableExports = exports ? Object.keys(exports).join(', ') : 'none';
      throw new Error(`Could not find runtime adapter in bundle. Available exports: ${availableExports}`);
    }

    // eslint-disable-next-line no-console
    console.log('Unpacked bundle loaded successfully (using lambda adapter)');

    // Set environment variables for DevelopmentServer
    process.env.HLX_DEV_SERVER_HOST ??= 'localhost:3000';
    process.env.HLX_DEV_SERVER_SCHEME = 'http';

    // Set mock Lambda environment variables for local dev
    if (!process.env.AWS_REGION) {
      process.env.AWS_REGION = 'us-east-1';
    }
    if (!process.env.AWS_LAMBDA_FUNCTION_NAME) {
      process.env.AWS_LAMBDA_FUNCTION_NAME = 'spacecat-services--audit-worker';
    }

    // Disable AWS X-Ray tracing in local dev
    process.env.AWS_XRAY_SDK_ENABLED = 'false';
    process.env.AWS_XRAY_CONTEXT_MISSING = 'IGNORE_ERROR';

    // Note: The bundled code will try to fetch secrets from AWS Secrets Manager
    // If this fails, make sure your AWS credentials are valid or use 'npm start' instead
    // to run the source code directly (which doesn't have this issue)

    // eslint-disable-next-line no-console
    console.log('AWS_REGION:', process.env.AWS_REGION);
    // eslint-disable-next-line no-console
    console.log('AWS_LAMBDA_FUNCTION_NAME:', process.env.AWS_LAMBDA_FUNCTION_NAME);
    // eslint-disable-next-line no-console
    console.log('\nNote: The bundle will attempt to fetch secrets from AWS Secrets Manager.');
    // eslint-disable-next-line no-console
    console.log('Ensure your AWS credentials in .env are valid, or use "npm start" for source debugging.\n');

    // Wrap to ensure Lambda context properties exist
    // DevelopmentServer should create these, but we ensure they're present
    const wrappedMain = async (event, context) => {
      context.invokedFunctionArn = 'arn:aws:lambda:us-east-1:123456789:function:spacecat-services--audit-worker:latest';

      if (!context.getRemainingTimeInMillis) {
        context.getRemainingTimeInMillis = () => 60000;
      }

      // Fix: DevelopmentServer passes req.headers as a Headers object, not a plain object
      // Headers objects have no enumerable properties, so they appear as {}
      // Convert to plain object so the lambda adapter can use them
      if (event.headers && typeof event.headers.entries === 'function') {
        const plainHeaders = {};
        for (const [key, value] of event.headers.entries()) {
          plainHeaders[key] = value;
        }
        // Create new event with plain headers
        const fixedEvent = { ...event, headers: plainHeaders };

        // Debug: log the event structure
        // eslint-disable-next-line no-console
        console.log('Event pathParameters:', JSON.stringify(fixedEvent.pathParameters));
        // eslint-disable-next-line no-console
        console.log('Event rawPath:', fixedEvent.rawPath);
        // eslint-disable-next-line no-console
        console.log('Event requestContext:', JSON.stringify(fixedEvent.requestContext));

        return main(fixedEvent, context);
      }

      const fixedCtx = {
        ...context,
        func: {
          package: 'spacecat-services',
          name: 'audit-worker',
          version: context.func?.version ?? 'latest',
          ...context.func,
        },
      };

      return main(event, fixedCtx);
    };

    // The bundled lambda export is already a lambda adapter
    // Don't pass it as main - pass a dummy main and provide our adapter via withAdapter
    const dummyMain = async () => ({ statusCode: 200, body: 'OK' });

    const devServer = new DevelopmentServer(dummyMain)
      .withAdapter(wrappedMain)
      .withDirectory(rootdir);

    // eslint-disable-next-line no-console
    console.log('Initializing dev server...');
    await devServer.init();

    // Debug: Check if the dev server has the right config
    // eslint-disable-next-line no-console
    console.log('Dev server initialized. Port:', devServer.port);

    // eslint-disable-next-line no-console
    console.log('Starting dev server on http://localhost:3000');
    await devServer.start();
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Error starting unpacked dev server:', error);
    process.exit(1);
  }
}

run().then(process.stdout).catch(process.stderr);
