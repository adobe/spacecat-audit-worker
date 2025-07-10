SELECT 
    url,
    {{topicExtraction}} as topic,
    SUM(count) as hits
FROM {{databaseName}}.{{tableName}}
{{whereClause}}
GROUP BY url, {{topicExtraction}}
ORDER BY hits DESC
