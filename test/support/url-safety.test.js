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
import esmock from 'esmock';

import { isPrivateIP } from '../../src/support/url-safety.js';

use(sinonChai);

describe('support/url-safety', () => {
  const sandbox = sinon.createSandbox();
  let log;

  beforeEach(() => {
    log = {
      info: sandbox.stub(),
      debug: sandbox.stub(),
      warn: sandbox.stub(),
      error: sandbox.stub(),
    };
  });

  afterEach(() => sandbox.restore());

  describe('isPrivateIP', () => {
    it('treats non-string input as private (defensive)', () => {
      expect(isPrivateIP(null)).to.equal(true);
      expect(isPrivateIP(undefined)).to.equal(true);
      expect(isPrivateIP(42)).to.equal(true);
    });

    it('flags RFC1918 IPv4 ranges as private', () => {
      expect(isPrivateIP('10.0.0.1')).to.equal(true);
      expect(isPrivateIP('172.16.0.1')).to.equal(true);
      expect(isPrivateIP('172.31.255.254')).to.equal(true);
      expect(isPrivateIP('192.168.1.1')).to.equal(true);
    });

    it('flags loopback / link-local / CGNAT / multicast / 0.0.0.0 as private', () => {
      expect(isPrivateIP('127.0.0.1')).to.equal(true);
      expect(isPrivateIP('169.254.169.254')).to.equal(true); // AWS IMDS
      expect(isPrivateIP('100.64.0.1')).to.equal(true); // CGNAT
      expect(isPrivateIP('100.127.255.255')).to.equal(true);
      expect(isPrivateIP('0.0.0.0')).to.equal(true);
      expect(isPrivateIP('224.0.0.1')).to.equal(true); // multicast
    });

    it('treats public IPv4 addresses as not private', () => {
      expect(isPrivateIP('8.8.8.8')).to.equal(false);
      expect(isPrivateIP('1.1.1.1')).to.equal(false);
      expect(isPrivateIP('172.32.0.1')).to.equal(false); // just outside 172.16/12
      expect(isPrivateIP('100.63.255.255')).to.equal(false); // just below CGNAT
      expect(isPrivateIP('100.128.0.1')).to.equal(false); // just above CGNAT
    });

    it('flags IPv6 loopback and unspecified as private', () => {
      expect(isPrivateIP('::1')).to.equal(true);
      expect(isPrivateIP('::')).to.equal(true);
    });

    it('flags IPv6 link-local, multicast, and ULA as private', () => {
      expect(isPrivateIP('fe80::1')).to.equal(true);
      expect(isPrivateIP('febf::1')).to.equal(true);
      expect(isPrivateIP('ff02::1')).to.equal(true);
      expect(isPrivateIP('fc00::1')).to.equal(true);
      expect(isPrivateIP('fd12::1')).to.equal(true);
    });

    it('unwraps v4-mapped IPv6 and re-checks the embedded v4', () => {
      expect(isPrivateIP('::ffff:127.0.0.1')).to.equal(true);
      expect(isPrivateIP('::ffff:10.0.0.1')).to.equal(true);
      expect(isPrivateIP('::ffff:8.8.8.8')).to.equal(false);
    });

    it('treats public IPv6 (2001::) as not private', () => {
      expect(isPrivateIP('2001:4860:4860::8888')).to.equal(false);
    });
  });

  describe('resolvesToPublicAddress', () => {
    async function load(lookupFn) {
      return esmock('../../src/support/url-safety.js', {
        'dns/promises': { default: { lookup: lookupFn }, lookup: lookupFn },
      });
    }

    it('returns true when all resolved addresses are public', async () => {
      const { resolvesToPublicAddress } = await load(
        async () => [{ address: '8.8.8.8', family: 4 }],
      );
      expect(await resolvesToPublicAddress('example.com', log)).to.equal(true);
    });

    it('returns false when DNS lookup throws', async () => {
      const lookup = async () => {
        throw new Error('ENOTFOUND');
      };
      const { resolvesToPublicAddress } = await load(lookup);
      expect(await resolvesToPublicAddress('bogus.invalid', log)).to.equal(false);
      expect(log.warn).to.have.been.calledWithMatch(/DNS lookup failed/);
    });

    it('returns false when DNS returns no addresses', async () => {
      const { resolvesToPublicAddress } = await load(async () => []);
      expect(await resolvesToPublicAddress('empty.example', log)).to.equal(false);
      expect(log.warn).to.have.been.calledWithMatch(/No addresses resolved/);
    });

    it('returns false when DNS returns null (no Array)', async () => {
      const { resolvesToPublicAddress } = await load(async () => null);
      expect(await resolvesToPublicAddress('weird.example', log)).to.equal(false);
      expect(log.warn).to.have.been.calledWithMatch(/No addresses resolved/);
    });

    it('returns false when any resolved address is private', async () => {
      const { resolvesToPublicAddress } = await load(
        async () => [
          { address: '8.8.8.8', family: 4 },
          { address: '127.0.0.1', family: 4 },
        ],
      );
      expect(await resolvesToPublicAddress('partial.example', log)).to.equal(false);
      expect(log.warn).to.have.been.calledWithMatch(/non-public address/);
    });
  });

  describe('isUrlSafeToFetch', () => {
    async function load(lookupFn) {
      return esmock('../../src/support/url-safety.js', {
        'dns/promises': { default: { lookup: lookupFn }, lookup: lookupFn },
      });
    }

    it('rejects malformed URLs', async () => {
      const { isUrlSafeToFetch } = await load(async () => [{ address: '8.8.8.8', family: 4 }]);
      expect(await isUrlSafeToFetch('not a url', log)).to.equal(false);
      expect(log.warn).to.have.been.calledWithMatch(/invalid URL/);
    });

    it('rejects non-http(s) schemes', async () => {
      const { isUrlSafeToFetch } = await load(async () => [{ address: '8.8.8.8', family: 4 }]);
      expect(await isUrlSafeToFetch('file:///etc/passwd', log)).to.equal(false);
      // eslint-disable-next-line no-script-url
      expect(await isUrlSafeToFetch('javascript:alert(1)', log)).to.equal(false);
      expect(await isUrlSafeToFetch('ftp://example.com/x', log)).to.equal(false);
      expect(log.warn).to.have.been.calledWithMatch(/non-http\(s\)/);
    });

    it('rejects URLs with an IPv4 private literal host without DNS lookup', async () => {
      const lookupStub = sandbox.stub();
      const { isUrlSafeToFetch } = await load(lookupStub);
      expect(await isUrlSafeToFetch('http://169.254.169.254/latest/meta-data/', log))
        .to.equal(false);
      expect(lookupStub).to.not.have.been.called;
      expect(log.warn).to.have.been.calledWithMatch(/private IP literal/);
    });

    it('rejects URLs with an IPv6 loopback literal host without DNS lookup', async () => {
      const lookupStub = sandbox.stub();
      const { isUrlSafeToFetch } = await load(lookupStub);
      expect(await isUrlSafeToFetch('http://[::1]/admin', log)).to.equal(false);
      expect(lookupStub).to.not.have.been.called;
    });

    it('accepts URLs with a public IPv4 literal host without DNS lookup', async () => {
      const lookupStub = sandbox.stub();
      const { isUrlSafeToFetch } = await load(lookupStub);
      expect(await isUrlSafeToFetch('http://1.1.1.1/', log)).to.equal(true);
      expect(lookupStub).to.not.have.been.called;
    });

    it('accepts public hostnames that resolve to public addresses', async () => {
      const { isUrlSafeToFetch } = await load(async () => [{ address: '8.8.8.8', family: 4 }]);
      expect(await isUrlSafeToFetch('https://example.com/path', log)).to.equal(true);
    });

    it('rejects hostnames that resolve to private addresses', async () => {
      const { isUrlSafeToFetch } = await load(async () => [{ address: '127.0.0.1', family: 4 }]);
      expect(await isUrlSafeToFetch('https://localhost.attacker.example/', log)).to.equal(false);
    });
  });
});
