SELECT 
  {{countryExtraction}} as country_code,
  {{weekColumns}}
FROM {{databaseName}}.{{tableName}}
{{whereClause}}
GROUP BY {{countryExtraction}}
ORDER BY {{orderBy}} DESC
