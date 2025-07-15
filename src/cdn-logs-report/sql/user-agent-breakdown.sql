SELECT 
  user_agent,
  status,
  {{topicExtraction}} as topic,
  SUM(count) as total_requests
FROM {{databaseName}}.{{tableName}}
{{whereClause}}
GROUP BY user_agent, status, {{topicExtraction}}
ORDER BY total_requests DESC 