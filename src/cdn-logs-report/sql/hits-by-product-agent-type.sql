WITH classified_data AS (
  SELECT 
    count,
    {{topicExtraction}} as product,
    {{agentTypeClassification}} as agent_type
  FROM {{databaseName}}.{{tableName}}
  {{whereClause}}
)
SELECT 
  product,
  agent_type,
  SUM(count) as hits
FROM classified_data
GROUP BY product, agent_type
ORDER BY hits DESC 