INSERT INTO {{database}}.{{aggregatedTable}}
SELECT
  -- in akamai, url path and query string come in separate fields - we concatenate them into single url field
  CASE
    WHEN queryStr IS NOT NULL AND trim(queryStr) NOT IN ('', '-')
      THEN concat(reqPath, '?', queryStr)
    ELSE reqPath
  END AS url,

  ua AS user_agent,
  CAST(statusCode AS INTEGER) AS status,
  try(url_extract_host(referer)) AS referer,
  reqHost AS host,
  CAST(timeToFirstByte AS DOUBLE) AS time_to_first_byte,
  COUNT(*) AS count,
  '{{serviceProvider}}' AS cdn_provider,
  
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
  AND REGEXP_LIKE(ua, '(?i)(ChatGPT|GPTBot|OAI-SearchBot|Perplexity|Claude|Anthropic|Gemini|Copilot|Googlebot|bingbot|^Google$)')

  -- only count text/html responses with robots.txt and sitemaps
  AND (
    rspContentType LIKE 'text/html%'
    OR rspContentType LIKE 'application/pdf%'
    OR reqPath LIKE '%robots.txt'
    OR reqPath LIKE '%sitemap%'
  )

  -- agentic and LLM-attributed traffic never has self-referer
  AND NOT REGEXP_LIKE(COALESCE(referer, ''), '{{host}}')

GROUP BY
  CASE
    WHEN queryStr IS NOT NULL AND trim(queryStr) NOT IN ('', '-')
      THEN concat(reqPath, '?', queryStr)
    ELSE reqPath
  END,
  ua,
  statusCode,
  try(url_extract_host(referer)),
  reqHost,
  CAST(timeToFirstByte AS DOUBLE),
  '{{serviceProvider}}';
