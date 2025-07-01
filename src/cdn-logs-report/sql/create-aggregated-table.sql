CREATE EXTERNAL TABLE IF NOT EXISTS {{databaseName}}.{{tableName}} (
  url string,
  user_agent string,
  status int,
  referer string,
  host string,
  count bigint
)
PARTITIONED BY (
  year string,
  month string,
  day string,
  hour string
)
STORED AS PARQUET
LOCATION '{{aggregatedLocation}}'
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
  'projection.hour.type' = 'integer',
  'projection.hour.range' = '0,23',
  'projection.hour.digits' = '2',
  'storage.location.template' = '{{aggregatedLocation}}${year}/${month}/${day}/${hour}/',
  'has_encrypted_data' = 'false'
)
