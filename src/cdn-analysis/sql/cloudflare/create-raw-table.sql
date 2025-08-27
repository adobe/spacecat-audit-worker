CREATE EXTERNAL TABLE IF NOT EXISTS {{database}}.{{rawTable}} (
  EdgeStartTimestamp      STRING,
  ClientCountry           STRING,
  ClientRequestHost       STRING,
  ClientRequestURI        STRING,
  ClientRequestMethod     STRING,
  ClientRequestProtocol   STRING,
  ClientRequestUserAgent  STRING,
  EdgeResponseStatus      INT,
  ClientRequestReferer    STRING,
  EdgeResponseContentType STRING,
  EdgeTimeToFirstByteMs   DOUBLE
)
PARTITIONED BY (
  year  STRING,
  month STRING,
  day   STRING
)
ROW FORMAT SERDE 'org.apache.hive.hcatalog.data.JsonSerDe'
LOCATION '{{rawLocation}}'
TBLPROPERTIES (
  'projection.enabled'        = 'true',
  'storage.location.template' = '{{rawLocation}}${year}${month}${day}/',
  'projection.year.type'      = 'integer',
  'projection.year.range'     = '2024,2030',
  'projection.month.type'     = 'integer',
  'projection.month.range'    = '1,12',
  'projection.month.digits'   = '2',
  'projection.day.type'       = 'integer',
  'projection.day.range'      = '1,31',
  'projection.day.digits'     = '2',
  'has_encrypted_data'        = 'false'
);
