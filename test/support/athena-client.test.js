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
import { AthenaClient } from '@aws-sdk/client-athena';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import athenaClient from '../../src/support/athena-client.js';

use(sinonChai);
use(chaiAsPromised);

describe('athenaClient middleware', () => {
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

  it('should add an AthenaClient instance to context if not already present', async () => {
    const wrappedFunction = athenaClient(mockFn);

    await wrappedFunction(request, context);

    expect(context.athenaClient).to.be.an.instanceof(AthenaClient);
    expect(mockFn).to.have.been.calledOnceWith(request, context);
  });

  it('should not overwrite existing AthenaClient instance in context', async () => {
    const existingAthenaClient = new AthenaClient();
    context.athenaClient = existingAthenaClient;

    const wrappedFunction = athenaClient(mockFn);

    await wrappedFunction(request, context);

    expect(context.athenaClient).to.equal(existingAthenaClient);
    expect(mockFn).to.have.been.calledOnceWith(request, context);
  });

  it('should use default region us-east-1 when AWS_REGION is not provided', async () => {
    context = { env: {} };
    const wrappedFunction = athenaClient(mockFn);

    await wrappedFunction(request, context);

    expect(context.athenaClient).to.be.an.instanceof(AthenaClient);
    expect(mockFn).to.have.been.calledOnceWith(request, context);
  });

  it('should use default region us-east-1 when env is not provided', async () => {
    context = {};
    const wrappedFunction = athenaClient(mockFn);

    await wrappedFunction(request, context);

    expect(context.athenaClient).to.be.an.instanceof(AthenaClient);
    expect(mockFn).to.have.been.calledOnceWith(request, context);
  });

  it('should use default region us-east-1 when AWS_REGION is null', async () => {
    context = { env: { AWS_REGION: null } };
    const wrappedFunction = athenaClient(mockFn);

    await wrappedFunction(request, context);

    expect(context.athenaClient).to.be.an.instanceof(AthenaClient);
    expect(mockFn).to.have.been.calledOnceWith(request, context);
  });

  it('should use default region us-east-1 when AWS_REGION is undefined', async () => {
    context = { env: { AWS_REGION: undefined } };
    const wrappedFunction = athenaClient(mockFn);

    await wrappedFunction(request, context);

    expect(context.athenaClient).to.be.an.instanceof(AthenaClient);
    expect(mockFn).to.have.been.calledOnceWith(request, context);
  });

  it('should return the response from the passed function', async () => {
    const wrappedFunction = athenaClient(mockFn);

    const response = await wrappedFunction(request, context);

    expect(response).to.deep.equal({ statusCode: 200, body: 'Success' });
  });

  it('should throw an error if the passed function throws', async () => {
    mockFn.rejects(new Error('Some error'));
    const wrappedFunction = athenaClient(mockFn);

    await expect(wrappedFunction(request, context)).to.be.rejectedWith('Some error');
  });
});
