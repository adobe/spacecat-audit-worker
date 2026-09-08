-- F5 follow-up questions to verify once we receive a real customer log sample:
-- 1. What is the exact per-record timestamp field name, if one is present in the payload?
-- 2. Does the payload include a response content-type field we should prefer over URL heuristics?
-- 3. Is `domain` consistently populated, or do we need `authority` / `original_authority` as fallbacks?
-- 4. Is `time_to_first_downstream_tx_byte` consistently populated, and is it reported in seconds or milliseconds?
-- 5. Until then, year/month/day/hour from the S3 partition path is the source of truth for request time.
CREATE EXTERNAL TABLE IF NOT EXISTS {{database}}.{{rawTable}} (
  req_path                           string,
  req_params                         string,
  user_agent                         string,
  referer                            string,
  rsp_code                           string,
  domain                             string,
  time_to_first_downstream_tx_byte   string
)
PARTITIONED BY (
  year  string,
  month string,
  day   string,
  hour  string
)
ROW FORMAT SERDE 'org.openx.data.jsonserde.JsonSerDe'
WITH SERDEPROPERTIES (
  'ignore.malformed.json' = 'true',
  'dots.in.keys'          = 'false',
  'case.insensitive'      = 'true'
)
LOCATION '{{rawLocation}}'
TBLPROPERTIES (
  'schema_version'            = '1',
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
