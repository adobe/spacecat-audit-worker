INSERT INTO {{database}}.{{aggregatedTable}}
WITH hosts AS (
  -- first, identify the hosts from the cdn logs so that self-referrals can be filtered out later on
  SELECT DISTINCT ClientRequestHost AS host
  FROM {{database}}.{{rawTable}}
  WHERE date = '{{year}}{{month}}{{day}}'
),

base AS (
  SELECT
    ClientRequestURI            AS url,
    ClientRequestHost           AS host,
    ClientRequestReferer        AS referer_raw,
    ClientRequestUserAgent      AS user_agent,
    EdgeResponseContentType     AS content_type
  FROM {{database}}.{{rawTable}}
  WHERE date = '{{year}}{{month}}{{day}}'
),

referrals_raw AS (
  SELECT
    url,
    host,
    try(url_extract_host(referer_raw)) AS referrer,
    url_extract_parameter(url, 'utm_source') AS utm_source,
    url_extract_parameter(url, 'utm_medium') AS utm_medium,

    -- only the tracking_param, not the value (no PII)
    -- for the tracking_param list, please refer to https://github.com/adobe/helix-rum-enhancer/blob/main/plugins/martech.js#L13-L22
    -- list is limited to have feature parity with rum-enhancer
    CASE
      WHEN REGEXP_LIKE(
        url,
        '(?i)(gclid|gclsrc|wbraid|gbraid|dclid|msclkid|fb(?:cl|ad_|pxl_)id|tw(?:clid|src|term)|li_fat_id|epik|ttclid)'
      ) THEN 'paid'
      WHEN REGEXP_LIKE(
        url,
        '(?i)(mc_(?:c|e)id|mkt_tok)'
      ) THEN 'email'
      ELSE NULL
    END AS tracking_param,
    
    -- device bucket from User-Agent
    CASE
      WHEN regexp_like(coalesce(user_agent, ''),
        '(?i)(mobi|iphone|ipod|ipad|android(?!.*tv)|windows phone|blackberry|bb10|opera mini|fennec|ucbrowser|silk|kindle|playbook|tablet)'
      )
        THEN 'mobile'
      ELSE 'desktop'
    END AS device,
    '{{serviceProvider}}' AS cdn_provider,

    CONCAT('{{year}}', '-', '{{month}}', '-', '{{day}}') as date

  FROM base
  WHERE
    -- referral traffic definition
    (
      -- case 1: IF URL contains utm_source OR utm_medium
      (
        (url_extract_parameter(url, 'utm_source') IS NOT NULL AND url_extract_parameter(url, 'utm_source') <> '')
        OR
        (url_extract_parameter(url, 'utm_medium') IS NOT NULL AND url_extract_parameter(url, 'utm_medium') <> '')
      )

      -- case 2: IF URL contains a known tracking param
      OR REGEXP_LIKE(
        url,
        -- for the tracking_param list, please refer to https://github.com/adobe/helix-rum-enhancer/blob/main/plugins/martech.js#L13-L22
        -- list is limited to have feature parity with rum-enhancer
        '(?i)(gclid|gclsrc|wbraid|gbraid|dclid|msclkid|fbclid|fbad_id|fbpxl_id|twclid|twsrc|twterm|li_fat_id|epik|ttclid)'
      )

      -- case 3: IF cdn log contains external referrer (not one of first party hosts)
      OR (
        referer_raw IS NOT NULL
        AND try(url_extract_host(referer_raw)) NOT IN (SELECT host FROM hosts)
      )
    )

    -- only count HTML page views
    AND content_type LIKE 'text/html%'

    -- basic filtering on user_agent for bots, crawlers, programmatic clients
    AND NOT REGEXP_LIKE(
      COALESCE(user_agent, ''),
      '(?i)(
         bot|crawler|crawl|spider|slurp|archiver|fetch|monitor|pingdom|preview|scanner|scrapy|httpclient|urlgrabber|
         ahrefs|semrush|mj12bot|dotbot|rogerbot|seznambot|linkdex|blexbot|screaming frog|
         googlebot|bingbot|duckduckbot|baiduspider|yandex(bot|images)|sogou|exabot|
         twitterbot|facebookexternalhit|linkedinbot|pinterest|quora link preview|whatsapp|telegrambot|discordbot|
         curl|wget|python|httpie|okhttp|aiohttp|libwww-perl|lwp::simple|
         java|go-http-client|php|ruby|perl|axios|node|synthetics|probe|ahc
      )'
    )
)

SELECT 
  url_extract_path(url) as url,
  host,
  referrer,
  utm_source,
  utm_medium,
  tracking_param,
  device,
  date,
  cdn_provider,
  
  -- Add partition columns as regular columns
  '{{year}}' AS year,
  '{{month}}' AS month,
  '{{day}}' AS day,
  '{{hour}}' AS hour
FROM referrals_raw
WHERE COALESCE(
  NULLIF(utm_source, ''),
  NULLIF(utm_medium, ''),
  NULLIF(referrer, ''),
  NULLIF(tracking_param, '')
) IS NOT NULL;
