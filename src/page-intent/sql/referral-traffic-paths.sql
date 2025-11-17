SELECT DISTINCT
    path
FROM {{tableName}}
WHERE siteid = '{{siteId}}'
    AND ({{temporalCondition}})
    AND trf_type = 'earned'
    AND trf_channel = 'llm'
