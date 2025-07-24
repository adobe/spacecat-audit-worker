WITH classified_data AS (
  SELECT 
    user_agent,
    status,
    count,
    {{agentTypeClassification}} as agent_type
  FROM {{databaseName}}.{{tableName}}
  {{whereClause}}
)
SELECT 
  user_agent,
  agent_type,
  status,
  SUM(count) as total_requests
FROM classified_data
GROUP BY user_agent, agent_type, status
ORDER BY total_requests DESC
