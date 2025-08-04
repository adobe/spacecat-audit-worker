SELECT 
    path, 
    trf_type, 
    trf_channel, 
    trf_platform, 
    device, 
    date, 
    pageviews, 
    consent, 
    (1 - engaged) AS bounced
FROM {{tableName}}
WHERE siteid = '{{siteId}}'
    AND ({{temporalCondition}})
    AND trf_type != 'owned'
