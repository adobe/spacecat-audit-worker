UNLOAD (
  SELECT
    url AS url,
    request_user_agent AS user_agent,
    response_status AS status,
    try(url_extract_host(request_referer)) AS referer,
    host,
    geo_country AS country,
    CAST(time_to_first_byte AS BIGINT) AS time_to_first_byte,
    COUNT(*) AS count
  FROM {{database}}.{{rawTable}}
  WHERE year  = '{{year}}'
    AND month = '{{month}}'
    AND day   = '{{day}}'
    AND hour  = '{{hour}}'
    
    -- agentic and LLM-attributed traffic filter based on user-agent, referer and utm tag
    AND (
      -- match known LLM-related user-agents
      REGEXP_LIKE(request_user_agent, '(?i)ChatGPT|GPTBot|Perplexity|Claude|Anthropic|Gemini|Copilot|Googlebot|bingbot')

      -- match known referer hostnames for LLM-attributed real-user traffic
      OR REGEXP_LIKE(COALESCE(request_referer, ''), '(?i)chatgpt\.com|openai\.com|perplexity\.ai|claude\.ai|gemini\.google\.com|copilot\.microsoft\.com')

      -- match known query parameters for LLM-attributed real-user traffic
      OR url LIKE '%utm_source=chatgpt.com%'
    )

    -- only count text/html responses with robots.txt and sitemaps
    AND (response_content_type LIKE 'text/html%' OR url LIKE '%robots.txt' OR url LIKE '%sitemap%')

    -- agentic and LLM-attributed traffic never has self-referer 
    AND NOT REGEXP_LIKE(COALESCE(request_referer, ''), '{{host}}')

  GROUP BY
    url,
    request_user_agent,
    response_status,
    request_referer,
    host,
    geo_country,
    CAST(time_to_first_byte AS BIGINT)

) TO 's3://{{bucket}}/aggregated/{{year}}/{{month}}/{{day}}/{{hour}}/'
WITH (format = 'PARQUET');
