CREATE EXTERNAL TABLE IF NOT EXISTS {{database}}.{{tableName}} (
  url string,
  request_user_agent string,
  tenant string
)
PARTITIONED BY (
  year string,
  month string,
  day string
)
STORED AS PARQUET
LOCATION '{{location}}'
TBLPROPERTIES (
  'projection.enabled' = 'true',
  'projection.year.type' = 'integer',
  'projection.year.range' = '2024,2030',
  'projection.month.type' = 'integer',
  'projection.month.range' = '1,12',
  'projection.month.digits' = '2',
  'projection.day.type' = 'integer',
  'projection.day.range' = '1,31',
  'projection.day.digits' = '2',
  'storage.location.template' = '{{location}}/${year}/${month}/${day}/',
  'has_encrypted_data' = 'false'
);
