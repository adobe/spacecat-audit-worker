SELECT DISTINCT 
  url,
  SUM(count) as total_hits
FROM {{databaseName}}.{{tableName}}
WHERE 
  {{userAgentFilter}}
  AND url IS NOT NULL
  AND url NOT LIKE '%.pdf'
  AND status BETWEEN 200 AND 399 
  AND ({{dateFilter}})
  AND {{siteFilters}}
GROUP BY url
HAVING SUM(count) >= 10
ORDER BY total_hits DESC
LIMIT 2000;
