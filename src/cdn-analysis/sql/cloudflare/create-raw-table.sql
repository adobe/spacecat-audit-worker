CREATE EXTERNAL TABLE IF NOT EXISTS {{database}}.{{rawTable}} (
  EdgeStartTimestamp      string,
  ClientCountry           string,
  ClientRequestHost       string,
  ClientRequestURI        string,
  ClientRequestMethod     string,
  ClientRequestProtocol   string,
  ClientRequestUserAgent  string,
  EdgeResponseStatus      int,
  ClientRequestReferer    string,
  EdgeResponseContentType string,
  EdgeTimeToFirstByteMs   int
)
PARTITIONED BY (
  year  string,
  month string,
  day   string
)
ROW FORMAT SERDE 'org.apache.hive.hcatalog.data.JsonSerDe'
LOCATION '{{rawLocation}}'
TBLPROPERTIES (
  'projection.enabled'        = 'true',
  'storage.location.template' = '{{rawLocation}}${year}/${month}/${day}/',
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
