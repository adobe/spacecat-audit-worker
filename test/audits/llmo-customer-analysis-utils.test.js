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
import { compareConfigs } from '../../src/llmo-customer-analysis/utils.js';

describe('LLMO Customer Analysis Utils - compareConfigs', () => {
  describe('entities comparison', () => {
    it('should detect no changes when entities are identical', () => {
      const oldConfig = {
        entities: {
          'uuid-1': { type: 'product', name: 'Product A' },
          'uuid-2': { type: 'service', name: 'Service B' },
        },
        categories: {},
        topics: {},
        brands: { aliases: [] },
        competitors: { competitors: [] },
      };
      const newConfig = {
        entities: {
          'uuid-1': { type: 'product', name: 'Product A' },
          'uuid-2': { type: 'service', name: 'Service B' },
        },
        categories: {},
        topics: {},
        brands: { aliases: [] },
        competitors: { competitors: [] },
      };

      const result = compareConfigs(oldConfig, newConfig);
      expect(result).to.deep.equal({});
    });

    it('should detect new entities', () => {
      const oldConfig = {
        entities: {
          'uuid-1': { type: 'product', name: 'Product A' },
        },
        categories: {},
        topics: {},
        brands: { aliases: [] },
        competitors: { competitors: [] },
      };
      const newConfig = {
        entities: {
          'uuid-1': { type: 'product', name: 'Product A' },
          'uuid-2': { type: 'service', name: 'Service B' },
        },
        categories: {},
        topics: {},
        brands: { aliases: [] },
        competitors: { competitors: [] },
      };

      const result = compareConfigs(oldConfig, newConfig);
      expect(result).to.have.property('entities');
      expect(result.entities).to.deep.equal({
        'uuid-2': { type: 'service', name: 'Service B' },
      });
    });

    it('should detect modified entities (same UUID, different content)', () => {
      const oldConfig = {
        entities: {
          'uuid-1': { type: 'product', name: 'Product A' },
        },
        categories: {},
        topics: {},
        brands: { aliases: [] },
        competitors: { competitors: [] },
      };
      const newConfig = {
        entities: {
          'uuid-1': { type: 'product', name: 'Product A Updated' },
        },
        categories: {},
        topics: {},
        brands: { aliases: [] },
        competitors: { competitors: [] },
      };

      const result = compareConfigs(oldConfig, newConfig);
      expect(result).to.have.property('entities');
      expect(result.entities).to.deep.equal({
        'uuid-1': { type: 'product', name: 'Product A Updated' },
      });
    });

    it('should detect deleted entities', () => {
      const oldConfig = {
        entities: {
          'uuid-1': { type: 'product', name: 'Product A' },
          'uuid-2': { type: 'service', name: 'Service B' },
        },
        categories: {},
        topics: {},
        brands: { aliases: [] },
        competitors: { competitors: [] },
      };
      const newConfig = {
        entities: {
          'uuid-1': { type: 'product', name: 'Product A' },
        },
        categories: {},
        topics: {},
        brands: { aliases: [] },
        competitors: { competitors: [] },
      };

      const result = compareConfigs(oldConfig, newConfig);
      expect(result).to.have.property('entities');
      // Only returns changed items from new config, but deletion is detected
      expect(result.entities).to.deep.equal({});
    });
  });

  describe('categories comparison', () => {
    it('should detect region changes in categories', () => {
      const oldConfig = {
        entities: {},
        categories: {
          'cat-1': { name: 'Category A', region: 'us' },
        },
        topics: {},
        brands: { aliases: [] },
        competitors: { competitors: [] },
      };
      const newConfig = {
        entities: {},
        categories: {
          'cat-1': { name: 'Category A', region: ['us', 'uk'] },
        },
        topics: {},
        brands: { aliases: [] },
        competitors: { competitors: [] },
      };

      const result = compareConfigs(oldConfig, newConfig);
      expect(result).to.have.property('categories');
      expect(result.categories).to.deep.equal({
        'cat-1': { name: 'Category A', region: ['us', 'uk'] },
      });
    });

    it('should detect name changes in categories', () => {
      const oldConfig = {
        entities: {},
        categories: {
          'cat-1': { name: 'Category A', region: 'us' },
        },
        topics: {},
        brands: { aliases: [] },
        competitors: { competitors: [] },
      };
      const newConfig = {
        entities: {},
        categories: {
          'cat-1': { name: 'Category A Renamed', region: 'us' },
        },
        topics: {},
        brands: { aliases: [] },
        competitors: { competitors: [] },
      };

      const result = compareConfigs(oldConfig, newConfig);
      expect(result).to.have.property('categories');
      expect(result.categories).to.deep.equal({
        'cat-1': { name: 'Category A Renamed', region: 'us' },
      });
    });
  });

  describe('topics comparison', () => {
    it('should detect changes in topic prompts', () => {
      const oldConfig = {
        entities: {},
        categories: {},
        topics: {
          'topic-1': {
            name: 'Topic A',
            category: 'cat-1',
            prompts: [
              {
                prompt: 'Old prompt',
                regions: ['us'],
                origin: 'human',
                source: 'config',
              },
            ],
          },
        },
        brands: { aliases: [] },
        competitors: { competitors: [] },
      };
      const newConfig = {
        entities: {},
        categories: {},
        topics: {
          'topic-1': {
            name: 'Topic A',
            category: 'cat-1',
            prompts: [
              {
                prompt: 'New prompt',
                regions: ['us'],
                origin: 'human',
                source: 'config',
              },
            ],
          },
        },
        brands: { aliases: [] },
        competitors: { competitors: [] },
      };

      const result = compareConfigs(oldConfig, newConfig);
      expect(result).to.have.property('topics');
      expect(result.topics['topic-1'].prompts[0].prompt).to.equal('New prompt');
    });

    it('should detect changes in prompt regions', () => {
      const oldConfig = {
        entities: {},
        categories: {},
        topics: {
          'topic-1': {
            name: 'Topic A',
            category: 'cat-1',
            prompts: [
              {
                prompt: 'Test prompt',
                regions: ['us'],
                origin: 'human',
                source: 'config',
              },
            ],
          },
        },
        brands: { aliases: [] },
        competitors: { competitors: [] },
      };
      const newConfig = {
        entities: {},
        categories: {},
        topics: {
          'topic-1': {
            name: 'Topic A',
            category: 'cat-1',
            prompts: [
              {
                prompt: 'Test prompt',
                regions: ['us', 'uk'],
                origin: 'human',
                source: 'config',
              },
            ],
          },
        },
        brands: { aliases: [] },
        competitors: { competitors: [] },
      };

      const result = compareConfigs(oldConfig, newConfig);
      expect(result).to.have.property('topics');
      expect(result.topics['topic-1'].prompts[0].regions).to.deep.equal(['us', 'uk']);
    });

    it('should detect added prompts to existing topic', () => {
      const oldConfig = {
        entities: {},
        categories: {},
        topics: {
          'topic-1': {
            name: 'Topic A',
            category: 'cat-1',
            prompts: [
              {
                prompt: 'Prompt 1',
                regions: ['us'],
                origin: 'human',
                source: 'config',
              },
            ],
          },
        },
        brands: { aliases: [] },
        competitors: { competitors: [] },
      };
      const newConfig = {
        entities: {},
        categories: {},
        topics: {
          'topic-1': {
            name: 'Topic A',
            category: 'cat-1',
            prompts: [
              {
                prompt: 'Prompt 1',
                regions: ['us'],
                origin: 'human',
                source: 'config',
              },
              {
                prompt: 'Prompt 2',
                regions: ['us'],
                origin: 'ai',
                source: 'api',
              },
            ],
          },
        },
        brands: { aliases: [] },
        competitors: { competitors: [] },
      };

      const result = compareConfigs(oldConfig, newConfig);
      expect(result).to.have.property('topics');
      expect(result.topics['topic-1'].prompts).to.have.length(2);
    });
  });

  describe('brands comparison', () => {
    it('should detect no changes when brands are identical', () => {
      const oldConfig = {
        entities: {},
        categories: {},
        topics: {},
        brands: {
          aliases: [
            {
              aliases: ['Brand A', 'Brand A Inc'],
              category: 'cat-1',
              region: 'us',
            },
          ],
        },
        competitors: { competitors: [] },
      };
      const newConfig = {
        entities: {},
        categories: {},
        topics: {},
        brands: {
          aliases: [
            {
              aliases: ['Brand A', 'Brand A Inc'],
              category: 'cat-1',
              region: 'us',
            },
          ],
        },
        competitors: { competitors: [] },
      };

      const result = compareConfigs(oldConfig, newConfig);
      expect(result).to.not.have.property('brands');
    });

    it('should detect new brand aliases', () => {
      const oldConfig = {
        entities: {},
        categories: {},
        topics: {},
        brands: {
          aliases: [
            {
              aliases: ['Brand A'],
              category: 'cat-1',
              region: 'us',
            },
          ],
        },
        competitors: { competitors: [] },
      };
      const newConfig = {
        entities: {},
        categories: {},
        topics: {},
        brands: {
          aliases: [
            {
              aliases: ['Brand A'],
              category: 'cat-1',
              region: 'us',
            },
            {
              aliases: ['Brand B'],
              category: 'cat-2',
              region: 'uk',
            },
          ],
        },
        competitors: { competitors: [] },
      };

      const result = compareConfigs(oldConfig, newConfig);
      expect(result).to.have.property('brands');
      expect(result.brands.aliases).to.have.length(2);
    });

    it('should detect changes in brand alias list', () => {
      const oldConfig = {
        entities: {},
        categories: {},
        topics: {},
        brands: {
          aliases: [
            {
              aliases: ['Brand A'],
              category: 'cat-1',
              region: 'us',
            },
          ],
        },
        competitors: { competitors: [] },
      };
      const newConfig = {
        entities: {},
        categories: {},
        topics: {},
        brands: {
          aliases: [
            {
              aliases: ['Brand A', 'Brand A Inc'],
              category: 'cat-1',
              region: 'us',
            },
          ],
        },
        competitors: { competitors: [] },
      };

      const result = compareConfigs(oldConfig, newConfig);
      expect(result).to.have.property('brands');
      expect(result.brands.aliases[0].aliases).to.deep.equal(['Brand A', 'Brand A Inc']);
    });

    it('should detect region changes in brand aliases', () => {
      const oldConfig = {
        entities: {},
        categories: {},
        topics: {},
        brands: {
          aliases: [
            {
              aliases: ['Brand A'],
              category: 'cat-1',
              region: 'us',
            },
          ],
        },
        competitors: { competitors: [] },
      };
      const newConfig = {
        entities: {},
        categories: {},
        topics: {},
        brands: {
          aliases: [
            {
              aliases: ['Brand A'],
              category: 'cat-1',
              region: ['us', 'uk'],
            },
          ],
        },
        competitors: { competitors: [] },
      };

      const result = compareConfigs(oldConfig, newConfig);
      expect(result).to.have.property('brands');
      expect(result.brands.aliases[0].region).to.deep.equal(['us', 'uk']);
    });
  });

  describe('competitors comparison', () => {
    it('should detect no changes when competitors are identical', () => {
      const oldConfig = {
        entities: {},
        categories: {},
        topics: {},
        brands: { aliases: [] },
        competitors: {
          competitors: [
            {
              category: 'cat-1',
              region: 'us',
              name: 'Competitor A',
              aliases: ['Comp A'],
              urls: ['https://competitor-a.com'],
            },
          ],
        },
      };
      const newConfig = {
        entities: {},
        categories: {},
        topics: {},
        brands: { aliases: [] },
        competitors: {
          competitors: [
            {
              category: 'cat-1',
              region: 'us',
              name: 'Competitor A',
              aliases: ['Comp A'],
              urls: ['https://competitor-a.com'],
            },
          ],
        },
      };

      const result = compareConfigs(oldConfig, newConfig);
      expect(result).to.not.have.property('competitors');
    });

    it('should detect new competitors', () => {
      const oldConfig = {
        entities: {},
        categories: {},
        topics: {},
        brands: { aliases: [] },
        competitors: {
          competitors: [
            {
              category: 'cat-1',
              region: 'us',
              name: 'Competitor A',
              aliases: ['Comp A'],
              urls: ['https://competitor-a.com'],
            },
          ],
        },
      };
      const newConfig = {
        entities: {},
        categories: {},
        topics: {},
        brands: { aliases: [] },
        competitors: {
          competitors: [
            {
              category: 'cat-1',
              region: 'us',
              name: 'Competitor A',
              aliases: ['Comp A'],
              urls: ['https://competitor-a.com'],
            },
            {
              category: 'cat-2',
              region: 'uk',
              name: 'Competitor B',
              aliases: ['Comp B'],
              urls: ['https://competitor-b.com'],
            },
          ],
        },
      };

      const result = compareConfigs(oldConfig, newConfig);
      expect(result).to.have.property('competitors');
      expect(result.competitors.competitors).to.have.length(2);
    });

    it('should detect changes in competitor URLs', () => {
      const oldConfig = {
        entities: {},
        categories: {},
        topics: {},
        brands: { aliases: [] },
        competitors: {
          competitors: [
            {
              category: 'cat-1',
              region: 'us',
              name: 'Competitor A',
              aliases: ['Comp A'],
              urls: ['https://competitor-a.com'],
            },
          ],
        },
      };
      const newConfig = {
        entities: {},
        categories: {},
        topics: {},
        brands: { aliases: [] },
        competitors: {
          competitors: [
            {
              category: 'cat-1',
              region: 'us',
              name: 'Competitor A',
              aliases: ['Comp A'],
              urls: ['https://competitor-a.com', 'https://competitor-a.net'],
            },
          ],
        },
      };

      const result = compareConfigs(oldConfig, newConfig);
      expect(result).to.have.property('competitors');
      expect(result.competitors.competitors[0].urls).to.have.length(2);
    });

    it('should detect changes in competitor aliases', () => {
      const oldConfig = {
        entities: {},
        categories: {},
        topics: {},
        brands: { aliases: [] },
        competitors: {
          competitors: [
            {
              category: 'cat-1',
              region: 'us',
              name: 'Competitor A',
              aliases: ['Comp A'],
              urls: ['https://competitor-a.com'],
            },
          ],
        },
      };
      const newConfig = {
        entities: {},
        categories: {},
        topics: {},
        brands: { aliases: [] },
        competitors: {
          competitors: [
            {
              category: 'cat-1',
              region: 'us',
              name: 'Competitor A',
              aliases: ['Comp A', 'Competitor A Inc'],
              urls: ['https://competitor-a.com'],
            },
          ],
        },
      };

      const result = compareConfigs(oldConfig, newConfig);
      expect(result).to.have.property('competitors');
      expect(result.competitors.competitors[0].aliases).to.deep.equal(['Comp A', 'Competitor A Inc']);
    });
  });

  describe('multiple sections with changes', () => {
    it('should detect changes across multiple sections', () => {
      const oldConfig = {
        entities: {
          'uuid-1': { type: 'product', name: 'Product A' },
        },
        categories: {
          'cat-1': { name: 'Category A', region: 'us' },
        },
        topics: {},
        brands: { aliases: [] },
        competitors: { competitors: [] },
      };
      const newConfig = {
        entities: {
          'uuid-1': { type: 'product', name: 'Product A Updated' },
          'uuid-2': { type: 'service', name: 'Service B' },
        },
        categories: {
          'cat-1': { name: 'Category A', region: ['us', 'uk'] },
        },
        topics: {},
        brands: { aliases: [] },
        competitors: { competitors: [] },
      };

      const result = compareConfigs(oldConfig, newConfig);
      expect(result).to.have.property('entities');
      expect(result).to.have.property('categories');
      expect(result.entities).to.have.all.keys('uuid-1', 'uuid-2');
      expect(result.categories).to.have.all.keys('cat-1');
    });
  });

  describe('edge cases', () => {
    it('should handle empty configs', () => {
      const oldConfig = {
        entities: {},
        categories: {},
        topics: {},
        brands: { aliases: [] },
        competitors: { competitors: [] },
      };
      const newConfig = {
        entities: {},
        categories: {},
        topics: {},
        brands: { aliases: [] },
        competitors: { competitors: [] },
      };

      const result = compareConfigs(oldConfig, newConfig);
      expect(result).to.deep.equal({});
    });

    it('should handle missing sections in old config', () => {
      const oldConfig = {
        entities: {},
      };
      const newConfig = {
        entities: {
          'uuid-1': { type: 'product', name: 'Product A' },
        },
        categories: {},
        topics: {},
        brands: { aliases: [] },
        competitors: { competitors: [] },
      };

      const result = compareConfigs(oldConfig, newConfig);
      expect(result).to.have.property('entities');
      expect(result.entities).to.deep.equal({
        'uuid-1': { type: 'product', name: 'Product A' },
      });
    });

    it('should handle missing sections in new config', () => {
      const oldConfig = {
        entities: {
          'uuid-1': { type: 'product', name: 'Product A' },
        },
        categories: {},
        topics: {},
        brands: { aliases: [] },
        competitors: { competitors: [] },
      };
      const newConfig = {
        entities: {},
      };

      const result = compareConfigs(oldConfig, newConfig);
      expect(result).to.have.property('entities');
      expect(result.entities).to.deep.equal({});
    });
  });
});

