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
import { load as cheerioLoad } from 'cheerio';
import { getMetadata } from '../../src/experimentation-ess/common.js';

describe('experimentation-ess common getMetadata', () => {
  // Regression guard for SITES-47215: pages are parsed with cheerio, not a DOM Document.
  // The previous doc.head.querySelectorAll implementation threw
  // "Cannot read properties of undefined (reading 'querySelectorAll')" on every page fetch.
  const html = `
    <html>
      <head>
        <meta name="experiment" content="my-experiment">
        <meta name="experiment-status" content="active">
        <meta property="og:title" content="Hello">
        <meta name="experiment-variants" content="control, challenger">
        <meta name="empty-meta">
      </head>
      <body><p>ignored</p></body>
    </html>`;
  let $;

  beforeEach(() => {
    $ = cheerioLoad(html);
  });

  it('does not throw and reads a name-based meta tag from a cheerio instance', () => {
    expect(() => getMetadata('experiment', $)).to.not.throw();
    expect(getMetadata('experiment', $)).to.equal('my-experiment');
    expect(getMetadata('experiment-status', $)).to.equal('active');
  });

  it('uses the property attribute when the name contains a colon', () => {
    expect(getMetadata('og:title', $)).to.equal('Hello');
  });

  it('returns an empty string for a missing tag or a tag without content', () => {
    expect(getMetadata('does-not-exist', $)).to.equal('');
    expect(getMetadata('empty-meta', $)).to.equal('');
  });

  it('joins multiple matching tags (comma-separated)', () => {
    const multi = cheerioLoad(`
      <head>
        <meta name="experiment-audience" content="mobile">
        <meta name="experiment-audience" content="desktop">
      </head>`);
    expect(getMetadata('experiment-audience', multi)).to.equal('mobile, desktop');
  });
});
