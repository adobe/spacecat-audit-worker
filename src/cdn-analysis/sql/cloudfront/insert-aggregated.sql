INSERT INTO {{database}}.{{aggregatedTable}}
SELECT
  "cs-uri-stem" AS url,
  "cs(user-agent)" AS user_agent,
  CAST("sc-status" AS INT) AS status,
  try(url_extract_host("cs(referer)")) AS referer,
  "x-host-header" AS host,
  CAST("time-to-first-byte" AS DOUBLE) * 1000 AS time_to_first_byte,
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
  AND REGEXP_LIKE("cs(user-agent)", '(?i)(ChatGPT|GPTBot|OAI-SearchBot|Perplexity|Claude|Anthropic|Gemini|Copilot|Googlebot|bingbot|^Google$)')

  -- only count text/html responses with robots.txt and sitemaps
  AND (
    "sc-content-type" LIKE 'text/html%'
    OR "sc-content-type" LIKE 'application/pdf%'
    OR "cs-uri-stem" LIKE '%robots.txt' 
    OR "cs-uri-stem" LIKE '%sitemap%'
  )

  -- agentic and LLM-attributed traffic never has self-referer 
  AND NOT REGEXP_LIKE(COALESCE("cs(referer)", ''), '{{host}}')

GROUP BY
  "cs-uri-stem",
  "cs(user-agent)",
  CAST("sc-status" AS INT),
  "cs(referer)",
  "x-host-header",
  CAST("time-to-first-byte" AS DOUBLE) * 1000,
  '{{serviceProvider}}';
