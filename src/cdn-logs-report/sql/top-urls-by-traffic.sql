SELECT 
  url,
  SUM(count) as total_requests
FROM {{databaseName}}.{{tableName}}
{{whereClause}}
GROUP BY url
ORDER BY total_requests DESC
LIMIT 1000
