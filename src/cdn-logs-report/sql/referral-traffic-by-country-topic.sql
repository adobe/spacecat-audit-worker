SELECT 
    {{countryExtraction}} as country,
    {{topicExtraction}} as topic,
    SUM(count) as hits
FROM {{databaseName}}.{{tableName}}
{{whereClause}}
GROUP BY {{countryExtraction}}, {{topicExtraction}}
ORDER BY hits DESC
