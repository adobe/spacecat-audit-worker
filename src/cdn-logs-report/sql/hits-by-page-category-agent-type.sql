WITH classified_data AS (
  SELECT 
    count,
    {{pageCategoryClassification}} as category,
    {{agentTypeClassification}} as agent_type
  FROM {{databaseName}}.{{tableName}}
  {{whereClause}}
)
SELECT 
  category,
  agent_type,
  SUM(count) as hits
FROM classified_data
GROUP BY category, agent_type
ORDER BY hits DESC 