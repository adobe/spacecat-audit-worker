-- Probe: does this site's host filter match any raw row for this window?
-- Used to decide whether it's safe to apply host filtering at aggregation time
-- (see handler.js) without risking silently excluding a not-yet-confirmed host.
SELECT 1
FROM (
  SELECT
    url_extract_path(ClientRequestURI) AS url,
    ClientRequestUserAgent AS user_agent,
    try(url_extract_host(ClientRequestReferer)) AS referer,
    ClientRequestHost AS host,
    '{{serviceProvider}}' AS cdn_provider,
    COALESCE(ClientRequestHost, '') as x_forwarded_host
  FROM {{database}}.{{rawTable}}
  WHERE date = '{{year}}{{month}}{{day}}'
)
WHERE {{siteFilterClause}}
LIMIT 1;
