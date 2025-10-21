INSERT INTO {{database}}.{{aggregatedTable}}
SELECT
  url_extract_path(url) AS url,
  request_user_agent AS user_agent,
  response_status AS status,
  try(url_extract_host(request_referer)) AS referer,
  host,
  CAST(time_to_first_byte AS DOUBLE) * 1000 AS time_to_first_byte,
  COUNT(*) AS count,
  '{{serviceProvider}}' AS cdn_provider,
  COALESCE(request_x_forwarded_host, '') as x_forwarded_host,
  
  -- Add partition columns as regular columns
  '{{year}}' AS year,
  '{{month}}' AS month,
  '{{day}}' AS day,
  '{{hour}}' AS hour
FROM {{database}}.{{rawTable}}
WHERE year  = '{{year}}'
  AND month = '{{month}}'
  AND day   = '{{day}}'
  {{hourFilter}}
  
   -- match known LLM-related user-agents
  AND REGEXP_LIKE(request_user_agent, '(?i)(ChatGPT|GPTBot|OAI-SearchBot|Perplexity|Claude|Anthropic|Gemini|Copilot|Googlebot|bingbot|^Google$)')

  -- only count text/html responses with robots.txt and sitemaps
  AND (
    response_content_type LIKE 'text/html%'
    OR response_content_type LIKE 'application/pdf%'
    OR url LIKE '%robots.txt' 
    OR url LIKE '%sitemap%'
  )

  -- agentic and LLM-attributed traffic never has self-referer 
  AND NOT REGEXP_LIKE(COALESCE(request_referer, ''), '{{host}}')

GROUP BY
  url_extract_path(url),
  request_user_agent,
  response_status,
  request_referer,
  host,
  CAST(time_to_first_byte AS DOUBLE) * 1000,
  '{{serviceProvider}}',
  COALESCE(request_x_forwarded_host, '');
