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

import { expect } from 'chai';
import { isTransientTierClientError } from '../../src/common/tier-client-error-classifier.js';

describe('tier-client-error-classifier', () => {
  describe('isTransientTierClientError', () => {
    describe('transient database errors', () => {
      it('returns true for PGRST000 error code (connection error)', () => {
        const error = new Error('Could not connect with the database');
        error.code = 'PGRST000';
        expect(isTransientTierClientError(error)).to.be.true;
      });

      it('returns true for PGRST001 error code (internal connection error)', () => {
        const error = new Error('Could not connect due to internal error');
        error.code = 'PGRST001';
        expect(isTransientTierClientError(error)).to.be.true;
      });

      it('returns true for PGRST002 error code (schema cache connection error)', () => {
        const error = new Error('Could not connect when building schema cache');
        error.code = 'PGRST002';
        expect(isTransientTierClientError(error)).to.be.true;
      });

      it('returns true for PGRST003 error code (pool timeout)', () => {
        const error = new Error('Timed out acquiring connection from connection pool');
        error.code = 'PGRST003';
        expect(isTransientTierClientError(error)).to.be.true;
      });

      it('returns true for connection pool timeout message', () => {
        const error = new Error('Timed out acquiring connection from connection pool');
        expect(isTransientTierClientError(error)).to.be.true;
      });

      it('returns true for generic timeout message', () => {
        const error = new Error('Operation timed out');
        expect(isTransientTierClientError(error)).to.be.true;
      });

      it('returns true for connection pool message (case insensitive)', () => {
        const error = new Error('CONNECTION POOL exhausted');
        expect(isTransientTierClientError(error)).to.be.true;
      });
    });

    describe('transient network errors', () => {
      it('returns true for ECONNREFUSED', () => {
        const error = new Error('Connection refused');
        error.code = 'ECONNREFUSED';
        expect(isTransientTierClientError(error)).to.be.true;
      });

      it('returns true for ETIMEDOUT', () => {
        const error = new Error('Connection timed out');
        error.code = 'ETIMEDOUT';
        expect(isTransientTierClientError(error)).to.be.true;
      });

      it('returns true for ENOTFOUND', () => {
        const error = new Error('DNS lookup failed');
        error.code = 'ENOTFOUND';
        expect(isTransientTierClientError(error)).to.be.true;
      });

      it('returns true for ECONNRESET', () => {
        const error = new Error('Connection reset by peer');
        error.code = 'ECONNRESET';
        expect(isTransientTierClientError(error)).to.be.true;
      });

      it('returns true for network error message', () => {
        const error = new Error('Network error occurred');
        expect(isTransientTierClientError(error)).to.be.true;
      });

      it('returns true for socket hang up message', () => {
        const error = new Error('socket hang up');
        expect(isTransientTierClientError(error)).to.be.true;
      });

      it('returns true for EAI_AGAIN message', () => {
        const error = new Error('getaddrinfo EAI_AGAIN');
        expect(isTransientTierClientError(error)).to.be.true;
      });
    });

    describe('transient HTTP errors', () => {
      it('returns true for HTTP 408 (Request Timeout)', () => {
        const error = new Error('Request Timeout');
        error.statusCode = 408;
        expect(isTransientTierClientError(error)).to.be.true;
      });

      it('returns true for HTTP 429 (Too Many Requests)', () => {
        const error = new Error('Too Many Requests');
        error.statusCode = 429;
        expect(isTransientTierClientError(error)).to.be.true;
      });

      it('returns true for HTTP 500 (Internal Server Error)', () => {
        const error = new Error('Internal Server Error');
        error.statusCode = 500;
        expect(isTransientTierClientError(error)).to.be.true;
      });

      it('returns true for HTTP 502 (Bad Gateway)', () => {
        const error = new Error('Bad Gateway');
        error.statusCode = 502;
        expect(isTransientTierClientError(error)).to.be.true;
      });

      it('returns true for HTTP 503 (Service Unavailable)', () => {
        const error = new Error('Service Unavailable');
        error.statusCode = 503;
        expect(isTransientTierClientError(error)).to.be.true;
      });

      it('returns true for HTTP 504 (Gateway Timeout)', () => {
        const error = new Error('Gateway Timeout');
        error.statusCode = 504;
        expect(isTransientTierClientError(error)).to.be.true;
      });

      it('returns true for status property instead of statusCode', () => {
        const error = new Error('Gateway Timeout');
        error.status = 504;
        expect(isTransientTierClientError(error)).to.be.true;
      });
    });

    describe('transient generic patterns', () => {
      it('returns true for temporary failure message', () => {
        const error = new Error('Temporary failure in name resolution');
        expect(isTransientTierClientError(error)).to.be.true;
      });

      it('returns true for service unavailable message', () => {
        const error = new Error('Service unavailable, please try again');
        expect(isTransientTierClientError(error)).to.be.true;
      });
    });

    describe('permanent errors', () => {
      it('returns false for HTTP 401 (Unauthorized)', () => {
        const error = new Error('Unauthorized');
        error.statusCode = 401;
        expect(isTransientTierClientError(error)).to.be.false;
      });

      it('returns false for HTTP 403 (Forbidden)', () => {
        const error = new Error('Forbidden');
        error.statusCode = 403;
        expect(isTransientTierClientError(error)).to.be.false;
      });

      it('returns false for HTTP 404 (Not Found)', () => {
        const error = new Error('Not Found');
        error.statusCode = 404;
        expect(isTransientTierClientError(error)).to.be.false;
      });

      it('returns false for not enrolled message', () => {
        const error = new Error('Site not enrolled for product code ASO');
        expect(isTransientTierClientError(error)).to.be.false;
      });

      it('returns false for no entitlement message', () => {
        const error = new Error('No entitlement found');
        expect(isTransientTierClientError(error)).to.be.false;
      });

      it('returns false for invalid product code message', () => {
        const error = new Error('Invalid product code');
        expect(isTransientTierClientError(error)).to.be.false;
      });

      it('returns false for generic error', () => {
        const error = new Error('Something went wrong');
        expect(isTransientTierClientError(error)).to.be.false;
      });

      it('returns false for PGRST100 (bad request - parsing error)', () => {
        const error = new Error('Parsing error in query string');
        error.code = 'PGRST100';
        expect(isTransientTierClientError(error)).to.be.false;
      });

      it('returns false for PGRST202 (function not found)', () => {
        const error = new Error('Function not found');
        error.code = 'PGRST202';
        expect(isTransientTierClientError(error)).to.be.false;
      });

      it('returns false for PGRST300 (configuration error)', () => {
        const error = new Error('JWT secret missing');
        error.code = 'PGRST300';
        expect(isTransientTierClientError(error)).to.be.false;
      });
    });

    describe('edge cases', () => {
      it('returns false for null error', () => {
        expect(isTransientTierClientError(null)).to.be.false;
      });

      it('returns false for undefined error', () => {
        expect(isTransientTierClientError(undefined)).to.be.false;
      });

      it('returns false for error with no message', () => {
        const error = new Error();
        expect(isTransientTierClientError(error)).to.be.false;
      });

      it('returns false for error with empty message', () => {
        const error = new Error('');
        expect(isTransientTierClientError(error)).to.be.false;
      });

      it('handles lowercase error codes', () => {
        const error = new Error('Connection refused');
        error.code = 'econnrefused';
        expect(isTransientTierClientError(error)).to.be.true;
      });
    });
  });
});
