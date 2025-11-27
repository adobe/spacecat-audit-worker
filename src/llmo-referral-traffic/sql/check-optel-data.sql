SELECT COUNT(*) as row_count
FROM {{tableName}}
WHERE siteid = '{{siteId}}'
    AND ({{temporalCondition}})
LIMIT 1

