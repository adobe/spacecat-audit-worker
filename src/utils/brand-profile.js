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

/**
 * Brand Profile Utilities
 *
 * Shared functions for extracting and formatting brand profile data.
 * Matches the extraction used in Mystique BrandProfileTool.py for consistency
 * across Readability, Summarization, Headings, and Content AI.
 */

/**
 * Extract brand guidelines from brand profile
 * Matches the extraction used in Mystique BrandProfileTool.py for Readability/Summarization
 * @param {Object} brandProfile - Brand profile from site config
 * @returns {Object} Formatted brand guidelines
 */
export function extractBrandGuidelinesFromProfile(brandProfile) {
  const mainProfile = brandProfile.main_profile || {};

  // Extract tone attributes (primary and avoid)
  const toneAttributes = mainProfile.tone_attributes || {};
  const tonePrimary = toneAttributes.primary || [];
  const toneAvoid = toneAttributes.avoid || [];

  // Extract vocabulary - signature phrases (top 5)
  const vocabulary = mainProfile.vocabulary || {};
  const signaturePhrases = (vocabulary.signature_phrases || []).slice(0, 5);

  // Extract brand values - core values (top 5)
  const brandValues = mainProfile.brand_values || {};
  const coreValues = (brandValues.core_values || []).slice(0, 5).map((v) => ({
    name: v.name || '',
    evidence: v.evidence || '',
  }));

  // Extract language patterns (preferred and avoid) (top 5 each)
  const languagePatterns = mainProfile.language_patterns || {};
  const languagePreferred = (languagePatterns.preferred || []).slice(0, 5);
  const languageAvoid = (languagePatterns.avoid || []).slice(0, 5);

  // Extract communication style
  const communicationStyle = mainProfile.communication_style || '';

  // Extract editorial guidelines (dos and donts) (top 5 each)
  const editorialGuidelines = mainProfile.editorial_guidelines || {};
  const editorialDos = (editorialGuidelines.dos || []).slice(0, 5);
  const editorialDonts = (editorialGuidelines.donts || []).slice(0, 5);

  return {
    tone_attributes: {
      primary: tonePrimary,
      avoid: toneAvoid,
    },
    signature_phrases: signaturePhrases,
    brand_values: coreValues,
    language_patterns: {
      preferred: languagePreferred,
      avoid: languageAvoid,
    },
    communication_style: communicationStyle,
    editorial_guidelines: {
      dos: editorialDos,
      donts: editorialDonts,
    },
  };
}

/**
 * Format brand guidelines to markdown string for AI prompts
 * Matches the format used in Mystique BrandProfileTool.py
 * @param {Object} guidelines - Extracted brand guidelines object
 * @returns {string} Formatted markdown string
 */
export function formatBrandGuidelinesToMarkdown(guidelines) {
  const parts = ['## Brand Guidelines (from Brand Profile)'];

  // Tone attributes
  if (guidelines.tone_attributes) {
    parts.push('\n### TONE ATTRIBUTES');
    if (guidelines.tone_attributes.primary?.length > 0) {
      parts.push(`  ✓ MUST USE: ${guidelines.tone_attributes.primary.join(', ')}`);
    }
    if (guidelines.tone_attributes.avoid?.length > 0) {
      parts.push(`  ✗ MUST AVOID: ${guidelines.tone_attributes.avoid.join(', ')}`);
    }
  }

  // Signature phrases
  if (guidelines.signature_phrases?.length > 0) {
    parts.push('\n### SIGNATURE PHRASES');
    parts.push('  ✓ USE these phrases when relevant:');
    guidelines.signature_phrases.forEach((phrase) => {
      parts.push(`    • "${phrase}"`);
    });
  }

  // Brand values
  if (guidelines.brand_values?.length > 0) {
    parts.push('\n### BRAND VALUES');
    guidelines.brand_values.forEach((value) => {
      parts.push(`    • ${value.name}: ${value.evidence}`);
    });
  }

  // Language patterns
  if (guidelines.language_patterns) {
    parts.push('\n### LANGUAGE PATTERNS');
    if (guidelines.language_patterns.preferred?.length > 0) {
      parts.push('  ✓ Preferred:');
      guidelines.language_patterns.preferred.forEach((item) => {
        parts.push(`    • ${item}`);
      });
    }
    if (guidelines.language_patterns.avoid?.length > 0) {
      parts.push('  ✗ Avoid:');
      guidelines.language_patterns.avoid.forEach((item) => {
        parts.push(`    • ${item}`);
      });
    }
  }

  // Communication style
  if (guidelines.communication_style) {
    parts.push('\n### COMMUNICATION STYLE');
    parts.push(`  ${guidelines.communication_style}`);
  }

  // Editorial guidelines
  if (guidelines.editorial_guidelines) {
    parts.push('\n### EDITORIAL GUIDELINES');
    if (guidelines.editorial_guidelines.dos?.length > 0) {
      parts.push('  ✓ DO:');
      guidelines.editorial_guidelines.dos.forEach((item) => {
        parts.push(`    • ${item}`);
      });
    }
    if (guidelines.editorial_guidelines.donts?.length > 0) {
      parts.push("  ✗ DON'T:");
      guidelines.editorial_guidelines.donts.forEach((item) => {
        parts.push(`    • ${item}`);
      });
    }
  }

  return parts.join('\n');
}

/**
 * Get formatted brand guidelines from a site's brand profile
 * @param {Object} site - Site object with getConfig method
 * @param {Object} log - Logger instance (optional)
 * @returns {string} Formatted brand guidelines markdown string, or empty string if not available
 */
export function getBrandGuidelinesFromSite(site, log = null) {
  if (!site) {
    return '';
  }

  try {
    const config = site.getConfig();
    const brandProfile = config?.getBrandProfile?.();

    if (brandProfile && typeof brandProfile === 'object' && Object.keys(brandProfile).length > 0) {
      log?.info('[Brand Guidelines] Using brand profile from site config');
      const guidelines = extractBrandGuidelinesFromProfile(brandProfile);
      const formattedGuidelines = formatBrandGuidelinesToMarkdown(guidelines);
      log?.debug(`[Brand Guidelines] Extracted guidelines: ${formattedGuidelines}`);
      return formattedGuidelines;
    }
  } catch (error) {
    log?.error(`[Brand Guidelines] Error accessing brand profile from site config: ${error.message}`);
  }

  return '';
}
