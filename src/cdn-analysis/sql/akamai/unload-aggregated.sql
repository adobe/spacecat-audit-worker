UNLOAD (
  SELECT
    -- in akamai, url path and query string come in separate fields - we concatenate them into single url field
    CASE
      WHEN queryStr IS NOT NULL AND trim(queryStr) NOT IN ('', '-')
        THEN concat(reqPath, '?', queryStr)
      ELSE reqPath
    END AS url,

    ua AS user_agent,
    CAST(statusCode AS INTEGER) AS status,
    try(url_extract_host(referer)) AS referer,
    reqHost AS host,
    CAST(timeToFirstByte AS DOUBLE) AS time_to_first_byte,
    COUNT(*) AS count

  FROM {{database}}.{{rawTable}}

  WHERE year  = '{{year}}'
    AND month = '{{month}}'
    AND day   = '{{day}}'
    AND hour  = '{{hour}}'

    -- agentic and LLM-attributed traffic filter based on user-agent, referer and utm tag
    AND (
      -- match known LLM-related user-agents
      REGEXP_LIKE(ua, '(?i)ChatGPT|GPTBot|OAI-SearchBot|Perplexity|Claude|Anthropic|Gemini|Copilot|Googlebot|bingbot')

      -- match known referer hostnames for LLM-attributed real-user traffic
      OR REGEXP_LIKE(COALESCE(referer, ''), '(?i)chatgpt\.com|openai\.com|perplexity\.ai|claude\.ai|gemini\.google\.com|copilot\.microsoft\.com')

      -- match known query parameters for LLM-attributed real-user traffic
      OR queryStr LIKE '%utm_source=chatgpt.com%'
    )

    -- only count text/html responses with robots.txt and sitemaps
    AND (
      rspContentType LIKE 'text/html%'
      OR rspContentType LIKE 'application/pdf%'
      OR reqPath LIKE '%robots.txt'
      OR reqPath LIKE '%sitemap%'
    )

    -- agentic and LLM-attributed traffic never has self-referer
    AND NOT REGEXP_LIKE(COALESCE(referer, ''), '{{host}}')

  GROUP BY
    CASE
      WHEN queryStr IS NOT NULL AND trim(queryStr) NOT IN ('', '-')
        THEN concat(reqPath, '?', queryStr)
      ELSE reqPath
    END,
    ua,
    statusCode,
    try(url_extract_host(referer)),
    reqHost,
    CAST(timeToFirstByte AS DOUBLE)

) TO 's3://{{bucket}}/aggregated/{{year}}/{{month}}/{{day}}/{{hour}}/'
WITH (format = 'PARQUET');
