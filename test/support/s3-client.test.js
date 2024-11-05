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

/* eslint-env mocha */

import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { S3Client } from '@aws-sdk/client-s3';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import s3Client from '../../src/support/s3-client.js';

use(sinonChai);
use(chaiAsPromised);

describe('s3Client middleware', () => {
  let mockFn;
  let request;
  let context;

  beforeEach(() => {
    mockFn = sinon.stub().resolves({ statusCode: 200, body: 'Success' });
    request = {};
    context = { env: { AWS_REGION: 'us-west-2' } };
  });

  afterEach(() => {
    sinon.restore();
  });

  it('should add an S3Client instance to context if not already present', async () => {
    const wrappedFunction = s3Client(mockFn);

    await wrappedFunction(request, context);

    expect(context.s3Client).to.be.an.instanceof(S3Client);
    expect(mockFn).to.have.been.calledOnceWith(request, context);
  });

  it('should not overwrite existing S3Client instance in context', async () => {
    const existingS3Client = new S3Client();
    context.s3Client = existingS3Client;

    const wrappedFunction = s3Client(mockFn);

    await wrappedFunction(request, context);

    expect(context.s3Client).to.equal(existingS3Client);
    expect(mockFn).to.have.been.calledOnceWith(request, context);
  });

  it('should return the response from the passed function', async () => {
    const wrappedFunction = s3Client(mockFn);

    const response = await wrappedFunction(request, context);

    expect(response).to.deep.equal({ statusCode: 200, body: 'Success' });
  });

  it('should throw an error if the passed function throws', async () => {
    mockFn.rejects(new Error('Some error'));
    const wrappedFunction = s3Client(mockFn);

    await expect(wrappedFunction(request, context)).to.be.rejectedWith('Some error');
  });
});
