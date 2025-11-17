WITH classified_data AS (
  SELECT 
    {{agentTypeClassification}} as agent_type,
    {{userAgentDisplay}} as user_agent_display,
    status,
    count,
    time_to_first_byte,
    url,
    {{topicExtraction}} as product,
    {{pageCategoryClassification}} as category
  FROM {{databaseName}}.{{tableName}}
  {{whereClause}}
),
aggregated_data AS (
  SELECT 
    agent_type,
    user_agent_display,
    status,
    SUM(count) as number_of_hits,
    ROUND(SUM(time_to_first_byte * count) / NULLIF(SUM(count), 0), 2) as avg_ttfb_ms,
    url,
    product,
    category
  FROM classified_data
  GROUP BY 
    agent_type,
    user_agent_display,
    status,
    url,
    product,
    category
)
SELECT 
  agent_type,
  user_agent_display as user_agent,
  status,
  SUM(number_of_hits) as total_requests,
  ROUND(SUM(avg_ttfb_ms * number_of_hits) / NULLIF(SUM(number_of_hits), 0), 2) as avg_ttfb_ms,
  CAST(NULL AS VARCHAR) as country_code,
  url,
  product,
  category
FROM aggregated_data
GROUP BY 
  agent_type,
  user_agent_display,
  status,
  url,
  product,
  category
ORDER BY total_requests DESC
LIMIT 500