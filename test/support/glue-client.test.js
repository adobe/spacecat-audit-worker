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

/* eslint-env mocha */

import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { GlueClient } from '@aws-sdk/client-glue';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import glueClient from '../../src/support/glue-client.js';

use(sinonChai);
use(chaiAsPromised);

describe('glueClient middleware', () => {
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

  it('should add a GlueClient instance to context if not already present', async () => {
    const wrappedFunction = glueClient(mockFn);

    await wrappedFunction(request, context);

    expect(context.glueClient).to.be.an.instanceof(GlueClient);
    expect(mockFn).to.have.been.calledOnceWith(request, context);
  });

  it('should not overwrite existing GlueClient instance in context', async () => {
    const existingGlueClient = new GlueClient();
    context.glueClient = existingGlueClient;

    const wrappedFunction = glueClient(mockFn);

    await wrappedFunction(request, context);

    expect(context.glueClient).to.equal(existingGlueClient);
    expect(mockFn).to.have.been.calledOnceWith(request, context);
  });

  it('should use default region us-east-1 when AWS_REGION is not provided', async () => {
    context = { env: {} };
    const wrappedFunction = glueClient(mockFn);

    await wrappedFunction(request, context);

    expect(context.glueClient).to.be.an.instanceof(GlueClient);
    expect(mockFn).to.have.been.calledOnceWith(request, context);
  });

  it('should use default region us-east-1 when env is not provided', async () => {
    context = {};
    const wrappedFunction = glueClient(mockFn);

    await wrappedFunction(request, context);

    expect(context.glueClient).to.be.an.instanceof(GlueClient);
    expect(mockFn).to.have.been.calledOnceWith(request, context);
  });

  it('should use default region us-east-1 when AWS_REGION is null', async () => {
    context = { env: { AWS_REGION: null } };
    const wrappedFunction = glueClient(mockFn);

    await wrappedFunction(request, context);

    expect(context.glueClient).to.be.an.instanceof(GlueClient);
    expect(mockFn).to.have.been.calledOnceWith(request, context);
  });

  it('should use default region us-east-1 when AWS_REGION is undefined', async () => {
    context = { env: { AWS_REGION: undefined } };
    const wrappedFunction = glueClient(mockFn);

    await wrappedFunction(request, context);

    expect(context.glueClient).to.be.an.instanceof(GlueClient);
    expect(mockFn).to.have.been.calledOnceWith(request, context);
  });

  it('should return the response from the passed function', async () => {
    const wrappedFunction = glueClient(mockFn);

    const response = await wrappedFunction(request, context);

    expect(response).to.deep.equal({ statusCode: 200, body: 'Success' });
  });

  it('should throw an error if the passed function throws', async () => {
    mockFn.rejects(new Error('Some error'));
    const wrappedFunction = glueClient(mockFn);

    await expect(wrappedFunction(request, context)).to.be.rejectedWith('Some error');
  });
});
