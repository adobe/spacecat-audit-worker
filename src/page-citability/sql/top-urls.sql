SELECT DISTINCT 
  url,
  SUM(count) as total_hits
FROM {{databaseName}}.{{tableName}}
WHERE 
  (
    REGEXP_LIKE(user_agent, '(?i)ChatGPT|GPTBot|OAI-SearchBot') OR 
    REGEXP_LIKE(user_agent, '(?i)Perplexity') OR 
    REGEXP_LIKE(user_agent, '(?i)(^Google$|Gemini-Deep-Research)')
  )
  AND url IS NOT NULL
  AND ({{dateFilter}})
GROUP BY url
HAVING SUM(count) >= 10
ORDER BY total_hits DESC
LIMIT 1;

