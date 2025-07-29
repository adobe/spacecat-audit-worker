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
import sinon from 'sinon';
import nock from 'nock';
import { isPreviewPage, getCountryCodeFromLang } from '../../src/utils/url-utils.js';
import * as utils from '../../src/utils/url-utils.js';

describe('isPreviewPage', () => {
  it('should return true for preview pages', () => {
    const url = 'https://www.example.page/test1';
    const result = isPreviewPage(url);
    expect(result).to.be.true;
  });

  it('should return false for non-preview pages', () => {
    const url = 'https://www.example.com/test1';
    const result = isPreviewPage(url);
    expect(result).to.be.false;
  });
  it('should return the country code from a language code', () => {
    expect(getCountryCodeFromLang('en-US')).to.equal('us');
    expect(getCountryCodeFromLang('fr_CA')).to.equal('ca');
  });

  it('should return the default country code if the language code is not in the format of "language-country" or "language_country"', () => {
    expect(getCountryCodeFromLang('en')).to.equal('us');
    expect(getCountryCodeFromLang('en', 'fr')).to.equal('fr');
  });
  it('should return the default country if the language code is not present', () => {
    expect(getCountryCodeFromLang(null)).to.equal('us');
    expect(getCountryCodeFromLang(undefined)).to.equal('us');
  });
});

describe('filterBrokenSuggestedUrls', () => {
  let fetchStub;
  let prependSchemaStub;

  beforeEach(() => {
    fetchStub = sinon.stub();
    prependSchemaStub = sinon.stub();
  });

  afterEach(() => {
    sinon.restore();
  });

  it('should return only working URLs from the same domain', async () => {
    const suggestedUrls = [
      'https://www.example.com/page1',
      'https://www.example.com/page2',
      'https://www.other.com/page3',
    ];
    const baseURL = 'https://www.example.com';

    nock('https://www.example.com')
      .head('/page1').reply(200)
      .head('/page2')
      .reply(200);
    nock('https://www.other.com')
      .head('/page3').reply(200);

    prependSchemaStub.callsFake((url) => url);
    fetchStub.withArgs('https://www.example.com/page1').resolves({ ok: true });
    fetchStub.withArgs('https://www.example.com/page2').resolves({ ok: true });
    fetchStub.withArgs('https://www.other.com/page3').resolves({ ok: true });

    const result = await utils.filterBrokenSuggestedUrls(suggestedUrls, baseURL);
    expect(result).to.deep.equal([
      'https://www.example.com/page1',
      'https://www.example.com/page2',
    ]);
  });

  it('should filter out broken URLs', async () => {
    const suggestedUrls = [
      'https://www.example.com/page1',
      'https://www.example.com/page2',
    ];
    const baseURL = 'https://www.example.com';
    nock('https://www.example.com')
      .head('/page1').reply(404)
      .head('/page2')
      .reply(200);
    prependSchemaStub.callsFake((url) => url);
    fetchStub.withArgs('https://www.example.com/page1').resolves({ ok: false });
    fetchStub.withArgs('https://www.example.com/page2').resolves({ ok: true });

    const result = await utils.filterBrokenSuggestedUrls(suggestedUrls, baseURL);
    expect(result).to.deep.equal(['https://www.example.com/page2']);
  });

  it('should filter out URLs from different domains', async () => {
    const suggestedUrls = [
      'https://www.example.com/page1',
      'https://www.other.com/page2',
    ];
    const baseURL = 'https://www.example.com';
    nock('https://www.example.com')
      .head('/page1').reply(200)
      .head('/page2')
      .reply(200);
    fetchStub.resolves({ ok: true });

    const result = await utils.filterBrokenSuggestedUrls(suggestedUrls, baseURL);
    expect(result).to.deep.equal(['https://www.example.com/page1']);
  });

  it('should handle fetch errors gracefully', async () => {
    const suggestedUrls = [
      'https://www.example.com/page1',
      'https://www.example.com/page2',
    ];
    const baseURL = 'https://www.example.com';
    nock('https://www.example.com')
      .head('/page1').reply(404)
      .head('/page2')
      .reply(200);
    prependSchemaStub.callsFake((url) => url);
    fetchStub.withArgs('https://www.example.com/page1').rejects(new Error('Network error'));
    fetchStub.withArgs('https://www.example.com/page2').resolves({ ok: true });

    const result = await utils.filterBrokenSuggestedUrls(suggestedUrls, baseURL);
    expect(result).to.deep.equal(['https://www.example.com/page2']);
  });
});
