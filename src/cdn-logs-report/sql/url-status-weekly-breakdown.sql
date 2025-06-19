SELECT 
  {{pageTypeCase}} as page_type,
  {{weekColumns}}
FROM {{databaseName}}.{{tableName}}
{{whereClause}}
GROUP BY {{pageTypeCase}}
ORDER BY {{orderBy}} DESC
