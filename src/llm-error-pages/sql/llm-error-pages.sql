WITH classified_data AS (
  SELECT 
    {{agentTypeClassification}} as agent_type,
    {{userAgentDisplay}} as user_agent_display,
    status,
    count,
    time_to_first_byte,
    url,
    {{countryExtraction}} as country_code,
    {{topicExtraction}} as product,
    {{pageCategoryClassification}} as category
  FROM {{databaseName}}.{{tableName}}
  {{whereClause}}
),
aggregated_data AS (
  SELECT 
    agent_type,
    user_agent_display,
    status,
    SUM(count) as number_of_hits,
    ROUND(SUM(time_to_first_byte * count) / NULLIF(SUM(count), 0), 2) as avg_ttfb_ms,
    url,
    country_code,
    product,
    category
  FROM classified_data
  GROUP BY 
    agent_type,
    user_agent_display,
    status,
    url,
    country_code,
    product,
    category
),
ranked AS (
  SELECT
    agent_type,
    user_agent_display AS user_agent,
    status,
    number_of_hits AS total_requests,
    avg_ttfb_ms,
    country_code,
    url,
    product,
    category,
    ROW_NUMBER() OVER (PARTITION BY status ORDER BY number_of_hits DESC) AS rn
  FROM aggregated_data
)
SELECT agent_type, user_agent, status, total_requests, avg_ttfb_ms, country_code, url, product, category
FROM ranked
WHERE rn <= {{rowsPerStatus}}
ORDER BY total_requests DESC
