SELECT
    user_agent,
    url,
    status,
    SUM(count) AS total_requests
FROM {{databaseName}}.{{tableName}}
{{whereClause}}
GROUP BY
    user_agent,
    url,
    status
ORDER BY
    total_requests DESC
LIMIT 500