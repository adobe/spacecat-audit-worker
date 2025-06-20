SELECT 
  user_agent,
  status,
  SUM(count) as total_requests
FROM {{databaseName}}.{{tableName}}
{{whereClause}}
GROUP BY user_agent, status
ORDER BY total_requests DESC
