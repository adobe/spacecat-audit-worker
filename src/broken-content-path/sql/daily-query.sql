SELECT 
  url
FROM {{database}}.{{tableName}}
WHERE year = '{{year}}' 
  AND month = '{{month}}' 
  AND day = '{{day}}'
  AND tenant = '{{tenant}}'