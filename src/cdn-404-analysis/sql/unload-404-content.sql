UNLOAD (
  SELECT
    url AS url,
    COALESCE(REGEXP_EXTRACT(url, '/content/dam/([^/]+)', 1), 'unknown') AS tenant,
    count(*) AS count
  FROM {{database}}.{{rawTable}}
  WHERE year  = '{{year}}'
    AND month = '{{month}}'
    AND day   = '{{day}}'
    AND hour  = '{{hour}}'
    
    AND response_status = 404
    -- Only include content fragment requests
    AND url LIKE '/content/dam/%'

  GROUP BY url, COALESCE(REGEXP_EXTRACT(url, '/content/dam/([^/]+)', 1), 'unknown')
) TO '{{output}}'
WITH (format = 'PARQUET');
