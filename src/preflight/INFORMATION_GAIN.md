# Information Gain Preflight Audit

## Overview

The Information Gain audit analyzes page content to measure how much valuable, specific information a page contains. It's based on research from the WGW25 Geo Content Optimizer project and evaluates content density, specificity, and SEO value.

## How It Works

The audit performs the following analysis:

### 1. Content Extraction
- Extracts text content from the page body
- Removes script, style, navigation, header, and footer elements
- Focuses on main content text

### 2. Information Analysis
The audit generates a summary of the content and measures several key metrics:

**Note**: InfoGain score was updated to represent information quality as a percentage (0-100%) rather than an efficiency ratio. This makes interpretation intuitive: a score of 0.79 means the page has 79% of ideal information quality.

#### Metrics Calculated

- **Compression Ratio**: Ratio of summary tokens to original tokens (lower is better for quality content)
- **Semantic Similarity**: How well the summary preserves the meaning of the original (higher is better)
- **Entity Preservation**: Percentage of named entities (product names, version numbers) preserved in summary (higher is better)
- **Fact Coverage**: Percentage of numbers, percentages, and factual statements preserved (higher is better)
- **Entropy Ratio**: Information density metric based on character distribution
- **InfoGain Score**: Weighted combination of semantic similarity (35%), entity preservation (25%), and fact coverage (40%). Represents information quality as a percentage (0-100%) of ideal information content.
- **Ten Point Score**: User-friendly 0-10 score with power curve transformation (0.0 → 0, 0.5 → 7.1, 0.8 → 9.0, 1.0 → 10)

#### Score Categories
- **Excellent** (9.0-10.0): Content has exceptional information density
- **Good** (7.0-8.9): Content has solid information value
- **Moderate** (5.0-6.9): Content needs improvement
- **Poor** (3.0-4.9): Content has significant issues
- **Very Poor** (0.0-2.9): Content requires major overhaul

### 3. Content Trait Analysis

The audit also analyzes content across 9 key traits:

- **Relevance**: Content alignment with target topics and search intent
- **Recency**: Timeliness and currency of information
- **Authority**: Establishment of expertise and authoritative sources
- **Credibility**: Trustworthiness and reliability indicators
- **Nuance**: Depth and thoroughness of topic coverage
- **Quality**: Writing clarity, structure, and professionalism
- **Specificity**: Use of concrete details, names, and specific references
- **Completeness**: Coverage of key facts, data points, and information
- **Novelty**: Uniqueness and originality of information provided

## Audit Steps

### Identify Step

In the identify step, the audit calculates all metrics and provides:
- InfoGain score and category
- All calculated metrics
- Content trait scores
- Summary of the page content

### Suggest Step

In the suggest step, the audit identifies weak aspects and generates AI-powered content improvements:

#### Weak Aspect Detection with LLM

The audit uses Azure OpenAI to perform sophisticated trait analysis:

1. **Correlation Analysis**: Maps content traits to InfoGain metrics to identify problematic areas
2. **Problem Extraction**: Uses LLM to extract 2-3 sentence passages from the content that demonstrate specific weaknesses
3. **Content Improvement**: Generates improved versions of the content using Azure OpenAI targeted at specific aspects
4. **Re-analysis**: Calculates new metrics for the improved content to show the impact delta

#### Supported Improvement Aspects

The audit can identify and improve the following aspects:

1. **Specificity Issues** (entity_preservation < 0.5)
   - **Problem**: Content lacks specific names, products, or concrete references
   - **Recommendation**: Add specific product names, version numbers, and named entities. Include precise metrics and exact terminology.
   - **AI Improvement**: Generates content with high specificity including concrete details

2. **Completeness Issues** (fact_coverage < 0.5)
   - **Problem**: Content is missing key facts, numbers, or detailed information
   - **Recommendation**: Include relevant statistics, data points, and quantitative information. Add dates, measurements, and specific examples.
   - **AI Improvement**: Expands content with additional facts and supporting information

3. **Relevance Issues** (semantic_similarity < 0.7)
   - **Problem**: Content may not accurately represent key topics for search engines
   - **Recommendation**: Focus more directly on core topics. Remove tangential information and strengthen connection to main themes.
   - **AI Improvement**: Refocuses content on core topics with better organization

4. **Quality Issues** (compression_ratio > 0.6)
   - **Problem**: Content may be verbose or contain unnecessary information
   - **Recommendation**: Remove redundancy and filler words. Make writing more clear and concise while preserving key information.
   - **AI Improvement**: Creates clearer, more concise version while preserving key information

5. **Nuance Issues** (detected through trait correlation)
   - **Problem**: Content lacks depth and detailed explanations
   - **Recommendation**: Add more detailed explanations, expert-level insights, and technical details to increase content value.
   - **AI Improvement**: Adds depth, subtleties, and expert-level insights

6. **Authority Issues** (entity_preservation < 0.5 with low trait score)
   - **Problem**: Content lacks authoritative sources and expert references
   - **Recommendation**: Add citations from authoritative sources, expert quotes, and references to official documentation.
   - **AI Improvement**: Establishes authority with expert sources and official references

7. **Credibility Issues** (fact_coverage < 0.5 with low trait score)
   - **Problem**: Content lacks verifiable facts and trustworthy sources
   - **Recommendation**: Include verifiable facts with sources, specific evidence, and trustworthy references.
   - **AI Improvement**: Enhances credibility with verifiable facts and reliable sources

8. **Recency Issues** (semantic_similarity < 0.7 with low recency trait)
   - **Problem**: Content lacks current dates and recent information
   - **Recommendation**: Add current dates, reference latest versions, and include recent developments or contemporary examples.
   - **AI Improvement**: Updates content with current information and recent developments

9. **Novelty Issues** (detected through novel_info_items metric)
   - **Problem**: Content lacks unique insights or uncommon information
   - **Recommendation**: Include unique insights, uncommon facts, and distinctive information not commonly found elsewhere.
   - **AI Improvement**: Adds unique perspectives and lesser-known details

## Output Format

The audit adds opportunities to the preflight response with the following structure:

### Identify Step Output

```json
{
  "check": "information-gain-score",
  "score": 7.5,
  "scoreCategory": "good",
  "metrics": {
    "compression_ratio": "0.35",
    "semantic_similarity": "0.82",
    "entity_preservation": "0.67",
    "fact_coverage": "0.78",
    "infogain_score": "0.76"
  },
  "traitScores": {
    "relevance": 7.2,
    "specificity": 6.8,
    "completeness": 7.5,
    "quality": 6.9,
    "nuance": 7.1,
    "authority": 6.8,
    "credibility": 7.5,
    "recency": 7.2
  },
  "summary": "Adobe released Premiere Pro 24.1 with AI features...",
  "seoImpact": "Low",
  "seoRecommendation": "Content has good information density and SEO value"
}
```

### Suggest Step Output

```json
{
  "check": "information-gain-analysis",
  "score": 5.2,
  "scoreCategory": "moderate",
  "metrics": {
    "compression_ratio": "0.42",
    "semantic_similarity": "0.65",
    "entity_preservation": "0.45",
    "fact_coverage": "0.48",
    "infogain_score": "0.52"
  },
  "traitScores": { ... },
  "weakAspects": [
    {
      "aspect": "specificity",
      "reason": "Low entity preservation (45%). Content lacks specific names, products, or concrete references for SEO keywords.",
      "currentScore": "0.45",
      "traitScore": "4.2",
      "seoImpact": "High",
      "seoRecommendation": "Add specific product names, version numbers, and named entities. Include precise metrics and exact terminology.",
      "suggestedKeywords": ["specific", "precise", "exact", "particular", "concrete"],
      "problemExamples": [
        "We have various products that can help with different tasks. Our solutions are designed to meet your needs.",
        "Many features are available in our software. Users can access tools through an intuitive interface."
      ],
      "improvedContent": "Adobe Premiere Pro 24.1 delivers 73% faster rendering with CUDA GPU acceleration. After Effects 2024 includes 500+ new particle effects and 8x improved RAM performance. Character Animator 24.0 supports 98.2% facial tracking accuracy with new neural engine.",
      "newSummary": "Adobe Creative Cloud apps deliver significant performance improvements with specific version numbers and quantifiable metrics.",
      "newScore": 8.5,
      "newScoreCategory": "excellent",
      "improvementDelta": "+3.30",
      "newMetrics": {
        "compression_ratio": "0.32",
        "semantic_similarity": "0.88",
        "entity_preservation": "0.92",
        "fact_coverage": "0.87",
        "infogain_score": "0.89"
      },
      "newTraitScores": {
        "specificity": 9.2,
        "completeness": 8.8,
        "relevance": 8.5
      },
      "aiRationale": "Content improved to enhance specificity, resulting in better information density and SEO value.",
      "suggestionStatus": "completed"
    }
  ],
  "summary": "The page discusses products and services...",
  "seoImpact": "High",
  "seoRecommendation": "Focus on improving: specificity, completeness"
}
```

## Enabling the Audit

The information-gain audit can be enabled for a site by configuring the `information-gain-preflight` audit in the site's audit configuration.

## Technical Implementation

The audit is implemented in `/src/preflight/information-gain.js` and includes:

### Core Analysis Functions

- **Entity Extraction**: Identifies named entities using capitalization patterns and version numbers
- **Number Extraction**: Finds percentages, multipliers, and numerical data
- **Fact Extraction**: Identifies factual statements using linguistic patterns
- **Entropy Calculation**: Measures information density using Shannon entropy
- **Extractive Summarization**: Creates summaries using sentence scoring and selection
- **Cosine Similarity**: Calculates semantic similarity using token overlap

### LLM-Powered Features

- **Azure OpenAI Integration**: Uses Azure OpenAI GPT models for sophisticated content analysis and generation
- **Problem Extraction**: LLM extracts meaningful 2-3 sentence passages demonstrating specific weaknesses
- **Content Improvement Generation**: LLM generates improved content versions targeting specific traits
- **Trait Correlation Analysis**: Maps content traits to metrics to identify high-impact improvements

### Supporting Files

- `/src/preflight/information-gain-constants.js`: Improvement prompts for each trait
- Tests: `/test/audits/preflight/information-gain.test.js`

### Environment Variables Required

```bash
AZURE_OPENAI_ENDPOINT=https://your-endpoint.openai.azure.com/
AZURE_OPENAI_KEY=your-api-key
AZURE_API_VERSION=2024-08-01-preview
AZURE_COMPLETION_DEPLOYMENT=your-deployment-name
```

## Example Use Cases

### Good Content Example

```text
Adobe Premiere Pro 24.1 delivers 73% faster rendering with new GPU acceleration.
After Effects 2024 includes 500 new particle effects and 8x improved performance.
Character Animator supports 98.2% facial tracking accuracy in version 24.0.
```

**Score**: ~8.5/10 (Good to Excellent)
- High specificity (product names + versions)
- Strong fact coverage (percentages, multipliers, specific numbers)
- Clear, concise writing

### Poor Content Example

```text
We have products and services. They are very good. Contact us to learn more.
Our team is dedicated to excellence. We provide solutions.
```

**Score**: ~3.0/10 (Poor)
- No specificity (no concrete references)
- No facts or data
- Verbose with low information density

## Integration with Preflight

The information-gain handler integrates with the existing preflight audit system:

1. Registered in `PREFLIGHT_HANDLERS` as `'information-gain'`
2. Added to `AVAILABLE_CHECKS` as `AUDIT_INFORMATION_GAIN`
3. Follows the same pattern as other preflight handlers (accessibility, links, etc.)
4. Supports both `identify` and `suggest` steps
5. Tracks execution time for profiling

## Testing

Comprehensive tests are available in `/test/audits/preflight/information-gain.test.js` covering:

- Content analysis with various quality levels
- Metric calculation accuracy
- Weak aspect identification
- Both identify and suggest steps
- Edge cases (insufficient content, script/style filtering)

Run tests with:
```bash
npm run test:spec -- test/audits/preflight/information-gain.test.js
```

## Migration Notes

**Breaking Change from Research Project (v1.0)**:

The suggest step now generates content improvements synchronously using Azure OpenAI instead of asynchronously via Mystique. This provides:

- ✅ Immediate results in the same API response
- ✅ Better correlation between problem identification and improvement generation
- ✅ LLM-extracted problem examples showing specific weaknesses
- ✅ Complete metrics analysis for improved content (before/after comparison)
- ✅ Support for all 9 content traits including novelty

### Migration from Mystique

The previous Mystique-based async flow has been replaced with direct Azure OpenAI integration:

- **Before**: Identify weak aspects → Send to Mystique → Wait for callback → Update results
- **After**: Identify weak aspects (with LLM problem extraction) → Generate improvements (synchronous) → Return complete results

This change eliminates the need for:
- `information-gain-async-mystique.js`
- `information-gain-guidance-handler.js`
- AsyncJob metadata storage for improvement tracking

## Future Enhancements

Potential improvements:
- Multi-language support using language-specific tokenizers
- Custom thresholds per site or content type
- Historical trending of InfoGain scores
- Competitive benchmarking against similar pages
- Integration with Exa AI for novel information discovery (similar to research project's NoveltyService)

