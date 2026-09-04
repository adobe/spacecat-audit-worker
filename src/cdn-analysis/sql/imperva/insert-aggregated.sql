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
    url_extract_path(cs_uri) AS url,
    cs_user_agent AS user_agent,
    COALESCE(try_cast(NULLIF(sc_status, '') AS INTEGER), 0) AS status,
    try(url_extract_host(cs_referrer)) AS referer,
    s_computername AS host,
    0.0 AS time_to_first_byte,
    '{{serviceProvider}}' AS cdn_provider,
    COALESCE(s_computername, '') as x_forwarded_host,

    '{{year}}' AS year,
    '{{month}}' AS month,
    '{{day}}' AS day,
    '{{hour}}' AS hour

  FROM {{database}}.{{rawTable}}

  WHERE
    date = '{{year}}-{{month}}-{{day}}'
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
    NOT REGEXP_LIKE(url, '(?i)\.(css|js|png|jpg|jpeg|gif|webp|php|svg|ico|woff|woff2|otf|ttf|eot|mp4|mp3|avi|mov|zip|tar|gz|json|xml|txt)$')
    OR REGEXP_LIKE(url, '(?i)((\.html?|\.pdf|\.md|robots\.txt|llms(-full)?\.txt)$|sitemap)')
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
