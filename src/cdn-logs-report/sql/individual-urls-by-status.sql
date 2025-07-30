WITH classified_data AS (
  SELECT 
    url,
    status,
    count,
    {{agentTypeClassification}} as agent_type
  FROM {{databaseName}}.{{tableName}}
  {{whereClause}}
)
SELECT 
  url,
  status,
  agent_type,
  SUM(count) as total_requests
FROM classified_data
GROUP BY url, status, agent_type
ORDER BY total_requests DESC
LIMIT 1000
