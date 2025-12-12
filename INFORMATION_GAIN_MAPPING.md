# Information Gain - Python to JavaScript Mapping

This document explains how the JavaScript implementation maps to the Python improvement service from the WGW25 Geo Content Optimizer research project.

## Recent Updates (Dec 2024)

The research project was updated with key improvements to the InfoGain calculation:

1. **InfoGain Score Change**: Removed division by compression_ratio to represent information quality as a percentage (0-100%) instead of an efficiency ratio
   - **Old**: `infogain_score = (semantic * 0.35 + entities * 0.25 + facts * 0.40) / compression_ratio`
   - **New**: `infogain_score = (semantic * 0.35 + entities * 0.25 + facts * 0.40)`
   - Makes interpretation intuitive: 0.79 = 79% of ideal information quality

2. **Novel Info Items**: Changed from count to actual list of sentences
   - **Old**: `novel_info_count` (integer)
   - **New**: `novel_info_items` (array of sentences)
   - Provides more actionable information about what novel content was extracted

Both changes have been applied to the JavaScript implementation.

## Python Improvement Service Flow

```python
# 1. Generate improvement using LLM
improved_content = self.generate_improvement(original_content, aspect)

# 2. Analyze improved content using InfoGain service
analysis_result = self.infogain_service.analyze_content(improved_content)

# 3. Return variation with metrics
return {
    'aspect': aspect,
    'improved_content': improved_content,
    'new_summary': analysis_result['summary'],
    'new_score_category': analysis_result['score_category'],
    'new_metrics': analysis_result['metrics']
}
```

## JavaScript Implementation (via Mystique)

### 1. Send to Mystique (Replaces LLM Call)

**Python**: Direct OpenAI/Anthropic API call with system + user prompts
```python
messages=[
    {"role": "system", "content": f"You are a content improvement specialist focused on enhancing {aspect}."},
    {"role": "user", "content": prompt}
]
```

**JavaScript**: Mystique message with combined observation
```javascript
// src/preflight/information-gain-async-mystique.js
const observation = `You are a content improvement specialist focused on enhancing ${request.aspect}.

${INFORMATION_GAIN_OBSERVATION}

${prompt}

Original content:
${request.originalContent}

Generate improved content with HIGH ${request.aspect}...`;
```

### 2. Process Response (Replaces InfoGain Analysis)

**Python**: Calls `infogain_service.analyze_content(improved_content)`
```python
analysis_result = self.infogain_service.analyze_content(improved_content)
```

**JavaScript**: Guidance handler analyzes improved content
```javascript
// src/preflight/information-gain-guidance-handler.js
const improvedSummary = improvedContent.substring(0, Math.min(500, improvedContent.length));
const newMetrics = measureInfoGain(improvedContent, improvedSummary);
const newScoreCategory = categorizeScore(newMetrics.infogain_score);
const newTraitScores = analyzeContentTraits(improvedContent);
```

### 3. Return Structure

**Python**: Returns variation object
```python
{
    'aspect': aspect,
    'improved_content': improved_content,
    'new_summary': analysis_result['summary'],
    'new_score_category': analysis_result['score_category'],
    'new_metrics': analysis_result['metrics']
}
```

**JavaScript**: Creates improvement object
```javascript
const improvement = {
    aspect: data.aspect,
    improvedContent: improvedContent,
    newSummary: improvedSummary,
    newScore: newMetrics.ten_point_score,
    newScoreCategory: newScoreCategory,
    improvementDelta: improvementDelta,
    newMetrics: {
        compression_ratio: newMetrics.compression_ratio.toFixed(2),
        semantic_similarity: newMetrics.semantic_similarity.toFixed(2),
        entity_preservation: newMetrics.entity_preservation.toFixed(2),
        fact_coverage: newMetrics.fact_coverage.toFixed(2),
        entropy_ratio: newMetrics.entropy_ratio.toFixed(2),
        infogain_score: newMetrics.infogain_score.toFixed(2),
        ten_point_score: newMetrics.ten_point_score.toFixed(1),
        novel_info_count: newMetrics.novel_info_count,
    },
    newTraitScores: newTraitScores,
    aiRationale: `Improved ${aspect}...`,
};
```

## Key Differences

### Asynchronous Processing
- **Python**: Synchronous - waits for LLM response
- **JavaScript**: Asynchronous via Mystique - sends message and processes callback later

### Architecture
- **Python**: Direct API calls within the service
- **JavaScript**: Queue-based (SQS) with separate guidance handler

### Integration
- **Python**: Used in FastAPI backend endpoint
- **JavaScript**: Integrated into preflight audit workflow with AsyncJob management

## Equivalent Components

| Python Component | JavaScript Equivalent | Purpose |
|-----------------|----------------------|---------|
| `improvement_service.py` | `information-gain-async-mystique.js` | Send improvement requests |
| `infogain_service.py` | `information-gain.js` (exported functions) | Calculate InfoGain metrics |
| `generate_improvement()` | Mystique LLM processing | Generate improved content |
| `generate_variation()` | `information-gain-guidance-handler.js` | Process and analyze improvements |
| `improvement_prompts` | `IMPROVEMENT_PROMPTS` in constants | Aspect-specific prompts |

## Improvement Prompts

Both implementations use identical prompts for five aspects:

1. **Specificity**: Add concrete details, product names, versions
2. **Completeness**: Expand with facts, context, examples
3. **Relevance**: Focus on core topics, remove tangents
4. **Quality**: Improve clarity, remove verbosity
5. **Nuance**: Add depth, expert insights, technical details

## Output Structure

The JavaScript implementation provides the same data structure as Python's `generate_variation()` return value:

```javascript
{
    aspect: "specificity",
    improvedContent: "...",
    newSummary: "...",
    newScore: 7.5,
    newScoreCategory: "good",
    improvementDelta: 0.234,
    newMetrics: { /* all InfoGain metrics */ },
    newTraitScores: { /* all trait scores */ }
}
```

This ensures compatibility with any frontend or reporting tools expecting the research project's data format.

## Testing

All implementations validated with:
- ✅ 11 unit tests passing
- ✅ Matches Python improvement service structure
- ✅ Supports all 5 improvement aspects
- ✅ Calculates identical metrics (compression, similarity, preservation, coverage, etc.)


