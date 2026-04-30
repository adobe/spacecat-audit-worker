SELECT
  url as path,
  host,
  referrer,
  utm_source,
  utm_medium,
  tracking_param,
  device,
  date,
  {{countryExtraction}} as region,
  COUNT(*) AS pageviews
FROM {{databaseName}}.{{tableName}}
{{whereClause}}
  AND (referrer IS NOT NULL OR utm_source IS NOT NULL)
GROUP BY
  url, host, referrer, utm_source, utm_medium, tracking_param, device, date, region
ORDER BY pageviews DESC
