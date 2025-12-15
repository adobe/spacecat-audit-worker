# Information Gain Identify Step Update

## Overview

Updated the Information Gain preflight audit's **identify step** to match the enhanced analysis approach from the research project (`wgw25-geo-content-optimizer` branch: `suggestion-improvements`).

## Key Changes

### 1. **Trait Correlation Analysis**

Added a new `correlateTraitsWithMetrics()` function that maps content traits to InfoGain metrics:

- **Maps each trait to a specific metric**:
  - specificity → entity_preservation
  - completeness → fact_coverage
  - relevance → semantic_similarity
  - quality → compression_ratio
  - nuance → infogain_score
  - authority → entity_preservation
  - credibility → fact_coverage
  - recency → semantic_similarity
  - novelty → novel_info_items

- **Calculates impact level** for each trait:
  - `high`: Trait score < 6.0 AND metric below threshold (problematic)
  - `medium`: Trait score < 7.0 (needs attention)
  - `low`: Trait score >= 7.0 (acceptable)

### 2. **Enhanced Identify Step Response**

The identify step now returns much more detailed information:

**Before:**
```json
{
  "check": "information-gain-score",
  "score": 7.5,
  "metrics": { ... },
  "traitScores": { ... },
  "summary": "...",
  "seoImpact": "Low"
}
```

**After:**
```json
{
  "check": "information-gain-score",
  "score": 7.5,
  "metrics": { ... },
  "traitScores": { ... },
  "traitCorrelations": [
    {
      "trait": "specificity",
      "traitScore": 6.8,
      "mappedMetric": "entity_preservation",
      "metricValue": "0.67",
      "impact": "medium",
      "description": "Use of concrete details, names, and specific references"
    }
  ],
  "summary": "...",
  "seoImpact": "Low",
  "weakAspectsIdentified": [ ... ]  // Optional for non-excellent scores
}
```

### 3. **Optional Weak Aspect Identification in Identify Step**

For non-excellent scores (< 9.0/10), the identify step now optionally identifies weak aspects with LLM-extracted problem examples:

- Only runs when Azure OpenAI client is available
- Provides insight into specific issues without generating improvements
- Includes problem examples showing exactly what's wrong
- Useful for understanding content issues before committing to full improvement generation

**Example:**
```json
{
  "weakAspectsIdentified": [
    {
      "aspect": "specificity",
      "reason": "Low entity preservation (45%)...",
      "currentScore": "0.45",
      "traitScore": "4.2",
      "seoImpact": "High",
      "problemExamples": [
        "We have various products that can help...",
        "Many features are available..."
      ]
    }
  ]
}
```

### 4. **Updated Suggest Step**

The suggest step now also uses trait correlations for consistency:

- Calculates trait correlations first
- Passes correlations to `identifyWeakAspects()`
- Uses high-impact traits from correlation analysis
- Includes `traitAnalysis` field in each weak aspect
- Includes `traitCorrelations` array in response

### 5. **Correlation-Based Weak Aspect Detection**

Updated `identifyWeakAspects()` to use trait correlations instead of direct metric checks:

**Before:**
```javascript
// Direct metric thresholds
if (metrics.entity_preservation < 0.5) {
  weakAspects.push({ aspect: 'specificity', ... });
}
```

**After:**
```javascript
// Correlation-based detection
const highImpactTraits = Object.entries(traitCorrelations)
  .filter(([, corr]) => corr.impact === 'high');

for (const [trait, corr] of highImpactTraits) {
  // Extract problem examples with LLM
  // Build comprehensive weak aspect object
}
```

## Benefits

1. **Better Insights**: Trait correlations show exactly how each trait affects InfoGain metrics
2. **Prioritized Improvements**: Sorted by impact level (high → medium → low) and score
3. **Earlier Problem Detection**: Identify step can now spot issues before generating improvements
4. **Consistent Analysis**: Both identify and suggest steps use the same correlation logic
5. **More Context**: traitAnalysis provides rich metadata about each problematic aspect

## Alignment with Research Project

This update brings the implementation in line with the research project's approach where:

1. **Identify phase** includes trait correlation analysis (lines 49-53 of routes.py)
2. **Trait scores** are correlated with metrics to understand impact (line 50-53)
3. **Weak aspects** can be identified with original content for LLM analysis (line 73-78)
4. **Problem examples** are extracted using LLM for better understanding (line 187-192 of reasoning_service.py)

## Testing

All 11 existing tests continue to pass ✅

The tests validate:
- Content analysis with various quality levels
- Metric calculation accuracy  
- Weak aspect identification
- Both identify and suggest steps
- Edge cases (insufficient content, script/style filtering)

## Documentation

Updated `/src/preflight/INFORMATION_GAIN.md` with:
- Enhanced identify step description
- New response format examples
- Trait correlation explanation
- Optional weak aspects identification

## Migration Notes

This is a **non-breaking change**:
- Adds new fields to responses (traitCorrelations, weakAspectsIdentified)
- Existing fields remain unchanged
- Backwards compatible with current consumers

## Files Modified

1. **src/preflight/information-gain.js**
   - Added `correlateTraitsWithMetrics()` function
   - Updated `identifyWeakAspects()` to accept trait correlations
   - Enhanced identify step to include correlations and optional weak aspects
   - Updated suggest step to calculate and include correlations

2. **src/preflight/INFORMATION_GAIN.md**
   - Updated identify step documentation
   - Added trait correlation examples
   - Updated response format examples

## Next Steps

The identify step now provides comprehensive analysis that matches the research project. Future enhancements could include:

- Integration with Exa AI for novel information discovery
- Wikipedia authority enhancement (like the research project's WikipediaAuthorityService)
- Custom trait-to-metric mappings per site type
- Historical trending of trait scores

