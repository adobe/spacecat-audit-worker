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
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import chaiAsPromised from 'chai-as-promised';
import esmock from 'esmock';

use(sinonChai);
use(chaiAsPromised);

function createAsyncBufferStream(buffer) {
  return {
    /* eslint-disable generator-star-spacing */
    async* [Symbol.asyncIterator]() {
      yield buffer;
    },
  };
}

describe('cdn-utils', () => {
  let sandbox;
  let s3Stub;
  let zlibStub;
  let utils;
  let bufferFromStream;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    s3Stub = { send: sandbox.stub() };
    zlibStub = { gunzipSync: sandbox.stub() };
    utils = await esmock('../../../src/cdn-analysis/utils/cdn-utils.js', {
      zlib: zlibStub,
      '@adobe/spacecat-shared-utils': { hasText: (v) => typeof v === 'string' && v.length > 0 },
    });
    bufferFromStream = (async (stream) => {
      const chunks = [];
      // eslint-disable-next-line no-restricted-syntax
      for await (const c of stream) chunks.push(c);
      return Buffer.concat(chunks);
    });
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('exports CDN_TYPES', () => {
    expect(utils.CDN_TYPES).to.have.property('AKAMAI', 'akamai');
    expect(utils.CDN_TYPES).to.have.property('FASTLY', 'fastly');
  });

  it('bufferFromStream returns buffer from async iterable', async () => {
    const chunks = [Buffer.from('a'), Buffer.from('b')];
    const stream = {
      async* [Symbol.asyncIterator]() {
        yield* chunks;
      },
    };
    const buf = await bufferFromStream(stream);
    expect(buf.toString()).to.equal('ab');
  });

  it('determineCdnProvider returns AKAMAI for .gz file with reqPath', async () => {
    s3Stub.send.onFirstCall().resolves({ Contents: [{ Key: 'logs/file.gz' }] });
    const fakeBody = Buffer.from('{"reqPath":"/foo"}\n');
    zlibStub.gunzipSync.returns(fakeBody);
    s3Stub.send.onSecondCall().resolves({ Body: createAsyncBufferStream(fakeBody) });
    const result = await utils.determineCdnProvider(s3Stub, 'bucket', 'prefix');
    expect(result).to.equal('akamai');
  });

  it('determineCdnProvider returns FASTLY for .gz file with url', async () => {
    s3Stub.send.onFirstCall().resolves({ Contents: [{ Key: 'logs/file.gz' }] });
    const fakeBody = Buffer.from('{"url":"/foo"}\n');
    zlibStub.gunzipSync.returns(fakeBody);
    s3Stub.send.onSecondCall().resolves({ Body: createAsyncBufferStream(fakeBody) });
    const result = await utils.determineCdnProvider(s3Stub, 'bucket', 'prefix');
    expect(result).to.equal('fastly');
  });

  it('determineCdnProvider returns FASTLY for non-gz file with url', async () => {
    s3Stub.send.onFirstCall().resolves({ Contents: [{ Key: 'logs/file.json' }] });
    const fakeBody = Buffer.from('{"url":"/foo"}\n');
    s3Stub.send.onSecondCall().resolves({ Body: createAsyncBufferStream(fakeBody) });
    const result = await utils.determineCdnProvider(s3Stub, 'bucket', 'prefix');
    expect(result).to.equal('fastly');
  });

  it('determineCdnProvider returns FASTLY if no key found', async () => {
    s3Stub.send.onFirstCall().resolves({ Contents: [] });
    const result = await utils.determineCdnProvider(s3Stub, 'bucket', 'prefix');
    expect(result).to.equal('fastly');
  });

  it('determineCdnProvider throws on unrecognized content', async () => {
    s3Stub.send.onFirstCall().resolves({ Contents: [{ Key: 'logs/file.json' }] });
    const fakeBody = Buffer.from('{"foo":"bar"}\n');
    s3Stub.send.onSecondCall().resolves({ Body: createAsyncBufferStream(fakeBody) });
    await expect(
      utils.determineCdnProvider(s3Stub, 'bucket', 'prefix'),
    ).to.be.rejectedWith('Unrecognized CDN Type. Bucket: bucket');
  });

  it('determineCdnProvider throws on invalid JSON', async () => {
    s3Stub.send.onFirstCall().resolves({ Contents: [{ Key: 'logs/file.json' }] });
    const fakeBody = Buffer.from('not a json\n');
    s3Stub.send.onSecondCall().resolves({ Body: createAsyncBufferStream(fakeBody) });
    await expect(
      utils.determineCdnProvider(s3Stub, 'bucket', 'prefix'),
    ).to.be.rejectedWith('Unrecognized CDN Type. Bucket: bucket');
  });
});
