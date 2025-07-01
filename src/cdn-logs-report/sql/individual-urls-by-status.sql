SELECT 
  url,
  status,
  SUM(count) as total_requests
FROM {{databaseName}}.{{tableName}}
{{whereClause}}
GROUP BY url, status
ORDER BY total_requests DESC
