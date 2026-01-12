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

import { expect, use as chaiUse } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import { AzureOpenAIClient } from '@adobe/spacecat-shared-gpt-client';
import { getBrandGuidelines } from '../../../src/headings/shared-utils.js';

chaiUse(sinonChai);

describe('Brand Profile Integration', () => {
  let context;
  let log;
  let mockAzureClient;

  beforeEach(() => {
    log = {
      info: sinon.stub(),
      warn: sinon.stub(),
      debug: sinon.stub(),
      error: sinon.stub(),
    };

    mockAzureClient = {
      fetchChatCompletion: sinon.stub().resolves({
        choices: [{
          message: {
            content: JSON.stringify({
              brand_persona: 'AI generated persona',
              tone: 'AI generated tone',
            }),
          },
        }],
      }),
    };

    sinon.stub(AzureOpenAIClient, 'createFrom').returns(mockAzureClient);

    context = {
      log,
      env: {
        AZURE_OPENAI_ENDPOINT: 'https://test.openai.azure.com',
        AZURE_OPENAI_KEY: 'test-key',
        AZURE_API_VERSION: '2024-02-01',
        AZURE_COMPLETION_DEPLOYMENT: 'test-deployment',
      },
    };
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('getBrandGuidelines', () => {
    it('should use brand profile from site config when available', async () => {
      const mockBrandProfile = {
        main_profile: {
          brand_personality: {
            description: 'Lovesac comes across as both a nurturing host and an inspired creator',
            archetype: 'Caregiver-Innovator hybrid',
            traits: ['hospitable', 'innovative', 'optimistic', 'genuine', 'modern'],
          },
          tone_attributes: {
            primary: ['warm', 'enthusiastic', 'optimistic', 'inviting', 'premium'],
            avoid: ['aloof', 'overly formal', 'utilitarian', 'cold', 'condescending'],
          },
          language_patterns: {
            preferred: [
              'Designed for life',
              'Changeable. Washable. Loveable.',
              'Innovation you can feel',
            ],
            avoid: [
              'Lowest price guaranteed',
              'Standard sofa',
              'Cheap',
            ],
          },
          editorial_guidelines: {
            dos: [
              'Use brand-specific terms like \'Sac\' and \'Sactional\' confidently',
              'Tie product features directly to lifestyle/emotional benefits',
              'Speak directly to the reader in second person',
            ],
            donts: [
              'Talk down to the reader or use superfluous jargon',
              'Overpromise on technical claims without backing up with benefits',
              'Depend on price or discount language as primary motivation',
            ],
          },
        },
      };

      const mockSite = {
        getConfig: () => ({
          getBrandProfile: () => mockBrandProfile,
        }),
      };

      const healthyTagsObject = {
        title: 'Sample Title',
        description: 'Sample Description',
        h1: 'Sample H1',
      };

      const result = await getBrandGuidelines(healthyTagsObject, log, context, mockSite);

      // Verify that brand profile was used
      expect(log.info).to.have.been.calledWith('[Brand Guidelines] Using brand profile from site config');

      // Verify the extracted guidelines
      expect(result).to.have.property('brand_persona');
      expect(result.brand_persona).to.equal('Lovesac comes across as both a nurturing host and an inspired creator');

      expect(result).to.have.property('tone');
      expect(result.tone).to.equal('warm, enthusiastic, optimistic, inviting, premium');

      expect(result).to.have.property('editorial_guidelines');
      expect(result.editorial_guidelines).to.have.property('do');
      expect(result.editorial_guidelines.do).to.be.an('array').with.length(3);
      expect(result.editorial_guidelines).to.have.property('dont');
      expect(result.editorial_guidelines.dont).to.be.an('array').with.length(3);

      expect(result).to.have.property('forbidden');
      expect(result.forbidden).to.be.an('array');
      expect(result.forbidden).to.include('Lowest price guaranteed');
      expect(result.forbidden).to.include('aloof');

      // Verify AI was not called
      expect(mockAzureClient.fetchChatCompletion).to.not.have.been.called;
    });

    it('should handle camelCase property names in brand profile', async () => {
      const mockBrandProfile = {
        mainProfile: {
          brandPersonality: {
            description: 'Test brand personality',
          },
          toneAttributes: {
            primary: ['professional', 'friendly'],
            avoid: ['aggressive'],
          },
          languagePatterns: {
            avoid: ['test phrase'],
          },
          editorialGuidelines: {
            dos: ['Test do'],
            donts: ['Test dont'],
          },
        },
      };

      const mockSite = {
        getConfig: () => ({
          getBrandProfile: () => mockBrandProfile,
        }),
      };

      const healthyTagsObject = {
        title: 'Sample Title',
        description: 'Sample Description',
        h1: 'Sample H1',
      };

      const result = await getBrandGuidelines(healthyTagsObject, log, context, mockSite);

      expect(result.brand_persona).to.equal('Test brand personality');
      expect(result.tone).to.equal('professional, friendly');
      expect(result.forbidden).to.include('test phrase');
      expect(result.forbidden).to.include('aggressive');
    });

    it('should fall back to AI when no brand profile is available', async () => {
      const mockSite = {
        getConfig: () => ({
          getBrandProfile: () => null,
        }),
      };

      const healthyTagsObject = {
        title: 'Sample Title',
        description: 'Sample Description',
        h1: 'Sample H1',
      };

      await getBrandGuidelines(healthyTagsObject, log, context, mockSite);

      // Verify that AI fallback was used
      expect(log.info).to.have.been.calledWith('[Brand Guidelines] No brand profile found in site config, generating from healthy tags using AI');
      expect(mockAzureClient.fetchChatCompletion).to.have.been.called;
    });

    it('should fall back to AI when no site is provided', async () => {
      const healthyTagsObject = {
        title: 'Sample Title',
        description: 'Sample Description',
        h1: 'Sample H1',
      };

      await getBrandGuidelines(healthyTagsObject, log, context);

      // Verify that AI was used
      expect(log.info).to.have.been.calledWith('[Brand Guidelines] No brand profile found in site config, generating from healthy tags using AI');
      expect(mockAzureClient.fetchChatCompletion).to.have.been.called;
    });

    it('should fall back to AI when brand profile is empty object', async () => {
      const mockSite = {
        getConfig: () => ({
          getBrandProfile: () => ({}),
        }),
      };

      const healthyTagsObject = {
        title: 'Sample Title',
        description: 'Sample Description',
        h1: 'Sample H1',
      };

      await getBrandGuidelines(healthyTagsObject, log, context, mockSite);

      // Verify that AI fallback was used
      expect(log.info).to.have.been.calledWith('[Brand Guidelines] No brand profile found in site config, generating from healthy tags using AI');
      expect(mockAzureClient.fetchChatCompletion).to.have.been.called;
    });

    it('should handle errors gracefully and fall back to AI', async () => {
      const mockSite = {
        getConfig: () => {
          throw new Error('Config access error');
        },
      };

      const healthyTagsObject = {
        title: 'Sample Title',
        description: 'Sample Description',
        h1: 'Sample H1',
      };

      await getBrandGuidelines(healthyTagsObject, log, context, mockSite);

      // Verify that warning was logged
      expect(log.warn).to.have.been.calledWith(sinon.match(/Error accessing brand profile from site config/));

      // Verify that AI fallback was used
      expect(log.info).to.have.been.calledWith('[Brand Guidelines] No brand profile found in site config, generating from healthy tags using AI');
      expect(mockAzureClient.fetchChatCompletion).to.have.been.called;
    });

    it('should extract all forbidden items from both language patterns and tone attributes', async () => {
      const mockBrandProfile = {
        main_profile: {
          tone_attributes: {
            primary: ['friendly'],
            avoid: ['tone1', 'tone2'],
          },
          language_patterns: {
            avoid: ['phrase1', 'phrase2', 'phrase3'],
          },
          editorial_guidelines: {
            dos: [],
            donts: [],
          },
          brand_personality: {
            description: 'Test',
          },
        },
      };

      const mockSite = {
        getConfig: () => ({
          getBrandProfile: () => mockBrandProfile,
        }),
      };

      const healthyTagsObject = {
        title: 'Sample Title',
        description: 'Sample Description',
        h1: 'Sample H1',
      };

      const result = await getBrandGuidelines(healthyTagsObject, log, context, mockSite);

      expect(result.forbidden).to.be.an('array').with.length(5);
      expect(result.forbidden).to.include.members(['phrase1', 'phrase2', 'phrase3', 'tone1', 'tone2']);
    });
  });
});

