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
import sinon from 'sinon';
import {
  DELIVERY_CONFIG_CDN_NONE,
  DELIVERY_CONFIG_CDN_TOKENS,
  toDeliveryConfigCdnToken,
} from '../../src/detect-cdn/delivery-config-cdn.js';

describe('delivery-config-cdn', () => {
  it('maps known detector labels to lowercase kebab-case or single-word tokens', () => {
    expect(toDeliveryConfigCdnToken('Fastly')).to.equal('fastly');
    expect(toDeliveryConfigCdnToken('Azure Front Door / Azure CDN')).to.equal('azure-edge');
    expect(toDeliveryConfigCdnToken('Azure Front Door')).to.equal('azure-front-door');
    expect(toDeliveryConfigCdnToken('Azure CDN')).to.equal('azure-cdn');
    expect(toDeliveryConfigCdnToken('Clever Cloud')).to.equal('clever-cloud');
  });

  it('returns none for unknown, empty, or fetch error', () => {
    expect(toDeliveryConfigCdnToken('unknown')).to.equal(DELIVERY_CONFIG_CDN_NONE);
    expect(toDeliveryConfigCdnToken('', null)).to.equal(DELIVERY_CONFIG_CDN_NONE);
    expect(toDeliveryConfigCdnToken('Fastly', 'timeout')).to.equal(DELIVERY_CONFIG_CDN_NONE);
  });

  it('logs and returns none for unmapped labels', () => {
    const log = { warn: sinon.stub() };
    expect(toDeliveryConfigCdnToken('Future CDN Inc', null, log)).to.equal(DELIVERY_CONFIG_CDN_NONE);
    expect(log.warn).to.have.been.calledOnce;
  });

  it('exports a sorted token list including none', () => {
    expect(DELIVERY_CONFIG_CDN_TOKENS).to.include(DELIVERY_CONFIG_CDN_NONE);
    expect(DELIVERY_CONFIG_CDN_TOKENS).to.include('cloudflare');
    const sorted = [...DELIVERY_CONFIG_CDN_TOKENS].sort();
    expect(DELIVERY_CONFIG_CDN_TOKENS).to.deep.equal(sorted);
  });
});
