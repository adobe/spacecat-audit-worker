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
import {
  FORMULA_TRIGGERS,
  sanitizeSpreadsheetValue,
  escapeCsvValue,
  serializeCsv,
} from '../../src/common/spreadsheet-safe.js';

describe('spreadsheet-safe', () => {
  describe('FORMULA_TRIGGERS', () => {
    it('lists the seven formula-injection trigger characters', () => {
      expect(FORMULA_TRIGGERS).to.deep.equal(['=', '+', '-', '@', '\t', '\r', '\n']);
    });
  });

  describe('sanitizeSpreadsheetValue', () => {
    it('prefixes a single quote to a string starting with each formula trigger', () => {
      expect(sanitizeSpreadsheetValue('=1+1')).to.equal("'=1+1");
      expect(sanitizeSpreadsheetValue('+1')).to.equal("'+1");
      expect(sanitizeSpreadsheetValue('-1')).to.equal("'-1");
      expect(sanitizeSpreadsheetValue('@x')).to.equal("'@x");
      expect(sanitizeSpreadsheetValue('\tx')).to.equal("'\tx");
      expect(sanitizeSpreadsheetValue('\rx')).to.equal("'\rx");
      expect(sanitizeSpreadsheetValue('\nx')).to.equal("'\nx");
    });

    it('neutralizes a formula operator after leading whitespace (bypass guard)', () => {
      // leading space does not defang the operator — Excel/Sheets trim it.
      expect(sanitizeSpreadsheetValue(' =1+1')).to.equal("' =1+1");
      expect(sanitizeSpreadsheetValue('  +cmd')).to.equal("'  +cmd");
      expect(sanitizeSpreadsheetValue('\t=x')).to.equal("'\t=x");
      expect(sanitizeSpreadsheetValue('\n=x')).to.equal("'\n=x");
    });

    it('passes through a string that does not start with a trigger', () => {
      expect(sanitizeSpreadsheetValue('Acrobat')).to.equal('Acrobat');
    });

    it('passes through leading-whitespace text without a formula operator', () => {
      expect(sanitizeSpreadsheetValue(' foo')).to.equal(' foo');
      expect(sanitizeSpreadsheetValue('  hello')).to.equal('  hello');
      expect(sanitizeSpreadsheetValue('   ')).to.equal('   ');
    });

    it('passes through an empty string (no leading trigger)', () => {
      expect(sanitizeSpreadsheetValue('')).to.equal('');
    });

    it('passes through non-string values unchanged (number, boolean, null)', () => {
      expect(sanitizeSpreadsheetValue(5)).to.equal(5);
      expect(sanitizeSpreadsheetValue(true)).to.equal(true);
      expect(sanitizeSpreadsheetValue(null)).to.equal(null);
      expect(sanitizeSpreadsheetValue(undefined)).to.equal(undefined);
    });
  });

  describe('escapeCsvValue', () => {
    it('renders null as an empty field', () => {
      expect(escapeCsvValue(null)).to.equal('');
    });

    it('renders undefined as an empty field', () => {
      expect(escapeCsvValue(undefined)).to.equal('');
    });

    it('renders an empty string as an empty field (no prefix, no quoting)', () => {
      expect(escapeCsvValue('')).to.equal('');
    });

    it('stringifies an object as JSON and RFC-4180-quotes the embedded quotes', () => {
      expect(escapeCsvValue({ a: 1 })).to.equal('"{""a"":1}"');
    });

    it('coerces a number to its string form', () => {
      expect(escapeCsvValue(5)).to.equal('5');
    });

    it('neutralizes each formula-trigger prefix (= + - @ tab CR)', () => {
      expect(escapeCsvValue('=1')).to.equal("'=1");
      expect(escapeCsvValue('+1')).to.equal("'+1");
      expect(escapeCsvValue('-1')).to.equal("'-1");
      expect(escapeCsvValue('@x')).to.equal("'@x");
      // tab-triggered value is prefixed; tab is not in the RFC-4180 quote set.
      expect(escapeCsvValue('\tx')).to.equal("'\tx");
      // CR-triggered value is prefixed AND quoted (CR is in the quote set).
      expect(escapeCsvValue('\rx')).to.equal('"\'\rx"');
    });

    it('neutralizes a formula operator after leading whitespace', () => {
      expect(escapeCsvValue(' =1+1')).to.equal("' =1+1");
      expect(escapeCsvValue('  +cmd')).to.equal("'  +cmd");
      expect(escapeCsvValue('\t=x')).to.equal("'\t=x");
    });

    it('neutralizes AND RFC-quotes an LF-triggered formula', () => {
      // LF triggers neutralization (prefix) and is in the RFC-4180 quote set.
      expect(escapeCsvValue('\n=evil')).to.equal('"\'\n=evil"');
    });

    it('does not prefix a value that does not start with a trigger', () => {
      expect(escapeCsvValue('Acrobat')).to.equal('Acrobat');
    });

    it('does not prefix leading-whitespace text without a formula operator', () => {
      expect(escapeCsvValue(' foo')).to.equal(' foo');
      expect(escapeCsvValue('  hello')).to.equal('  hello');
    });

    it('quotes a value containing a comma', () => {
      expect(escapeCsvValue('a,b')).to.equal('"a,b"');
    });

    it('quotes a value containing a double quote and doubles the quote', () => {
      expect(escapeCsvValue('a"b')).to.equal('"a""b"');
    });

    it('quotes a value containing a newline', () => {
      expect(escapeCsvValue('a\nb')).to.equal('"a\nb"');
    });

    it('quotes a value containing a carriage return', () => {
      // value does not start with the CR, so only quoting applies (no prefix).
      expect(escapeCsvValue('a\rb')).to.equal('"a\rb"');
    });
  });

  describe('serializeCsv', () => {
    const COLUMNS = ['traffic_date', 'host', 'url_path', 'trf_platform', 'device'];

    it('emits a header-only string when there are no rows', () => {
      expect(serializeCsv([], ['a', 'b'])).to.equal('a,b');
    });

    it('joins multiple rows with CRLF and projects only the listed columns in order', () => {
      const rows = [
        { a: 1, b: 2, ignored: 'x' },
        { a: 3, b: 4 },
      ];
      expect(serializeCsv(rows, ['a', 'b'])).to.equal('a,b\r\n1,2\r\n3,4');
    });

    it('renders a missing column value as an empty field', () => {
      const rows = [{
        traffic_date: '2026-04-29',
        host: 'example.com',
        url_path: '/page',
        device: 'desktop',
      }];
      // trf_platform absent → empty field between url_path and device.
      expect(serializeCsv(rows, COLUMNS)).to.include('2026-04-29,example.com,/page,,desktop');
    });

    it('applies field escaping to each cell', () => {
      const rows = [{ a: '=1', b: 'a,b' }];
      expect(serializeCsv(rows, ['a', 'b'])).to.equal('a,b\r\n\'=1,"a,b"');
    });
  });
});
