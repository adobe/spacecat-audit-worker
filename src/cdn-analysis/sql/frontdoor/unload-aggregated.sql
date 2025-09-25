UNLOAD (
  SELECT
    RequestUri AS url,
    UserAgent AS user_agent,
    HttpStatusCode AS status,
    try(url_extract_host(Referrer)) AS referer,
    RequestHost AS host,
    TimeToFirstByte * 1000 AS time_to_first_byte,
    COUNT(*) AS count,
    '{{serviceProvider}}' AS cdn_provider
  FROM {{database}}.{{rawTable}}
  WHERE year  = '{{year}}'
    AND month = '{{month}}'
    AND day   = '{{day}}'
    AND hour  = '{{hour}}'
    
     -- match known LLM-related user-agents
    AND REGEXP_LIKE(UserAgent, '(?i)(ChatGPT|GPTBot|OAI-SearchBot|Perplexity|Claude|Anthropic|Gemini|Copilot|Googlebot|bingbot|^Google$)')

    -- only count text/html responses with robots.txt and sitemaps
    AND (
      HttpStatusCode = 200
      AND (
        RequestUri LIKE 'text/html%'
        OR RequestUri LIKE 'application/pdf%'
        OR RequestUri LIKE '%robots.txt' 
        OR RequestUri LIKE '%sitemap%'
      )
    )

    -- agentic and LLM-attributed traffic never has self-referer 
    AND NOT REGEXP_LIKE(COALESCE(Referrer, ''), '{{host}}')

  GROUP BY
    RequestUri,
    UserAgent,
    HttpStatusCode,
    Referrer,
    RequestHost,
    TimeToFirstByte * 1000,
    '{{serviceProvider}}'

) TO '{{aggregatedOutput}}'
WITH (format = 'PARQUET');
