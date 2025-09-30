UNLOAD (
  SELECT
    url_extract_path(properties.requestUri) AS url,
    properties.userAgent AS user_agent,
    CAST(properties.httpStatusCode AS INT) AS status,
    try(url_extract_host(properties.referer)) AS referer,
    COALESCE(NULLIF(properties.hostname, ''), url_extract_host(properties.requestUri)) AS host,
    CAST(properties.timeToFirstByte AS DOUBLE) AS time_to_first_byte,
    COUNT(*) AS count,
    '{{serviceProvider}}' AS cdn_provider
  FROM {{database}}.{{rawTable}}
  WHERE year  = '{{year}}'
    AND month = '{{month}}'
    AND day   = '{{day}}'
    AND hour  = '{{hour}}'
    
     -- match known LLM-related user-agents
    AND REGEXP_LIKE(properties.userAgent, '(?i)(ChatGPT|GPTBot|OAI-SearchBot|Perplexity|Claude|Anthropic|Gemini|Copilot|Googlebot|bingbot|^Google$)')

    -- exclude static assets, but always include HTML, PDF, robots.txt, and sitemaps
    AND (
        NOT REGEXP_LIKE(url_extract_path(properties.requestUri), '(?i)\.(css|js|png|jpg|jpeg|gif|webp|svg|ico|woff|woff2|ttf|eot|mp4|mp3|avi|mov|zip|tar|gz|json|xml|txt)(\?.*)?$')
        OR REGEXP_LIKE(url_extract_path(properties.requestUri), '(?i)(\.htm|\.pdf|robots\.txt|sitemap)')
    )

    -- agentic and LLM-attributed traffic never has self-referer 
    AND NOT REGEXP_LIKE(COALESCE(properties.referer, ''), '{{host}}')

  GROUP BY
    url_extract_path(properties.requestUri),
    properties.userAgent,
    CAST(properties.httpStatusCode AS INT),
    COALESCE(NULLIF(properties.hostname, ''), url_extract_host(properties.requestUri)),
    CAST(properties.timeToFirstByte AS DOUBLE),
    '{{serviceProvider}}'

) TO '{{aggregatedOutput}}'
WITH (format = 'PARQUET');
