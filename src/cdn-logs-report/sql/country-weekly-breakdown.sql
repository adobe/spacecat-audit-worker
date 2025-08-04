WITH base_data AS (
  SELECT 
    {{countryExtraction}} as country_code,
    {{agentTypeClassification}} as agent_type,
    count,
    year,
    month,
    day
  FROM {{databaseName}}.{{tableName}}
  {{whereClause}}
)
SELECT 
  country_code,
  agent_type,
  {{weekColumns}}
FROM base_data
GROUP BY country_code, agent_type
ORDER BY {{orderBy}} DESC
