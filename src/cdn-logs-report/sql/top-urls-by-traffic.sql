SELECT 
  url,
  {{topicExtraction}} as topic,
  SUM(count) as total_requests
FROM {{databaseName}}.{{tableName}}
{{whereClause}}
GROUP BY url, {{topicExtraction}}
ORDER BY total_requests DESC
