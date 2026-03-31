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

import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import {
  MYSTIQUE_URLS_LIMIT,
  resolveMystiqueUrlLimit,
} from '../../src/utils/offsite-audit-utils.js';

use(sinonChai);

describe('offsite-audit-utils', () => {
  let sandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('MYSTIQUE_URLS_LIMIT', () => {
    it('should be a positive number', () => {
      expect(MYSTIQUE_URLS_LIMIT).to.be.a('number');
      expect(MYSTIQUE_URLS_LIMIT).to.be.greaterThan(0);
    });
  });

  describe('resolveMystiqueUrlLimit', () => {
    it('returns MYSTIQUE_URLS_LIMIT when urlLimit is absent', () => {
      expect(resolveMystiqueUrlLimit({})).to.equal(MYSTIQUE_URLS_LIMIT);
      expect(resolveMystiqueUrlLimit(undefined)).to.equal(MYSTIQUE_URLS_LIMIT);
      expect(resolveMystiqueUrlLimit(null)).to.equal(MYSTIQUE_URLS_LIMIT);
    });

    it('returns integer urlLimit when valid and below cap', () => {
      expect(resolveMystiqueUrlLimit({ messageData: { urlLimit: 5 } })).to.equal(5);
      expect(resolveMystiqueUrlLimit({ messageData: { urlLimit: '12' } })).to.equal(12);
      expect(resolveMystiqueUrlLimit({ messageData: { urlLimit: 8 } })).to.equal(8);
    });

    it('returns cap when urlLimit exceeds MYSTIQUE_URLS_LIMIT', () => {
      const log = { info: sandbox.stub() };
      expect(resolveMystiqueUrlLimit(
        { messageData: { urlLimit: MYSTIQUE_URLS_LIMIT + 10 } },
        log,
        '[T]',
      )).to.equal(MYSTIQUE_URLS_LIMIT);
      expect(log.info).to.have.been.calledOnce;
    });

    it('returns default and warns when urlLimit is invalid', () => {
      const log = { warn: sandbox.stub() };
      expect(resolveMystiqueUrlLimit({ messageData: { urlLimit: 'x' } }, log, '[T]')).to.equal(MYSTIQUE_URLS_LIMIT);
      expect(resolveMystiqueUrlLimit({ messageData: { urlLimit: 1.5 } }, log, '[T]')).to.equal(MYSTIQUE_URLS_LIMIT);
      expect(log.warn).to.have.been.calledTwice;
    });
  });
});
