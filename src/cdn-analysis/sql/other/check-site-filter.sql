-- Probe: does this site's host filter match any raw row for this window?
-- Used to decide whether it's safe to apply host filtering at aggregation time
-- (see handler.js) without risking silently excluding a not-yet-confirmed host.
SELECT 1
FROM (
  SELECT
    url_extract_path(url) AS url,
    request_user_agent AS user_agent,
    try(url_extract_host(request_referer)) AS referer,
    host,
    '{{serviceProvider}}' AS cdn_provider,
    '' as x_forwarded_host
  FROM {{database}}.{{rawTable}}
  WHERE year  = '{{year}}'
    AND month = '{{month}}'
    AND day   = '{{day}}'
)
WHERE {{siteFilterClause}}
LIMIT 1;
