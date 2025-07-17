SELECT 
  url,
  status,
  {{topicExtraction}} as topic,
  SUM(count) as total_requests
FROM {{databaseName}}.{{tableName}}
{{whereClause}}
GROUP BY url, status, {{topicExtraction}}
ORDER BY total_requests DESC