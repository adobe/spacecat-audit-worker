WITH base_referrals AS (
  SELECT
    url,
    referrer,
    utm_source,
    utm_medium,
    tracking_param,
    device,
    date,
    {{countryExtraction}} as region
  FROM {{databaseName}}.{{tableName}}
  {{whereClause}}
),

llm_referrals AS (
  SELECT * FROM base_referrals
  WHERE
    -- case 1: referrer is a known LLM (supports subdomains like l.meta.ai, www.perplexity.ai, etc.)
    REGEXP_LIKE(
      COALESCE(referrer, ''),
      '(?i)^([a-z0-9-]+\.)*(chatgpt\.com|openai\.com|claude\.ai|perplexity\.ai|gemini\.google\.com|copilot\.microsoft\.com|m365\.cloud\.microsoft|meta\.ai|deepseek\.com|mistral\.ai)$'
    )
    OR
    -- case 2: no referrer exists, but utm_source indicates LLM origin
    (
      (referrer IS NULL OR referrer = '')
      AND REGEXP_LIKE(
        COALESCE(utm_source, ''),
        '(?i)^(chatgpt|chatgpt\.com|openai|perplexity|perplexity\.ai|claude|claude\.ai|gemini|copilot|meta\.ai|deepseek|mistral)$'
      )
    )
)

SELECT
  url as path,
  referrer,
  utm_source,
  utm_medium,
  tracking_param,
  device,
  date,
  region,
  COUNT(*) AS pageviews
FROM llm_referrals
GROUP BY
  url, referrer, utm_source, utm_medium, tracking_param, device, date, region
ORDER BY pageviews DESC
