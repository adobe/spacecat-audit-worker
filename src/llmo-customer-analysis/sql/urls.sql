SELECT
    path,
    SUM(pageviews) AS pageviews
FROM {{tableName}}
WHERE siteid = '{{siteId}}'
    AND ({{temporalCondition}})
GROUP BY path
ORDER BY pageviews DESC
LIMIT 100;
