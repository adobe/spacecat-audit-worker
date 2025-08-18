SELECT 
  {{agentTypeClassification}} as agent_type,
  {{userAgentDisplay}} as user_agent_display,
  status,
  SUM(count) as number_of_hits,
  ROUND(SUM(time_to_first_byte * count) / SUM(count), 2) as avg_ttfb_ms,
  {{countryExtraction}} as country_code,
  url,
  {{topicExtraction}} as product,
  {{pageCategoryClassification}} as category
FROM {{databaseName}}.{{tableName}}
{{whereClause}}
GROUP BY 
  {{agentTypeClassification}},
  {{userAgentDisplay}},
  status,
  {{countryExtraction}},
  url,
  {{topicExtraction}},
  {{pageCategoryClassification}}
ORDER BY number_of_hits DESC
