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
import { enrichUrlsWithTopicData } from '../../src/utils/url-topic-enrichment.js';

describe('enrichUrlsWithTopicData', () => {
  const redditUrl1 = 'https://www.reddit.com/r/france/comments/abc123/post_title';
  const redditUrl2 = 'https://www.reddit.com/r/travel/comments/def456/another_post';
  const redditUrl3 = 'https://www.reddit.com/r/finance/comments/ghi789/finance_post';

  it('should enrich urls with categories, timesCited, and prompts from topics', () => {
    const urls = [
      { url: redditUrl1, siteId: 'site-1' },
      { url: redditUrl2, siteId: 'site-1' },
    ];

    const topics = [
      {
        topicId: 'topic-1',
        name: 'Insurance',
        urls: [
          {
            url: redditUrl1,
            category: 'pet-insurance',
            timesCited: 3,
            subPrompts: ['prompt-a', 'prompt-b'],
          },
        ],
      },
      {
        topicId: 'topic-2',
        name: 'Travel',
        urls: [
          {
            url: redditUrl1,
            category: 'travel-insurance',
            timesCited: 2,
            subPrompts: ['prompt-b', 'prompt-c'],
          },
          {
            url: redditUrl2,
            category: 'travel',
            timesCited: 5,
            subPrompts: ['prompt-d'],
          },
        ],
      },
    ];

    const result = enrichUrlsWithTopicData(urls, topics);

    expect(result[0]).to.deep.equal({
      url: redditUrl1,
      siteId: 'site-1',
      categories: ['pet-insurance', 'travel-insurance'],
      timesCited: 5,
      prompts: ['prompt-a', 'prompt-b', 'prompt-c'],
    });

    expect(result[1]).to.deep.equal({
      url: redditUrl2,
      siteId: 'site-1',
      categories: ['travel'],
      timesCited: 5,
      prompts: ['prompt-d'],
    });
  });

  it('should return url unchanged when not found in any topic', () => {
    const urls = [{ url: redditUrl3, siteId: 'site-1' }];
    const topics = [
      {
        topicId: 'topic-1',
        name: 'Insurance',
        urls: [{
          url: redditUrl1,
          category: 'insurance',
          timesCited: 1,
          subPrompts: [],
        }],
      },
    ];

    const result = enrichUrlsWithTopicData(urls, topics);

    expect(result[0]).to.deep.equal({ url: redditUrl3, siteId: 'site-1' });
    expect(result[0]).to.not.have.property('categories');
    expect(result[0]).to.not.have.property('timesCited');
    expect(result[0]).to.not.have.property('prompts');
  });

  it('should deduplicate categories and prompts', () => {
    const urls = [{ url: redditUrl1 }];
    const topics = [
      {
        topicId: 'topic-1',
        urls: [{
          url: redditUrl1,
          category: 'insurance',
          timesCited: 1,
          subPrompts: ['p1', 'p2'],
        }],
      },
      {
        topicId: 'topic-2',
        urls: [{
          url: redditUrl1,
          category: 'insurance',
          timesCited: 2,
          subPrompts: ['p2', 'p3'],
        }],
      },
    ];

    const result = enrichUrlsWithTopicData(urls, topics);

    expect(result[0].categories).to.deep.equal(['insurance']);
    expect(result[0].timesCited).to.equal(3);
    expect(result[0].prompts).to.deep.equal(['p1', 'p2', 'p3']);
  });

  it('should match urls case-insensitively', () => {
    const urls = [{ url: 'https://WWW.Reddit.com/r/France/comments/ABC123/Post_Title' }];
    const topics = [
      {
        topicId: 'topic-1',
        urls: [
          {
            url: 'https://www.reddit.com/r/france/comments/abc123/post_title',
            category: 'fr',
            timesCited: 1,
            subPrompts: [],
          },
        ],
      },
    ];

    const result = enrichUrlsWithTopicData(urls, topics);

    expect(result[0].categories).to.deep.equal(['fr']);
    expect(result[0].timesCited).to.equal(1);
  });

  it('should return original urls when topics is empty', () => {
    const urls = [{ url: redditUrl1 }, { url: redditUrl2 }];

    expect(enrichUrlsWithTopicData(urls, [])).to.deep.equal(urls);
    expect(enrichUrlsWithTopicData(urls, null)).to.deep.equal(urls);
    expect(enrichUrlsWithTopicData(urls, undefined)).to.deep.equal(urls);
  });

  it('should return empty array when urls is empty or falsy', () => {
    const topics = [{
      topicId: 't1',
      urls: [{
        url: redditUrl1,
        category: 'a',
        timesCited: 1,
      }],
    }];

    expect(enrichUrlsWithTopicData([], topics)).to.deep.equal([]);
    expect(enrichUrlsWithTopicData(null, topics)).to.deep.equal([]);
    expect(enrichUrlsWithTopicData(undefined, topics)).to.deep.equal([]);
  });

  it('should handle topics without urls array', () => {
    const urls = [{ url: redditUrl1 }];
    const topics = [
      { topicId: 'topic-1', name: 'No URLs topic' },
    ];

    const result = enrichUrlsWithTopicData(urls, topics);

    expect(result[0]).to.deep.equal({ url: redditUrl1 });
  });

  it('should omit categories/prompts when they are empty after filtering', () => {
    const urls = [{ url: redditUrl1 }];
    const topics = [
      {
        topicId: 'topic-1',
        urls: [{
          url: redditUrl1,
          category: null,
          timesCited: 0,
          subPrompts: [],
        }],
      },
    ];

    const result = enrichUrlsWithTopicData(urls, topics);

    expect(result[0]).to.not.have.property('categories');
    expect(result[0]).to.not.have.property('timesCited');
    expect(result[0]).to.not.have.property('prompts');
  });

  it('should handle timesCited as string values', () => {
    const urls = [{ url: redditUrl1 }];
    const topics = [
      {
        topicId: 'topic-1',
        urls: [{
          url: redditUrl1,
          category: 'cat',
          timesCited: '3',
          subPrompts: ['p1'],
        }],
      },
      {
        topicId: 'topic-2',
        urls: [{
          url: redditUrl1,
          category: 'dog',
          timesCited: '7',
          subPrompts: ['p2'],
        }],
      },
    ];

    const result = enrichUrlsWithTopicData(urls, topics);

    expect(result[0].timesCited).to.equal(10);
  });

  it('should skip topic url entries without a url field', () => {
    const urls = [{ url: redditUrl1 }];
    const topics = [
      {
        topicId: 'topic-1',
        urls: [
          { category: 'orphan', timesCited: 99 },
          {
            url: null,
            category: 'null-url',
            timesCited: 50,
          },
          {
            url: redditUrl1,
            category: 'valid',
            timesCited: 1,
            subPrompts: ['p1'],
          },
        ],
      },
    ];

    const result = enrichUrlsWithTopicData(urls, topics);

    expect(result[0].categories).to.deep.equal(['valid']);
    expect(result[0].timesCited).to.equal(1);
  });

  it('should handle url items without a url property', () => {
    const urls = [{ siteId: 'site-1' }, { url: redditUrl1 }];
    const topics = [
      {
        topicId: 'topic-1',
        urls: [{
          url: redditUrl1,
          category: 'cat',
          timesCited: 1,
          subPrompts: ['p1'],
        }],
      },
    ];

    const result = enrichUrlsWithTopicData(urls, topics);

    expect(result[0]).to.deep.equal({ siteId: 'site-1' });
    expect(result[1].categories).to.deep.equal(['cat']);
  });

  it('should preserve existing url item properties', () => {
    const urls = [{
      url: redditUrl1,
      siteId: 'site-1',
      audits: ['reddit-analysis'],
      byCustomer: false,
    }];
    const topics = [
      {
        topicId: 'topic-1',
        urls: [{
          url: redditUrl1,
          category: 'cat',
          timesCited: 1,
          subPrompts: ['p1'],
        }],
      },
    ];

    const result = enrichUrlsWithTopicData(urls, topics);

    expect(result[0].siteId).to.equal('site-1');
    expect(result[0].audits).to.deep.equal(['reddit-analysis']);
    expect(result[0].byCustomer).to.equal(false);
    expect(result[0].categories).to.deep.equal(['cat']);
  });
});
