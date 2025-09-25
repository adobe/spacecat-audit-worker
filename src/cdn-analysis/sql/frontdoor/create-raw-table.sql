CREATE EXTERNAL TABLE IF NOT EXISTS {{database}}.{{rawTable}} (
  Time                  string,
  RequestHost           string,
  RequestUri            string,
  HttpMethod            string,
  UserAgent             string,
  HttpStatusCode        int,
  Referrer              string,
  TimeToFirstByte       double
)
PARTITIONED BY (
  year  string,
  month string,
  day   string,
  hour  string
)
ROW FORMAT SERDE 'org.apache.hive.hcatalog.data.JsonSerDe'
LOCATION '{{rawLocation}}'
TBLPROPERTIES (
  'projection.enabled'        = 'true',
  'storage.location.template' = '{{rawLocation}}${year}/${month}/${day}/${hour}/',
  'projection.year.type'      = 'integer',
  'projection.year.range'     = '2024,2030',
  'projection.month.type'     = 'integer',
  'projection.month.range'    = '1,12',
  'projection.month.digits'   = '2',
  'projection.day.type'       = 'integer',
  'projection.day.range'      = '1,31',
  'projection.day.digits'     = '2',
  'projection.hour.type'      = 'integer',
  'projection.hour.range'     = '0,23',
  'projection.hour.digits'    = '2',
  'has_encrypted_data'        = 'false'
);
