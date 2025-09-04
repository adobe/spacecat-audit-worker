WITH classified_data AS (
  SELECT 
    {{agentTypeClassification}} as agent_type,
    {{userAgentDisplay}} as user_agent_display,
    status,
    count,
    time_to_first_byte,
    {{countryExtraction}} as country_code,
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
    ROUND(SUM(time_to_first_byte * count) / SUM(count), 2) as avg_ttfb_ms,
    country_code,
    url,
    product,
    category
  FROM classified_data
  GROUP BY 
    agent_type,
    user_agent_display,
    status,
    country_code,
    url,
    product,
    category
)
SELECT 
  agent_type,
  user_agent_display,
  status,
  SUM(number_of_hits) as number_of_hits,
  ROUND(SUM(avg_ttfb_ms * number_of_hits) / SUM(number_of_hits), 2) as avg_ttfb_ms,
  country_code,
  url,
  product,
  category
FROM aggregated_data
GROUP BY 
  agent_type,
  user_agent_display,
  status,
  country_code,
  url,
  product,
  category
ORDER BY number_of_hits DESC
LIMIT 500