WITH classified_data AS (
  SELECT 
    url,
    user_agent,
    status,
    count,
    time_to_first_byte,
    {{agentTypeClassification}} as agent_type,
    {{topicExtraction}} as product
  FROM {{databaseName}}.{{tableName}}
  {{whereClause}}
)
SELECT 
  url,
  SUM(count) as total_hits,
  COUNT(DISTINCT user_agent) as unique_agents,
  CAST(ROUND((SUM(CASE WHEN status >= 200 AND status < 300 THEN count ELSE 0 END) * 100.0) / NULLIF(SUM(count), 0), 2) AS VARCHAR) as success_rate,
  CAST(ROUND(SUM(time_to_first_byte * count) / NULLIF(SUM(count), 0), 3) AS DECIMAL(10,3)) as avg_ttfb_ms,
  MAX_BY(user_agent, count) as top_agent,
  MAX_BY(agent_type, count) as top_agent_type,
  product
FROM classified_data
GROUP BY url, product
ORDER BY total_hits DESC
LIMIT 1000
