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

export class MockContextBuilder {
  withSandbox(sandbox) {
    this.sandbox = sandbox;
    return this;
  }

  withOverrides(contextOverrides) {
    this.contextOverrides = contextOverrides;
    return this;
  }

  build() {
    const mockLog = {
      debug: this.sandbox.spy(),
      info: this.sandbox.spy(),
      warn: this.sandbox.spy(),
      error: this.sandbox.spy(),
    };

    const mockDataAccess = {
      Configuration: {
        findLatest: this.sandbox.stub(),
      },
      Audit: {
        create: this.sandbox.stub(),
      },
      Site: {
        findById: this.sandbox.stub(),
      },
      SiteTopPage: {
        allBySiteIdAndSourceAndGeo: this.sandbox.stub(),
      },
      Organization: {
        findById: this.sandbox.stub(),
      },
      Opportunity: {
        getId: this.sandbox.stub(),
        getType: this.sandbox.stub(),
        allBySiteIdAndStatus: this.sandbox.stub(),
        create: this.sandbox.stub(),
        getSuggestions: this.sandbox.stub(),
        addSuggestions: this.sandbox.stub(),
        setAuditId: this.sandbox.stub(),
        save: this.sandbox.stub(),
      },
    };

    const mockSqs = {
      sendMessage: this.sandbox.stub().resolves(),
    };

    const mockS3Client = {
      send: this.sandbox.stub(),
    };

    const mockEnv = {
      S3_SCRAPER_BUCKET_NAME: 'test-bucket',
    };

    let context = {
      log: mockLog,
      dataAccess: mockDataAccess,
      sqs: mockSqs,
      s3Client: mockS3Client,
      env: mockEnv,
    };

    if (this.contextOverrides) {
      context = {
        ...context,
        ...this.contextOverrides,
      };
    }

    return context;
  }
}
