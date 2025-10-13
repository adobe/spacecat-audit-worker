INSERT INTO {{database}}.{{aggregatedTable}}
SELECT
  ClientRequestURI AS url,
  ClientRequestUserAgent AS user_agent,
  EdgeResponseStatus AS status,
  try(url_extract_host(ClientRequestReferer)) AS referer,
  ClientRequestHost AS host,
  CAST(EdgeTimeToFirstByteMs AS DOUBLE) AS time_to_first_byte,
  COUNT(*) AS count,
  '{{serviceProvider}}' AS cdn_provider,
  
  -- Add partition columns as regular columns
  '{{year}}' AS year,
  '{{month}}' AS month,
  '{{day}}' AS day,
  '{{hour}}' AS hour

FROM {{database}}.{{rawTable}}

WHERE date = '{{year}}{{month}}{{day}}'
  
  -- CloudFlare daily analysis: Process entire day but output to hour 08 directory
  -- This avoids scanning daily files 24 times while maintaining downstream compatibility
  -- The 'hour' column in output provides hourly breakdown within the daily aggregation

  -- match known LLM-related user-agents
  AND REGEXP_LIKE(ClientRequestUserAgent, '(?i)(ChatGPT|GPTBot|OAI-SearchBot|Perplexity|Claude|Anthropic|Gemini|Copilot|Googlebot|bingbot|^Google$)')

  -- only count text/html responses with robots.txt and sitemaps
  AND (
    EdgeResponseContentType LIKE 'text/html%'
    OR EdgeResponseContentType LIKE 'application/pdf%'
    OR ClientRequestURI LIKE '%robots.txt'
    OR ClientRequestURI LIKE '%sitemap%'
  )

  -- agentic and LLM-attributed traffic never has self-referer
  AND NOT REGEXP_LIKE(COALESCE(ClientRequestReferer, ''), '{{host}}')

GROUP BY
  ClientRequestURI,
  ClientRequestUserAgent,
  EdgeResponseStatus,
  try(url_extract_host(ClientRequestReferer)),
  ClientRequestHost,
  CAST(EdgeTimeToFirstByteMs AS DOUBLE),
  '{{serviceProvider}}';
