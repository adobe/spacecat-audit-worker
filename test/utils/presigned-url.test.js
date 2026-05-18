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

/* eslint-env mocha */

import { expect } from 'chai';
import { assertPresignedUrl } from '../../src/utils/presigned-url.js';

describe('assertPresignedUrl', () => {
  it('accepts a valid S3 presigned URL (virtual-hosted style)', () => {
    expect(() => assertPresignedUrl(
      'https://my-bucket.s3.amazonaws.com/path/to/object?X-Amz-Signature=abc',
    )).to.not.throw();
  });

  it('accepts a path-style S3 URL', () => {
    expect(() => assertPresignedUrl(
      'https://s3.amazonaws.com/bucket/bo.json',
    )).to.not.throw();
  });

  it('accepts an S3 URL with a region suffix', () => {
    expect(() => assertPresignedUrl(
      'https://my-bucket.s3.us-east-1.amazonaws.com/data/result.json',
    )).to.not.throw();
  });

  it('accepts an S3 URL with eu-west region', () => {
    expect(() => assertPresignedUrl(
      'https://bucket.s3.eu-west-2.amazonaws.com/key',
    )).to.not.throw();
  });

  it('throws when the URL uses http instead of https', () => {
    expect(() => assertPresignedUrl(
      'http://bucket.s3.amazonaws.com/key',
    )).to.throw('presignedUrl must use https');
  });

  it('throws when the hostname is not an S3 hostname', () => {
    expect(() => assertPresignedUrl(
      'https://169.254.169.254/latest/meta-data/',
    )).to.throw('presignedUrl hostname is not an allowlisted S3 hostname');
  });

  it('throws when the hostname is an internal service', () => {
    expect(() => assertPresignedUrl(
      'https://internal.corp.example.com/secret',
    )).to.throw('presignedUrl hostname is not an allowlisted S3 hostname');
  });

  it('throws when the URL is not parseable', () => {
    expect(() => assertPresignedUrl('not a url')).to.throw('presignedUrl is not a valid URL');
  });

  it('throws when the URL is an empty string', () => {
    expect(() => assertPresignedUrl('')).to.throw('presignedUrl is not a valid URL');
  });

  it('throws when the URL mimics an S3 hostname but has a non-amazonaws.com suffix', () => {
    expect(() => assertPresignedUrl(
      'https://evil.s3.amazonaws.com.attacker.example/payload',
    )).to.throw('presignedUrl hostname is not an allowlisted S3 hostname');
  });
});
