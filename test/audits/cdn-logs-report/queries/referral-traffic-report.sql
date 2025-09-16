SELECT
  url as path,
  referrer,
  utm_source,
  utm_medium,
  tracking_param,
  device,
  date,
  COALESCE(
    NULLIF(UPPER(REGEXP_EXTRACT(url, '(?i)^(?:/|(?:https?:\/\/|\/\/)?[^/]+/)?[a-z]{2}-([a-z]{2})(?:/|$)', 1)), ''),
    NULLIF(UPPER(REGEXP_EXTRACT(url, '(?i)^(?:/|(?:https?:\/\/|\/\/)?[^/]+/)?[a-z]{2}_([a-z]{2})(?:/|$)', 1)), ''),
    NULLIF(UPPER(REGEXP_EXTRACT(url, '(?i)^(?:/|(?:https?:\/\/|\/\/)?[^/]+/)?[a-z]{2}_([a-z]{2})\.[a-z]+$', 1)), ''),
    NULLIF(UPPER(REGEXP_EXTRACT(url, '(?i)^(?:/|(?:https?:\/\/|\/\/)?[^/]+/)(?:global|international)/([a-z]{2})(?:/|$)', 1)), ''),
    NULLIF(UPPER(REGEXP_EXTRACT(url, '(?i)^(?:/|(?:https?:\/\/|\/\/)?[^/]+/)(?:countries?|regions?)/([a-z]{2})(?:/|$)', 1)), ''),
    NULLIF(UPPER(REGEXP_EXTRACT(url, '(?i)^(?:/|(?:https?:\/\/|\/\/)?[^/]+/)([a-z]{2})/[a-z]{2}(?:/|$)', 1)), ''),
    NULLIF(UPPER(REGEXP_EXTRACT(url, '(?i)^(?:/|(?:https?:\/\/|\/\/)?[^/]+/)?([a-z]{2})(?:/|$)', 1)), ''),
    NULLIF(UPPER(REGEXP_EXTRACT(url, '(?i)[?&]country=([a-z]{2,3})(?:&|$)', 1)), ''),
    NULLIF(UPPER(REGEXP_EXTRACT(url, '(?i)[?&]locale=[a-z]{2}-([a-z]{2})(?:&|$)', 1)), ''),
    'GLOBAL'
  ) as region,
  COUNT(*) AS pageviews
FROM cdn_logs_database.aggregated_referral_logs
WHERE (year = '2025' AND month = '08' AND day >= '18' AND day <= '24') AND (NOT REGEXP_LIKE(host, '(?i)(preprod|stag|catalog|test)') AND REGEXP_LIKE(host, '(?i)(www.another.com)'))
GROUP BY
  url, referrer, utm_source, utm_medium, tracking_param, device, date
ORDER BY pageviews DESC
