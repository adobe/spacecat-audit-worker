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

import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import writeDrsPromptsToLlmoConfig from '../../src/drs-prompt-generation/drs-config-writer.js';

use(sinonChai);

describe('DRS Config Writer', () => {
  let sandbox;
  let log;
  let s3Client;
  let configClient;

  before('setup', () => {
    sandbox = sinon.createSandbox();
  });

  beforeEach(() => {
    log = {
      info: sandbox.spy(),
      warn: sandbox.spy(),
      error: sandbox.spy(),
    };
    s3Client = {};

    configClient = {
      readConfig: sandbox.stub(),
      writeConfig: sandbox.stub().resolves({ version: 'v42' }),
    };
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('creates aiTopics and categories from DRS prompts', async () => {
    configClient.readConfig.resolves({
      config: { categories: {}, aiTopics: {} },
    });

    const drsPrompts = [
      {
        prompt: 'What is Adobe?',
        region: 'us',
        category: 'brand',
        topic: 'general',
        base_url: 'https://adobe.com',
      },
      {
        prompt: 'How does Photoshop work?',
        region: 'de',
        category: 'brand',
        topic: 'product',
        base_url: 'https://adobe.com/photoshop',
      },
    ];

    const result = await writeDrsPromptsToLlmoConfig({
      drsPrompts, siteId: 'site-1', s3Client, s3Bucket: 'bucket', log, configClient,
    });

    expect(result.success).to.equal(true);
    expect(result.version).to.equal('v42');

    const writtenConfig = configClient.writeConfig.firstCall.args[1];

    // One category 'brand' was created with merged regions
    const catEntries = Object.entries(writtenConfig.categories);
    expect(catEntries).to.have.lengthOf(1);
    expect(catEntries[0][1].name).to.equal('brand');
    expect(catEntries[0][1].origin).to.equal('ai');
    expect(catEntries[0][1].region).to.deep.include.members(['us', 'de']);

    // Two aiTopics created: 'general' and 'product'
    const topicEntries = Object.entries(writtenConfig.aiTopics);
    expect(topicEntries).to.have.lengthOf(2);

    const topicNames = topicEntries.map(([, t]) => t.name).sort();
    expect(topicNames).to.deep.equal(['general', 'product']);

    // Both reference the same category
    const categoryId = catEntries[0][0];
    topicEntries.forEach(([, t]) => {
      expect(t.category).to.equal(categoryId);
    });

    // Each has one prompt with correct fields
    topicEntries.forEach(([, t]) => {
      expect(t.prompts).to.have.lengthOf(1);
      expect(t.prompts[0].origin).to.equal('ai');
      expect(t.prompts[0].source).to.equal('drs');
      expect(t.prompts[0]).to.have.property('id');
      expect(t.prompts[0]).to.have.property('updatedBy', 'drs');
      expect(t.prompts[0]).to.have.property('updatedAt');
    });
  });

  it('reuses existing categories by name (case-insensitive)', async () => {
    configClient.readConfig.resolves({
      config: {
        categories: {
          'existing-cat-id': { name: 'Brand' },
        },
        aiTopics: {},
      },
    });

    const drsPrompts = [
      {
        prompt: 'Test prompt', region: 'us', category: 'brand', topic: 'general',
      },
    ];

    await writeDrsPromptsToLlmoConfig({
      drsPrompts, siteId: 'site-1', s3Client, s3Bucket: 'bucket', log, configClient,
    });

    const writtenConfig = configClient.writeConfig.firstCall.args[1];

    // Should NOT create a new category
    expect(Object.keys(writtenConfig.categories)).to.have.lengthOf(1);
    expect(writtenConfig.categories['existing-cat-id'].name).to.equal('Brand');

    // aiTopic references existing category
    const [, topic] = Object.entries(writtenConfig.aiTopics)[0];
    expect(topic.category).to.equal('existing-cat-id');
  });

  it('merges regions for duplicate prompts within a topic', async () => {
    configClient.readConfig.resolves({
      config: { categories: {}, aiTopics: {} },
    });

    const drsPrompts = [
      {
        prompt: 'Same question', region: 'us', category: 'cat', topic: 'topic',
      },
      {
        prompt: 'Same question', region: 'de', category: 'cat', topic: 'topic',
      },
      {
        prompt: 'Same question', region: 'fr', category: 'cat', topic: 'topic',
      },
    ];

    await writeDrsPromptsToLlmoConfig({
      drsPrompts, siteId: 'site-1', s3Client, s3Bucket: 'bucket', log, configClient,
    });

    const writtenConfig = configClient.writeConfig.firstCall.args[1];
    const [, topic] = Object.entries(writtenConfig.aiTopics)[0];

    // Should be one prompt with 3 regions, not 3 prompts
    expect(topic.prompts).to.have.lengthOf(1);
    expect(topic.prompts[0].regions.sort()).to.deep.equal(['de', 'fr', 'us']);
  });

  it('defaults category and topic to "general"', async () => {
    configClient.readConfig.resolves({
      config: { categories: {}, aiTopics: {} },
    });

    const drsPrompts = [
      { prompt: 'No category or topic' },
    ];

    await writeDrsPromptsToLlmoConfig({
      drsPrompts, siteId: 'site-1', s3Client, s3Bucket: 'bucket', log, configClient,
    });

    const writtenConfig = configClient.writeConfig.firstCall.args[1];
    const [, cat] = Object.entries(writtenConfig.categories)[0];
    expect(cat.name).to.equal('general');
    const [, topic] = Object.entries(writtenConfig.aiTopics)[0];
    expect(topic.name).to.equal('general');
  });

  it('skips empty prompt texts', async () => {
    configClient.readConfig.resolves({
      config: { categories: {}, aiTopics: {} },
    });

    const drsPrompts = [
      {
        prompt: '', region: 'us', category: 'cat', topic: 'topic',
      },
      {
        prompt: 'Valid prompt', region: 'us', category: 'cat', topic: 'topic',
      },
    ];

    await writeDrsPromptsToLlmoConfig({
      drsPrompts, siteId: 'site-1', s3Client, s3Bucket: 'bucket', log, configClient,
    });

    const writtenConfig = configClient.writeConfig.firstCall.args[1];
    const [, topic] = Object.entries(writtenConfig.aiTopics)[0];
    expect(topic.prompts).to.have.lengthOf(1);
    expect(topic.prompts[0].prompt).to.equal('Valid prompt');
  });

  it('initializes aiTopics and categories if missing from config', async () => {
    configClient.readConfig.resolves({
      config: {},
    });

    const drsPrompts = [
      {
        prompt: 'Test', region: 'us', category: 'c', topic: 't',
      },
    ];

    await writeDrsPromptsToLlmoConfig({
      drsPrompts, siteId: 'site-1', s3Client, s3Bucket: 'bucket', log, configClient,
    });

    const writtenConfig = configClient.writeConfig.firstCall.args[1];
    expect(writtenConfig.aiTopics).to.be.an('object');
    expect(writtenConfig.categories).to.be.an('object');
  });

  it('passes correct args to readConfig and writeConfig', async () => {
    configClient.readConfig.resolves({
      config: { categories: {}, aiTopics: {} },
    });

    const drsPrompts = [
      {
        prompt: 'Q', region: 'us', category: 'c', topic: 't',
      },
    ];

    await writeDrsPromptsToLlmoConfig({
      drsPrompts, siteId: 'site-xyz', s3Client, s3Bucket: 'my-bucket', log, configClient,
    });

    expect(configClient.readConfig).to.have.been.calledOnceWith('site-xyz', s3Client, { s3Bucket: 'my-bucket' });
    expect(configClient.writeConfig).to.have.been.calledOnceWith('site-xyz', sinon.match.object, s3Client, { s3Bucket: 'my-bucket' });
  });

  it('skips topic when all prompts in group have empty text', async () => {
    configClient.readConfig.resolves({
      config: { categories: {}, aiTopics: {} },
    });

    const drsPrompts = [
      {
        prompt: '', region: 'us', category: 'cat', topic: 'empty-topic',
      },
    ];

    await writeDrsPromptsToLlmoConfig({
      drsPrompts, siteId: 'site-1', s3Client, s3Bucket: 'bucket', log, configClient,
    });

    const writtenConfig = configClient.writeConfig.firstCall.args[1];
    // Category still created, but no aiTopics since all prompts were empty
    expect(Object.keys(writtenConfig.aiTopics)).to.have.lengthOf(0);
  });

  it('handles prompts without region', async () => {
    configClient.readConfig.resolves({
      config: { categories: {}, aiTopics: {} },
    });

    const drsPrompts = [
      { prompt: 'No region prompt', category: 'cat', topic: 'topic' },
    ];

    await writeDrsPromptsToLlmoConfig({
      drsPrompts, siteId: 'site-1', s3Client, s3Bucket: 'bucket', log, configClient,
    });

    const writtenConfig = configClient.writeConfig.firstCall.args[1];
    const [, topic] = Object.entries(writtenConfig.aiTopics)[0];
    expect(topic.prompts[0].regions).to.deep.equal([]);

    // Category should not have region set when no prompts have regions
    const [, cat] = Object.entries(writtenConfig.categories)[0];
    expect(cat.region).to.be.undefined;
  });

  it('sets single region string on category when all prompts share one region', async () => {
    configClient.readConfig.resolves({
      config: { categories: {}, aiTopics: {} },
    });

    const drsPrompts = [
      {
        prompt: 'Q1', region: 'us', category: 'brand', topic: 't1',
      },
      {
        prompt: 'Q2', region: 'us', category: 'brand', topic: 't2',
      },
    ];

    await writeDrsPromptsToLlmoConfig({
      drsPrompts, siteId: 'site-1', s3Client, s3Bucket: 'bucket', log, configClient,
    });

    const writtenConfig = configClient.writeConfig.firstCall.args[1];
    const [, cat] = Object.entries(writtenConfig.categories)[0];
    expect(cat.region).to.equal('us');
  });

  it('sets region array on category when prompts have multiple regions', async () => {
    configClient.readConfig.resolves({
      config: { categories: {}, aiTopics: {} },
    });

    const drsPrompts = [
      {
        prompt: 'Q1', region: 'us', category: 'brand', topic: 't1',
      },
      {
        prompt: 'Q2', region: 'uk', category: 'brand', topic: 't1',
      },
      {
        prompt: 'Q3', region: 'de', category: 'brand', topic: 't2',
      },
    ];

    await writeDrsPromptsToLlmoConfig({
      drsPrompts, siteId: 'site-1', s3Client, s3Bucket: 'bucket', log, configClient,
    });

    const writtenConfig = configClient.writeConfig.firstCall.args[1];
    const [, cat] = Object.entries(writtenConfig.categories)[0];
    expect(cat.region).to.be.an('array');
    expect(cat.region).to.have.lengthOf(3);
    expect(cat.region.sort()).to.deep.equal(['de', 'uk', 'us']);
  });

  it('creates separate categories for different category names', async () => {
    configClient.readConfig.resolves({
      config: { categories: {}, aiTopics: {} },
    });

    const drsPrompts = [
      {
        prompt: 'Q1', region: 'us', category: 'brand', topic: 't1',
      },
      {
        prompt: 'Q2', region: 'us', category: 'product', topic: 't2',
      },
    ];

    await writeDrsPromptsToLlmoConfig({
      drsPrompts, siteId: 'site-1', s3Client, s3Bucket: 'bucket', log, configClient,
    });

    const writtenConfig = configClient.writeConfig.firstCall.args[1];
    expect(Object.keys(writtenConfig.categories)).to.have.lengthOf(2);
    expect(Object.keys(writtenConfig.aiTopics)).to.have.lengthOf(2);
  });
});
