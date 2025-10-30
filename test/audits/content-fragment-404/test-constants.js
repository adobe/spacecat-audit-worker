/*
 * Copyright 2025 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

// IDs
export const TEST_SITE_ID = 'test-site-id';
export const TEST_OPPORTUNITY_ID = 'test-opportunity-id';
export const TEST_AUDIT_ID = 'test-audit-id';
export const TEST_SUGGESTION_ID = 'test-suggestion-id';
export const TEST_SUGGESTION_ID_2 = 'test-suggestion-id-2';
export const TEST_ORG_ID = 'test-org-id';
export const TEST_HOSTNAME = 'test';
export const TEST_CURSOR = 'cursor-123';

// URLs and Base URLs
export const TEST_BASE_URL = 'https://test-tenant.adobe.com';
export const TEST_CUSTOM_URL = 'https://custom-tenant.adobe.com';
export const TEST_BASE_URL_SITE = 'https://test-site.com';
export const TEST_AEM_AUTHOR_URL = 'https://author.example.com';
export const TEST_URL_EXAMPLE_COM_CONTENT_DAM_IMAGES_PHOTO = 'https://example.com/content/dam/images/photo.jpg';

// Paths - Base Content DAM
export const TEST_PATH_CONTENT = '/content';
export const TEST_PATH_CONTENT_DAM = '/content/dam';
export const TEST_PATH_CONTENT_DAM_SLASH = '/content/dam/';
export const TEST_PATH_TEST = '/content/dam/test';
export const TEST_PATH_PARENT = '/content/dam/parent';
export const TEST_PATH_OTHER = '/other/path';
export const TEST_PATH_RELATIVE = 'content/dam/test';

// Paths - Generic Test Paths
export const TEST_PATH_BROKEN = '/content/dam/test/broken.jpg';
export const TEST_PATH_FIXED = '/content/dam/test/fixed.jpg';
export const TEST_PATH_TEST_IMAGE = '/content/dam/test/image.jpg';
export const TEST_PATH_TEST_BROKEN = '/content/dam/test/broken.jpg';
export const TEST_PATH_TEST_FIXED = '/content/dam/test/fixed.jpg';
export const TEST_PATH_TEST_MISSING = '/content/dam/test/missing.jpg';
export const TEST_PATH_TEST_DELETED = '/content/dam/test/deleted.jpg';
export const TEST_PATH_IMAGE = '/content/dam/test/image.jpg';
export const TEST_PATH_IMAGE_1 = '/content/dam/test/image1.jpg';
export const TEST_PATH_IMAGE_2 = '/content/dam/test/image2.jpg';
export const TEST_PATH_CHILD = '/content/dam/test/child';
export const TEST_PATH_CHILD_1 = '/content/dam/test/child1.jpg';
export const TEST_PATH_PARENT_CHILD = '/content/dam/parent/child.jpg';

// Paths - With Double Slashes
export const TEST_PATH_BROKEN_WITH_DOUBLE_SLASHES = '/content/dam//test/broken.jpg';
export const TEST_PATH_CONTENT_DAM_DOUBLE_SLASH_IMAGES_PHOTO = '/content/dam//images/photo.jpg';
export const TEST_PATH_CONTENT_DOUBLE_SLASH_DAM_IMAGES_PHOTO = '/content//dam/images/photo.jpg';
export const TEST_PATH_CONTENT_DAM_IMAGES_DOUBLE_SLASH_PHOTO = '/content/dam/images//photo.jpg';
export const TEST_PATH_CONTENT_DAM_TRIPLE_SLASH_IMAGES_PHOTO = '/content/dam///images/photo.jpg';
export const TEST_PATH_CONTENT_QUAD_SLASH_DAM_IMAGES_PHOTO = '/content////dam/images/photo.jpg';
export const TEST_PATH_SIX_SLASHES_CONTENT_DAM_IMAGES_PHOTO = '//////content/dam/images/photo.jpg';

// Paths - With Special Characters
export const TEST_PATH_TEST_IMAG = '/content/dam/test/imag.jpg';
export const TEST_PATH_TEST_PHOTO = '/content/dam/test/photo.jpg';
export const TEST_PATH_TEST_PHOTOS = '/content/dam/test/photos.jpg';
export const TEST_PATH_TEST_PUBLISHED_IMAGE = '/content/dam/test/published-image.jpg';
export const TEST_PATH_IMAGE_WITH_SPACES = '/content/dam/test/image with spaces.jpg';
export const TEST_PATH_EN_US_COMPLEX = '/content/dam/en-us/folder with spaces/sub-folder/image%20with%20encoding.jpg';
export const TEST_PATH_FOLDER_FILE = '/content/dam/folder/subfolder/file.jpg';

// Paths - Locale-specific (en-US, en-GB, fr-FR, de-DE)
export const TEST_PATH_EN_US = '/content/dam/en-us/test/broken.jpg';
export const TEST_PATH_EN_GB = '/content/dam/en-gb/test/broken.jpg';
export const TEST_PATH_FR_FR = '/content/dam/fr-fr/test/broken.jpg';
export const TEST_PATH_EN_US_TEST_IMAGE = '/content/dam/en-us/test/image.jpg';
export const TEST_PATH_FR_FR_TEST_IMAGE = '/content/dam/fr-fr/test/image.jpg';
export const TEST_PATH_DE_DE_TEST_IMAGE = '/content/dam/de-de/test/image.jpg';
export const TEST_PATH_CONTENT_DAM_EN_US = '/content/dam/en-US';
export const TEST_PATH_CONTENT_DAM_EN_US_SLASH = '/content/dam/en-US/';
export const TEST_PATH_CONTENT_DAM_EN_US_IMAGES = '/content/dam/en-US/images';
export const TEST_PATH_EN_US_IMAGES = '/content/dam/en-US/images';
export const TEST_PATH_CONTENT_DAM_EN_US_IMAGES_PHOTO = '/content/dam/en-US/images/photo.jpg';
export const TEST_PATH_EN_US_IMAGES_PHOTO = '/content/dam/en-US/images/photo.jpg';
export const TEST_PATH_EN_US_IMAGES_PHOTO_JPG = '/content/dam/en-US/images/photo.jpg';
export const TEST_PATH_EN_US_IMAGES_PHOTO_PNG = '/content/dam/en-US/images/photo.png';
export const TEST_PATH_EN_US_IMAGES_PHOTO1 = '/content/dam/en-US/images/photo1.jpg';
export const TEST_PATH_EN_US_IMAGES_PHOTO2 = '/content/dam/en-US/images/photo2.jpg';
export const TEST_PATH_EN_US_IMAGES_SUBFOLDER_PHOTO3 = '/content/dam/en-US/images/subfolder/photo3.jpg';
export const TEST_PATH_CONTENT_DAM_FR_IMAGES_PHOTO = '/content/dam/fr/images/photo.jpg';
export const TEST_PATH_CONTENT_DAM_FR_FR_IMAGES_PHOTO = '/content/dam/fr_FR/images/photo.jpg';
export const TEST_PATH_FR_FR_IMAGES_PHOTO = '/content/dam/fr-FR/images/photo.jpg';
export const TEST_PATH_FR_FR_IMAGES_PHOTO_JPG = '/content/dam/fr-FR/images/photo.jpg';
export const TEST_PATH_FR_FR_IMAGES_PHOTO1 = '/content/dam/fr-FR/images/photo1.jpg';
export const TEST_PATH_CONTENT_DAM_EN_US_US_IMAGES_PHOTO = '/content/dam/en-US/US/images/photo.jpg';
export const TEST_PATH_CONTENT_DAM_US_IMAGES_PHOTO = '/content/dam/US/images/photo.jpg';
export const TEST_PATH_DE_DE_IMAGES_PHOTO = '/content/dam/de-DE/images/photo.jpg';
export const TEST_PATH_DE_DE_IMAGES = '/content/dam/de-DE/images';
export const TEST_PATH_DE_DE = '/content/dam/de-DE';

// Paths - With Numeric Segments
export const TEST_PATH_CONTENT_DAM_123_IMAGES_PHOTO = '/content/dam/123/images/photo.jpg';
export const TEST_PATH_CONTENT_DAM_123_SLASH = '/content/dam/123/';

// Paths - Generic Images/Photos
export const TEST_PATH_CONTENT_DAM_IMAGES_PHOTO = '/content/dam/images/photo.jpg';
export const TEST_PATH_CONTENT_DAM_IMAGES_SLASH = '/content/dam/images/';

// Paths - Fragments
export const TEST_PATH_1 = '/content/dam/test/fragment1';
export const TEST_PATH_2 = '/content/dam/test/fragment2';
export const TEST_PATH_FRAGMENT = '/content/dam/fragment';
export const TEST_PATH_FRAGMENT1 = '/content/dam/fragment1';
export const TEST_PATH_FRAGMENT2 = '/content/dam/fragment2';
export const TEST_PATH_FRAGMENT3 = '/content/dam/fragment3';
export const TEST_PATH_FRAGMENT4 = '/content/dam/fragment4';
export const TEST_PATH_FRAGMENT5 = '/content/dam/fragment5';
export const TEST_PATH_ANOTHER_FRAGMENT = '/content/dam/another-fragment';
export const TEST_PATH_ANOTHER_FRAGMENT_2 = '/content/dam/test/another-fragment';
export const TEST_PATH_VALID_FRAGMENT = '/content/dam/test/valid-fragment';
export const TEST_PATH_BROKEN_1 = '/content/dam/test/broken1.jpg';
export const TEST_PATH_BROKEN_2 = '/content/dam/test/broken2.jpg';
export const TEST_PATH_BROKEN_3 = '/content/dam/test/broken3.jpg';
export const TEST_PATH_BROKEN_NO_EXT = '/content/dam/test/broken';
export const TEST_PATH_SUGGESTED = '/content/dam/test/suggested.jpg';
export const TEST_PATH_SUGGESTED_2 = '/content/dam/test/suggested2.jpg';
export const TEST_PATH_FIXED_1 = '/content/dam/test/fixed1.jpg';
export const TEST_SUGGESTED_PATH_1 = '/content/dam/test/fixed1';
export const TEST_OBJECT_FORMAT_PATH = '/content/dam/test/object-format';
export const TEST_STRING_FORMAT_PATH = '/content/dam/test/string-format';

// Paths - Assets/Files by Type
export const TEST_ASSET_PATH = '/content/dam/test/asset.jpg';
export const TEST_PATH_IMAGE_JPG = '/content/dam/image.jpg';
export const TEST_PATH_DOCUMENT_PDF = '/content/dam/document.pdf';
export const TEST_PATH_VIDEO_MP4 = '/content/dam/video.mp4';
export const TEST_PATH_FONT_WOFF = '/content/dam/font.woff';
export const TEST_PATH_ARCHIVE_ZIP = '/content/dam/archive.zip';
export const TEST_PATH_ANOTHER = '/content/dam/another';

// AEM Configuration
export const TEST_AEM_AUTHOR_TOKEN = 'test-token-123';
export const TEST_AEM_AUTHOR_TOKEN_ALT = 'token-123';
export const BEARER_PREFIX = 'Bearer ';
export const ACCEPT_JSON = 'application/json';
export const API_SITES_FRAGMENTS = '/adobe/sites/cf/fragments';
export const PROJECTION_MINIMAL = 'minimal';
export const HTTP_STATUS_NOT_FOUND = 404;
export const HTTP_STATUS_TEXT_NOT_FOUND = 'Not Found';
export const MAX_PAGES_VALUE = 10;
export const PAGINATION_DELAY_MS_VALUE = 100;
export const DELAY_MS_TEST = 50;
export const DELAY_TOLERANCE_MS = 45;
export const DELAY_ZERO = 0;
export const DELAY_THRESHOLD_MS = 10;

// AWS/Athena Configuration
export const TEST_DATABASE = 'test_database';
export const TEST_TABLE = 'test_table';
export const TEST_IMS_ORG = 'test-ims-org';
export const TEST_S3_BUCKET = 'test-raw-bucket';
export const TEST_DATABASE_NAME = 'test_db';
export const DEFAULT_DATABASE_NAME = 'cdn_logs_test';
export const DEFAULT_TABLE_NAME = 'content_fragment_404';
export const CUSTOM_BUCKET_NAME = 'custom-bucket';
export const CUSTOM_IMS_ORG = 'custom-ims';
export const S3_PATH_AGGREGATED_404 = 'aggregated-404';
export const S3_PATH_TEMP_ATHENA_RESULTS = 'temp/athena-results/';
export const TEST_SQL_RESULT = 'SELECT * FROM test_table;';
export const ATHENA_QUERY_PREFIX = '[Athena Query]';

// User Agents
export const TEST_USER_AGENT_1 = 'Mozilla/5.0';
export const TEST_USER_AGENT_2 = 'Chrome/91.0';
export const TEST_USER_AGENT_3 = 'Safari/14.0';
export const TEST_USER_AGENT_4 = 'Edge/90.0';
export const TEST_USER_AGENT_5 = 'Opera/80.0';

// Request Counts
export const REQUEST_COUNT_NONE = 0;
export const REQUEST_COUNT_TINY = 5;
export const REQUEST_COUNT_LOW_1 = 7;
export const REQUEST_COUNT_LOW_2 = 6;
export const REQUEST_COUNT_LOW_3 = 4;
export const REQUEST_COUNT_LOW_4 = 3;
export const REQUEST_COUNT_LOW_5 = 2;
export const REQUEST_COUNT_SMALL = 10;
export const REQUEST_COUNT_MEDIUM = 8;
export const REQUEST_COUNT_MID_1 = 9;
export const REQUEST_COUNT_MID_2 = 12;
export const REQUEST_COUNT_MID_3 = 15;
export const REQUEST_COUNT_LOW = 50;
export const REQUEST_COUNT_HIGH = 20;
export const REQUEST_COUNT_HIGH_1 = 25;
export const REQUEST_COUNT_HIGH_2 = 30;
export const REQUEST_COUNT_1 = 100;
export const REQUEST_COUNT_2 = 200;
export const USER_AGENT_COUNT_1 = 50;
export const USER_AGENT_COUNT_2 = 200;

// Dates and Date Components
export const TEST_YEAR = '2025';
export const TEST_MONTH = '01';
export const TEST_DAY = '15';
export const TEST_DAY_PREVIOUS = '14';
export const TEST_MONTH_MAR = '03';
export const TEST_DAY_5 = '05';
export const TEST_MONTH_DEC = '12';
export const TEST_DAY_25 = '25';
export const TEST_DAY_31 = '31';
export const TEST_DATE_2025_01_14 = new Date('2025-01-14T12:00:00.000Z');
export const TEST_DATE_2025_01_15 = new Date('2025-01-15T12:00:00.000Z');
export const TEST_DATE_2025_02_01 = new Date('2025-02-01T10:30:00Z');
export const TEST_DATE_2025_03_05 = new Date('2025-03-05T10:30:00Z');
export const TEST_DATE_2025_12_25 = new Date('2025-12-25T10:30:00Z');

// Status Values
export const STATUS_UNKNOWN = 'UNKNOWN';
export const STATUS_PUBLISHED = 'PUBLISHED';
export const STATUS_DRAFT = 'DRAFT';
export const SUGGESTION_TYPE_PUBLISH = 'PUBLISH';
export const SUGGESTION_TYPE_LOCALE = 'LOCALE';
export const SUGGESTION_TYPE_SIMILAR = 'SIMILAR';
export const SUGGESTION_TYPE_NOT_FOUND = 'NOT_FOUND';

// Locale Codes
export const LOCALE_CODE_EN_US = 'en-us';

// Error Messages
export const ERROR_AEM_CONNECTION_FAILED = 'AEM connection failed';

// Priorities
export const PRIORITY_HIGH = 1;
export const PRIORITY_MEDIUM = 2;
export const PRIORITY_LOW = 3;

// Expected Counts
export const EXPECTED_COUNT_ZERO = 0;
export const EXPECTED_EMPTY_COUNT = 0;
export const EXPECTED_COUNT_TWO = 2;
export const EXPECTED_COUNT_FOUR = 4;
export const EXPECTED_SUGGESTIONS_COUNT = 2;
export const EXPECTED_SINGLE_SUGGESTION_COUNT = 1;
export const EXPECTED_RULES_COUNT = 3;

// Levenshtein Distance Values
export const DISTANCE_SINGLE_CHAR = 1;
export const DISTANCE_TWO_CHARS = 2;
export const DISTANCE_THREE_CHARS = 3;
export const DISTANCE_FOUR_CHARS = 4;
export const STRING_LENGTH_HELLO = 5;
