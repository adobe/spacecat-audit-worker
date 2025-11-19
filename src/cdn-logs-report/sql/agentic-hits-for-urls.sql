SELECT
  url,
  SUM(number_of_hits) AS number_of_hits
FROM {{databaseName}}.{{tableName}}
{{whereClause}}
AND url IN ({{urlList}})
GROUP BY url;

