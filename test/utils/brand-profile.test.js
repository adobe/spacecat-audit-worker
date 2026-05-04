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
import {
  extractBrandGuidelinesFromProfile,
  formatBrandGuidelinesToMarkdown,
  getBrandGuidelinesFromSite,
} from '../../src/utils/brand-profile.js';

use(sinonChai);

describe('Brand Profile Utils', () => {
  describe('extractBrandGuidelinesFromProfile', () => {
    it('should extract all brand guidelines from a complete profile', () => {
      const brandProfile = {
        main_profile: {
          tone_attributes: {
            primary: ['friendly', 'professional', 'helpful'],
            avoid: ['aggressive', 'casual'],
          },
          vocabulary: {
            signature_phrases: ['phrase1', 'phrase2', 'phrase3', 'phrase4', 'phrase5', 'phrase6'],
          },
          brand_values: {
            core_values: [
              { name: 'Innovation', evidence: 'We lead with new ideas' },
              { name: 'Quality', evidence: 'We deliver excellence' },
            ],
          },
          language_patterns: {
            preferred: ['active voice', 'clear language'],
            avoid: ['jargon', 'passive voice'],
          },
          communication_style: 'Direct and empathetic',
          editorial_guidelines: {
            dos: ['Use short sentences', 'Be specific'],
            donts: ['Use clichés', 'Be vague'],
          },
        },
      };

      const result = extractBrandGuidelinesFromProfile(brandProfile);

      expect(result.tone_attributes.primary).to.deep.equal(['friendly', 'professional', 'helpful']);
      expect(result.tone_attributes.avoid).to.deep.equal(['aggressive', 'casual']);
      expect(result.signature_phrases).to.have.lengthOf(5); // Limited to 5
      expect(result.brand_values).to.have.lengthOf(2);
      expect(result.brand_values[0].name).to.equal('Innovation');
      expect(result.language_patterns.preferred).to.deep.equal(['active voice', 'clear language']);
      expect(result.language_patterns.avoid).to.deep.equal(['jargon', 'passive voice']);
      expect(result.communication_style).to.equal('Direct and empathetic');
      expect(result.editorial_guidelines.dos).to.deep.equal(['Use short sentences', 'Be specific']);
      expect(result.editorial_guidelines.donts).to.deep.equal(['Use clichés', 'Be vague']);
    });

    it('should handle missing main_profile', () => {
      const brandProfile = {};
      const result = extractBrandGuidelinesFromProfile(brandProfile);

      expect(result.tone_attributes.primary).to.deep.equal([]);
      expect(result.tone_attributes.avoid).to.deep.equal([]);
      expect(result.signature_phrases).to.deep.equal([]);
      expect(result.brand_values).to.deep.equal([]);
      expect(result.communication_style).to.equal('');
    });

    it('should handle missing nested properties', () => {
      const brandProfile = {
        main_profile: {},
      };
      const result = extractBrandGuidelinesFromProfile(brandProfile);

      expect(result.tone_attributes.primary).to.deep.equal([]);
      expect(result.signature_phrases).to.deep.equal([]);
      expect(result.editorial_guidelines.dos).to.deep.equal([]);
    });

    it('should handle brand values with missing name or evidence', () => {
      const brandProfile = {
        main_profile: {
          brand_values: {
            core_values: [
              { name: 'HasName' }, // missing evidence
              { evidence: 'Has evidence' }, // missing name
              {}, // missing both
            ],
          },
        },
      };

      const result = extractBrandGuidelinesFromProfile(brandProfile);

      expect(result.brand_values).to.have.lengthOf(3);
      expect(result.brand_values[0]).to.deep.equal({ name: 'HasName', evidence: '' });
      expect(result.brand_values[1]).to.deep.equal({ name: '', evidence: 'Has evidence' });
      expect(result.brand_values[2]).to.deep.equal({ name: '', evidence: '' });
    });
  });

  describe('formatBrandGuidelinesToMarkdown', () => {
    it('should format complete guidelines to markdown', () => {
      const guidelines = {
        tone_attributes: {
          primary: ['friendly', 'professional'],
          avoid: ['aggressive'],
        },
        signature_phrases: ['Just do it', 'Think different'],
        brand_values: [
          { name: 'Innovation', evidence: 'We pioneer new solutions' },
        ],
        language_patterns: {
          preferred: ['active voice'],
          avoid: ['passive voice'],
        },
        communication_style: 'Direct and clear',
        editorial_guidelines: {
          dos: ['Be concise'],
          donts: ['Use jargon'],
        },
      };

      const result = formatBrandGuidelinesToMarkdown(guidelines);

      expect(result).to.include('## Brand Guidelines (from Brand Profile)');
      expect(result).to.include('### TONE ATTRIBUTES');
      expect(result).to.include('✓ MUST USE: friendly, professional');
      expect(result).to.include('✗ MUST AVOID: aggressive');
      expect(result).to.include('### SIGNATURE PHRASES');
      expect(result).to.include('"Just do it"');
      expect(result).to.include('### BRAND VALUES');
      expect(result).to.include('Innovation: We pioneer new solutions');
      expect(result).to.include('### LANGUAGE PATTERNS');
      expect(result).to.include('✓ Preferred:');
      expect(result).to.include('active voice');
      expect(result).to.include('✗ Avoid:');
      expect(result).to.include('passive voice');
      expect(result).to.include('### COMMUNICATION STYLE');
      expect(result).to.include('Direct and clear');
      expect(result).to.include('### EDITORIAL GUIDELINES');
      expect(result).to.include('✓ DO:');
      expect(result).to.include('Be concise');
      expect(result).to.include("✗ DON'T:");
      expect(result).to.include('Use jargon');
    });

    it('should handle empty guidelines', () => {
      const guidelines = {
        tone_attributes: { primary: [], avoid: [] },
        signature_phrases: [],
        brand_values: [],
        language_patterns: { preferred: [], avoid: [] },
        communication_style: '',
        editorial_guidelines: { dos: [], donts: [] },
      };

      const result = formatBrandGuidelinesToMarkdown(guidelines);

      expect(result).to.include('## Brand Guidelines (from Brand Profile)');
      expect(result).to.not.include('MUST USE:');
      expect(result).to.not.include('SIGNATURE PHRASES');
      expect(result).to.not.include('BRAND VALUES');
    });

    it('should handle missing optional sections', () => {
      const guidelines = {
        tone_attributes: {
          primary: ['professional'],
        },
      };

      const result = formatBrandGuidelinesToMarkdown(guidelines);

      expect(result).to.include('## Brand Guidelines (from Brand Profile)');
      expect(result).to.include('MUST USE: professional');
      expect(result).to.not.include('SIGNATURE PHRASES');
    });
  });

  describe('getBrandGuidelinesFromSite', () => {
    let sandbox;
    let mockLog;

    beforeEach(() => {
      sandbox = sinon.createSandbox();
      mockLog = {
        info: sandbox.stub(),
        debug: sandbox.stub(),
        error: sandbox.stub(),
      };
    });

    afterEach(() => {
      sandbox.restore();
    });

    it('should return empty string when site is null', () => {
      const result = getBrandGuidelinesFromSite(null, mockLog);
      expect(result).to.equal('');
    });

    it('should return empty string when site is undefined', () => {
      const result = getBrandGuidelinesFromSite(undefined, mockLog);
      expect(result).to.equal('');
    });

    it('should return formatted guidelines when brand profile exists', () => {
      const mockSite = {
        getConfig: () => ({
          getBrandProfile: () => ({
            main_profile: {
              tone_attributes: {
                primary: ['warm', 'helpful'],
                avoid: ['cold'],
              },
              editorial_guidelines: {
                dos: ['Be friendly'],
                donts: ['Be rude'],
              },
            },
          }),
        }),
      };

      const result = getBrandGuidelinesFromSite(mockSite, mockLog);

      expect(result).to.include('## Brand Guidelines (from Brand Profile)');
      expect(result).to.include('MUST USE: warm, helpful');
      expect(result).to.include('MUST AVOID: cold');
      expect(mockLog.info).to.have.been.calledWith(
        '[Brand Guidelines] Using brand profile from site config',
      );
    });

    it('should return empty string when brand profile is null', () => {
      const mockSite = {
        getConfig: () => ({
          getBrandProfile: () => null,
        }),
      };

      const result = getBrandGuidelinesFromSite(mockSite, mockLog);
      expect(result).to.equal('');
    });

    it('should return empty string when brand profile is empty object', () => {
      const mockSite = {
        getConfig: () => ({
          getBrandProfile: () => ({}),
        }),
      };

      const result = getBrandGuidelinesFromSite(mockSite, mockLog);
      expect(result).to.equal('');
    });

    it('should return empty string when getConfig returns null', () => {
      const mockSite = {
        getConfig: () => null,
      };

      const result = getBrandGuidelinesFromSite(mockSite, mockLog);
      expect(result).to.equal('');
    });

    it('should return empty string when getBrandProfile is not a function', () => {
      const mockSite = {
        getConfig: () => ({
          // getBrandProfile is missing
        }),
      };

      const result = getBrandGuidelinesFromSite(mockSite, mockLog);
      expect(result).to.equal('');
    });

    it('should handle errors gracefully and log them', () => {
      const mockSite = {
        getConfig: () => {
          throw new Error('Config error');
        },
      };

      const result = getBrandGuidelinesFromSite(mockSite, mockLog);

      expect(result).to.equal('');
      expect(mockLog.error).to.have.been.calledWith(
        '[Brand Guidelines] Error accessing brand profile from site config: Config error',
      );
    });

    it('should handle errors when getBrandProfile throws', () => {
      const mockSite = {
        getConfig: () => ({
          getBrandProfile: () => {
            throw new Error('Brand profile error');
          },
        }),
      };

      const result = getBrandGuidelinesFromSite(mockSite, mockLog);

      expect(result).to.equal('');
      expect(mockLog.error).to.have.been.calledWith(
        '[Brand Guidelines] Error accessing brand profile from site config: Brand profile error',
      );
    });

    it('should work without a logger', () => {
      const mockSite = {
        getConfig: () => ({
          getBrandProfile: () => ({
            main_profile: {
              tone_attributes: {
                primary: ['friendly'],
              },
            },
          }),
        }),
      };

      // Should not throw when log is null
      const result = getBrandGuidelinesFromSite(mockSite, null);
      expect(result).to.include('MUST USE: friendly');
    });

    it('should call log.debug with extracted guidelines', () => {
      const mockSite = {
        getConfig: () => ({
          getBrandProfile: () => ({
            main_profile: {
              tone_attributes: {
                primary: ['professional'],
              },
            },
          }),
        }),
      };

      getBrandGuidelinesFromSite(mockSite, mockLog);

      expect(mockLog.debug).to.have.been.called;
      const debugCall = mockLog.debug.firstCall.args[0];
      expect(debugCall).to.include('[Brand Guidelines] Extracted guidelines:');
    });
  });
});
