WITH classified_data AS (
  SELECT 
    user_agent,
    status,
    count,
    time_to_first_byte,
    {{agentTypeClassification}} as agent_type
  FROM {{databaseName}}.{{tableName}}
  {{whereClause}}
)
SELECT 
  user_agent,
  agent_type,
  status,
  SUM(count) as total_requests,
  CAST(ROUND(SUM(time_to_first_byte * count) / NULLIF(SUM(count), 0), 3) AS DECIMAL(10,3)) as avg_ttfb_ms
FROM classified_data
GROUP BY user_agent, agent_type, status
ORDER BY total_requests DESC
