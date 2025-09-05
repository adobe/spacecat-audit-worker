UNLOAD (
  SELECT
    url AS url,
    request_user_agent AS user_agent,
    response_status AS status,
    try(url_extract_host(request_referer)) AS referer,
    host,
    CAST(time_to_first_byte AS DOUBLE) * 1000 AS time_to_first_byte,
    COUNT(*) AS count,
    '{{serviceProvider}}' AS cdn_provider
  FROM {{database}}.{{rawTable}}
  WHERE year  = '{{year}}'
    AND month = '{{month}}'
    AND day   = '{{day}}'
    AND hour  = '{{hour}}'
    
     -- match known LLM-related user-agents
    AND REGEXP_LIKE(request_user_agent, '(?i)(ChatGPT|GPTBot|OAI-SearchBot|Perplexity|Claude|Anthropic|Gemini|Copilot|Googlebot|bingbot|^Google$)')

    -- only count text/html responses with robots.txt and sitemaps
    AND (
      response_content_type LIKE 'text/html%'
      OR response_content_type LIKE 'application/pdf%'
      OR url LIKE '%robots.txt' 
      OR url LIKE '%sitemap%'
    )

    -- agentic and LLM-attributed traffic never has self-referer 
    AND NOT REGEXP_LIKE(COALESCE(request_referer, ''), '{{host}}')

  GROUP BY
    url,
    request_user_agent,
    response_status,
    request_referer,
    host,
    CAST(time_to_first_byte AS DOUBLE) * 1000,
    '{{serviceProvider}}'

) TO '{{aggregatedOutput}}'
WITH (format = 'PARQUET');
