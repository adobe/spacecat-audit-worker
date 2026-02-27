/*
 * Copyright 2026 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import { mapDrsPromptsToSchema, writeDrsPromptsToS3 } from '../../src/drs-prompt-generation/drs-parquet-writer.js';

use(sinonChai);

describe('DRS Parquet Writer', () => {
  let sandbox;

  before('setup', () => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('mapDrsPromptsToSchema', () => {
    it('maps DRS fields to parquet schema', () => {
      const drsPrompts = [
        {
          prompt: 'What is Adobe Creative Cloud?',
          region: 'us',
          category: 'creative-cloud',
          topic: 'general',
          base_url: 'https://adobe.com/creativecloud',
        },
      ];

      const result = mapDrsPromptsToSchema(drsPrompts);

      expect(result).to.have.lengthOf(1);
      expect(result[0].prompt).to.equal('What is Adobe Creative Cloud?');
      expect(result[0].region).to.equal('us');
      expect(result[0].category).to.equal('creative-cloud');
      expect(result[0].topic).to.equal('general');
      expect(result[0].url).to.equal('https://adobe.com/creativecloud');
      expect(result[0].keyword).to.equal('');
      expect(result[0].volume).to.equal(0);
      expect(result[0].source).to.equal('drs');
      expect(result[0].keywordImportTime).to.be.a('number');
      expect(result[0].volumeImportTime).to.be.a('number');
    });

    it('maps base_url to url', () => {
      const result = mapDrsPromptsToSchema([
        { base_url: 'https://example.com' },
      ]);

      expect(result[0].url).to.equal('https://example.com');
    });

    it('defaults missing fields to empty strings', () => {
      const result = mapDrsPromptsToSchema([{}]);

      expect(result[0].prompt).to.equal('');
      expect(result[0].region).to.equal('');
      expect(result[0].category).to.equal('');
      expect(result[0].topic).to.equal('');
      expect(result[0].url).to.equal('');
    });

    it('maps multiple prompts', () => {
      const drsPrompts = [
        {
          prompt: 'Q1', region: 'us', category: 'c1', topic: 't1', base_url: 'https://a.com',
        },
        {
          prompt: 'Q2', region: 'de', category: 'c2', topic: 't2', base_url: 'https://b.com',
        },
        {
          prompt: 'Q3', region: 'fr', category: 'c3', topic: 't3', base_url: 'https://c.com',
        },
      ];

      const result = mapDrsPromptsToSchema(drsPrompts);

      expect(result).to.have.lengthOf(3);
      expect(result[0].region).to.equal('us');
      expect(result[1].region).to.equal('de');
      expect(result[2].region).to.equal('fr');
    });
  });

  describe('writeDrsPromptsToS3', () => {
    let s3Client;
    let log;
    let clock;

    beforeEach(() => {
      s3Client = { send: sandbox.stub().resolves() };
      log = {
        info: sandbox.spy(),
        warn: sandbox.spy(),
        error: sandbox.spy(),
      };
      // Fix date for predictable S3 keys
      clock = sandbox.useFakeTimers(new Date('2026-02-27T12:00:00Z'));
    });

    afterEach(() => {
      clock.restore();
    });

    it('writes JSON and parquet to correct S3 paths', async () => {
      const drsPrompts = [
        {
          prompt: 'What is Photoshop?',
          region: 'us',
          category: 'photoshop',
          topic: 'general',
          base_url: 'https://adobe.com/photoshop',
        },
      ];

      const result = await writeDrsPromptsToS3({
        drsPrompts,
        siteId: 'site-abc',
        jobId: 'job-123',
        bucket: 'my-bucket',
        s3Client,
        log,
      });

      expect(result.jsonKey).to.equal(
        'metrics/site-abc/llmo-prompts-drs/date=2026-02-27/job=job-123/data.json',
      );
      expect(result.parquetKey).to.equal(
        'metrics/site-abc/llmo-prompts-drs/date=2026-02-27/job=job-123/data.parquet',
      );

      // Two S3 writes: JSON + parquet
      expect(s3Client.send).to.have.been.calledTwice;

      // Verify JSON write
      const jsonCall = s3Client.send.firstCall.args[0].input;
      expect(jsonCall.Bucket).to.equal('my-bucket');
      expect(jsonCall.Key).to.equal(result.jsonKey);
      expect(jsonCall.ContentType).to.equal('application/json');
      expect(JSON.parse(jsonCall.Body)).to.deep.equal(drsPrompts);

      // Verify parquet write
      const parquetCall = s3Client.send.secondCall.args[0].input;
      expect(parquetCall.Bucket).to.equal('my-bucket');
      expect(parquetCall.Key).to.equal(result.parquetKey);
      expect(parquetCall.ContentType).to.equal('application/octet-stream');
      expect(parquetCall.Body).to.be.an.instanceOf(ArrayBuffer);
    });

    it('handles empty prompts array — writes JSON but skips parquet', async () => {
      const result = await writeDrsPromptsToS3({
        drsPrompts: [],
        siteId: 'site-abc',
        jobId: 'job-456',
        bucket: 'my-bucket',
        s3Client,
        log,
      });

      // Only JSON write (no parquet since empty)
      expect(s3Client.send).to.have.been.calledOnce;
      expect(log.warn).to.have.been.calledWith(
        'No prompts to write to parquet — skipping parquet file',
      );
      expect(result.jsonKey).to.include('data.json');
      expect(result.parquetKey).to.include('data.parquet');
    });

    it('writes multiple prompts correctly', async () => {
      const drsPrompts = [
        {
          prompt: 'Q1', region: 'us', category: 'c1', topic: 't1', base_url: 'https://a.com',
        },
        {
          prompt: 'Q2', region: 'de', category: 'c2', topic: 't2', base_url: 'https://b.com',
        },
      ];

      await writeDrsPromptsToS3({
        drsPrompts,
        siteId: 'site-xyz',
        jobId: 'job-789',
        bucket: 'bucket',
        s3Client,
        log,
      });

      expect(s3Client.send).to.have.been.calledTwice;
      expect(log.info).to.have.been.calledWith(
        sinon.match('Writing 2 DRS prompts as JSON'),
      );
      expect(log.info).to.have.been.calledWith(
        sinon.match('Writing 2 DRS prompts as parquet'),
      );
    });
  });
});
