SELECT 
  {{countryExtraction}} as country_code,
  {{topicExtraction}} as topic,
  {{weekColumns}}
FROM {{databaseName}}.{{tableName}}
{{whereClause}}
GROUP BY {{countryExtraction}}, {{topicExtraction}}
ORDER BY {{orderBy}} DESC 