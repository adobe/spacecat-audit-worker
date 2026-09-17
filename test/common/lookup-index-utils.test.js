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
import {
  sanitizeUrls, REASON, failure, resolvePostgrestClient,
} from '../../src/common/lookup-index-utils.js';

describe('lookup-index-utils', () => {
  describe('sanitizeUrls', () => {
    it('passes through an ordinary http(s) URL unchanged', () => {
      expect(sanitizeUrls(['https://example.com/normal-page'])).to.deep.equal([
        'https://example.com/normal-page',
      ]);
    });

    it('rejects a non-string candidate instead of letting it coerce through', () => {
      expect(sanitizeUrls([['https://example.com/a'], 42, null, undefined, {}]))
        .to.deep.equal([]);
    });

    it('rejects a non-http(s) scheme', () => {
      expect(sanitizeUrls(['ftp://example.com/a', 'data:text/plain,hi'])).to.deep.equal([]);
    });

    it('rejects a URL that fails to parse', () => {
      expect(sanitizeUrls(['not a url at all'])).to.deep.equal([]);
    });

    it('drops a credential-bearing URL entirely, rather than stripping the credentials', () => {
      expect(sanitizeUrls(['https://user:p4ssw0rd@internal.example.com/path']))
        .to.deep.equal([]);
    });

    it('strips a known sensitive query parameter but keeps the rest of the URL', () => {
      expect(sanitizeUrls(['https://example.com/x?access_token=AbCdEf123456&page=2']))
        .to.deep.equal(['https://example.com/x?page=2']);
    });

    it('keeps a non-sensitive query parameter that identifies the resource', () => {
      expect(sanitizeUrls(['https://youtube.com/watch?v=abc123'])).to.deep.equal([
        'https://youtube.com/watch?v=abc123',
      ]);
    });

    it('strips the fragment', () => {
      expect(sanitizeUrls(['https://example.com/page#section'])).to.deep.equal([
        'https://example.com/page',
      ]);
    });

    it('serializes a value containing a literal quote and comma into a safe percent-encoded form', () => {
      const result = sanitizeUrls(['https://example.com/a",b']);
      expect(result).to.have.lengthOf(1);
      expect(result[0]).to.not.include('"');
    });

    it('rejects a URL over the length cap', () => {
      const longUrl = `https://example.com/${'a'.repeat(2500)}`;
      expect(sanitizeUrls([longUrl])).to.deep.equal([]);
    });

    it('de-duplicates an exact repeat', () => {
      expect(sanitizeUrls(['https://example.com/a', 'https://example.com/a']))
        .to.deep.equal(['https://example.com/a']);
    });

    it('de-duplicates candidates that only differ by the fragment, since it is stripped', () => {
      expect(sanitizeUrls(['https://example.com/a#one', 'https://example.com/a#two']))
        .to.deep.equal(['https://example.com/a']);
    });

    it('de-duplicates candidates that only differ by a stripped sensitive query parameter', () => {
      expect(sanitizeUrls([
        'https://example.com/a?token=abc&page=2',
        'https://example.com/a?token=xyz&page=2',
      ])).to.deep.equal(['https://example.com/a?page=2']);
    });

    it('drops invalid entries while keeping valid ones, preserving order', () => {
      const result = sanitizeUrls([
        'https://example.com/a',
        'not a url',
        'https://example.com/b',
      ]);
      expect(result).to.deep.equal(['https://example.com/a', 'https://example.com/b']);
    });

    it('returns an empty array for an empty input', () => {
      expect(sanitizeUrls([])).to.deep.equal([]);
    });

    it('caps the de-duplicated result at MAX_URLS_PER_ENTITY, keeping the first 500 in order', () => {
      const many = Array.from({ length: 510 }, (_, i) => `https://example.com/page-${i}`);
      const result = sanitizeUrls(many);
      expect(result).to.have.lengthOf(500);
      expect(result[0]).to.equal('https://example.com/page-0');
      expect(result[499]).to.equal('https://example.com/page-499');
    });
  });

  describe('failure', () => {
    it('returns an error with the reason as its message and no cause when none is given', () => {
      const result = failure(REASON.RESOLVE_POSTGREST_CLIENT_FAILED);

      expect(result).to.have.all.keys('error');
      expect(result.error.message).to.equal(REASON.RESOLVE_POSTGREST_CLIENT_FAILED);
      expect(result.error.cause).to.be.undefined;
    });

    it('attaches the given cause without altering the message', () => {
      const cause = new Error('boom');
      const result = failure(REASON.SYNC_URL_INDEX_FAILED, cause);

      expect(result.error.message).to.equal(REASON.SYNC_URL_INDEX_FAILED);
      expect(result.error.cause).to.equal(cause);
    });
  });

  describe('resolvePostgrestClient', () => {
    it('returns the postgrest client from the context', () => {
      const postgrestClient = { from: () => {} };
      expect(resolvePostgrestClient({ dataAccess: { services: { postgrestClient } } }))
        .to.equal(postgrestClient);
    });

    it('returns undefined when any part of the path is missing', () => {
      expect(resolvePostgrestClient({})).to.be.undefined;
      expect(resolvePostgrestClient(undefined)).to.be.undefined;
    });
  });
});
