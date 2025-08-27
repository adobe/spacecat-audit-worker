UNLOAD (
    -- first, identify the hosts from the cdn logs so that self-referrals can be filtered out later on
    WITH hosts AS (
      SELECT DISTINCT host
      FROM {{database}}.{{rawTable}}
      WHERE year  = '{{year}}'
        AND month = '{{month}}'
        AND day   = '{{day}}'
        AND hour  = '{{hour}}'
    ),
    
    
    referrals_raw AS (
      SELECT
        url AS url,
        host AS host,
        try(url_extract_host(request_referer)) AS referrer,
        url_extract_parameter(url, 'utm_source') AS utm_source,
        url_extract_parameter(url, 'utm_medium') AS utm_medium,
    
        -- only the tracking_param, not the value (no PII)
        -- for the tracking_param list, please refer to https://github.com/adobe/helix-rum-enhancer/blob/main/plugins/martech.js#L13-L22
        -- list is limited to have feature parity with rum-enhancer
        REGEXP_EXTRACT(
          url,
          '(?i)(gclid|gclsrc|wbraid|gbraid|dclid|msclkid|fbclid|fbad_id|fbpxl_id|twclid|twsrc|twterm|li_fat_id|epik|ttclid)'
        ) AS tracking_param
    
      FROM {{database}}.{{rawTable}}
      WHERE year  = '{{year}}'
        AND month = '{{month}}'
        AND day   = '{{day}}'
        AND hour  = '{{hour}}'
    
        -- referral traffic definition
        AND (
          -- case 1: IF URL contains utm_source OR utm_medium
          (
            (url_extract_parameter(url, 'utm_source') IS NOT NULL AND url_extract_parameter(url, 'utm_source') <> '')
            OR (url_extract_parameter(url, 'utm_medium') IS NOT NULL AND url_extract_parameter(url, 'utm_medium') <> '')
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
            request_referer IS NOT NULL AND try(url_extract_host(request_referer)) NOT IN (SELECT host FROM hosts)
          )
        )
    
        -- only count HTML page views
        AND response_content_type LIKE 'text/html%'
    
        -- basic filtering on user_agent for bots, crawlers, programmatic clients
        AND NOT REGEXP_LIKE(
          COALESCE(request_user_agent, ''),
          '(?i)(
             bot|crawler|crawl|spider|slurp|archiver|fetch|monitor|pingdom|preview|scanner|scrapy|httpclient|urlgrabber|
             ahrefs|semrush|mj12bot|dotbot|rogerbot|seznambot|linkdex|blexbot|screaming frog|
             googlebot|bingbot|duckduckbot|baiduspider|yandex(bot|images)|sogou|exabot|
             twitterbot|facebookexternalhit|linkedinbot|pinterest|quora link preview|whatsapp|telegrambot|discordbot|
             curl|wget|python-requests|httpie|okhttp|aiohttp|libwww-perl|lwp::simple|
             java|go-http-client|php|ruby|perl|axios|node-fetch
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
    ) IS NOT NULL;
) TO 's3://{{bucket}}/aggregated-referral/{{year}}/{{month}}/{{day}}/{{hour}}/'
WITH (format = 'PARQUET');
