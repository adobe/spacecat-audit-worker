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

import { stripTrailingSlash } from '@adobe/spacecat-shared-utils';
import { load as cheerioLoad } from 'cheerio';
import { AzureOpenAIClient } from '@adobe/spacecat-shared-gpt-client';
import ExaClient from '../support/exa-client.js';
import { saveIntermediateResults } from './utils.js';
import { IMPROVEMENT_PROMPTS } from './information-gain-constants.js';

export const PREFLIGHT_INFORMATION_GAIN = 'information-gain';

/**
 * Feature ontology for content trait analysis
 */
const FEATURE_ONTOLOGY = {
  relevance: ['relevant', 'related', 'directly address', 'pertinent', 'applicable', 'on topic'],
  recency: ['recent', 'current', 'latest', 'up-to-date', 'new', 'modern'],
  authority: ['authoritative', 'official', 'expert', 'credible source', 'trusted'],
  credibility: ['credible', 'verified', 'reliable', 'trustworthy', 'reputable'],
  nuance: ['detailed', 'nuanced', 'comprehensive', 'in-depth', 'thorough'],
  quality: ['well-written', 'clear', 'articulate', 'professional'],
  specificity: ['specific', 'precise', 'exact', 'particular', 'concrete'],
  completeness: ['complete', 'comprehensive', 'thorough', 'full coverage'],
  novelty: ['unique', 'novel', 'distinctive', 'original', 'uncommon', 'rare'],
};

/**
 * Extract named entities from text (simple implementation)
 * @param {string} text - Text to analyze
 * @returns {Array<string>} List of entities
 */
function extractEntities(text) {
  const entities = new Set();

  // Extract capitalized words/phrases (likely proper nouns)
  const capitalizedPattern = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g;
  const matches = text.match(capitalizedPattern);
  if (matches) {
    matches.forEach((match) => entities.add(match.toLowerCase()));
  }

  // Extract product names with versions (e.g., "Premiere Pro 24.1")
  const versionPattern = /\b[A-Z][a-zA-Z\s]+\d+(?:\.\d+)*\b/g;
  const versionMatches = text.match(versionPattern);
  if (versionMatches) {
    versionMatches.forEach((match) => entities.add(match.toLowerCase().trim()));
  }

  return Array.from(entities);
}

/**
 * Extract numbers and facts from text
 * @param {string} text - Text to analyze
 * @returns {Array<string>} List of numbers/facts
 */
function extractNumbers(text) {
  const numbers = new Set();

  // Extract percentages, multipliers, and numbers
  const patterns = [
    /\d+\.?\d*\s*%/g,
    /\d+\.?\d*x/g,
    /\d+,\d+/g,
    /\d+\.\d+/g,
    /\d+/g,
  ];

  patterns.forEach((pattern) => {
    const matches = text.match(pattern);
    if (matches) {
      matches.forEach((match) => numbers.add(match));
    }
  });

  return Array.from(numbers);
}

/**
 * Extract factual statements from text
 * @param {string} text - Text to analyze
 * @returns {Array<string>} List of factual sentences
 */
function extractFacts(text) {
  const facts = [];
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [];

  const factIndicators = [
    /\d+\.?\d*\s*%/,
    /\d+\.?\d*x/,
    /\d+,\d+/,
    /\d+\.?\d*\s*(GB|MB|TB|ms|seconds?|minutes?|hours?|users?|times?)/i,
    /version\s+\d+/i,
    /\d+\.\d+/,
    /(?:improved|increased|decreased|reduced|achieved|reached|shipped|released|launched)/i,
    /(?:faster|slower|better|worse|higher|lower)\s+(?:by|than)/i,
    /(?:according to|based on|shows?|demonstrates?|proves?)/i,
  ];

  sentences.forEach((sent) => {
    const isFact = factIndicators.some((pattern) => pattern.test(sent));
    if (isFact) {
      facts.push(sent.trim());
    }
  });

  return facts;
}

/**
 * Calculate Shannon entropy of text
 * @param {string} text - Text to analyze
 * @returns {number} Entropy value
 */
function calculateEntropy(text) {
  if (!text || text.length === 0) {
    return 0.0;
  }

  const charFreq = {};
  for (const char of text) {
    charFreq[char] = (charFreq[char] || 0) + 1;
  }

  let entropy = 0.0;
  const textLen = text.length;
  for (const freq of Object.values(charFreq)) {
    const p = freq / textLen;
    if (p > 0) {
      entropy -= p * Math.log2(p);
    }
  }

  return entropy;
}

/**
 * Simple extractive summarization using sentence scoring
 * @param {string} text - Text to summarize
 * @param {number} targetRatio - Target compression ratio
 * @returns {string} Summary
 */
function extractiveSummarize(text, targetRatio = 0.3) {
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [];
  if (sentences.length <= 2) {
    return text;
  }

  // Score sentences based on fact indicators and entity presence
  const scoredSentences = sentences.map((sent, idx) => {
    let score = 0;

    // Has numbers or facts
    if (/\d/.test(sent)) {
      score += 2;
    }

    // Has capitalized words (entities)
    const capitalizedMatches = sent.match(/\b[A-Z][a-z]+/g);
    if (capitalizedMatches) {
      score += capitalizedMatches.length * 0.5;
    }

    // Position bonus (earlier sentences often more important)
    score += (sentences.length - idx) * 0.1;

    return { sentence: sent, score, index: idx };
  });

  // Sort by score and select top sentences
  scoredSentences.sort((a, b) => b.score - a.score);
  const targetCount = Math.max(1, Math.floor(sentences.length * targetRatio));
  const selectedSentences = scoredSentences.slice(0, targetCount);

  // Restore original order
  selectedSentences.sort((a, b) => a.index - b.index);

  return selectedSentences.map((s) => s.sentence).join(' ');
}

/**
 * Simple cosine similarity calculation
 * @param {Array<string>} tokens1 - First set of tokens
 * @param {Array<string>} tokens2 - Second set of tokens
 * @returns {number} Similarity score (0-1)
 */
function cosineSimilarity(tokens1, tokens2) {
  const set1 = new Set(tokens1);
  const set2 = new Set(tokens2);

  const intersection = new Set([...set1].filter((x) => set2.has(x)));

  if (set1.size === 0 || set2.size === 0) {
    return 0.0;
  }

  // Jaccard similarity as a proxy for cosine similarity
  const union = new Set([...set1, ...set2]);
  return intersection.size / union.size;
}

/**
 * Tokenize text into words
 * @param {string} text - Text to tokenize
 * @returns {Array<string>} Tokens
 */
function tokenize(text) {
  return text.toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 2);
}

/**
 * Measure information gain metrics
 * @param {string} original - Original text
 * @param {string} summary - Summary text
 * @returns {Object} Metrics
 */
export function measureInfoGain(original, summary) {
  // Token counts for compression ratio
  const origTokens = tokenize(original);
  const summTokens = tokenize(summary);
  const compressionRatio = origTokens.length > 0 ? summTokens.length / origTokens.length : 1.0;

  // Semantic similarity (using token overlap as proxy)
  const semanticSimilarity = cosineSimilarity(origTokens, summTokens);

  // Entity preservation
  const origEntities = new Set(extractEntities(original).map((e) => e.toLowerCase()));
  const summEntities = new Set(extractEntities(summary).map((e) => e.toLowerCase()));

  const exactMatches = new Set([...origEntities].filter((e) => summEntities.has(e)));

  let partialMatches = 0;
  for (const origEnt of origEntities) {
    if (!exactMatches.has(origEnt)) {
      for (const summEnt of summEntities) {
        if (origEnt.includes(summEnt) || summEnt.includes(origEnt)) {
          partialMatches += 1;
          break;
        }
      }
    }
  }

  const entityPreservation = origEntities.size > 0
    ? (exactMatches.size + partialMatches) / origEntities.size
    : 0.0;

  // Fact coverage (using numbers as proxy)
  const origNumbers = new Set(extractNumbers(original));
  const summNumbers = new Set(extractNumbers(summary));

  let factCoverage = 0.0;
  if (origNumbers.size > 0) {
    const preservedNumbers = new Set([...origNumbers].filter((n) => summNumbers.has(n)));
    factCoverage = preservedNumbers.size / origNumbers.size;
  } else {
    // Fallback to factual sentence coverage
    const origFacts = extractFacts(original);
    const summFacts = extractFacts(summary);
    factCoverage = origFacts.length > 0 ? summFacts.length / origFacts.length : 0.0;
  }

  // Entropy ratio
  const origEntropy = calculateEntropy(original);
  const summEntropy = calculateEntropy(summary);
  const entropyRatio = origEntropy > 0 ? summEntropy / origEntropy : 1.0;

  // InfoGain as information quality score (0-1 range, represents % of ideal information)
  // Note: Removed compression_ratio division to make score represent quality percentage
  const infogainScore = (semanticSimilarity * 0.35)
    + (entityPreservation * 0.25)
    + (factCoverage * 0.40);

  // Convert to 10-point scale with power curve
  // 0.0 → 0, 0.5 → 7.1, 0.8 → 9.0, 1.0 → 10
  const tenPointScore = Math.min(10.0, Math.max(0.0, infogainScore ** 0.7 * 10));

  // Extract novel information items (sentences) from summary
  const novelInfoItems = summary.match(/[^.!?]+[.!?]+/g) || [];

  return {
    compression_ratio: compressionRatio,
    semantic_similarity: semanticSimilarity,
    entity_preservation: entityPreservation,
    fact_coverage: factCoverage,
    entropy_ratio: entropyRatio,
    infogain_score: infogainScore,
    ten_point_score: parseFloat(tenPointScore.toFixed(1)),
    novel_info_items: novelInfoItems,
  };
}

/**
 * Categorize InfoGain score
 * @param {number} infogainScore - InfoGain score (0-1)
 * @returns {string} Category
 */
export function categorizeScore(infogainScore) {
  const tenPoint = Math.min(10.0, Math.max(0.0, infogainScore ** 0.7 * 10));

  if (tenPoint >= 9.0) return 'excellent';
  if (tenPoint >= 7.0) return 'good';
  if (tenPoint >= 5.0) return 'moderate';
  if (tenPoint >= 3.0) return 'poor';
  return 'very_poor';
}

/**
 * Analyze content traits
 * @param {string} content - Content to analyze
 * @returns {Object} Trait scores
 */
export function analyzeContentTraits(content) {
  const contentLower = content.toLowerCase();
  const traitScores = {};

  for (const [traitName, keywords] of Object.entries(FEATURE_ONTOLOGY)) {
    const count = keywords
      .reduce((sum, keyword) => sum + (contentLower.includes(keyword) ? 1 : 0), 0);

    let baseScore = Math.min((count / keywords.length) * 10, 10);

    // Adjust score based on content structure and density
    const wordCount = content.split(/\s+/).length;
    if (wordCount > 100) {
      const densityBonus = Math.min((wordCount / 500) * 2, 2);
      baseScore = Math.min(baseScore + densityBonus, 10);
    }

    traitScores[traitName] = parseFloat(baseScore.toFixed(1));
  }

  return traitScores;
}

/**
 * Extract problem examples from content using LLM
 * @param {Object} azureOpenAIClient - Azure OpenAI client
 * @param {string} originalContent - Original content to analyze
 * @param {string} trait - Trait to analyze (e.g., 'specificity', 'completeness')
 * @param {Array<string>} suggestedKeywords - Suggested keywords for the trait
 * @param {number} maxExamples - Maximum number of examples to extract
 * @param {Object} log - Logger
 * @returns {Promise<Array<string>>} Problem examples
 */
async function extractProblemExamplesWithLLM(
  azureOpenAIClient,
  originalContent,
  trait,
  suggestedKeywords,
  maxExamples,
  log,
) {
  if (!azureOpenAIClient) {
    log.warn('[information-gain] No Azure OpenAI client available for problem extraction');
    return [];
  }

  // Clean content to remove media references
  let cleanedContent = originalContent
    .replace(/!\[.*?\]\(.*?\)/g, '') // Remove markdown images
    .replace(/<img[^>]*>/g, '') // Remove HTML images
    .replace(/https?:\/\/[^\s]+\.(jpg|jpeg|png|gif|webp|svg|mp4|mp3)[^\s]*/gi, '') // Remove media URLs
    .replace(/\.\/media_[a-f0-9]+\.[a-z]+[^\s]*/g, '') // Remove media paths
    .replace(/\s+/g, ' ') // Remove excessive whitespace
    .trim();

  // Truncate if too long
  cleanedContent = cleanedContent.substring(0, 3000);

  const traitDescriptions = {
    relevance: 'Content alignment with target topics and search intent',
    recency: 'Timeliness and currency of information presented',
    authority: 'Establishment of expertise and authoritative sources',
    credibility: 'Trustworthiness and reliability indicators',
    nuance: 'Depth and thoroughness of topic coverage',
    quality: 'Writing clarity, structure, and professionalism',
    specificity: 'Use of concrete details, names, and specific references',
    completeness: 'Coverage of key facts, data points, and information',
    novelty: 'Uniqueness and originality of information provided',
  };

  const traitGuidance = {
    specificity: 'lacks concrete details, specific names, numbers, version numbers, or precise references',
    completeness: 'is vague, incomplete, uses general terms like "some", "many", "various" without specifics',
    relevance: 'is generic, boilerplate, or tangential to the main topic',
    quality: 'is overly verbose, unclear, redundant, or poorly structured',
    nuance: 'lacks depth, misses important distinctions, or oversimplifies complex topics',
    authority: 'lacks authoritative sources, expert citations, or credible references',
    credibility: 'lacks verifiable facts, data sources, or trustworthiness indicators',
    recency: 'lacks current dates, recent information, or up-to-date references',
    novelty: 'lacks unique information, uncommon facts, or distinctive insights',
  };

  const keywordsStr = suggestedKeywords.join(', ');
  const guidance = traitGuidance[trait] || `demonstrates weakness in ${trait}`;
  const description = traitDescriptions[trait] || '';

  const prompt = `Analyze this content and extract ${maxExamples} meaningful passages (2-3 sentences each) that demonstrate problems with "${trait}".

TRAIT: ${trait}
DEFINITION: ${description}
LOOK FOR: Passages that ${guidance}
SUGGESTED KEYWORDS TO CONSIDER: ${keywordsStr}

REQUIREMENTS:
- Each example should be 2-3 complete sentences (minimum 50 words)
- Focus on substantial text content that shows the weakness clearly
- Avoid image captions, media references, or single-word examples
- Select passages that provide enough context to understand the problem

CONTENT:
${cleanedContent}

Extract EXACTLY ${maxExamples} problematic passages that best demonstrate the weakness in "${trait}".
Each should be a direct quote from the content with enough context to be meaningful.

Return ONLY a JSON array of strings, nothing else:
["passage 1 with 2-3 sentences...", "passage 2 with 2-3 sentences..."]`;

  try {
    const response = await azureOpenAIClient.fetchChatCompletion(prompt, {
      systemPrompt: `You are an expert content analyst. Extract meaningful 2-3 sentence passages that demonstrate weakness in ${trait}. Return only valid JSON array with substantial, contextual examples.`,
    });

    const resultText = response.choices[0].message.content.trim();

    // Parse JSON response
    let examples = JSON.parse(resultText);

    // Validate structure
    if (!Array.isArray(examples)) {
      log.warn('[information-gain] Problem examples response is not an array');
      return [];
    }

    // Filter and validate examples
    examples = examples
      .filter((ex) => typeof ex === 'string'
        && ex.length > 50 // Minimum 50 characters
        && !ex.match(/!\[.*?\]\(.*?\)/) // No markdown images
        && !ex.match(/<img/) // No HTML images
        && !ex.match(/\.\/media_/)) // No media paths
      .slice(0, maxExamples);

    log.info(`[information-gain] Extracted ${examples.length} problem examples for trait: ${trait}`);
    return examples;
  } catch (error) {
    log.error(`[information-gain] Problem extraction failed for ${trait}: ${error.message}`);
    return [];
  }
}

/**
 * Correlate content traits with InfoGain metrics
 * @param {Object} traitScores - Content trait scores (0-10 for each trait)
 * @param {Object} metrics - InfoGain metrics
 * @returns {Object} Trait correlations with impact analysis
 */
function correlateTraitsWithMetrics(traitScores, metrics) {
  const traitToMetricMapping = {
    specificity: 'entity_preservation',
    completeness: 'fact_coverage',
    relevance: 'semantic_similarity',
    quality: 'compression_ratio',
    nuance: 'infogain_score',
    authority: 'entity_preservation',
    credibility: 'fact_coverage',
    recency: 'semantic_similarity',
    novelty: 'novel_info_items',
  };

  const traitDescriptions = {
    relevance: 'Content alignment with target topics and search intent',
    recency: 'Timeliness and currency of information presented',
    authority: 'Establishment of expertise and authoritative sources',
    credibility: 'Trustworthiness and reliability indicators',
    nuance: 'Depth and thoroughness of topic coverage',
    quality: 'Writing clarity, structure, and professionalism',
    specificity: 'Use of concrete details, names, and specific references',
    completeness: 'Coverage of key facts, data points, and information',
    novelty: 'Uniqueness and originality of information provided',
  };

  const correlations = {};

  Object.entries(traitScores).forEach(([trait, score]) => {
    const mappedMetric = traitToMetricMapping[trait];
    if (!mappedMetric) {
      return;
    }

    let metricValue = metrics[mappedMetric] || 0;

    // Handle special cases
    if (mappedMetric === 'novel_info_items') {
      // Normalize to 0-1 scale (assume 10 as good baseline)
      metricValue = Array.isArray(metrics.novel_info_items)
        ? metrics.novel_info_items.length / 10
        : 0;
    }

    // Determine impact level based on trait score and metric value
    let impact = 'low';
    let isProblematic = false;

    if (trait === 'quality') {
      // For quality, lower compression_ratio is better
      isProblematic = metricValue > 0.6 && score < 6.0;
    } else {
      // For other traits, higher is better
      isProblematic = metricValue < 0.5 && score < 6.0;
    }

    if (isProblematic) {
      impact = 'high';
    } else if (score < 7.0) {
      impact = 'medium';
    }

    correlations[trait] = {
      trait_score: score,
      mapped_metric: mappedMetric,
      metric_value: metricValue,
      impact,
      description: traitDescriptions[trait] || '',
    };
  });

  return correlations;
}

/**
 * Identify weak aspects based on metrics
 * @param {Object} metrics - InfoGain metrics
 * @param {Object} traitScores - Content trait scores
 * @param {Object} traitCorrelations - Trait correlation analysis
 * @param {Object} azureOpenAIClient - Azure OpenAI client (optional)
 * @param {string} originalContent - Original content (optional, for problem extraction)
 * @param {Object} log - Logger
 * @returns {Promise<Array<Object>>} Weak aspects
 */
async function identifyWeakAspects(
  metrics,
  traitScores,
  traitCorrelations,
  azureOpenAIClient,
  originalContent,
  log,
) {
  const weakAspects = [];
  const tenPoint = metrics.ten_point_score;

  // Only suggest improvements if score is below 9.0 (excellent threshold)
  if (tenPoint >= 9.0) {
    log.info(`[information-gain] Score is excellent (${tenPoint}/10), no improvements suggested`);
    return weakAspects;
  }

  // Reason templates for each trait
  const reasonMap = {
    specificity: (value) => `Low entity preservation (${(value * 100).toFixed(0)}%). Content lacks specific names, products, or concrete references for SEO keywords.`,
    completeness: (value) => `Low fact coverage (${(value * 100).toFixed(0)}%). Content is missing key facts, numbers, or detailed information needed for authority.`,
    relevance: (value) => `Low semantic similarity (${(value * 100).toFixed(0)}%). Content may not accurately represent key topics for search engines.`,
    quality: (value) => `High compression ratio (${(value * 100).toFixed(0)}%). Content may be verbose or contain unnecessary information that dilutes SEO value.`,
    authority: (value) => `Low authority indicators (${(value * 100).toFixed(0)}%). Content lacks expert sources, official references, or authoritative citations.`,
    credibility: (value) => `Low credibility signals (${(value * 100).toFixed(0)}%). Content needs more verifiable facts, reliable sources, or trustworthiness indicators.`,
    nuance: () => `Limited depth and nuance (InfoGain: ${metrics.infogain_score.toFixed(2)}). Content would benefit from more comprehensive and detailed coverage.`,
    recency: (value) => `Limited timeliness indicators (${(value * 100).toFixed(0)}%). Content lacks current dates, recent information, or up-to-date references.`,
    novelty: () => 'Limited novel information. Content would benefit from unique insights or uncommon facts.',
  };

  // SEO recommendation templates for each trait
  const seoRecommendationMap = {
    specificity: 'Add specific product names, version numbers, and named entities. Include precise metrics and exact terminology.',
    completeness: 'Include relevant statistics, data points, and quantitative information. Add dates, measurements, and specific examples.',
    relevance: 'Focus more directly on core topics. Remove tangential information and strengthen connection to main themes.',
    quality: 'Remove redundancy and filler words. Make writing more clear and concise while preserving key information.',
    authority: 'Add citations from authoritative sources, expert quotes, and references to official documentation.',
    credibility: 'Include verifiable facts with sources, specific evidence, and trustworthy references.',
    nuance: 'Add more detailed explanations, expert-level insights, and technical details to increase content value.',
    recency: 'Add current dates, reference latest versions, and include recent developments or contemporary examples.',
    novelty: 'Include unique insights, uncommon facts, and distinctive information not commonly found elsewhere.',
  };

  // Use trait correlations to identify high-impact weaknesses
  if (traitCorrelations) {
    // Get all high-impact traits from correlation analysis
    const highImpactTraits = Object.entries(traitCorrelations)
      .filter(([, corr]) => corr.impact === 'high');

    // Create weak aspects for each high-impact trait
    for (const [trait, corr] of highImpactTraits) {
      const metricValue = corr.metric_value || 0;
      const traitScore = corr.trait_score || 0;
      const suggestedKeywords = FEATURE_ONTOLOGY[trait] || [];

      // Extract problem examples using LLM if content is available
      let problemExamples = [];
      if (azureOpenAIClient && originalContent && originalContent.length > 100) {
        try {
          // eslint-disable-next-line no-await-in-loop
          problemExamples = await extractProblemExamplesWithLLM(
            azureOpenAIClient,
            originalContent,
            trait,
            suggestedKeywords.slice(0, 5),
            2, // max 2 examples per trait
            log,
          );
        } catch (error) {
          log.error(`[information-gain] Failed to extract problem examples for ${trait}: ${error.message}`);
        }
      }

      weakAspects.push({
        aspect: trait,
        reason: reasonMap[trait] ? reasonMap[trait](metricValue) : `Trait "${trait}" needs improvement for better SEO performance.`,
        current_score: metricValue,
        trait_score: traitScore,
        trait_analysis: {
          trait,
          score: traitScore,
          description: corr.description || '',
          impact_on_infogain: corr.impact || 'high',
        },
        seoImpact: metricValue < 0.4 ? 'High' : 'Moderate',
        seoRecommendation: seoRecommendationMap[trait] || `Improve ${trait} by focusing on relevant keywords and adding more specific content.`,
        suggestedKeywords: suggestedKeywords.slice(0, 5),
        problemExamples: problemExamples || [],
      });
    }
  }

  log.info(`[information-gain] Identified ${weakAspects.length} weak aspects for score ${tenPoint}/10`);
  return weakAspects;
}

/**
 * Extract key concepts from content for Wikipedia/novelty searches
 * @param {string} content - Content to analyze
 * @param {number} maxConcepts - Maximum concepts to extract
 * @returns {Array<string>} List of key concepts
 */
function extractKeyConcepts(content, maxConcepts = 5) {
  const concepts = [];

  // Extract capitalized phrases (likely proper nouns/entities)
  const capitalizedPattern = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g;
  const matches = content.match(capitalizedPattern);

  if (matches) {
    const seen = new Set();
    matches.forEach((match) => {
      if (match.length > 3 && !seen.has(match)) {
        seen.add(match);
        concepts.push(match);
      }
    });
  }

  return concepts.slice(0, maxConcepts);
}

/**
 * Generate authority-enhanced content using Wikipedia sources via Exa
 * @param {Object} azureOpenAIClient - Azure OpenAI client
 * @param {Object} exaClient - Exa AI client
 * @param {string} originalContent - Original content
 * @param {Object} log - Logger
 * @returns {Promise<Object>} Enhanced content result
 */
async function generateAuthorityEnhancement(
  azureOpenAIClient,
  exaClient,
  originalContent,
  log,
) {
  try {
    // Extract key concepts
    const concepts = extractKeyConcepts(originalContent, 5);
    log.info(`[information-gain authority] Extracted concepts: ${concepts.join(', ')}`);

    if (concepts.length === 0) {
      throw new Error('No concepts extracted from content');
    }

    // Find Wikipedia pages via Exa
    const wikipediaPages = [];
    for (const concept of concepts.slice(0, 3)) {
      try {
        log.info(`[information-gain authority] Searching Wikipedia for: ${concept}`);

        // eslint-disable-next-line no-await-in-loop
        const results = await exaClient.getContentsWithText([`https://en.wikipedia.org/wiki/${concept.replace(/\s+/g, '_')}`]);

        if (results.results && results.results.length > 0) {
          const result = results.results[0];
          if (result.text && result.text.length > 100) {
            wikipediaPages.push({
              url: result.url,
              title: result.title || concept,
              content: result.text.substring(0, 2000),
              concept,
            });
            log.info(`[information-gain authority] Found Wikipedia page: ${result.title}`);
          }
        }
      } catch (error) {
        log.warn(`[information-gain authority] Wikipedia search failed for "${concept}": ${error.message}`);
      }
    }

    if (wikipediaPages.length === 0) {
      throw new Error('No Wikipedia pages found');
    }

    // Extract authoritative statements (first paragraph of each)
    const authStatements = wikipediaPages.map((page) => {
      const paragraphs = page.content.split('\n').filter((p) => p.trim().length > 50);
      const leadPara = paragraphs[0] || page.content.substring(0, 500);

      // Clean Wikipedia markup
      const cleaned = leadPara
        .replace(/\[.*?\]/g, '') // Remove [citations]
        .replace(/\{.*?\}/g, '') // Remove {templates}
        .trim();

      return {
        statement: cleaned.substring(0, 500),
        source_title: page.title,
        source_url: page.url,
        concept: page.concept,
      };
    });

    // Format for LLM prompt
    const wikiInfoFormatted = authStatements.map((info, idx) => (
      `${idx + 1}. Concept: "${info.concept}"\n`
      + `   Definition: ${info.statement}\n`
      + `   Source: "${info.source_title}"\n`
      + `   URL: ${info.source_url}`
    )).join('\n\n');

    const prompt = 'You are an expert content editor focused on adding authoritative references.'
      + ' Your task is to rewrite the content integrating Wikipedia information with inline citations.\n\n'
      + `ORIGINAL CONTENT:\n${originalContent}\n\n`
      + `WIKIPEDIA AUTHORITATIVE INFORMATION:\n${wikiInfoFormatted}\n\n`
      + 'INSTRUCTIONS:\n'
      + '1. Rewrite the content maintaining the original structure and flow\n'
      + '2. Integrate authoritative definitions and facts from Wikipedia naturally\n'
      + '3. Add inline citations in [N] format after relevant statements\n'
      + '4. Use citations like: "Artificial intelligence [1] is a field of computer science..."\n'
      + '5. Each Wikipedia source must be cited at least once\n'
      + '6. Keep the writing clear, professional, and readable\n'
      + '7. Do NOT just append Wikipedia text - integrate it naturally\n\n'
      + 'CITATION RULES:\n'
      + '- Place [N] immediately after the statement or clause\n'
      + '- First time mentioning a concept, cite the definition\n'
      + '- Can reuse same citation number for the same source\n\n'
      + 'Generate the authority-enhanced content with inline [1], [2], [3] citations:';

    const systemPrompt = 'You are an expert content editor specializing in adding authoritative'
      + ' Wikipedia citations. Return enhanced content with inline [N] style citations.';

    const response = await azureOpenAIClient.fetchChatCompletion(prompt, { systemPrompt });
    const enhancedContent = response.choices[0].message.content.trim();

    // Add references section
    const references = `\n\n## References\n${
      authStatements.map((info, idx) => `[${idx + 1}] ${info.source_title}. Wikipedia. ${info.source_url}`).join('\n')}`;

    return {
      enhancedContent: enhancedContent + references,
      wikipediaSources: authStatements,
    };
  } catch (error) {
    log.error(`[information-gain authority] Enhancement failed: ${error.message}`);
    throw error;
  }
}

/**
 * Generate novelty-enhanced content using Exa to find related sources
 * @param {Object} azureOpenAIClient - Azure OpenAI client
 * @param {Object} exaClient - Exa AI client
 * @param {string} originalContent - Original content
 * @param {Object} log - Logger
 * @returns {Promise<Object>} Enhanced content result
 */
async function generateNoveltyEnhancement(azureOpenAIClient, exaClient, originalContent, log) {
  try {
    // Extract topic keywords
    const words = originalContent.split(/\s+/).slice(0, 200);
    const topicText = words.join(' ');
    const phrases = topicText.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g) || [];

    const keywords = [];
    const seen = new Set();
    phrases.forEach((phrase) => {
      if (phrase.length > 3 && !seen.has(phrase) && keywords.length < 3) {
        seen.add(phrase);
        keywords.push(phrase);
      }
    });

    if (keywords.length === 0) {
      keywords.push('related information');
    }

    log.info(`[information-gain novelty] Extracted keywords: ${keywords.join(', ')}`);

    // Find related content via Exa
    const relatedPages = [];
    for (const keyword of keywords.slice(0, 2)) {
      try {
        log.info(`[information-gain novelty] Searching for: ${keyword}`);

        // eslint-disable-next-line no-await-in-loop
        const results = await exaClient.findSimilarWithFullContent(
          `${keyword}`,
          { numResults: 2 },
        );

        if (results.results) {
          results.results.forEach((result) => {
            if (result.text && result.text.length > 200) {
              relatedPages.push({
                url: result.url,
                title: result.title || keyword,
                content: result.text.substring(0, 3000),
                keyword,
              });
            }
          });
        }
      } catch (error) {
        log.warn(`[information-gain novelty] Search failed for "${keyword}": ${error.message}`);
      }
    }

    if (relatedPages.length === 0) {
      throw new Error('No related pages found');
    }

    log.info(`[information-gain novelty] Found ${relatedPages.length} related pages`);

    // Extract novel insights using LLM
    const relatedFormatted = relatedPages.map((page, idx) => (
      `${idx + 1}. Source: ${page.title}\n`
      + `   URL: ${page.url}\n`
      + `   Content excerpt: ${page.content.substring(0, 500)}...`
    )).join('\n\n');

    const extractPrompt = 'You are an expert content analyst. Your task is to identify novel,'
      + ' unique information from related sources that is NOT already present in the original content.\n\n'
      + `ORIGINAL CONTENT:\n${originalContent.substring(0, 2000)}\n\n`
      + `RELATED SOURCES:\n${relatedFormatted}\n\n`
      + 'INSTRUCTIONS:\n'
      + '1. Carefully compare the original content with the related sources\n'
      + '2. Identify 3-5 specific facts, insights, or information pieces that are:\n'
      + '   - Present in the related sources\n'
      + '   - NOT mentioned or implied in the original content\n'
      + '   - Factual and verifiable\n'
      + '   - Relevant to the main topic\n'
      + '   - Would add value if integrated\n\n'
      + '3. For each novel insight, provide:\n'
      + '   - The specific information/fact\n'
      + '   - Which source it came from (source number and title)\n'
      + '   - Why it\'s novel (what makes it different from original)\n\n'
      + 'Return ONLY a JSON array of novel insights in this exact format:\n'
      + '[\n'
      + '  {\n'
      + '    "insight": "Specific novel fact or information",\n'
      + '    "source_index": 1,\n'
      + '    "source_title": "Source Title",\n'
      + '    "source_url": "URL",\n'
      + '    "novelty_reason": "Brief explanation of why this is novel"\n'
      + '  }\n'
      + ']\n\n'
      + 'If no truly novel information is found, return an empty array: []';

    const extractSystemPrompt = 'You are an expert at identifying novel information. Return only valid JSON.';

    const extractResponse = await azureOpenAIClient.fetchChatCompletion(
      extractPrompt,
      { systemPrompt: extractSystemPrompt },
    );

    let novelInsights = [];
    try {
      let responseText = extractResponse.choices[0].message.content.trim();

      // Clean markdown wrapping
      if (responseText.includes('```json')) {
        responseText = responseText.split('```json')[1].split('```')[0].trim();
      } else if (responseText.includes('```')) {
        responseText = responseText.split('```')[1].split('```')[0].trim();
      }

      novelInsights = JSON.parse(responseText);

      if (!Array.isArray(novelInsights)) {
        log.warn('[information-gain novelty] Response is not an array');
        novelInsights = [];
      }
    } catch (error) {
      log.error(`[information-gain novelty] Failed to parse insights: ${error.message}`);
      novelInsights = [];
    }

    if (novelInsights.length === 0) {
      throw new Error('No novel insights extracted');
    }

    log.info(`[information-gain novelty] Extracted ${novelInsights.length} novel insights`);

    // Generate novelty-enhanced content
    const insightsFormatted = novelInsights.map((insight, idx) => (
      `${idx + 1}. ${insight.insight}\n`
      + `   Source: ${insight.source_title} (${insight.source_url})`
    )).join('\n\n');

    const integratePrompt = 'You are an expert content editor. Your task is to integrate novel'
      + ' information into existing content seamlessly.\n\n'
      + `ORIGINAL CONTENT:\n${originalContent}\n\n`
      + `NOVEL INSIGHTS TO INTEGRATE:\n${insightsFormatted}\n\n`
      + 'INSTRUCTIONS:\n'
      + '1. Rewrite the content to naturally integrate the novel insights\n'
      + '2. Add the new information in relevant sections where it fits contextually\n'
      + '3. Include inline citations in [N] format after novel facts\n'
      + '4. Maintain the original structure and voice\n'
      + '5. Ensure the content flows naturally with the additions\n'
      + '6. Make the novel information feel like a natural part of the content\n\n'
      + 'CITATION FORMAT:\n'
      + '- Use [1], [2], [3] for each novel insight\n'
      + '- Place immediately after the novel statement\n'
      + '- Example: "Recent studies show X result [1] which impacts Y..."\n\n'
      + 'Generate the novelty-enhanced content with inline citations:';

    const integrateSystemPrompt = 'You are an expert content editor specializing in seamlessly'
      + ' integrating novel information with inline citations.';

    const integrateResponse = await azureOpenAIClient.fetchChatCompletion(
      integratePrompt,
      { systemPrompt: integrateSystemPrompt },
    );

    const enhancedContent = integrateResponse.choices[0].message.content.trim();

    // Add references section
    const references = `\n\n## References\n${
      novelInsights.map((insight, idx) => `[${idx + 1}] ${insight.source_title}. ${insight.source_url}`).join('\n')}`;

    return {
      enhancedContent: enhancedContent + references,
      novelSources: novelInsights,
    };
  } catch (error) {
    log.error(`[information-gain novelty] Enhancement failed: ${error.message}`);
    throw error;
  }
}

/**
 * Generate standard improvement using Azure OpenAI (for non-authority/novelty aspects)
 * @param {Object} azureOpenAIClient - Azure OpenAI client
 * @param {string} originalContent - Original content
 * @param {string} aspect - Aspect to improve
 * @returns {Promise<string>} Improved content
 */
async function generateStandardImprovement(azureOpenAIClient, originalContent, aspect) {
  if (!IMPROVEMENT_PROMPTS[aspect]) {
    throw new Error(`Unknown aspect: ${aspect}`);
  }

  const promptTemplate = IMPROVEMENT_PROMPTS[aspect];
  const userPrompt = `Original content:\n${originalContent}\n\n${promptTemplate}`;
  const systemPrompt = `You are a content improvement specialist focused on enhancing ${aspect}.`;

  const response = await azureOpenAIClient.fetchChatCompletion(userPrompt, {
    systemPrompt,
  });

  return response.choices[0].message.content.trim();
}

/**
 * Analyze page content and calculate InfoGain metrics
 * @param {string} text - Page text content
 * @returns {Object} Analysis result
 */
function analyzeContent(text) {
  if (!text || text.trim().length < 50) {
    return {
      error: 'Text too short to analyze',
      original_text: text,
    };
  }

  const summary = extractiveSummarize(text, 0.40);
  const metrics = measureInfoGain(text, summary);
  const scoreCategory = categorizeScore(metrics.infogain_score);
  const traitScores = analyzeContentTraits(text);

  return {
    original_text: text,
    summary,
    score_category: scoreCategory,
    metrics,
    trait_scores: traitScores,
    original_length: text.length,
    summary_length: summary.length,
  };
}

/**
 * Generate improved content for a specific aspect using Azure OpenAI
 * @param {Object} azureOpenAIClient - Azure OpenAI client
 * @param {Object} exaClient - Exa AI client (optional, for authority/novelty)
 * @param {string} originalContent - Original content to improve
 * @param {string} aspect - Aspect to improve (e.g., 'specificity', 'completeness')
 * @param {Object} log - Logger
 * @returns {Promise<Object>} Improvement result with new content and metrics
 */
async function generateImprovement(
  azureOpenAIClient,
  exaClient,
  originalContent,
  aspect,
  log,
) {
  if (!azureOpenAIClient) {
    throw new Error('Azure OpenAI client is required for content improvement');
  }

  try {
    log.info(`[information-gain] Generating improvement for aspect: ${aspect}`);

    let improvedContent;
    const additionalData = {};

    // Special handling for authority and novelty aspects using Exa
    if (aspect === 'authority' && exaClient) {
      try {
        const authorityResult = await generateAuthorityEnhancement(
          azureOpenAIClient,
          exaClient,
          originalContent,
          log,
        );
        improvedContent = authorityResult.enhancedContent;
        additionalData.wikipedia_sources = authorityResult.wikipediaSources;
      } catch (error) {
        log.warn(`[information-gain authority] Exa enhancement failed, using standard improvement: ${error.message}`);
        // Fallback to standard improvement
        improvedContent = await generateStandardImprovement(
          azureOpenAIClient,
          originalContent,
          aspect,
          log,
        );
      }
    } else if (aspect === 'novelty' && exaClient) {
      try {
        const noveltyResult = await generateNoveltyEnhancement(
          azureOpenAIClient,
          exaClient,
          originalContent,
          log,
        );
        improvedContent = noveltyResult.enhancedContent;
        additionalData.novel_sources = noveltyResult.novelSources;
      } catch (error) {
        log.warn(`[information-gain novelty] Exa enhancement failed, using standard improvement: ${error.message}`);
        // Fallback to standard improvement
        improvedContent = await generateStandardImprovement(
          azureOpenAIClient,
          originalContent,
          aspect,
          log,
        );
      }
    } else {
      // Standard improvement for other aspects
      improvedContent = await generateStandardImprovement(
        azureOpenAIClient,
        originalContent,
        aspect,
        log,
      );
    }

    // Analyze the improved content to get new metrics
    const improvedAnalysis = analyzeContent(improvedContent);

    // Calculate entity improvement
    const origEntities = new Set(extractEntities(originalContent));
    const improvedEntities = new Set(extractEntities(improvedContent));
    const entityImprovement = (
      improvedEntities.size - origEntities.size
    ) / Math.max(origEntities.size, 1);

    const entityCountMsg = `${origEntities.size} -> ${improvedEntities.size} entities`;
    const percentMsg = `(${(entityImprovement * 100).toFixed(1)}%)`;
    log.info(`[information-gain] Entity improvement for ${aspect}: ${entityCountMsg} ${percentMsg}`);

    // Calculate original analysis for delta
    const originalAnalysis = analyzeContent(originalContent);
    const improvementDelta = (
      improvedAnalysis.metrics.ten_point_score - originalAnalysis.metrics.ten_point_score
    );

    return {
      aspect,
      improvedContent,
      newSummary: improvedAnalysis.summary,
      newScore: improvedAnalysis.metrics.ten_point_score,
      newScoreCategory: improvedAnalysis.score_category,
      newMetrics: improvedAnalysis.metrics,
      newTraitScores: improvedAnalysis.trait_scores,
      entityImprovement,
      improvedContentEntityCount: improvedEntities.size,
      improvementDelta,
      aiRationale: `Content improved to enhance ${aspect}, resulting in better information density and SEO value.`,
      ...additionalData, // Include wikipedia_sources or novel_sources if present
    };
  } catch (error) {
    log.error(`[information-gain] Content improvement failed for ${aspect}: ${error.message}`);
    throw new Error(`Failed to generate improvement: ${error.message}`);
  }
}

/**
 * Information Gain preflight handler
 * @param {Object} context - Audit context
 * @param {Object} auditContext - Preflight audit context
 */
export default async function informationGain(context, auditContext) {
  const {
    site, job, log,
  } = context;
  const {
    previewUrls,
    step,
    audits,
    auditsResult,
    scrapedObjects,
    timeExecutionBreakdown,
  } = auditContext;

  const infoGainStartTime = Date.now();
  const infoGainStartTimestamp = new Date().toISOString();

  // Initialize Azure OpenAI client for LLM-based analysis
  let azureOpenAIClient = null;
  try {
    azureOpenAIClient = AzureOpenAIClient.createFrom(context);
    log.info('[information-gain] Azure OpenAI client initialized successfully');
  } catch (error) {
    log.warn(`[information-gain] Azure OpenAI client initialization failed: ${error.message}. Problem extraction and improvements will be limited.`);
  }

  // Initialize Exa AI client for authority/novelty enhancements
  let exaClient = null;
  try {
    exaClient = ExaClient.createFrom(context);
    log.info('[information-gain] Exa AI client initialized successfully');
  } catch (error) {
    log.warn(`[information-gain] Exa AI client initialization failed: ${error.message}. Authority and novelty enhancements will use fallback approach.`);
  }

  // Create information-gain audit entries for all pages
  previewUrls.forEach((url) => {
    const pageResult = audits.get(url);
    pageResult.audits.push({ name: PREFLIGHT_INFORMATION_GAIN, type: 'geo', opportunities: [] });
  });

  // Process each scraped page
  for (const { data } of scrapedObjects) {
    const { finalUrl, scrapeResult: { rawBody } } = data;
    const pageResult = audits.get(stripTrailingSlash(finalUrl));
    const infoGainAudit = pageResult.audits.find((a) => a.name === PREFLIGHT_INFORMATION_GAIN);

    // Extract text content from body
    const $ = cheerioLoad(rawBody);

    // Remove script, style, and nav elements
    $('script, style, nav, header, footer').remove();

    // Extract main content text
    const textContent = $('body').text()
      .replace(/\s+/g, ' ')
      .trim();

    if (textContent.length < 50) {
      infoGainAudit.opportunities.push({
        check: 'insufficient-content',
        issue: 'Page content too short for information gain analysis',
        seoImpact: 'High',
        seoRecommendation: 'Add more substantive content to the page',
      });
    } else {
      // Analyze content
      const analysis = analyzeContent(textContent);

      if (analysis.error) {
        infoGainAudit.opportunities.push({
          check: 'analysis-error',
          issue: analysis.error,
          seoImpact: 'Moderate',
          seoRecommendation: 'Ensure page has sufficient text content',
        });
      } else {
        // For identify step, add metrics and trait correlation analysis
        if (step === 'identify') {
          // Calculate trait correlations
          const traitCorrelations = correlateTraitsWithMetrics(
            analysis.trait_scores,
            analysis.metrics,
          );

          // Convert to array format for response
          const traitCorrelationsArray = Object.entries(traitCorrelations).map(([trait, corr]) => ({
            trait,
            traitScore: corr.trait_score,
            mappedMetric: corr.mapped_metric,
            metricValue: corr.metric_value.toFixed(2),
            impact: corr.impact,
            description: corr.description,
          }));

          // Sort by impact (high first) and then by trait score (low first)
          traitCorrelationsArray.sort((a, b) => {
            const impactOrder = { high: 0, medium: 1, low: 2 };
            const impactCompare = impactOrder[a.impact] - impactOrder[b.impact];
            if (impactCompare !== 0) return impactCompare;
            return a.traitScore - b.traitScore;
          });

          const opportunity = {
            check: 'information-gain-score',
            score: analysis.metrics.ten_point_score,
            scoreCategory: analysis.score_category,
            metrics: {
              compression_ratio: analysis.metrics.compression_ratio.toFixed(2),
              semantic_similarity: analysis.metrics.semantic_similarity.toFixed(2),
              entity_preservation: analysis.metrics.entity_preservation.toFixed(2),
              fact_coverage: analysis.metrics.fact_coverage.toFixed(2),
              entropy_ratio: analysis.metrics.entropy_ratio.toFixed(2),
              infogain_score: analysis.metrics.infogain_score.toFixed(2),
            },
            traitScores: analysis.trait_scores,
            traitCorrelations: traitCorrelationsArray,
            summary: analysis.summary,
            seoImpact: analysis.score_category === 'excellent' || analysis.score_category === 'good' ? 'Low' : 'High',
            seoRecommendation: analysis.score_category === 'excellent' || analysis.score_category === 'good'
              ? 'Content has good information density and SEO value'
              : 'Content needs improvement in information density and specificity',
          };

          // For non-excellent scores, optionally identify weak aspects (without improvements)
          if (analysis.score_category !== 'excellent' && azureOpenAIClient) {
            try {
              // eslint-disable-next-line no-await-in-loop
              const weakAspects = await identifyWeakAspects(
                analysis.metrics,
                analysis.trait_scores,
                traitCorrelations,
                azureOpenAIClient,
                textContent,
                log,
              );

              if (weakAspects.length > 0) {
                // Include weak aspects summary in identify step (without improvements)
                opportunity.weakAspectsIdentified = weakAspects.map((aspect) => ({
                  aspect: aspect.aspect,
                  reason: aspect.reason,
                  currentScore: aspect.current_score.toFixed(2),
                  traitScore: aspect.trait_score.toFixed(1),
                  seoImpact: aspect.seoImpact,
                  problemExamples: aspect.problemExamples || [],
                }));
              }
            } catch (error) {
              log.warn(`[information-gain identify] Failed to identify weak aspects: ${error.message}`);
            }
          }

          infoGainAudit.opportunities.push(opportunity);
        }

        // For suggest step, identify weak aspects and generate improvements
        if (step === 'suggest') {
          // Calculate trait correlations
          const traitCorrelations = correlateTraitsWithMetrics(
            analysis.trait_scores,
            analysis.metrics,
          );

          // eslint-disable-next-line no-await-in-loop
          const weakAspects = await identifyWeakAspects(
            analysis.metrics,
            analysis.trait_scores,
            traitCorrelations,
            azureOpenAIClient,
            textContent,
            log,
          );

          // Generate improvements for each weak aspect using Azure OpenAI
          const weakAspectsWithImprovements = [];
          for (const aspect of weakAspects) {
            const aspectData = {
              aspect: aspect.aspect,
              reason: aspect.reason,
              currentScore: aspect.current_score.toFixed(2),
              traitScore: aspect.trait_score.toFixed(1),
              traitAnalysis: aspect.trait_analysis,
              seoImpact: aspect.seoImpact,
              seoRecommendation: aspect.seoRecommendation,
              suggestedKeywords: aspect.suggestedKeywords || [],
              problemExamples: aspect.problemExamples || [],
            };

            if (azureOpenAIClient) {
              try {
                log.info(`[information-gain suggest] Generating improvement for aspect: ${aspect.aspect}`);
                // eslint-disable-next-line no-await-in-loop
                const improvement = await generateImprovement(
                  azureOpenAIClient,
                  exaClient, // Pass exaClient for authority/novelty enhancements
                  textContent,
                  aspect.aspect,
                  log,
                );

                const improvementData = {
                  ...aspectData,
                  improvedContent: improvement.improvedContent,
                  newSummary: improvement.newSummary,
                  newScore: improvement.newScore,
                  newScoreCategory: improvement.newScoreCategory,
                  improvementDelta: improvement.improvementDelta.toFixed(2),
                  newMetrics: {
                    compression_ratio: improvement.newMetrics.compression_ratio.toFixed(2),
                    semantic_similarity: improvement.newMetrics.semantic_similarity.toFixed(2),
                    entity_preservation: improvement.newMetrics.entity_preservation.toFixed(2),
                    fact_coverage: improvement.newMetrics.fact_coverage.toFixed(2),
                    infogain_score: improvement.newMetrics.infogain_score.toFixed(2),
                  },
                  newTraitScores: improvement.newTraitScores,
                  aiRationale: improvement.aiRationale,
                  suggestionStatus: 'completed',
                };

                // Add authority-specific sources if present
                if (improvement.wikipedia_sources) {
                  improvementData.wikipediaSources = improvement.wikipedia_sources;
                }

                // Add novelty-specific sources if present
                if (improvement.novel_sources) {
                  improvementData.novelSources = improvement.novel_sources;
                }

                weakAspectsWithImprovements.push(improvementData);
              } catch (error) {
                log.error(`[information-gain suggest] Failed to generate improvement for ${aspect.aspect}: ${error.message}`);
                weakAspectsWithImprovements.push({
                  ...aspectData,
                  suggestionStatus: 'failed',
                  suggestionMessage: `Failed to generate improvement: ${error.message}`,
                });
              }
            } else {
              weakAspectsWithImprovements.push({
                ...aspectData,
                suggestionStatus: 'unavailable',
                suggestionMessage: 'Azure OpenAI client not available. Problem extraction completed but improvements cannot be generated.',
              });
            }
          }

          // Convert trait correlations to array format
          const traitCorrelationsArray = Object.entries(traitCorrelations).map(([trait, corr]) => ({
            trait,
            traitScore: corr.trait_score,
            mappedMetric: corr.mapped_metric,
            metricValue: corr.metric_value.toFixed(2),
            impact: corr.impact,
            description: corr.description,
          }));

          traitCorrelationsArray.sort((a, b) => {
            const impactOrder = { high: 0, medium: 1, low: 2 };
            const impactCompare = impactOrder[a.impact] - impactOrder[b.impact];
            if (impactCompare !== 0) return impactCompare;
            return a.traitScore - b.traitScore;
          });

          infoGainAudit.opportunities.push({
            check: 'information-gain-analysis',
            score: analysis.metrics.ten_point_score,
            scoreCategory: analysis.score_category,
            metrics: {
              compression_ratio: analysis.metrics.compression_ratio.toFixed(2),
              semantic_similarity: analysis.metrics.semantic_similarity.toFixed(2),
              entity_preservation: analysis.metrics.entity_preservation.toFixed(2),
              fact_coverage: analysis.metrics.fact_coverage.toFixed(2),
              infogain_score: analysis.metrics.infogain_score.toFixed(2),
            },
            traitScores: analysis.trait_scores,
            traitCorrelations: traitCorrelationsArray,
            weakAspects: weakAspectsWithImprovements,
            summary: analysis.summary,
            seoImpact: weakAspects.length > 0 ? 'High' : 'Low',
            seoRecommendation: weakAspects.length > 0
              ? `Focus on improving: ${weakAspects.map((a) => a.aspect).join(', ')}`
              : 'Content has good information density and SEO value',
          });
        }
      }
    }
  }

  const infoGainEndTime = Date.now();
  const infoGainEndTimestamp = new Date().toISOString();
  const infoGainElapsed = ((infoGainEndTime - infoGainStartTime) / 1000).toFixed(2);

  log.debug(`[preflight-audit] site: ${site.getId()}, job: ${job.getId()}, step: ${step}. Information Gain audit completed in ${infoGainElapsed} seconds`);

  timeExecutionBreakdown.push({
    name: 'information-gain',
    duration: `${infoGainElapsed} seconds`,
    startTime: infoGainStartTimestamp,
    endTime: infoGainEndTimestamp,
  });

  await saveIntermediateResults(context, auditsResult, 'information gain audit');

  // Information Gain audit completes synchronously with Azure OpenAI
  return { processing: false };
}
