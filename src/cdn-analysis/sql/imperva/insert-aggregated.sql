INSERT INTO {{database}}.{{aggregatedTable}}
SELECT
  url_extract_path(cs_uri) AS url,
  cs_user_agent AS user_agent,
  COALESCE(try_cast(NULLIF(sc_status, '') AS INTEGER), 0) AS status,
  try(url_extract_host(cs_referrer)) AS referer,
  s_computername AS host,
  0.0 AS time_to_first_byte,
  COUNT(*) AS count,
  '{{serviceProvider}}' AS cdn_provider,
  COALESCE(s_computername, '') as x_forwarded_host,

  '{{year}}' AS year,
  '{{month}}' AS month,
  '{{day}}' AS day,
  '{{hour}}' AS hour

FROM {{database}}.{{rawTable}}

WHERE 
  date = '{{year}}-{{month}}-{{day}}'

  -- match known LLM-related user-agents
  AND REGEXP_LIKE(cs_user_agent, '(?i)(ChatGPT|GPTBot|OAI-SearchBot|Perplexity|Claude|Anthropic|Gemini|Copilot|MistralAI-User|Google-NotebookLM|Google-?Agent|Google-Extended|Googlebot|bingbot|Amzn-User|^Google$)')

  -- only count HTML/PDF/Markdown responses, plus .md paths, robots.txt and sitemaps
  AND (
    NOT REGEXP_LIKE(url_extract_path(cs_uri), '(?i)\.(css|js|png|jpg|jpeg|gif|webp|php|svg|ico|woff|woff2|otf|ttf|eot|mp4|mp3|avi|mov|zip|tar|gz|json|xml|txt)$')
    OR REGEXP_LIKE(url_extract_path(cs_uri), '(?i)((\.html?|\.pdf|\.md|robots\.txt)$|sitemap)')
  )

  -- agentic and LLM-attributed traffic never has self-referer
  AND NOT REGEXP_LIKE(COALESCE(cs_referrer, ''), '{{host}}')

GROUP BY
  url_extract_path(cs_uri),
  cs_user_agent,
  COALESCE(try_cast(NULLIF(sc_status, '') AS INTEGER), 0),
  try(url_extract_host(cs_referrer)),
  s_computername,
  0.0,
  '{{serviceProvider}}',
  '';
