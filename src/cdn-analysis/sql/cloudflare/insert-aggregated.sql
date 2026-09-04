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
    url_extract_path(ClientRequestURI) AS url,
    ClientRequestUserAgent AS user_agent,
    EdgeResponseStatus AS status,
    try(url_extract_host(ClientRequestReferer)) AS referer,
    ClientRequestHost AS host,
    CAST(EdgeTimeToFirstByteMs AS DOUBLE) AS time_to_first_byte,
    '{{serviceProvider}}' AS cdn_provider,
    COALESCE(ClientRequestHost, '') as x_forwarded_host,
    EdgeResponseContentType AS content_type,

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

  -- only count HTML/PDF/Markdown responses, plus .md paths, robots.txt, llms.txt and sitemaps
  AND (
    REGEXP_LIKE(lower(content_type), '^(text/html|application/pdf|text/markdown)')
    OR REGEXP_LIKE(lower(url), '\.md(\?.*)?$')
    OR url LIKE '%robots.txt'
    OR REGEXP_LIKE(lower(url), 'llms(-full)?\.txt$')
    OR url LIKE '%sitemap%'
  )

  -- agentic and LLM-attributed traffic never has self-referer
  AND NOT REGEXP_LIKE(COALESCE(referer, ''), '{{host}}')

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
