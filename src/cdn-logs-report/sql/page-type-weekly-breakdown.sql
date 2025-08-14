WITH classified_data AS (
  SELECT 
    count,
    year,
    month,
    day,
    {{pageTypeCase}} as page_type
  FROM {{databaseName}}.{{tableName}}
  {{whereClause}}
)
SELECT 
  page_type,
  {{weekColumns}}
FROM classified_data
GROUP BY page_type
ORDER BY {{orderBy}} DESC
