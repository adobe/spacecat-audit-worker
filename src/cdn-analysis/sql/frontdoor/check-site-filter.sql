-- Probe: does this site's host filter match any raw row for this window?
-- Used to decide whether it's safe to apply host filtering at aggregation time
-- (see handler.js) without risking silently excluding a not-yet-confirmed host.
SELECT 1
FROM (
  SELECT
    url_extract_path(properties.requestUri) AS url,
    properties.userAgent AS user_agent,
    try(url_extract_host(properties.referer)) AS referer,
    COALESCE(NULLIF(properties.hostname, ''), url_extract_host(properties.requestUri)) AS host,
    '{{serviceProvider}}' AS cdn_provider,
    COALESCE(COALESCE(NULLIF(properties.hostname, ''), url_extract_host(properties.requestUri)), '') as x_forwarded_host
  FROM {{database}}.{{rawTable}}
  WHERE year  = '{{year}}'
    AND month = '{{month}}'
    AND day   = '{{day}}'
    {{hourFilter}}
)
WHERE {{siteFilterClause}}
LIMIT 1;
