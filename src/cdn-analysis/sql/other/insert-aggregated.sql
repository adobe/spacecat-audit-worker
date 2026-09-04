INSERT INTO {{database}}.{{aggregatedTable}}
SELECT
  url,
  user_agent,
  status,
  referer,
  host,
  time_to_first_byte,
  COUNT(*) AS count,
  cdn_provider,
  x_forwarded_host,
  year,
  month,
  day,
  hour
FROM (
  SELECT
    url_extract_path(url) AS url,
    request_user_agent AS user_agent,
    response_status AS status,
    try(url_extract_host(request_referer)) AS referer,
    host,
    CAST(time_to_first_byte AS DOUBLE) AS time_to_first_byte,
    '{{serviceProvider}}' AS cdn_provider,
    '' as x_forwarded_host,
    response_content_type AS content_type,

    -- Add partition columns as regular columns
    '{{year}}' AS year,
    '{{month}}' AS month,
    '{{day}}' AS day,
    '{{hour}}' AS hour
  FROM {{database}}.{{rawTable}}
  WHERE year  = '{{year}}'
    AND month = '{{month}}'
    AND day   = '{{day}}'
)
WHERE
  -- restrict to this site's own traffic; the raw path can be shared by multiple
  -- sites under the same org/CDN, so without this every site sharing the path
  -- would aggregate every other site's rows too. Same host-matching logic
  -- (default or per-site cdnlogsFilter override) the report layer already uses.
  {{siteFilterClause}}

   -- match known LLM-related user-agents
  AND REGEXP_LIKE(user_agent, '(?i)(ChatGPT|GPTBot|OAI-SearchBot|OAI-AdsBot|Perplexity|Claude|Anthropic|Gemini|Copilot|MistralAI-User|Google-NotebookLM|Google-?Agent|Google-Extended|Googlebot|bingbot|Amzn-User|^Google$)')

  -- exclude Adobe internal/proxied user agents (O@E appends AdobeEdgeOptimize/*, internal crawler uses Spacecat/1.0, Tokowaka)
  AND NOT REGEXP_LIKE(user_agent, '(?i)(Tokowaka|Spacecat|AdobeEdgeOptimize)')

  -- prefer response content type when present, otherwise fall back to URL heuristics
  AND (
    (
      NULLIF(trim(content_type), '') IS NOT NULL
      AND (
        REGEXP_LIKE(lower(content_type), '^(text/html|application/pdf|text/markdown)')
        OR REGEXP_LIKE(lower(url), '\.md(\?.*)?$')
        OR url LIKE '%robots.txt'
        OR REGEXP_LIKE(lower(url), 'llms(-full)?\.txt$')
        OR url LIKE '%sitemap%'
      )
    )
    OR (
      NULLIF(trim(content_type), '') IS NULL
      AND (
        NOT REGEXP_LIKE(COALESCE(url, ''), '(?i)\.(css|js|mjs|png|jpg|jpeg|gif|webp|avif|php|svg|ico|woff|woff2|otf|ttf|eot|mp4|mp3|avi|mov|zip|tar|gz|json|xml|txt)(\?.*)?$')
        OR REGEXP_LIKE(COALESCE(url, ''), '(?i)(\.htm|\.pdf|\.md|robots\.txt|llms(-full)?\.txt|sitemap)')
      )
    )
  )

GROUP BY
  url,
  user_agent,
  status,
  referer,
  host,
  time_to_first_byte,
  cdn_provider,
  x_forwarded_host,
  year,
  month,
  day,
  hour;
