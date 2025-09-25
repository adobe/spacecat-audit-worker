UNLOAD (
  -- first, identify the hosts from the cdn logs so that self-referrals can be filtered out later on
  WITH hosts AS (
    SELECT DISTINCT RequestHost AS host
    FROM {{database}}.{{rawTable}}
    WHERE year  = '{{year}}'
      AND month = '{{month}}'
      AND day   = '{{day}}'
      AND hour  = '{{hour}}'
  ),
  
  referrals_raw AS (
    SELECT
      RequestUri AS url,
      RequestHost AS host,
      try(url_extract_host(Referrer)) AS referrer,
      url_extract_parameter(RequestUri, 'utm_source') AS utm_source,
      url_extract_parameter(RequestUri, 'utm_medium') AS utm_medium,
  
      -- only the tracking_param, not the value (no PII)
      -- for the tracking_param list, please refer to https://github.com/adobe/helix-rum-enhancer/blob/main/plugins/martech.js#L13-L22
      -- list is limited to have feature parity with rum-enhancer
      CASE
        WHEN REGEXP_LIKE(
          RequestUri,
          '(?i)(gclid|gclsrc|wbraid|gbraid|dclid|msclkid|fb(?:cl|ad_|pxl_)id|tw(?:clid|src|term)|li_fat_id|epik|ttclid)'
        ) THEN 'paid'
        WHEN REGEXP_LIKE(
          RequestUri,
          '(?i)(mc_(?:c|e)id|mkt_tok)'
        ) THEN 'email'
        ELSE NULL
      END AS tracking_param,
      
      -- device bucket from User-Agent
      CASE
        WHEN regexp_like(coalesce(UserAgent, ''),
          '(?i)(mobi|iphone|ipod|ipad|android(?!.*tv)|windows phone|blackberry|bb10|opera mini|fennec|ucbrowser|silk|kindle|playbook|tablet)'
        )
          THEN 'mobile'
        ELSE 'desktop'
      END AS device,
      '{{serviceProvider}}' AS cdn_provider,
      CONCAT('{{year}}', '-', '{{month}}', '-', '{{day}}') as date
  
    FROM {{database}}.{{rawTable}}
    WHERE year  = '{{year}}'
      AND month = '{{month}}'
      AND day   = '{{day}}'
      AND hour  = '{{hour}}'
  
      -- referral traffic definition
      AND (
        -- case 1: IF URL contains utm_source OR utm_medium
        (
          (url_extract_parameter(RequestUri, 'utm_source') IS NOT NULL AND url_extract_parameter(RequestUri, 'utm_source') <> '')
          OR (url_extract_parameter(RequestUri, 'utm_medium') IS NOT NULL AND url_extract_parameter(RequestUri, 'utm_medium') <> '')
        )
  
        -- case 2: IF URL contains a known tracking param
        OR REGEXP_LIKE(
          RequestUri,
          -- for the tracking_param list, please refer to https://github.com/adobe/helix-rum-enhancer/blob/main/plugins/martech.js#L13-L22
          -- list is limited to have feature parity with rum-enhancer
          '(?i)(gclid|gclsrc|wbraid|gbraid|dclid|msclkid|fbclid|fbad_id|fbpxl_id|twclid|twsrc|twterm|li_fat_id|epik|ttclid)'
        )
  
        -- case 3: IF cdn log contains external referrer (not one of first party hosts)
        OR (
          Referer IS NOT NULL AND try(url_extract_host(Referer)) NOT IN (SELECT host FROM hosts)
        )
      )
  
      -- only count HTML page views
      AND HttpStatusCode = 200
      AND (
        RequestUri LIKE '%.html'
        OR RequestUri LIKE '%.htm'
      )
  
      -- basic filtering on user_agent for bots, crawlers, programmatic clients
      AND NOT REGEXP_LIKE(
        COALESCE(UserAgent, ''),
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
  
  SELECT *
  FROM referrals_raw
  WHERE COALESCE(
    NULLIF(utm_source, ''),
    NULLIF(utm_medium, ''),
    NULLIF(referrer, ''),
    NULLIF(tracking_param, '')
  ) IS NOT NULL
) TO '{{aggregatedReferralOutput}}'
WITH (format = 'PARQUET');
