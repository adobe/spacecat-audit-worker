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
/* eslint-disable object-curly-newline, indent, no-multiple-empty-lines, padded-blocks */


import { expect } from 'chai';
import {
  deepMerge,
  deepMergeAll,
  isMultiLocaleConfig,
  getAvailablePaths,
  isLocaleSupported,
  validateLocales,
  getConfigForPath,
  getLocaleDebugInfo,
} from '../../src/utils/config-utils.js';

describe('config-utils', () => {
  describe('deepMerge', () => {
    it('merges nested objects recursively and replaces primitives/arrays/nulls', () => {
      const target = { a: 1, nested: { x: 1, inner: { z: 0 } }, keep: 't', arr: [1] };
      const source = { b: 2, nested: { y: 2, inner: { w: 3 } }, keep: null, arr: [2] };

      const result = deepMerge(target, source);

      expect(result).to.deep.equal({
        a: 1,
        b: 2,
        nested: { x: 1, y: 2, inner: { z: 0, w: 3 } },
        keep: null,
        arr: [2],
      });
    });

    it('returns source when source is non-object or array', () => {
      expect(deepMerge({ a: 1 }, null)).to.equal(null);
      expect(deepMerge({ a: 1 }, 5)).to.equal(5);
      expect(deepMerge({ a: 1 }, 's')).to.equal('s');
      expect(deepMerge({ a: 1 }, [1, 2])).to.deep.equal([1, 2]);
    });
  });

  describe('deepMergeAll', () => {
    it('merges multiple objects left-to-right and skips nullish', () => {
      const result = deepMergeAll(
        { a: 1, nested: { x: 1 } },
        null,
        undefined,
        { b: 2, nested: { y: 2 } },
        { a: 3 },
      );
      expect(result).to.deep.equal({ a: 3, b: 2, nested: { x: 1, y: 2 } });
    });
  });

  describe('multi-locale helpers', () => {
    const configData = {
      public: {
        default: { a: 1 },
        '/en/': { b: 2 },
        '/en/us/': { c: 3 },
      },
    };

    it('isMultiLocaleConfig detects multiple locales', () => {
      expect(isMultiLocaleConfig(configData)).to.equal(true);
      expect(isMultiLocaleConfig({ public: { default: {} } })).to.equal(false);
      expect(isMultiLocaleConfig({}, 'public')).to.equal(false);
    });

    it('getAvailablePaths lists all non-default keys', () => {
      expect(getAvailablePaths(configData)).to.deep.equal(['/en/', '/en/us/']);
      expect(getAvailablePaths({})).to.deep.equal([]);
    });

    it('isLocaleSupported checks direct, with slashes, and best-match cases', () => {
      // direct match
      expect(isLocaleSupported(configData, '/en/us/')).to.equal(true);
      // locale without slashes should match config with slashes
      expect(isLocaleSupported(configData, 'en/us')).to.equal(true);
      // best-match via startsWith
      expect(isLocaleSupported(configData, '/en/us/products/item')).to.equal(true);
      // unsupported
      expect(isLocaleSupported(configData, '/de/')).to.equal(false);
    });

    it('validateLocales returns supported/unsupported and availablePaths', () => {
      const { supported, unsupported, availablePaths, allSupported } = validateLocales(
        configData,
        ['/en/', '/en/us/', '/fr/', '/en/us/products'],
      );
      expect(supported).to.include.members(['/en/', '/en/us/', '/en/us/products']);
      expect(unsupported).to.deep.equal(['/fr/']);
      expect(availablePaths).to.deep.equal(['/en/', '/en/us/']);
      expect(allSupported).to.equal(false);
    });
  });

  describe('getConfigForPath', () => {
    const configData = {
      public: {
        default: { analytics: { a: true }, feature: { on: true }, arr: [1] },
        '/en/': { analytics: { b: true }, feature: { extra: 'x' }, arr: [9] },
      },
    };

    it('returns default config when path resolves to default', () => {
      const result = getConfigForPath(configData, '/no/match');
      expect(result).to.deep.equal({ analytics: { a: true }, feature: { on: true }, arr: [1] });
    });

    it('merges default and specific path config', () => {
      const result = getConfigForPath(configData, '/en/products');
      expect(result).to.deep.equal({
        analytics: { a: true, b: true },
        feature: { on: true, extra: 'x' },
        arr: [9],
      });
    });

    it('returns empty object when section is missing', () => {
      const result = getConfigForPath({}, '/anything');
      expect(result).to.deep.equal({});
    });

    it('uses {} for defaultConfig when section.default is missing', () => {
      const result = getConfigForPath({ public: { '/en/': { x: 1 } } }, '/no/match');
      expect(result).to.deep.equal({});
    });

    it('uses {} for pathConfig when matched key exists but value is null', () => {
      const result = getConfigForPath({ public: { default: { a: 1 }, '/en/': null } }, '/en/us/');
      expect(result).to.deep.equal({ a: 1 });
    });


  });

  describe('getLocaleDebugInfo', () => {
    it('returns diagnostic info when section exists', () => {
      const configData = {
        public: {
          default: {},
          '/en/': {},
        },
      };
      const info = getLocaleDebugInfo(configData, '/en/us/');
      expect(info.locale).to.equal('/en/us/');
      expect(info.isSupported).to.equal(true);
      expect(info.matchedPath).to.equal('/en/');
      expect(info.availablePaths).to.deep.equal(['/en/']);
      expect(info.hasMultipleLocales).to.equal(true);
      expect(info.sectionExists).to.equal(true);
      expect(info.totalPaths).to.equal(2); // 1 available + default
    });

    it('handles missing section with defaults', () => {
      const info = getLocaleDebugInfo({}, '/foo');
      expect(info.sectionExists).to.equal(false);
      expect(info.matchedPath).to.equal('default');
      expect(info.availablePaths).to.deep.equal([]);
    });
  });
});

