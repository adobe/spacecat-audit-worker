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
import { saveIntermediateResults } from './utils.js';
import { sendInformationGainToMystique } from './information-gain-async-mystique.js';

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
 * Identify weak aspects based on metrics
 * @param {Object} metrics - InfoGain metrics
 * @param {Object} traitScores - Content trait scores
 * @returns {Array<Object>} Weak aspects
 */
function identifyWeakAspects(metrics, traitScores) {
  const weakAspects = [];
  const tenPoint = metrics.ten_point_score;

  // Only suggest improvements if score is below 7.0 (good threshold)
  if (tenPoint >= 7.0) {
    return weakAspects;
  }

  if (metrics.entity_preservation < 0.5) {
    weakAspects.push({
      aspect: 'specificity',
      reason: `Low entity preservation (${(metrics.entity_preservation * 100).toFixed(0)}%). Content lacks specific names, products, or concrete references for SEO keywords.`,
      current_score: metrics.entity_preservation,
      trait_score: traitScores.specificity || 0,
      seoImpact: 'High',
      seoRecommendation: 'Add specific product names, version numbers, and named entities. Include precise metrics and exact terminology.',
    });
  }

  if (metrics.fact_coverage < 0.5) {
    weakAspects.push({
      aspect: 'completeness',
      reason: `Low fact coverage (${(metrics.fact_coverage * 100).toFixed(0)}%). Content is missing key facts, numbers, or detailed information needed for authority.`,
      current_score: metrics.fact_coverage,
      trait_score: traitScores.completeness || 0,
      seoImpact: 'High',
      seoRecommendation: 'Include relevant statistics, data points, and quantitative information. Add dates, measurements, and specific examples.',
    });
  }

  if (metrics.semantic_similarity < 0.7) {
    weakAspects.push({
      aspect: 'relevance',
      reason: `Low semantic similarity (${(metrics.semantic_similarity * 100).toFixed(0)}%). Content may not accurately represent key topics for search engines.`,
      current_score: metrics.semantic_similarity,
      trait_score: traitScores.relevance || 0,
      seoImpact: 'Moderate',
      seoRecommendation: 'Focus more directly on core topics. Remove tangential information and strengthen connection to main themes.',
    });
  }

  if (metrics.compression_ratio > 0.6) {
    weakAspects.push({
      aspect: 'quality',
      reason: `High compression ratio (${(metrics.compression_ratio * 100).toFixed(0)}%). Content may be verbose or contain unnecessary information that dilutes SEO value.`,
      current_score: metrics.compression_ratio,
      trait_score: traitScores.quality || 0,
      seoImpact: 'Moderate',
      seoRecommendation: 'Remove redundancy and filler words. Make writing more clear and concise while preserving key information.',
    });
  }

  if (weakAspects.length === 0 && tenPoint < 7.0) {
    weakAspects.push({
      aspect: 'nuance',
      reason: `Content could benefit from more depth and detail to improve SEO score to 7.0+ (currently ${tenPoint}/10).`,
      current_score: tenPoint,
      trait_score: traitScores.nuance || 0,
      seoImpact: 'Moderate',
      seoRecommendation: 'Add more detailed explanations, expert-level insights, and technical details to increase content value.',
    });
  }

  return weakAspects;
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

  // Create information-gain audit entries for all pages
  previewUrls.forEach((url) => {
    const pageResult = audits.get(url);
    pageResult.audits.push({ name: PREFLIGHT_INFORMATION_GAIN, type: 'geo', opportunities: [] });
  });

  // Process each scraped page
  scrapedObjects.forEach(({ data }) => {
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
      return;
    }

    // Analyze content
    const analysis = analyzeContent(textContent);

    if (analysis.error) {
      infoGainAudit.opportunities.push({
        check: 'analysis-error',
        issue: analysis.error,
        seoImpact: 'Moderate',
        seoRecommendation: 'Ensure page has sufficient text content',
      });
      return;
    }

    // For identify step, add metrics and basic analysis
    if (step === 'identify') {
      infoGainAudit.opportunities.push({
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
        summary: analysis.summary,
        seoImpact: analysis.score_category === 'excellent' || analysis.score_category === 'good' ? 'Low' : 'High',
        seoRecommendation: analysis.score_category === 'excellent' || analysis.score_category === 'good'
          ? 'Content has good information density and SEO value'
          : 'Content needs improvement in information density and specificity',
      });
    }

    // For suggest step, identify weak aspects and send to Mystique for improvements
    if (step === 'suggest') {
      const weakAspects = identifyWeakAspects(analysis.metrics, analysis.trait_scores);

      // Mark each weak aspect as processing initially
      const weakAspectsWithStatus = weakAspects.map((aspect) => ({
        aspect: aspect.aspect,
        reason: aspect.reason,
        currentScore: aspect.current_score.toFixed(2),
        traitScore: aspect.trait_score.toFixed(1),
        seoImpact: aspect.seoImpact,
        seoRecommendation: aspect.seoRecommendation,
        suggestionStatus: 'processing',
        suggestionMessage: 'AI-powered content improvements are being generated by Mystique. Suggestions will be available shortly.',
      }));

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
        weakAspects: weakAspectsWithStatus,
        summary: analysis.summary,
        seoImpact: weakAspects.length > 0 ? 'High' : 'Low',
        seoRecommendation: weakAspects.length > 0
          ? `Focus on improving: ${weakAspects.map((a) => a.aspect).join(', ')}`
          : 'Content has good information density and SEO value',
      });

      // Store weak aspects for Mystique processing
      if (weakAspects.length > 0) {
        if (!auditContext.improvementRequests) {
          // eslint-disable-next-line no-param-reassign
          auditContext.improvementRequests = [];
        }
        weakAspects.forEach((aspect) => {
          auditContext.improvementRequests.push({
            pageUrl: stripTrailingSlash(finalUrl),
            aspect: aspect.aspect,
            originalContent: textContent,
            reason: aspect.reason,
            currentScore: aspect.current_score,
            seoImpact: aspect.seoImpact,
          });
        });
      }
    }
  });

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

  // For suggest step, send improvement requests to Mystique
  let isProcessing = false;
  if (step === 'suggest' && auditContext.improvementRequests && auditContext.improvementRequests.length > 0) {
    try {
      // Check if we already have improvements from previous Mystique run
      const { dataAccess } = context;
      const { AsyncJob: AsyncJobEntity } = dataAccess;
      const jobEntity = await AsyncJobEntity.findById(job.getId());
      const jobMetadata = jobEntity?.getMetadata() || {};
      const infoGainMetadata = jobMetadata.payload?.informationGainMetadata || {};
      const existingImprovements = infoGainMetadata.improvements || [];

      if (existingImprovements.length > 0) {
        log.info(`[information-gain suggest] Found ${existingImprovements.length} existing improvements from Mystique`);

        // Update audit results with existing improvements
        auditsResult.forEach((pageResult) => {
          const infoGainAudit = pageResult
            .audits?.find((a) => a.name === PREFLIGHT_INFORMATION_GAIN);
          if (infoGainAudit) {
            const pageImprovements = existingImprovements.filter(
              (imp) => imp.pageUrl === pageResult.pageUrl,
            );

            infoGainAudit.opportunities.forEach((opp) => {
              if (opp.check === 'information-gain-analysis' && opp.weakAspects) {
                // eslint-disable-next-line no-param-reassign
                opp.weakAspects = opp.weakAspects.map((aspect) => {
                  const improvement = pageImprovements.find((imp) => imp.aspect === aspect.aspect);
                  if (improvement) {
                    return {
                      ...aspect,
                      improvedContent: improvement.improvedContent,
                      newSummary: improvement.newSummary,
                      newScore: improvement.newScore,
                      newScoreCategory: improvement.newScoreCategory,
                      improvementDelta: improvement.improvementDelta,
                      newMetrics: improvement.newMetrics,
                      newTraitScores: improvement.newTraitScores,
                      aiRationale: improvement.aiRationale,
                      suggestionStatus: 'completed',
                    };
                  }
                  return aspect;
                });
              }
            });
          }
        });
      } else {
        // No existing improvements, send to Mystique
        log.debug(`[information-gain suggest] Sending ${auditContext.improvementRequests.length} improvement requests to Mystique...`);

        await sendInformationGainToMystique(
          site.getBaseURL(),
          auditContext.improvementRequests,
          site.getId(),
          job.getId(),
          context,
        );

        log.debug(`[information-gain suggest] Successfully sent ${auditContext.improvementRequests.length} improvement requests to Mystique`);
        isProcessing = true;
      }
    } catch (error) {
      log.error(`[information-gain suggest] Failed to process Mystique integration: ${error.message}`);
    }
  }

  return { processing: isProcessing };
}
