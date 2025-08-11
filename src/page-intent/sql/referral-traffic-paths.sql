SELECT 
    path
FROM {{tableName}}
WHERE siteid = '{{siteId}}'
    AND ({{temporalCondition}})
    AND trf_type != 'owned'
