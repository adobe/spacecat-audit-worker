INSERT INTO {{database}}.{{aggregatedTable}}
WITH base AS (
  SELECT
    CASE
      WHEN NULLIF(trim(req_params), '') IS NOT NULL AND substr(trim(req_params), 1, 1) = '?'
        THEN CONCAT(req_path, trim(req_params))
      WHEN NULLIF(trim(req_params), '') IS NOT NULL
        THEN CONCAT(req_path, '?', trim(req_params))
      ELSE req_path
    END AS url,
    user_agent,
    COALESCE(try_cast(NULLIF(trim(rsp_code), '') AS INTEGER), 0) AS status,
    referer,
    NULLIF(trim(domain), '') AS host,
    COALESCE(try_cast(NULLIF(trim(time_to_first_downstream_tx_byte), '') AS DOUBLE), 0.0) * 1000 AS time_to_first_byte
  FROM {{database}}.{{rawTable}}
  WHERE year  = '{{year}}'
    AND month = '{{month}}'
    AND day   = '{{day}}'
    {{hourFilter}}
)

SELECT
  url_extract_path(url) AS url,
  user_agent,
  status,
  try(url_extract_host(referer)) AS referer,
  host,
  time_to_first_byte,
  COUNT(*) AS count,
  '{{serviceProvider}}' AS cdn_provider,
  COALESCE(host, '') as x_forwarded_host,

  -- Add partition columns as regular columns
  '{{year}}' AS year,
  '{{month}}' AS month,
  '{{day}}' AS day,
  '{{hour}}' AS hour
FROM base
WHERE
  -- match known LLM-related user-agents
  REGEXP_LIKE(user_agent, '(?i)(ChatGPT|GPTBot|OAI-SearchBot|OAI-AdsBot|Perplexity|Claude|Anthropic|Gemini|Copilot|MistralAI-User|Google-NotebookLM|Google-?Agent|Google-Extended|Googlebot|bingbot|Amzn-User|^Google$)')

  -- F5 access logs do not expose response content type, so use URL heuristics.
  AND (
    NOT REGEXP_LIKE(url_extract_path(url), '(?i)\.(css|js|png|jpg|jpeg|gif|webp|php|svg|ico|woff|woff2|otf|ttf|eot|mp4|mp3|avi|mov|zip|tar|gz|json|xml|txt)$')
    OR REGEXP_LIKE(url_extract_path(url), '(?i)((\.html?|\.pdf|\.md|robots\.txt)$|sitemap)')
  )

  -- agentic and LLM-attributed traffic never has self-referer
  AND NOT REGEXP_LIKE(COALESCE(referer, ''), '{{host}}')

GROUP BY
  url_extract_path(url),
  user_agent,
  status,
  try(url_extract_host(referer)),
  host,
  time_to_first_byte,
  '{{serviceProvider}}',
  COALESCE(host, '');
