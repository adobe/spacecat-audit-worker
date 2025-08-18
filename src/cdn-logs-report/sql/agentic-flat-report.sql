SELECT 
  {{agentTypeClassification}} as agent_type,
  CASE 
    WHEN LOWER(user_agent) LIKE '%chatgpt-user%' THEN 'ChatGPT-User'
    WHEN LOWER(user_agent) LIKE '%gptbot%' THEN 'GPTBot' 
    WHEN LOWER(user_agent) LIKE '%oai-searchbot%' THEN 'OAI-SearchBot'
    WHEN LOWER(user_agent) LIKE '%perplexitybot%' THEN 'PerplexityBot'
    WHEN LOWER(user_agent) LIKE '%perplexity-user%' THEN 'Perplexity-User'
    WHEN LOWER(user_agent) LIKE '%perplexity%' THEN 'Perplexity'
    WHEN LOWER(user_agent) LIKE '%googlebot%' THEN 'Googlebot'
    WHEN LOWER(user_agent) LIKE '%bingbot%' THEN 'Bingbot'
    WHEN LOWER(user_agent) LIKE '%claude%' THEN 'Claude'
    WHEN LOWER(user_agent) LIKE '%anthropic%' THEN 'Anthropic'
    WHEN LOWER(user_agent) LIKE '%gemini%' THEN 'Gemini'
    WHEN LOWER(user_agent) LIKE '%copilot%' THEN 'Copilot'
    ELSE SUBSTR(user_agent, 1, 100)
  END as user_agent_display,
  status,
  SUM(count) as number_of_hits,
  ROUND(AVG(time_to_first_byte * 1000), 2) as avg_ttfb_ms,
  {{countryExtraction}} as country_code,
  url,
  {{topicExtraction}} as product,
  {{pageCategoryClassification}} as category
FROM {{databaseName}}.{{tableName}}
{{whereClause}}
GROUP BY 
  {{agentTypeClassification}},
  CASE 
    WHEN LOWER(user_agent) LIKE '%chatgpt-user%' THEN 'ChatGPT-User'
    WHEN LOWER(user_agent) LIKE '%gptbot%' THEN 'GPTBot' 
    WHEN LOWER(user_agent) LIKE '%oai-searchbot%' THEN 'OAI-SearchBot'
    WHEN LOWER(user_agent) LIKE '%perplexitybot%' THEN 'PerplexityBot'
    WHEN LOWER(user_agent) LIKE '%perplexity-user%' THEN 'Perplexity-User'
    WHEN LOWER(user_agent) LIKE '%perplexity%' THEN 'Perplexity'
    WHEN LOWER(user_agent) LIKE '%googlebot%' THEN 'Googlebot'
    WHEN LOWER(user_agent) LIKE '%bingbot%' THEN 'Bingbot'
    WHEN LOWER(user_agent) LIKE '%claude%' THEN 'Claude'
    WHEN LOWER(user_agent) LIKE '%anthropic%' THEN 'Anthropic'
    WHEN LOWER(user_agent) LIKE '%gemini%' THEN 'Gemini'
    WHEN LOWER(user_agent) LIKE '%copilot%' THEN 'Copilot'
    ELSE SUBSTR(user_agent, 1, 100)
  END,
  status,
  {{countryExtraction}},
  url,
  {{topicExtraction}},
  {{pageCategoryClassification}}
ORDER BY number_of_hits DESC
