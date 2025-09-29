UNLOAD (
  SELECT
    url_extract_path(properties.requestUri) AS url,
    properties.userAgent AS user_agent,
    CAST(properties.httpStatusCode AS INT) AS status,
    NULL AS referer,
    url_extract_host(properties.requestUri) AS host,
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

    AND (
        url_extract_path(properties.requestUri) LIKE '%.htm%'
        OR url_extract_path(properties.requestUri)  LIKE '%.pdf%'
        OR url_extract_path(properties.requestUri) LIKE '%robots.txt%' 
        OR url_extract_path(properties.requestUri) LIKE '%sitemap%'
    )

    -- agentic and LLM-attributed traffic never has self-referer 
    AND NOT REGEXP_LIKE(COALESCE(properties.referrer, ''), '{{host}}')

  GROUP BY
    url_extract_path(properties.requestUri),
    properties.userAgent,
    CAST(properties.httpStatusCode AS INT),
    url_extract_host(properties.requestUri),
    CAST(properties.timeToFirstByte AS DOUBLE),
    '{{serviceProvider}}'

) TO '{{aggregatedOutput}}'
WITH (format = 'PARQUET');
