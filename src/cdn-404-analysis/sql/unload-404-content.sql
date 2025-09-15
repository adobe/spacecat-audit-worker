UNLOAD (
  SELECT
    url AS url,
    COALESCE(REGEXP_EXTRACT(url, '/content/dam/([^/]+)', 1), 'unknown') AS tenant,
    count(*) AS count
  FROM {{database}}.{{tableName}}
  WHERE year  = '{{year}}'
    AND month = '{{month}}'
    AND day   = '{{day}}'
    AND hour  = '{{hour}}'
    
    AND response_status = 404
    -- Only include content fragment requests
    AND url LIKE '/content/dam/%'

  GROUP BY url, COALESCE(REGEXP_EXTRACT(url, '/content/dam/([^/]+)', 1), 'unknown')
) TO 's3://{{bucket}}/aggregated/{{year}}/{{month}}/{{day}}/{{hour}}/'
WITH (format = 'PARQUET');
