WITH ranked_urls AS (
  SELECT 
    url,
    status,
    SUM(count) as total_requests,
    ROW_NUMBER() OVER (PARTITION BY status ORDER BY SUM(count) DESC) as rank_desc,
    ROW_NUMBER() OVER (PARTITION BY status ORDER BY SUM(count) ASC) as rank_asc
  FROM {{databaseName}}.{{tableName}}
  {{whereClause}}
  GROUP BY url, status
)
SELECT 
  url,
  status,
  total_requests
FROM ranked_urls
WHERE rank_desc <= 10 OR rank_asc <= 10
ORDER BY status, total_requests DESC
