SELECT 
  url,
  request_user_agent
FROM {{database}}.{{tableName}}
WHERE year = '{{year}}' 
  AND month = '{{month}}' 
  AND day = '{{day}}'