SELECT
  url as path,
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
GROUP BY
  url, referrer, utm_source, utm_medium, tracking_param, device, date
ORDER BY pageviews DESC
