WITH filtered AS (
  SELECT
    url,
    count AS hits
  FROM {{databaseName}}.{{tableName}}
  {{whereClause}}
),
aggregated AS (
  SELECT
    url,
    SUM(hits) AS total_hits
  FROM filtered
  WHERE url IS NOT NULL
    AND url <> 'Other'
    {{excludedUrlSuffixesFilter}}
  GROUP BY url
)
SELECT
  url
FROM aggregated
ORDER BY total_hits DESC
LIMIT {{limit}}

