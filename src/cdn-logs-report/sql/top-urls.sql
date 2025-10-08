WITH
counts AS (
  SELECT
    lower(regexp_replace(url, '/+$', '')) AS url_norm,
    COUNT(*) AS hits
  FROM {{databaseName}}.{{tableName}}
  {{whereClause}}
  GROUP BY 1
),
top_urls AS (
  SELECT url_norm AS url
  FROM counts
  ORDER BY hits DESC, url_norm
  LIMIT 100
),
tail_candidates AS (
  SELECT url_norm AS url
  FROM counts
  WHERE url_norm NOT IN (SELECT url FROM top_urls)
),
tail_sample AS (
  SELECT url
  FROM tail_candidates
  -- deterministic ~1% sample; change 100 -> 50 (~2%), 20 (~5%), etc.
  WHERE MOD(from_big_endian_64(xxhash64(to_utf8(url))), 100) = 0
  LIMIT 100
)
SELECT url FROM top_urls
UNION ALL
SELECT url FROM tail_sample
ORDER BY url;
