-- Probe: does this site's host filter match any raw row for this window?
-- Used to decide whether it's safe to apply host filtering at aggregation time
-- (see handler.js) without risking silently excluding a not-yet-confirmed host.
SELECT 1
FROM (
  SELECT
    url_extract_path(cs_uri) AS url,
    cs_user_agent AS user_agent,
    try(url_extract_host(cs_referrer)) AS referer,
    s_computername AS host,
    '{{serviceProvider}}' AS cdn_provider,
    COALESCE(s_computername, '') as x_forwarded_host
  FROM {{database}}.{{rawTable}}
  WHERE
    date = '{{year}}-{{month}}-{{day}}'
)
WHERE {{siteFilterClause}}
LIMIT 1;
