CREATE EXTERNAL TABLE IF NOT EXISTS {{database}}.{{rawTable}} (
  EdgeStartTimestamp      string,
  ClientCountry           string,
  ClientRequestHost       string,
  ClientRequestURI        string,
  ClientRequestMethod     string,
  ClientRequestUserAgent  string,
  EdgeResponseStatus      int,
  ClientRequestReferer    string,
  EdgeResponseContentType string,
  EdgeTimeToFirstByteMs   int
)
PARTITIONED BY (
  date string
)
ROW FORMAT SERDE 'org.apache.hive.hcatalog.data.JsonSerDe'
LOCATION '{{rawLocation}}'
TBLPROPERTIES (
  'projection.enabled'        = 'true',
  'storage.location.template' = '{{rawLocation}}${date}/',
  'projection.date.type'      = 'date',
  'projection.date.range'     = '20250101,NOW',
  'projection.date.format'    = 'yyyyMMdd',
  'projection.date.interval'  = '1',
  'projection.date.interval.unit' = 'DAYS',
  'has_encrypted_data'        = 'false'
);
