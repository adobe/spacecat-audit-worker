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

import { expect } from 'chai';
import { assertResultLocation } from '../../src/strategic-recommendations-semrush/result-location.js';

const ENV = { DRS_RESULTS_BUCKET: 'drs-results', DRS_RESULTS_PREFIX: 'results/' };

describe('assertResultLocation', () => {
  it('accepts a virtual-hosted-style presigned URL under the bucket/prefix', () => {
    expect(() => assertResultLocation(
      'https://drs-results.s3.us-east-1.amazonaws.com/results/job-1/r.json?X-Amz-Signature=x',
      ENV,
    )).to.not.throw();
  });

  it('accepts a virtual-hosted URL with no region', () => {
    expect(() => assertResultLocation(
      'https://drs-results.s3.amazonaws.com/results/job-1/r.json',
      ENV,
    )).to.not.throw();
  });

  it('accepts a path-style presigned URL under the bucket/prefix', () => {
    expect(() => assertResultLocation(
      'https://s3.us-east-1.amazonaws.com/drs-results/results/job-1/r.json',
      ENV,
    )).to.not.throw();
  });

  it('accepts an s3:// URI under the bucket/prefix', () => {
    expect(() => assertResultLocation('s3://drs-results/results/job-1/r.json', ENV)).to.not.throw();
  });

  it('defaults the prefix to results/ when not configured', () => {
    expect(() => assertResultLocation(
      's3://drs-results/results/job-1/r.json',
      { DRS_RESULTS_BUCKET: 'drs-results' },
    )).to.not.throw();
  });

  it('normalizes a prefix without a trailing slash', () => {
    expect(() => assertResultLocation(
      's3://drs-results/out/job-1/r.json',
      { DRS_RESULTS_BUCKET: 'drs-results', DRS_RESULTS_PREFIX: '/out' },
    )).to.not.throw();
  });

  it('fails closed when DRS_RESULTS_BUCKET is not configured', () => {
    expect(() => assertResultLocation('s3://drs-results/results/x.json', {}))
      .to.throw('DRS_RESULTS_BUCKET is not configured');
  });

  it('rejects an empty / non-string location', () => {
    expect(() => assertResultLocation('', ENV)).to.throw('resultLocation is missing');
    expect(() => assertResultLocation(undefined, ENV)).to.throw('resultLocation is missing');
  });

  it('rejects a malformed s3:// URI (no key)', () => {
    expect(() => assertResultLocation('s3://drs-results', ENV)).to.throw('not a valid s3 URI');
    expect(() => assertResultLocation('s3://drs-results/', ENV)).to.throw('not a valid s3 URI');
  });

  it('rejects an unparseable URL', () => {
    expect(() => assertResultLocation('http://[bad', ENV)).to.throw('not a valid URL');
  });

  it('rejects a non-https protocol', () => {
    expect(() => assertResultLocation('http://drs-results.s3.amazonaws.com/results/x.json', ENV))
      .to.throw('must use https');
  });

  it('rejects a non-S3 hostname', () => {
    expect(() => assertResultLocation('https://evil.example.com/results/x.json', ENV))
      .to.throw('not an allowlisted S3 hostname');
  });

  it('rejects a path-style URL with no key', () => {
    expect(() => assertResultLocation('https://s3.amazonaws.com/drs-results', ENV))
      .to.throw('does not contain a bucket and key');
  });

  it('rejects a foreign bucket (virtual-hosted)', () => {
    expect(() => assertResultLocation('https://other.s3.amazonaws.com/results/x.json', ENV))
      .to.throw('not the expected results bucket');
  });

  it('rejects a key outside the expected prefix', () => {
    expect(() => assertResultLocation('s3://drs-results/elsewhere/x.json', ENV))
      .to.throw('not under the expected prefix');
  });
});
