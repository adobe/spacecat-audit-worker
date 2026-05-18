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
import { DataAccessError } from '@adobe/spacecat-shared-data-access';
import { isTransientTierClientError } from '../../src/common/tier-client-error-classifier.js';

describe('tier-client-error-classifier', () => {
  describe('isTransientTierClientError', () => {
    describe('transient database errors', () => {
      it('returns true for PGRST000 error code (connection error)', () => {
        const pgrstError = { code: 'PGRST000', message: 'Could not connect with the database' };
        const error = new DataAccessError('Failed to query', { entityName: 'Entitlement' }, pgrstError);
        expect(isTransientTierClientError(error)).to.be.true;
      });

      it('returns true for PGRST001 error code (internal connection error)', () => {
        const pgrstError = { code: 'PGRST001', message: 'Could not connect due to internal error' };
        const error = new DataAccessError('Failed to query', { entityName: 'Entitlement' }, pgrstError);
        expect(isTransientTierClientError(error)).to.be.true;
      });

      it('returns true for PGRST002 error code (schema cache connection error)', () => {
        const pgrstError = { code: 'PGRST002', message: 'Could not connect when building schema cache' };
        const error = new DataAccessError('Failed to query', { entityName: 'Entitlement' }, pgrstError);
        expect(isTransientTierClientError(error)).to.be.true;
      });

      it('returns true for PGRST003 error code (pool timeout)', () => {
        const pgrstError = {
          code: 'PGRST003',
          message: 'Timed out acquiring connection from connection pool',
          details: 'Waited 10 seconds',
          hint: 'Increase pool size or timeout',
        };
        const error = new DataAccessError('Failed to query', { entityName: 'Entitlement' }, pgrstError);
        expect(isTransientTierClientError(error)).to.be.true;
      });

      it('returns true for connection pool timeout message in cause', () => {
        const pgrstError = {
          code: 'PGRST003',
          message: 'Timed out acquiring connection from connection pool',
        };
        const error = new DataAccessError('Failed to query', { entityName: 'Entitlement' }, pgrstError);
        expect(isTransientTierClientError(error)).to.be.true;
      });

      it('returns true for generic timeout message in cause', () => {
        const pgrstError = { message: 'Operation timed out' };
        const error = new DataAccessError('Failed to query', { entityName: 'Entitlement' }, pgrstError);
        expect(isTransientTierClientError(error)).to.be.true;
      });

      it('returns true for connection pool message (case insensitive) in cause', () => {
        const pgrstError = { message: 'CONNECTION POOL exhausted' };
        const error = new DataAccessError('Failed to query', { entityName: 'Entitlement' }, pgrstError);
        expect(isTransientTierClientError(error)).to.be.true;
      });
    });

    describe('transient network errors', () => {
      it('returns true for ECONNREFUSED', () => {
        const networkError = { code: 'ECONNREFUSED', message: 'Connection refused' };
        const error = new DataAccessError('Failed to query', { entityName: 'Entitlement' }, networkError);
        expect(isTransientTierClientError(error)).to.be.true;
      });

      it('returns true for ETIMEDOUT', () => {
        const networkError = { code: 'ETIMEDOUT', message: 'Connection timed out' };
        const error = new DataAccessError('Failed to query', { entityName: 'Entitlement' }, networkError);
        expect(isTransientTierClientError(error)).to.be.true;
      });

      it('returns true for ENOTFOUND', () => {
        const networkError = { code: 'ENOTFOUND', message: 'DNS lookup failed' };
        const error = new DataAccessError('Failed to query', { entityName: 'Entitlement' }, networkError);
        expect(isTransientTierClientError(error)).to.be.true;
      });

      it('returns true for ECONNRESET', () => {
        const networkError = { code: 'ECONNRESET', message: 'Connection reset by peer' };
        const error = new DataAccessError('Failed to query', { entityName: 'Entitlement' }, networkError);
        expect(isTransientTierClientError(error)).to.be.true;
      });

      it('returns true for network error message in cause', () => {
        const networkError = { message: 'Network error occurred' };
        const error = new DataAccessError('Failed to query', { entityName: 'Entitlement' }, networkError);
        expect(isTransientTierClientError(error)).to.be.true;
      });

      it('returns true for socket hang up message in cause', () => {
        const networkError = { message: 'socket hang up' };
        const error = new DataAccessError('Failed to query', { entityName: 'Entitlement' }, networkError);
        expect(isTransientTierClientError(error)).to.be.true;
      });

      it('returns true for EAI_AGAIN message in cause', () => {
        const networkError = { message: 'getaddrinfo EAI_AGAIN' };
        const error = new DataAccessError('Failed to query', { entityName: 'Entitlement' }, networkError);
        expect(isTransientTierClientError(error)).to.be.true;
      });
    });

    describe('transient HTTP errors', () => {
      it('returns true for HTTP 408 (Request Timeout) in cause', () => {
        const httpError = { statusCode: 408, message: 'Request Timeout' };
        const error = new DataAccessError('Failed to query', { entityName: 'Entitlement' }, httpError);
        expect(isTransientTierClientError(error)).to.be.true;
      });

      it('returns true for HTTP 429 (Too Many Requests) in cause', () => {
        const httpError = { statusCode: 429, message: 'Too Many Requests' };
        const error = new DataAccessError('Failed to query', { entityName: 'Entitlement' }, httpError);
        expect(isTransientTierClientError(error)).to.be.true;
      });

      it('returns true for HTTP 500 (Internal Server Error) in cause', () => {
        const httpError = { statusCode: 500, message: 'Internal Server Error' };
        const error = new DataAccessError('Failed to query', { entityName: 'Entitlement' }, httpError);
        expect(isTransientTierClientError(error)).to.be.true;
      });

      it('returns true for HTTP 502 (Bad Gateway) in cause', () => {
        const httpError = { statusCode: 502, message: 'Bad Gateway' };
        const error = new DataAccessError('Failed to query', { entityName: 'Entitlement' }, httpError);
        expect(isTransientTierClientError(error)).to.be.true;
      });

      it('returns true for HTTP 503 (Service Unavailable) in cause', () => {
        const httpError = { statusCode: 503, message: 'Service Unavailable' };
        const error = new DataAccessError('Failed to query', { entityName: 'Entitlement' }, httpError);
        expect(isTransientTierClientError(error)).to.be.true;
      });

      it('returns true for HTTP 504 (Gateway Timeout) in cause', () => {
        const httpError = { statusCode: 504, message: 'Gateway Timeout' };
        const error = new DataAccessError('Failed to query', { entityName: 'Entitlement' }, httpError);
        expect(isTransientTierClientError(error)).to.be.true;
      });

      it('returns true for status property instead of statusCode in cause', () => {
        const httpError = { status: 504, message: 'Gateway Timeout' };
        const error = new DataAccessError('Failed to query', { entityName: 'Entitlement' }, httpError);
        expect(isTransientTierClientError(error)).to.be.true;
      });
    });

    describe('transient generic patterns', () => {
      it('returns true for temporary failure message in cause', () => {
        const innerError = { message: 'Temporary failure in name resolution' };
        const error = new DataAccessError('Failed to query', { entityName: 'Entitlement' }, innerError);
        expect(isTransientTierClientError(error)).to.be.true;
      });

      it('returns true for service unavailable message in cause', () => {
        const innerError = { message: 'Service unavailable, please try again' };
        const error = new DataAccessError('Failed to query', { entityName: 'Entitlement' }, innerError);
        expect(isTransientTierClientError(error)).to.be.true;
      });
    });

    describe('permanent errors', () => {
      it('returns false for HTTP 401 (Unauthorized)', () => {
        const httpError = { statusCode: 401, message: 'Unauthorized' };
        const error = new DataAccessError('Failed to query', { entityName: 'Entitlement' }, httpError);
        expect(isTransientTierClientError(error)).to.be.false;
      });

      it('returns false for HTTP 403 (Forbidden)', () => {
        const httpError = { statusCode: 403, message: 'Forbidden' };
        const error = new DataAccessError('Failed to query', { entityName: 'Entitlement' }, httpError);
        expect(isTransientTierClientError(error)).to.be.false;
      });

      it('returns false for HTTP 404 (Not Found)', () => {
        const httpError = { statusCode: 404, message: 'Not Found' };
        const error = new DataAccessError('Failed to query', { entityName: 'Entitlement' }, httpError);
        expect(isTransientTierClientError(error)).to.be.false;
      });

      it('returns false for not enrolled message (business logic error)', () => {
        const error = new Error('Site not enrolled for product code ASO');
        expect(isTransientTierClientError(error)).to.be.false;
      });

      it('returns false for no entitlement message (business logic error)', () => {
        const error = new Error('No entitlement found');
        expect(isTransientTierClientError(error)).to.be.false;
      });

      it('returns false for invalid product code message (business logic error)', () => {
        const error = new Error('Invalid product code');
        expect(isTransientTierClientError(error)).to.be.false;
      });

      it('returns false for generic error', () => {
        const error = new Error('Something went wrong');
        expect(isTransientTierClientError(error)).to.be.false;
      });

      it('returns false for DataAccessError with generic message and no cause', () => {
        const error = new DataAccessError('Failed to query', { entityName: 'Entitlement' });
        expect(isTransientTierClientError(error)).to.be.false;
      });

      it('returns false for PGRST100 (bad request - parsing error)', () => {
        const pgrstError = { code: 'PGRST100', message: 'Parsing error in query string' };
        const error = new DataAccessError('Failed to query', { entityName: 'Entitlement' }, pgrstError);
        expect(isTransientTierClientError(error)).to.be.false;
      });

      it('returns false for PGRST202 (function not found)', () => {
        const pgrstError = { code: 'PGRST202', message: 'Function not found' };
        const error = new DataAccessError('Failed to query', { entityName: 'Entitlement' }, pgrstError);
        expect(isTransientTierClientError(error)).to.be.false;
      });

      it('returns false for PGRST300 (configuration error)', () => {
        const pgrstError = { code: 'PGRST300', message: 'JWT secret missing' };
        const error = new DataAccessError('Failed to query', { entityName: 'Entitlement' }, pgrstError);
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

      it('handles lowercase error codes in cause', () => {
        const networkError = { code: 'econnrefused', message: 'Connection refused' };
        const error = new DataAccessError('Failed to query', { entityName: 'Entitlement' }, networkError);
        expect(isTransientTierClientError(error)).to.be.true;
      });

      it('walks multiple levels of cause chain', () => {
        // Create a deeply nested error chain
        const rootCause = { code: 'PGRST003', message: 'Timed out acquiring connection' };
        const middleError = new Error('Database operation failed');
        middleError.cause = rootCause;
        const error = new DataAccessError('Failed to query', { entityName: 'Entitlement' }, middleError);
        expect(isTransientTierClientError(error)).to.be.true;
      });

      it('returns false when no level in cause chain is transient', () => {
        const rootCause = { code: 'PGRST100', message: 'Bad request' };
        const middleError = new Error('Invalid query');
        middleError.cause = rootCause;
        const error = new DataAccessError('Failed to query', { entityName: 'Entitlement' }, middleError);
        expect(isTransientTierClientError(error)).to.be.false;
      });
    });
  });
});
