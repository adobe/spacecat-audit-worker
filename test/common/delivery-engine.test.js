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
import { BLACKBOARD_ENGINE, isBlackboardEngine } from '../../src/common/delivery-engine.js';

const siteWith = (deliveryConfig) => ({ getDeliveryConfig: () => deliveryConfig });

describe('delivery-engine — isBlackboardEngine', () => {
  it('is true only when the requested field equals "blackboard"', () => {
    expect(isBlackboardEngine(siteWith({ canonicalEngine: 'blackboard' }), 'canonicalEngine')).to.be.true;
  });

  it('is false for legacy / absent / any other value (degrades to legacy)', () => {
    expect(isBlackboardEngine(siteWith({ canonicalEngine: 'legacy' }), 'canonicalEngine')).to.be.false;
    expect(isBlackboardEngine(siteWith({ canonicalEngine: 'v2' }), 'canonicalEngine')).to.be.false;
    expect(isBlackboardEngine(siteWith({ canonicalEngine: null }), 'canonicalEngine')).to.be.false;
    expect(isBlackboardEngine(siteWith({}), 'canonicalEngine')).to.be.false;
  });

  it('checks the requested field independently of sibling engine keys', () => {
    const site = siteWith({ cwvEngine: 'blackboard', canonicalEngine: 'legacy' });
    expect(isBlackboardEngine(site, 'cwvEngine')).to.be.true;
    expect(isBlackboardEngine(site, 'canonicalEngine')).to.be.false;
    expect(isBlackboardEngine(site, 'metaTagsEngine')).to.be.false;
  });

  it('degrades safely when the site or its deliveryConfig is missing', () => {
    expect(isBlackboardEngine(undefined, 'canonicalEngine')).to.be.false;
    expect(isBlackboardEngine({}, 'canonicalEngine')).to.be.false;
    expect(isBlackboardEngine({ getDeliveryConfig: () => undefined }, 'canonicalEngine')).to.be.false;
  });

  it('exposes the shared blackboard constant', () => {
    expect(BLACKBOARD_ENGINE).to.equal('blackboard');
  });
});
