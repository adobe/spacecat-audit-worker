#!/usr/bin/env node

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

import { createReadStream, createWriteStream } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import streamChain from 'stream-chain';
import streamJson from 'stream-json';
import StreamArray from 'stream-json/streamers/StreamArray.js';

const { chain } = streamChain;
const { parser } = streamJson;

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * TODO: Filter remaining entities by siteId, might require multiple passes
 */

// Entity types to exclude from the seed data
const EXCLUDED_ENTITY_TYPES = new Set([
  'Suggestion',
  'Audit',
  'TrialUserActivity',
  'OrganizationIdentityProvider',
  'Opportunity',
  'LatestAudit',
  'ScrapeJob',
  'FixEntity',
  'ImportJob',
  'PageIntent',
  'SiteCandidate',
  'Experiment',
  'KeyEvent',
  'FixEntitySuggestion',
  'SiteTopForm',
  'Report',
  'ApiKey',
  'TrialUser',
  'AsyncJob',
  'ScrapeUrl',
]);

/*
{
    "__edb_e__": {
        "S": "Configuration"
    },
    "version": {
        "N": "2142"
    },
    "versionString": {
        "S": "0000002142"
    },
    "gsi1sk": {
        "S": "$configuration_1#versionstring_0000002142"
    },
    "slackRoles": {
        "M": {
            "import": {
                "L": [
                    {
                        "S": "W4SGM7NGP"
                    },
                    {
                        "S": "W4RRU2BNE"
                    },
                    {
                        "S": "U049ELV3SD8"
                    },
                    {
                        "S": "W5MJH1GUX"
                    },
                    {
                        "S": "W4RRVN4Q2"
                    },
                    {
                        "S": "W4R4Z5HFA"
                    },
                    {
                        "S": "W4RUBR3NZ"
                    },
                    {
                        "S": "W623D8DE3"
                    },
                    {
                        "S": "WSVT1L36Z"
                    },
                    {
                        "S": "W0113Q3MJD9"
                    },
                    {
                        "S": "D07KDR9K4HK"
                    },
                    {
                        "S": "U0887HZRX97"
                    },
                    {
                        "S": "W4RUDAP9B"
                    }
                ]
            },
            "admin": {
                "L": [
                    {
                        "S": "W4SGM7NGP"
                    }
                ]
            },
            "scrape": {
                "L": [
                    {
                        "S": "W4SGM7NGP"
                    },
                    {
                        "S": "U03CR0FDC2V"
                    },
                    {
                        "S": "W0113Q3MJD9"
                    },
                    {
                        "S": "W4RU562TX"
                    },
                    {
                        "S": "W4RUDAP9B"
                    },
                    {
                        "S": "U0887HZRX97"
                    }
                ]
            }
        }
    },
    "jobs": {
        "L": [
            {
                "M": {
                    "type": {
                        "S": "rum-to-aa"
                    },
                    "interval": {
                        "S": "daily"
                    },
                    "group": {
                        "S": "imports"
                    }
                }
            },
            {
                "M": {
                    "type": {
                        "S": "experimentation-internal"
                    },
                    "interval": {
                        "S": "weekly"
                    },
                    "group": {
                        "S": "reports"
                    }
                }
            },
            {
                "M": {
                    "type": {
                        "S": "experimentation"
                    },
                    "interval": {
                        "S": "never"
                    },
                    "group": {
                        "S": "audits"
                    }
                }
            },
            {
                "M": {
                    "type": {
                        "S": "redirect-chains"
                    },
                    "interval": {
                        "S": "monthly"
                    },
                    "group": {
                        "S": "audits"
                    }
                }
            },
            {
                "M": {
                    "type": {
                        "S": "404"
                    },
                    "interval": {
                        "S": "every-sunday"
                    },
                    "group": {
                        "S": "audits"
                    }
                }
            },
            {
                "M": {
                    "type": {
                        "S": "lhs-mobile"
                    },
                    "interval": {
                        "S": "daily"
                    },
                    "group": {
                        "S": "audits"
                    }
                }
            },
            {
                "M": {
                    "type": {
                        "S": "lhs-desktop"
                    },
                    "interval": {
                        "S": "daily"
                    },
                    "group": {
                        "S": "audits"
                    }
                }
            },
            {
                "M": {
                    "type": {
                        "S": "top-pages"
                    },
                    "interval": {
                        "S": "every-saturday"
                    },
                    "group": {
                        "S": "imports"
                    }
                }
            },
            {
                "M": {
                    "type": {
                        "S": "top-forms"
                    },
                    "interval": {
                        "S": "every-saturday"
                    },
                    "group": {
                        "S": "imports"
                    }
                }
            },
            {
                "M": {
                    "type": {
                        "S": "organic-traffic"
                    },
                    "interval": {
                        "S": "weekly"
                    },
                    "group": {
                        "S": "imports"
                    }
                }
            },
            {
                "M": {
                    "type": {
                        "S": "all-traffic"
                    },
                    "interval": {
                        "S": "weekly"
                    },
                    "group": {
                        "S": "imports"
                    }
                }
            },
            {
                "M": {
                    "type": {
                        "S": "conversion"
                    },
                    "interval": {
                        "S": "every-sunday"
                    },
                    "group": {
                        "S": "audits"
                    }
                }
            },
            {
                "M": {
                    "type": {
                        "S": "conversion-internal"
                    },
                    "interval": {
                        "S": "weekly"
                    },
                    "group": {
                        "S": "reports"
                    }
                }
            },
            {
                "M": {
                    "type": {
                        "S": "broken-backlinks-internal"
                    },
                    "interval": {
                        "S": "weekly"
                    },
                    "group": {
                        "S": "reports"
                    }
                }
            },
            {
                "M": {
                    "type": {
                        "S": "broken-backlinks-external"
                    },
                    "interval": {
                        "S": "weekly"
                    },
                    "group": {
                        "S": "reports"
                    }
                }
            },
            {
                "M": {
                    "type": {
                        "S": "404-internal"
                    },
                    "interval": {
                        "S": "weekly"
                    },
                    "group": {
                        "S": "reports"
                    }
                }
            },
            {
                "M": {
                    "type": {
                        "S": "404-external"
                    },
                    "interval": {
                        "S": "weekly"
                    },
                    "group": {
                        "S": "reports"
                    }
                }
            },
            {
                "M": {
                    "type": {
                        "S": "apex-internal"
                    },
                    "interval": {
                        "S": "weekly"
                    },
                    "group": {
                        "S": "reports"
                    }
                }
            },
            {
                "M": {
                    "type": {
                        "S": "sitemap-internal"
                    },
                    "interval": {
                        "S": "monthly"
                    },
                    "group": {
                        "S": "reports"
                    }
                }
            },
            {
                "M": {
                    "type": {
                        "S": "costs"
                    },
                    "interval": {
                        "S": "weekly"
                    },
                    "group": {
                        "S": "audits"
                    }
                }
            },
            {
                "M": {
                    "type": {
                        "S": "sitemap"
                    },
                    "interval": {
                        "S": "every-sunday"
                    },
                    "group": {
                        "S": "audits"
                    }
                }
            },
            {
                "M": {
                    "type": {
                        "S": "organic-traffic-internal"
                    },
                    "interval": {
                        "S": "weekly"
                    },
                    "group": {
                        "S": "reports"
                    }
                }
            },
            {
                "M": {
                    "type": {
                        "S": "structured-data"
                    },
                    "interval": {
                        "S": "every-sunday"
                    },
                    "group": {
                        "S": "audits"
                    }
                }
            },
            {
                "M": {
                    "type": {
                        "S": "structured-data-internal"
                    },
                    "interval": {
                        "S": "weekly"
                    },
                    "group": {
                        "S": "reports"
                    }
                }
            },
            {
                "M": {
                    "type": {
                        "S": "cwv-internal"
                    },
                    "interval": {
                        "S": "weekly"
                    },
                    "group": {
                        "S": "reports"
                    }
                }
            },
            {
                "M": {
                    "type": {
                        "S": "cwv-external"
                    },
                    "interval": {
                        "S": "weekly"
                    },
                    "group": {
                        "S": "reports"
                    }
                }
            },
            {
                "M": {
                    "type": {
                        "S": "cwv"
                    },
                    "interval": {
                        "S": "every-sunday"
                    },
                    "group": {
                        "S": "audits"
                    }
                }
            },
            {
                "M": {
                    "type": {
                        "S": "broken-backlinks"
                    },
                    "interval": {
                        "S": "every-sunday"
                    },
                    "group": {
                        "S": "audits"
                    }
                }
            },
            {
                "M": {
                    "type": {
                        "S": "broken-internal-links"
                    },
                    "interval": {
                        "S": "every-sunday"
                    },
                    "group": {
                        "S": "audits"
                    }
                }
            },
            {
                "M": {
                    "type": {
                        "S": "broken-internal-links-internal"
                    },
                    "interval": {
                        "S": "weekly"
                    },
                    "group": {
                        "S": "reports"
                    }
                }
            },
            {
                "M": {
                    "type": {
                        "S": "broken-internal-links-external"
                    },
                    "interval": {
                        "S": "weekly"
                    },
                    "group": {
                        "S": "reports"
                    }
                }
            },
            {
                "M": {
                    "type": {
                        "S": "scrape-top-pages"
                    },
                    "interval": {
                        "S": "every-saturday"
                    },
                    "group": {
                        "S": "scrapes"
                    }
                }
            },
            {
                "M": {
                    "type": {
                        "S": "meta-tags"
                    },
                    "interval": {
                        "S": "fortnightly"
                    },
                    "group": {
                        "S": "audits"
                    }
                }
            },
            {
                "M": {
                    "type": {
                        "S": "meta-tags-internal"
                    },
                    "interval": {
                        "S": "fortnightly"
                    },
                    "group": {
                        "S": "reports"
                    }
                }
            },
            {
                "M": {
                    "type": {
                        "S": "experimentation-opportunities-internal"
                    },
                    "interval": {
                        "S": "weekly"
                    },
                    "group": {
                        "S": "reports"
                    }
                }
            },
            {
                "M": {
                    "type": {
                        "S": "experimentation-opportunities-external"
                    },
                    "interval": {
                        "S": "weekly"
                    },
                    "group": {
                        "S": "reports"
                    }
                }
            },
            {
                "M": {
                    "type": {
                        "S": "latest-metrics"
                    },
                    "interval": {
                        "S": "fortnightly-sunday"
                    },
                    "group": {
                        "S": "imports"
                    }
                }
            },
            {
                "M": {
                    "type": {
                        "S": "cwv-weekly"
                    },
                    "interval": {
                        "S": "every-saturday"
                    },
                    "group": {
                        "S": "imports"
                    }
                }
            },
            {
                "M": {
                    "type": {
                        "S": "cwv-daily"
                    },
                    "interval": {
                        "S": "daily"
                    },
                    "group": {
                        "S": "imports"
                    }
                }
            },
            {
                "M": {
                    "type": {
                        "S": "organic-keywords"
                    },
                    "interval": {
                        "S": "never"
                    },
                    "group": {
                        "S": "imports"
                    }
                }
            },
            {
                "M": {
                    "type": {
                        "S": "organic-keywords-nonbranded"
                    },
                    "interval": {
                        "S": "never"
                    },
                    "group": {
                        "S": "imports"
                    }
                }
            },
            {
                "M": {
                    "type": {
                        "S": "accessibility"
                    },
                    "interval": {
                        "S": "every-sunday"
                    },
                    "group": {
                        "S": "audits"
                    }
                }
            },
            {
                "M": {
                    "type": {
                        "S": "organic-keywords-ai-overview"
                    },
                    "interval": {
                        "S": "never"
                    },
                    "group": {
                        "S": "imports"
                    }
                }
            },
            {
                "M": {
                    "type": {
                        "S": "organic-keywords-feature-snippets"
                    },
                    "interval": {
                        "S": "never"
                    },
                    "group": {
                        "S": "imports"
                    }
                }
            },
            {
                "M": {
                    "type": {
                        "S": "organic-keywords-questions"
                    },
                    "interval": {
                        "S": "never"
                    },
                    "group": {
                        "S": "imports"
                    }
                }
            },
            {
                "M": {
                    "type": {
                        "S": "traffic-analysis"
                    },
                    "interval": {
                        "S": "weekly"
                    },
                    "group": {
                        "S": "imports"
                    }
                }
            },
            {
                "M": {
                    "type": {
                        "S": "cdn-analysis"
                    },
                    "interval": {
                        "S": "every-hour"
                    },
                    "group": {
                        "S": "audits"
                    }
                }
            },
            {
                "M": {
                    "type": {
                        "S": "cdn-logs-report"
                    },
                    "interval": {
                        "S": "never"
                    },
                    "group": {
                        "S": "audits"
                    }
                }
            },
            {
                "M": {
                    "type": {
                        "S": "llmo-prompts-ahrefs"
                    },
                    "interval": {
                        "S": "never"
                    },
                    "group": {
                        "S": "imports"
                    }
                }
            },
            {
                "M": {
                    "type": {
                        "S": "user-engagement"
                    },
                    "interval": {
                        "S": "weekly"
                    },
                    "group": {
                        "S": "imports"
                    }
                }
            },
            {
                "M": {
                    "type": {
                        "S": "security-csp"
                    },
                    "interval": {
                        "S": "never"
                    },
                    "group": {
                        "S": "audits"
                    }
                }
            },
            {
                "M": {
                    "type": {
                        "S": "security-permissions"
                    },
                    "interval": {
                        "S": "weekly"
                    },
                    "group": {
                        "S": "audits"
                    }
                }
            },
            {
                "M": {
                    "type": {
                        "S": "prerender"
                    },
                    "interval": {
                        "S": "weekly"
                    },
                    "group": {
                        "S": "audits"
                    }
                }
            },
            {
                "M": {
                    "type": {
                        "S": "security-permissions-redundant"
                    },
                    "interval": {
                        "S": "weekly"
                    },
                    "group": {
                        "S": "audits"
                    }
                }
            }
        ]
    },
    "createdAt": {
        "S": "2025-10-17T12:34:26.725Z"
    },
    "updatedBy": {
        "S": "system"
    },
    "configurationId": {
        "S": "50e609b2-5bfe-4aae-8810-3d57cb717bd0"
    },
    "handlers": {
        "M": {
            "404": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": false
                    },
                    "disabled": {
                        "M": {
                            "sites": {
                                "L": [
                                    {
                                        "S": "7be95fa1-e532-410c-b6f8-6584ca92ac09"
                                    },
                                    {
                                        "S": "7f1cc65a-b16b-4986-b564-86c4b1190e55"
                                    }
                                ]
                            }
                        }
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    },
                    "enabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    }
                }
            },
            "broken-internal-links-auto-suggest": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": false
                    },
                    "disabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    },
                    "enabled": {
                        "M": {
                            "sites": {
                                "L": [
                                    {
                                        "S": "c236a20b-c879-4960-b5b2-c0b607ade100"
                                    },
                                    {
                                        "S": "d04f59a7-3962-40fa-99eb-bf47faa95026"
                                    },
                                    {
                                        "S": "36e4848b-d6e5-4350-a7f9-610e78325966"
                                    },
                                    {
                                        "S": "d1a5d531-8c3a-42a0-a39a-e7f4a72f4015"
                                    },
                                    {
                                        "S": "97bff092-e8c6-4fbb-825f-e199dadf65d1"
                                    },
                                    {
                                        "S": "0f889afa-270c-46b1-b831-425818c3fdd4"
                                    },
                                    {
                                        "S": "87ef8777-ef4b-4ddc-b399-47b65083b5fd"
                                    },
                                    {
                                        "S": "9c1c5fdc-de7a-42e7-8d76-97df716112f0"
                                    },
                                    {
                                        "S": "9d57757b-eae0-4011-a030-3367465bcb27"
                                    },
                                    {
                                        "S": "09a7c782-04ad-49b5-98cf-77fb75480d9f"
                                    },
                                    {
                                        "S": "b80f894b-032a-4724-b613-65cd6d40b80b"
                                    },
                                    {
                                        "S": "96f21bbd-ae3f-49fd-87f3-765862ef4abc"
                                    },
                                    {
                                        "S": "bce7f685-de5a-4a33-92eb-3c37064dac87"
                                    },
                                    {
                                        "S": "15d1546d-6284-41be-86af-2c1c722f93b1"
                                    },
                                    {
                                        "S": "542ad116-ed33-448a-a123-06cbcd7c1d4c"
                                    },
                                    {
                                        "S": "a4762196-7696-4fb8-b61f-446516650cb8"
                                    },
                                    {
                                        "S": "56c36c3f-9a39-4d90-ab17-f02b01462a86"
                                    },
                                    {
                                        "S": "7cd6cfd5-6960-4c36-a63a-e03a313faefc"
                                    },
                                    {
                                        "S": "6a688c0a-9dab-474c-979d-23e303312c78"
                                    },
                                    {
                                        "S": "81bd3248-f491-4721-a1ca-4cbca8c96442"
                                    },
                                    {
                                        "S": "ceb71f84-610b-4ecb-818e-989117dff0a7"
                                    },
                                    {
                                        "S": "eb386962-6997-4ab2-ad30-845797dd1686"
                                    },
                                    {
                                        "S": "a9806a61-432c-489f-9899-660d0b017259"
                                    },
                                    {
                                        "S": "d041ebe2-9a96-4e1e-8d66-be878022c137"
                                    },
                                    {
                                        "S": "5a377a31-b6c3-411c-8b00-62d7e1b116ac"
                                    },
                                    {
                                        "S": "61ef5d03-2505-41d6-b7b2-c6dd01c9deb9"
                                    },
                                    {
                                        "S": "f23eaa14-2069-47ff-b136-e6330788e7a9"
                                    },
                                    {
                                        "S": "59579bb7-7c96-41c2-9159-d6cded5733cd"
                                    },
                                    {
                                        "S": "cccdac43-1a22-4659-9086-b762f59b9928"
                                    },
                                    {
                                        "S": "d2960efd-a226-4b15-b5ec-b64ccb99995e"
                                    },
                                    {
                                        "S": "19bc527d-bfba-41da-85a9-fe38edab915d"
                                    },
                                    {
                                        "S": "1f6023e7-b7df-404f-9cb9-636178381c93"
                                    },
                                    {
                                        "S": "22906986-7e08-4dc4-97f2-4e24bf7e000a"
                                    },
                                    {
                                        "S": "02bd0de2-f8f5-49ed-905d-0e75153ef85a"
                                    },
                                    {
                                        "S": "c2473d89-e997-458d-a86d-b4096649c12b"
                                    },
                                    {
                                        "S": "ffaddb3a-e4ea-4bf2-b04a-13163a3b6b1f"
                                    },
                                    {
                                        "S": "d4262fc6-ef6c-4c8b-924f-925a13f95dde"
                                    },
                                    {
                                        "S": "1b6c0d1d-30a3-4003-b591-10d95eb4019f"
                                    },
                                    {
                                        "S": "9e9749f7-e039-45e3-9227-04275ad25018"
                                    },
                                    {
                                        "S": "569df81c-5a1e-4792-9b68-a0ad5a6d3868"
                                    },
                                    {
                                        "S": "30489f91-98b3-46ef-ac97-6e9b42dc8d95"
                                    },
                                    {
                                        "S": "dd141e74-8e84-470c-953a-0ae6e755d81d"
                                    },
                                    {
                                        "S": "5e69a3c8-324e-40f7-97da-5f22084c8093"
                                    },
                                    {
                                        "S": "c05aad78-c002-4207-b136-47e31ca14e89"
                                    },
                                    {
                                        "S": "50f36cc0-56e4-4d26-8017-1c2f552f32fb"
                                    },
                                    {
                                        "S": "246227b9-54ae-49a8-808d-1e9caf4fb537"
                                    },
                                    {
                                        "S": "b6e60877-4ea6-46d4-b1c7-605202048160"
                                    },
                                    {
                                        "S": "6a6005b1-15fe-4ce3-853e-815942e225b1"
                                    },
                                    {
                                        "S": "95bbd0b8-7617-48e2-9292-57c3e4f85cbd"
                                    },
                                    {
                                        "S": "13027b3c-579c-4506-995d-032170b68b32"
                                    },
                                    {
                                        "S": "f7128a8b-e62e-478e-ad97-c112fe030f89"
                                    },
                                    {
                                        "S": "5c784c7d-dd21-4ef5-9986-0451198681b9"
                                    },
                                    {
                                        "S": "776c8ec5-4518-4c91-84f8-f22442680efa"
                                    },
                                    {
                                        "S": "7f2c624b-9267-4624-b798-c10178e96ab3"
                                    },
                                    {
                                        "S": "e807f72e-c2b7-4cd1-a010-a2b1f15f7ee1"
                                    }
                                ]
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    }
                }
            },
            "experimentation-ess-all": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": false
                    },
                    "disabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    },
                    "enabled": {
                        "M": {
                            "sites": {
                                "L": [
                                    {
                                        "S": "36e4848b-d6e5-4350-a7f9-610e78325966"
                                    },
                                    {
                                        "S": "193649cd-2a34-4b2e-9b33-2ba129884aae"
                                    },
                                    {
                                        "S": "97eea6f3-497c-4f9e-86db-7848b6a7db77"
                                    },
                                    {
                                        "S": "03406b43-ed10-478b-a932-179ad93a8764"
                                    },
                                    {
                                        "S": "1b4d53f2-b614-4ab3-8a1b-f74c9d5c4299"
                                    }
                                ]
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    }
                }
            },
            "lhs-mobile-internal": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": true
                    },
                    "disabled": {
                        "M": {
                            "sites": {
                                "L": [
                                    {
                                        "S": "5ccded7f-3ca8-4e7f-aef2-7887bf21afc6"
                                    }
                                ]
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    },
                    "enabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    }
                }
            },
            "redirect-chains": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": false
                    },
                    "disabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    },
                    "enabled": {
                        "M": {
                            "sites": {
                                "L": [
                                    {
                                        "S": "d1a5d531-8c3a-42a0-a39a-e7f4a72f4015"
                                    },
                                    {
                                        "S": "87ef8777-ef4b-4ddc-b399-47b65083b5fd"
                                    },
                                    {
                                        "S": "cccdac43-1a22-4659-9086-b762f59b9928"
                                    },
                                    {
                                        "S": "5824344d-fa1a-4b3f-8eb6-a6c6a3cff646"
                                    },
                                    {
                                        "S": "221ce671-7010-43aa-b9df-08d639b66326"
                                    },
                                    {
                                        "S": "7f2c624b-9267-4624-b798-c10178e96ab3"
                                    },
                                    {
                                        "S": "776c8ec5-4518-4c91-84f8-f22442680efa"
                                    },
                                    {
                                        "S": "81bd3248-f491-4721-a1ca-4cbca8c96442"
                                    },
                                    {
                                        "S": "e807f72e-c2b7-4cd1-a010-a2b1f15f7ee1"
                                    },
                                    {
                                        "S": "12d54932-e963-4783-aac3-4b1edbc27cde"
                                    }
                                ]
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    }
                }
            },
            "apex-internal": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": true
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    }
                }
            },
            "accessibility": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": false
                    },
                    "disabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    },
                    "enabled": {
                        "M": {
                            "sites": {
                                "L": [
                                    {
                                        "S": "36e4848b-d6e5-4350-a7f9-610e78325966"
                                    },
                                    {
                                        "S": "87ef8777-ef4b-4ddc-b399-47b65083b5fd"
                                    },
                                    {
                                        "S": "d2960efd-a226-4b15-b5ec-b64ccb99995e"
                                    },
                                    {
                                        "S": "c2e9e9d6-826d-4257-9fde-f68b69b0b023"
                                    },
                                    {
                                        "S": "a4762196-7696-4fb8-b61f-446516650cb8"
                                    },
                                    {
                                        "S": "d1a5d531-8c3a-42a0-a39a-e7f4a72f4015"
                                    },
                                    {
                                        "S": "dc2428a3-70e9-438d-9de4-de3a4e751f12"
                                    },
                                    {
                                        "S": "246227b9-54ae-49a8-808d-1e9caf4fb537"
                                    },
                                    {
                                        "S": "f35ffe86-4d9b-4c13-a20b-9e6fc6231ead"
                                    },
                                    {
                                        "S": "0ceeef1f-c56e-4c31-b8d3-55af6b9509c7"
                                    },
                                    {
                                        "S": "542ad116-ed33-448a-a123-06cbcd7c1d4c"
                                    },
                                    {
                                        "S": "12d54932-e963-4783-aac3-4b1edbc27cde"
                                    },
                                    {
                                        "S": "c236a20b-c879-4960-b5b2-c0b607ade100"
                                    },
                                    {
                                        "S": "ff51d86f-4d7b-4601-a792-9eef58779717"
                                    },
                                    {
                                        "S": "0f889afa-270c-46b1-b831-425818c3fdd4"
                                    },
                                    {
                                        "S": "bbdc5699-28fa-48d9-ac8e-5cf1c8eb4b71"
                                    },
                                    {
                                        "S": "12552d40-a3ae-46da-9a17-b99b0e5bc0dc"
                                    },
                                    {
                                        "S": "50f36cc0-56e4-4d26-8017-1c2f552f32fb"
                                    },
                                    {
                                        "S": "15d1546d-6284-41be-86af-2c1c722f93b1"
                                    },
                                    {
                                        "S": "97bff092-e8c6-4fbb-825f-e199dadf65d1"
                                    },
                                    {
                                        "S": "c7a4eae4-4fbe-4e4f-9c89-3d4085d179c6"
                                    },
                                    {
                                        "S": "0c32fd58-de1d-48d1-acb4-74b98642fd7d"
                                    },
                                    {
                                        "S": "11d4b4a2-8849-4b72-93f1-b2136ac44662"
                                    },
                                    {
                                        "S": "49fcf0af-ef57-42ce-9d06-e0736caabea6"
                                    },
                                    {
                                        "S": "12d892c5-779d-409f-b16b-56fba9304204"
                                    },
                                    {
                                        "S": "3f0a2fc2-ba3f-4153-acb8-73bdcae14392"
                                    },
                                    {
                                        "S": "19d61aaa-09bd-430d-9d4e-e17bc3b9b5ba"
                                    },
                                    {
                                        "S": "81bd3248-f491-4721-a1ca-4cbca8c96442"
                                    },
                                    {
                                        "S": "e807f72e-c2b7-4cd1-a010-a2b1f15f7ee1"
                                    },
                                    {
                                        "S": "cccdac43-1a22-4659-9086-b762f59b9928"
                                    }
                                ]
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    }
                }
            },
            "llm-error-pages": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": false
                    },
                    "disabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    },
                    "enabled": {
                        "M": {
                            "sites": {
                                "L": [
                                    {
                                        "S": "c236a20b-c879-4960-b5b2-c0b607ade100"
                                    },
                                    {
                                        "S": "cccdac43-1a22-4659-9086-b762f59b9928"
                                    },
                                    {
                                        "S": "c2473d89-e997-458d-a86d-b4096649c12b"
                                    },
                                    {
                                        "S": "2c735382-0497-42a6-a435-1efa7d75921c"
                                    },
                                    {
                                        "S": "028147f6-4a7a-4325-a758-376c460a559c"
                                    },
                                    {
                                        "S": "12d54932-e963-4783-aac3-4b1edbc27cde"
                                    },
                                    {
                                        "S": "38fbd289-03df-4f34-80ea-9333d4e4d6d7"
                                    }
                                ]
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    }
                }
            },
            "lhs-mobile": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": true
                    },
                    "disabled": {
                        "M": {
                            "sites": {
                                "L": [
                                    {
                                        "S": "7f1cc65a-b16b-4986-b564-86c4b1190e55"
                                    }
                                ]
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    },
                    "enabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    }
                }
            },
            "security-vulnerabilities-auto-fix": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": false
                    },
                    "disabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    },
                    "enabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    }
                }
            },
            "apex": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": true
                    },
                    "disabled": {
                        "M": {
                            "sites": {
                                "L": [
                                    {
                                        "S": "7be95fa1-e532-410c-b6f8-6584ca92ac09"
                                    },
                                    {
                                        "S": "f7128a8b-e62e-478e-ad97-c112fe030f89"
                                    }
                                ]
                            }
                        }
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    },
                    "enabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    }
                }
            },
            "broken-backlinks-internal": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": true
                    },
                    "disabled": {
                        "M": {
                            "sites": {
                                "L": [
                                    {
                                        "S": "97eea6f3-497c-4f9e-86db-7848b6a7db77"
                                    }
                                ]
                            }
                        }
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    }
                }
            },
            "experimentation-opportunities-external": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": false
                    },
                    "enabled": {
                        "M": {
                            "sites": {
                                "L": [
                                    {
                                        "S": "c2473d89-e997-458d-a86d-b4096649c12b"
                                    }
                                ]
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    }
                }
            },
            "llmo-customer-analysis": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": false
                    },
                    "disabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    },
                    "enabled": {
                        "M": {
                            "sites": {
                                "L": [
                                    {
                                        "S": "c236a20b-c879-4960-b5b2-c0b607ade100"
                                    },
                                    {
                                        "S": "34f30d1f-2665-4401-b243-40e1afc02307"
                                    },
                                    {
                                        "S": "12d54932-e963-4783-aac3-4b1edbc27cde"
                                    },
                                    {
                                        "S": "2c735382-0497-42a6-a435-1efa7d75921c"
                                    },
                                    {
                                        "S": "9ba371e5-ed92-4a5a-a8cf-15a2989704b7"
                                    },
                                    {
                                        "S": "1ed6fb38-1f95-4e3c-ac9c-c0bdcdbde8da"
                                    },
                                    {
                                        "S": "1eedc2f0-5b30-4e87-8d5e-7e87efd62c2d"
                                    },
                                    {
                                        "S": "cccdac43-1a22-4659-9086-b762f59b9928"
                                    },
                                    {
                                        "S": "36e4848b-d6e5-4350-a7f9-610e78325966"
                                    },
                                    {
                                        "S": "bb961426-c338-45d6-bae3-2b8701a62826"
                                    },
                                    {
                                        "S": "f35ffe86-4d9b-4c13-a20b-9e6fc6231ead"
                                    },
                                    {
                                        "S": "19d61aaa-09bd-430d-9d4e-e17bc3b9b5ba"
                                    },
                                    {
                                        "S": "f753f464-53ba-4c04-82a0-c0271808e1f5"
                                    },
                                    {
                                        "S": "415b4ae8-e6f8-4be7-a5c8-76605c1cad56"
                                    },
                                    {
                                        "S": "1b7592da-da6f-4efe-a702-a70442f87155"
                                    },
                                    {
                                        "S": "3f5c649c-3666-4171-9cc5-50511b669362"
                                    },
                                    {
                                        "S": "822e1ffb-9313-4188-bb44-3d2cc52b3c3d"
                                    },
                                    {
                                        "S": "4560c5a1-c2b8-4188-b2d3-330886ef90bc"
                                    },
                                    {
                                        "S": "408cd1be-d781-429d-a360-09943ed9d705"
                                    },
                                    {
                                        "S": "b5e1885d-bd39-45c6-a39f-f0c478f820d5"
                                    },
                                    {
                                        "S": "ff7b3145-541f-43fc-96a3-187b6ba9336f"
                                    },
                                    {
                                        "S": "9b5b02d3-9e01-49af-bb7f-1a4c9faf6729"
                                    },
                                    {
                                        "S": "db8e44df-8a4d-4f0f-b049-3315ff6afbdc"
                                    },
                                    {
                                        "S": "6bd5cad1-9000-4fd5-8fc6-d232b34325f7"
                                    },
                                    {
                                        "S": "e54754be-9217-4fb6-8937-48337b22e8b5"
                                    },
                                    {
                                        "S": "eb39e797-ab5e-496a-95ee-469499c8867a"
                                    }
                                ]
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    }
                }
            },
            "cwv-auto-suggest": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": false
                    },
                    "disabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    },
                    "enabled": {
                        "M": {
                            "sites": {
                                "L": [
                                    {
                                        "S": "f4acd9af-c9d8-4fd6-926f-618a4733da71"
                                    },
                                    {
                                        "S": "9ab0575a-c238-4470-ae82-9d37fb2d0e78"
                                    },
                                    {
                                        "S": "ad3d5bb7-9e85-4195-94e8-833cc5a73253"
                                    }
                                ]
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    }
                }
            },
            "alt-text-auto-suggest-mystique": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": false
                    },
                    "disabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    },
                    "enabled": {
                        "M": {
                            "sites": {
                                "L": [
                                    {
                                        "S": "36e4848b-d6e5-4350-a7f9-610e78325966"
                                    },
                                    {
                                        "S": "0b466e25-a71a-43ce-b970-15312bef9402"
                                    },
                                    {
                                        "S": "5de1b8ad-a687-46f9-87ac-a1bd7d5c04cf"
                                    },
                                    {
                                        "S": "7a13fe74-d721-4b7e-9464-2c1fadc4f821"
                                    },
                                    {
                                        "S": "bbdc5699-28fa-48d9-ac8e-5cf1c8eb4b71"
                                    },
                                    {
                                        "S": "c236a20b-c879-4960-b5b2-c0b607ade100"
                                    },
                                    {
                                        "S": "542ad116-ed33-448a-a123-06cbcd7c1d4c"
                                    }
                                ]
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    }
                }
            },
            "customer-analysis": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": false
                    },
                    "disabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    },
                    "enabled": {
                        "M": {
                            "sites": {
                                "L": [
                                    {
                                        "S": "cccdac43-1a22-4659-9086-b762f59b9928"
                                    },
                                    {
                                        "S": "d1a5d531-8c3a-42a0-a39a-e7f4a72f4015"
                                    },
                                    {
                                        "S": "c236a20b-c879-4960-b5b2-c0b607ade100"
                                    }
                                ]
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    }
                }
            },
            "faqs": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": false
                    },
                    "disabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    },
                    "enabled": {
                        "M": {
                            "sites": {
                                "L": [
                                    {
                                        "S": "c236a20b-c879-4960-b5b2-c0b607ade100"
                                    },
                                    {
                                        "S": "cccdac43-1a22-4659-9086-b762f59b9928"
                                    },
                                    {
                                        "S": "c2473d89-e997-458d-a86d-b4096649c12b"
                                    },
                                    {
                                        "S": "2c735382-0497-42a6-a435-1efa7d75921c"
                                    },
                                    {
                                        "S": "028147f6-4a7a-4325-a758-376c460a559c"
                                    },
                                    {
                                        "S": "12d54932-e963-4783-aac3-4b1edbc27cde"
                                    },
                                    {
                                        "S": "38fbd289-03df-4f34-80ea-9333d4e4d6d7"
                                    }
                                ]
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "dependencies": {
                        "L": [
                            {
                                "M": {
                                    "handler": {
                                        "S": "geo-brand-presence"
                                    }
                                }
                            }
                        ]
                    }
                }
            },
            "high-organic-low-ctr-auto-fix": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": false
                    },
                    "disabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    },
                    "enabled": {
                        "M": {
                            "sites": {
                                "L": [
                                    {
                                        "S": "bdcc12b0-112b-4416-95b1-004cc3c1209c"
                                    },
                                    {
                                        "S": "b69e9bef-0c6f-4ba5-9921-8b3ae44edf59"
                                    },
                                    {
                                        "S": "706369ba-d362-4772-9fd9-1dcf5581db33"
                                    }
                                ]
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    }
                }
            },
            "accessibility-preflight": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": true
                    },
                    "disabled": {
                        "M": {
                            "sites": {
                                "L": [
                                    {
                                        "S": "dc2428a3-70e9-438d-9de4-de3a4e751f12"
                                    },
                                    {
                                        "S": "f998740e-5cee-416c-b5ea-cb3aca01c52f"
                                    }
                                ]
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    },
                    "enabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    }
                }
            },
            "meta-tags-internal": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": false
                    },
                    "enabled": {
                        "M": {
                            "sites": {
                                "L": [
                                    {
                                        "S": "cccdac43-1a22-4659-9086-b762f59b9928"
                                    },
                                    {
                                        "S": "d04f59a7-3962-40fa-99eb-bf47faa95026"
                                    },
                                    {
                                        "S": "0c3a59b1-16a6-4bf1-9fae-8b332723a28e"
                                    },
                                    {
                                        "S": "26b8cc63-bcc2-4ecb-81b2-58b7420cd8a3"
                                    }
                                ]
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    }
                }
            },
            "experimentation-internal": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": true
                    },
                    "disabled": {
                        "M": {
                            "sites": {
                                "L": [
                                    {
                                        "S": "7be95fa1-e532-410c-b6f8-6584ca92ac09"
                                    }
                                ]
                            }
                        }
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    }
                }
            },
            "headings": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": true
                    },
                    "disabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    },
                    "enabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    }
                }
            },
            "experimentation-opportunities": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": false
                    },
                    "disabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    },
                    "enabled": {
                        "M": {
                            "sites": {
                                "L": [
                                    {
                                        "S": "97eea6f3-497c-4f9e-86db-7848b6a7db77"
                                    },
                                    {
                                        "S": "c81ff7c9-cea3-4cba-9438-6d62d26d160f"
                                    },
                                    {
                                        "S": "36e4848b-d6e5-4350-a7f9-610e78325966"
                                    },
                                    {
                                        "S": "193649cd-2a34-4b2e-9b33-2ba129884aae"
                                    },
                                    {
                                        "S": "916e7978-0375-4b8f-a5bd-75d88113b10f"
                                    },
                                    {
                                        "S": "c2473d89-e997-458d-a86d-b4096649c12b"
                                    },
                                    {
                                        "S": "5a377a31-b6c3-411c-8b00-62d7e1b116ac"
                                    },
                                    {
                                        "S": "d04f59a7-3962-40fa-99eb-bf47faa95026"
                                    },
                                    {
                                        "S": "12d892c5-779d-409f-b16b-56fba9304204"
                                    },
                                    {
                                        "S": "cccdac43-1a22-4659-9086-b762f59b9928"
                                    },
                                    {
                                        "S": "9ab0575a-c238-4470-ae82-9d37fb2d0e78"
                                    },
                                    {
                                        "S": "c236a20b-c879-4960-b5b2-c0b607ade100"
                                    },
                                    {
                                        "S": "eb520448-0b9a-4d3c-a573-acfb4c97c11d"
                                    },
                                    {
                                        "S": "0f889afa-270c-46b1-b831-425818c3fdd4"
                                    },
                                    {
                                        "S": "72ce473e-ff0d-428b-bfd4-856d652639ee"
                                    },
                                    {
                                        "S": "52322a41-d11d-4e08-85fc-6eaf31b0741c"
                                    },
                                    {
                                        "S": "97bff092-e8c6-4fbb-825f-e199dadf65d1"
                                    },
                                    {
                                        "S": "02bd0de2-f8f5-49ed-905d-0e75153ef85a"
                                    },
                                    {
                                        "S": "7f1cc65a-b16b-4986-b564-86c4b1190e55"
                                    },
                                    {
                                        "S": "246227b9-54ae-49a8-808d-1e9caf4fb537"
                                    },
                                    {
                                        "S": "103cabfc-7fd9-4469-a55f-3c991f3fb2bd"
                                    },
                                    {
                                        "S": "30489f91-98b3-46ef-ac97-6e9b42dc8d95"
                                    },
                                    {
                                        "S": "569df81c-5a1e-4792-9b68-a0ad5a6d3868"
                                    },
                                    {
                                        "S": "5c784c7d-dd21-4ef5-9986-0451198681b9"
                                    },
                                    {
                                        "S": "bdcc12b0-112b-4416-95b1-004cc3c1209c"
                                    },
                                    {
                                        "S": "ff51d86f-4d7b-4601-a792-9eef58779717"
                                    },
                                    {
                                        "S": "6fdcadaf-04e1-4411-aeeb-daa146df44d7"
                                    },
                                    {
                                        "S": "542ad116-ed33-448a-a123-06cbcd7c1d4c"
                                    },
                                    {
                                        "S": "f7128a8b-e62e-478e-ad97-c112fe030f89"
                                    },
                                    {
                                        "S": "bea22317-d986-4c3a-9da7-c32f3d5509bb"
                                    },
                                    {
                                        "S": "776c8ec5-4518-4c91-84f8-f22442680efa"
                                    },
                                    {
                                        "S": "7f2c624b-9267-4624-b798-c10178e96ab3"
                                    },
                                    {
                                        "S": "81bd3248-f491-4721-a1ca-4cbca8c96442"
                                    },
                                    {
                                        "S": "e807f72e-c2b7-4cd1-a010-a2b1f15f7ee1"
                                    },
                                    {
                                        "S": "03406b43-ed10-478b-a932-179ad93a8764"
                                    }
                                ]
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    }
                }
            },
            "broken-backlinks": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": false
                    },
                    "disabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    },
                    "enabled": {
                        "M": {
                            "sites": {
                                "L": [
                                    {
                                        "S": "7be95fa1-e532-410c-b6f8-6584ca92ac09"
                                    },
                                    {
                                        "S": "193649cd-2a34-4b2e-9b33-2ba129884aae"
                                    },
                                    {
                                        "S": "36e4848b-d6e5-4350-a7f9-610e78325966"
                                    },
                                    {
                                        "S": "103cabfc-7fd9-4469-a55f-3c991f3fb2bd"
                                    },
                                    {
                                        "S": "d04f59a7-3962-40fa-99eb-bf47faa95026"
                                    },
                                    {
                                        "S": "d5605edb-d3ef-4b0e-801f-322edb2eeeab"
                                    },
                                    {
                                        "S": "9ab0575a-c238-4470-ae82-9d37fb2d0e78"
                                    },
                                    {
                                        "S": "044ea848-2c33-4d12-be75-bcc6c4461dba"
                                    },
                                    {
                                        "S": "97eea6f3-497c-4f9e-86db-7848b6a7db77"
                                    },
                                    {
                                        "S": "542ad116-ed33-448a-a123-06cbcd7c1d4c"
                                    },
                                    {
                                        "S": "5a377a31-b6c3-411c-8b00-62d7e1b116ac"
                                    },
                                    {
                                        "S": "12d892c5-779d-409f-b16b-56fba9304204"
                                    },
                                    {
                                        "S": "cccdac43-1a22-4659-9086-b762f59b9928"
                                    },
                                    {
                                        "S": "c2473d89-e997-458d-a86d-b4096649c12b"
                                    },
                                    {
                                        "S": "ba2010ef-ac81-475c-89e1-3628bae31d28"
                                    },
                                    {
                                        "S": "12d54932-e963-4783-aac3-4b1edbc27cde"
                                    },
                                    {
                                        "S": "cd31ac1d-b836-4883-bf68-775be68597ef"
                                    },
                                    {
                                        "S": "d1a5d531-8c3a-42a0-a39a-e7f4a72f4015"
                                    },
                                    {
                                        "S": "0f889afa-270c-46b1-b831-425818c3fdd4"
                                    },
                                    {
                                        "S": "87ef8777-ef4b-4ddc-b399-47b65083b5fd"
                                    },
                                    {
                                        "S": "97bff092-e8c6-4fbb-825f-e199dadf65d1"
                                    },
                                    {
                                        "S": "9c1c5fdc-de7a-42e7-8d76-97df716112f0"
                                    },
                                    {
                                        "S": "c236a20b-c879-4960-b5b2-c0b607ade100"
                                    },
                                    {
                                        "S": "9d57757b-eae0-4011-a030-3367465bcb27"
                                    },
                                    {
                                        "S": "09a7c782-04ad-49b5-98cf-77fb75480d9f"
                                    },
                                    {
                                        "S": "b80f894b-032a-4724-b613-65cd6d40b80b"
                                    },
                                    {
                                        "S": "96f21bbd-ae3f-49fd-87f3-765862ef4abc"
                                    },
                                    {
                                        "S": "bce7f685-de5a-4a33-92eb-3c37064dac87"
                                    },
                                    {
                                        "S": "5d6acebd-802a-4f50-875f-23ad6788c46a"
                                    },
                                    {
                                        "S": "15d1546d-6284-41be-86af-2c1c722f93b1"
                                    },
                                    {
                                        "S": "a4762196-7696-4fb8-b61f-446516650cb8"
                                    },
                                    {
                                        "S": "56c36c3f-9a39-4d90-ab17-f02b01462a86"
                                    },
                                    {
                                        "S": "7cd6cfd5-6960-4c36-a63a-e03a313faefc"
                                    },
                                    {
                                        "S": "6a688c0a-9dab-474c-979d-23e303312c78"
                                    },
                                    {
                                        "S": "81bd3248-f491-4721-a1ca-4cbca8c96442"
                                    },
                                    {
                                        "S": "ceb71f84-610b-4ecb-818e-989117dff0a7"
                                    },
                                    {
                                        "S": "eb386962-6997-4ab2-ad30-845797dd1686"
                                    },
                                    {
                                        "S": "a9806a61-432c-489f-9899-660d0b017259"
                                    },
                                    {
                                        "S": "d041ebe2-9a96-4e1e-8d66-be878022c137"
                                    },
                                    {
                                        "S": "95883131-a97c-43ab-9a39-7ae98ab0f70d"
                                    },
                                    {
                                        "S": "40f377b0-2242-41d6-b215-e9ff8ace8b3d"
                                    },
                                    {
                                        "S": "eb520448-0b9a-4d3c-a573-acfb4c97c11d"
                                    },
                                    {
                                        "S": "61ef5d03-2505-41d6-b7b2-c6dd01c9deb9"
                                    },
                                    {
                                        "S": "f23eaa14-2069-47ff-b136-e6330788e7a9"
                                    },
                                    {
                                        "S": "d2960efd-a226-4b15-b5ec-b64ccb99995e"
                                    },
                                    {
                                        "S": "5ea9f41b-3a2e-4a39-876a-d1f76a7d0fb0"
                                    },
                                    {
                                        "S": "1f6023e7-b7df-404f-9cb9-636178381c93"
                                    },
                                    {
                                        "S": "22906986-7e08-4dc4-97f2-4e24bf7e000a"
                                    },
                                    {
                                        "S": "ffaddb3a-e4ea-4bf2-b04a-13163a3b6b1f"
                                    },
                                    {
                                        "S": "eede5a3e-5525-4cfb-86d5-43fff8881929"
                                    },
                                    {
                                        "S": "d4262fc6-ef6c-4c8b-924f-925a13f95dde"
                                    },
                                    {
                                        "S": "5b6afa2b-cc29-4459-b767-2ad8f04f45c3"
                                    },
                                    {
                                        "S": "78d91201-157d-41a8-a9ca-720e6318cbd8"
                                    },
                                    {
                                        "S": "1b6c0d1d-30a3-4003-b591-10d95eb4019f"
                                    },
                                    {
                                        "S": "9e9749f7-e039-45e3-9227-04275ad25018"
                                    },
                                    {
                                        "S": "246227b9-54ae-49a8-808d-1e9caf4fb537"
                                    },
                                    {
                                        "S": "569df81c-5a1e-4792-9b68-a0ad5a6d3868"
                                    },
                                    {
                                        "S": "30489f91-98b3-46ef-ac97-6e9b42dc8d95"
                                    },
                                    {
                                        "S": "dd141e74-8e84-470c-953a-0ae6e755d81d"
                                    },
                                    {
                                        "S": "5e69a3c8-324e-40f7-97da-5f22084c8093"
                                    },
                                    {
                                        "S": "c05aad78-c002-4207-b136-47e31ca14e89"
                                    },
                                    {
                                        "S": "50f36cc0-56e4-4d26-8017-1c2f552f32fb"
                                    },
                                    {
                                        "S": "b6e60877-4ea6-46d4-b1c7-605202048160"
                                    },
                                    {
                                        "S": "6a6005b1-15fe-4ce3-853e-815942e225b1"
                                    },
                                    {
                                        "S": "95bbd0b8-7617-48e2-9292-57c3e4f85cbd"
                                    },
                                    {
                                        "S": "13027b3c-579c-4506-995d-032170b68b32"
                                    },
                                    {
                                        "S": "f7128a8b-e62e-478e-ad97-c112fe030f89"
                                    },
                                    {
                                        "S": "5c784c7d-dd21-4ef5-9986-0451198681b9"
                                    },
                                    {
                                        "S": "776c8ec5-4518-4c91-84f8-f22442680efa"
                                    },
                                    {
                                        "S": "7f2c624b-9267-4624-b798-c10178e96ab3"
                                    },
                                    {
                                        "S": "d6d24b64-386b-42ef-9410-c0c1defe13e1"
                                    },
                                    {
                                        "S": "e807f72e-c2b7-4cd1-a010-a2b1f15f7ee1"
                                    }
                                ]
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    }
                }
            },
            "broken-internal-links-auto-fix": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": false
                    },
                    "disabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    },
                    "enabled": {
                        "M": {
                            "sites": {
                                "L": [
                                    {
                                        "S": "36e4848b-d6e5-4350-a7f9-610e78325966"
                                    },
                                    {
                                        "S": "0f889afa-270c-46b1-b831-425818c3fdd4"
                                    },
                                    {
                                        "S": "52322a41-d11d-4e08-85fc-6eaf31b0741c"
                                    },
                                    {
                                        "S": "5175a307-988c-4b56-a871-d6cadc5efb03"
                                    },
                                    {
                                        "S": "f127adab-2e07-4f01-9721-0ea1859983aa"
                                    },
                                    {
                                        "S": "5c0cf22b-2323-4b03-b170-c7e15f2b4fc6"
                                    },
                                    {
                                        "S": "ffaddb3a-e4ea-4bf2-b04a-13163a3b6b1f"
                                    },
                                    {
                                        "S": "cccdac43-1a22-4659-9086-b762f59b9928"
                                    },
                                    {
                                        "S": "97bff092-e8c6-4fbb-825f-e199dadf65d1"
                                    },
                                    {
                                        "S": "f7128a8b-e62e-478e-ad97-c112fe030f89"
                                    },
                                    {
                                        "S": "5c784c7d-dd21-4ef5-9986-0451198681b9"
                                    },
                                    {
                                        "S": "776c8ec5-4518-4c91-84f8-f22442680efa"
                                    },
                                    {
                                        "S": "7f2c624b-9267-4624-b798-c10178e96ab3"
                                    },
                                    {
                                        "S": "81bd3248-f491-4721-a1ca-4cbca8c96442"
                                    },
                                    {
                                        "S": "e807f72e-c2b7-4cd1-a010-a2b1f15f7ee1"
                                    }
                                ]
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    }
                }
            },
            "lhs-desktop-internal": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": true
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    }
                }
            },
            "paid-traffic-analysis-monthly": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": false
                    },
                    "disabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    },
                    "enabled": {
                        "M": {
                            "sites": {
                                "L": [
                                    {
                                        "S": "bea22317-d986-4c3a-9da7-c32f3d5509bb"
                                    },
                                    {
                                        "S": "cf3158d8-a886-46fb-aba4-f65ec8fea705"
                                    },
                                    {
                                        "S": "d6d24b64-386b-42ef-9410-c0c1defe13e1"
                                    },
                                    {
                                        "S": "15d1546d-6284-41be-86af-2c1c722f93b1"
                                    },
                                    {
                                        "S": "36e4848b-d6e5-4350-a7f9-610e78325966"
                                    },
                                    {
                                        "S": "f50390e8-30fe-483d-a2a5-a029d10aa39c"
                                    },
                                    {
                                        "S": "d2960efd-a226-4b15-b5ec-b64ccb99995e"
                                    }
                                ]
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    }
                }
            },
            "links-preflight": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": true
                    },
                    "disabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    },
                    "enabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    }
                }
            },
            "cwv-internal": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": true
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    }
                }
            },
            "security-vulnerabilities": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": false
                    },
                    "disabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    },
                    "enabled": {
                        "M": {
                            "sites": {
                                "L": [
                                    {
                                        "S": "60710df6-3cc8-43df-9d6c-8540dfd1982e"
                                    },
                                    {
                                        "S": "c944b5c9-5d81-4e9b-9ce5-b463562facf2"
                                    },
                                    {
                                        "S": "e12fc51a-c9fd-484f-a5a8-e62b4f5662d7"
                                    }
                                ]
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    }
                }
            },
            "security-permissions": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": false
                    },
                    "disabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            }
                        ]
                    },
                    "enabled": {
                        "M": {
                            "sites": {
                                "L": [
                                    {
                                        "S": "aa4b7d3d-c2a8-4179-b878-86e5efe78ce5"
                                    }
                                ]
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "dependencies": {
                        "L": []
                    }
                }
            },
            "body-size-preflight": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": true
                    },
                    "disabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    },
                    "enabled": {
                        "M": {}
                    }
                }
            },
            "paid-traffic-analysis-weekly": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": false
                    },
                    "disabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    },
                    "enabled": {
                        "M": {
                            "sites": {
                                "L": [
                                    {
                                        "S": "c2473d89-e997-458d-a86d-b4096649c12b"
                                    },
                                    {
                                        "S": "c236a20b-c879-4960-b5b2-c0b607ade100"
                                    },
                                    {
                                        "S": "d6d24b64-386b-42ef-9410-c0c1defe13e1"
                                    },
                                    {
                                        "S": "15d1546d-6284-41be-86af-2c1c722f93b1"
                                    },
                                    {
                                        "S": "b520b4cf-dc73-49de-8573-0eb44b123e0d"
                                    },
                                    {
                                        "S": "8a09357d-7d18-4a9f-a203-002bb53ee7f5"
                                    },
                                    {
                                        "S": "d2960efd-a226-4b15-b5ec-b64ccb99995e"
                                    }
                                ]
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    }
                }
            },
            "scrape-top-pages": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": false
                    },
                    "disabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    },
                    "enabled": {
                        "M": {
                            "sites": {
                                "L": [
                                    {
                                        "S": "d04f59a7-3962-40fa-99eb-bf47faa95026"
                                    },
                                    {
                                        "S": "c2473d89-e997-458d-a86d-b4096649c12b"
                                    },
                                    {
                                        "S": "916e7978-0375-4b8f-a5bd-75d88113b10f"
                                    },
                                    {
                                        "S": "5a377a31-b6c3-411c-8b00-62d7e1b116ac"
                                    },
                                    {
                                        "S": "cccdac43-1a22-4659-9086-b762f59b9928"
                                    },
                                    {
                                        "S": "f3fc07e9-7226-49dd-917c-7f7355df85c1"
                                    },
                                    {
                                        "S": "36e4848b-d6e5-4350-a7f9-610e78325966"
                                    },
                                    {
                                        "S": "d1a5d531-8c3a-42a0-a39a-e7f4a72f4015"
                                    },
                                    {
                                        "S": "0f889afa-270c-46b1-b831-425818c3fdd4"
                                    },
                                    {
                                        "S": "87ef8777-ef4b-4ddc-b399-47b65083b5fd"
                                    },
                                    {
                                        "S": "97bff092-e8c6-4fbb-825f-e199dadf65d1"
                                    },
                                    {
                                        "S": "9c1c5fdc-de7a-42e7-8d76-97df716112f0"
                                    },
                                    {
                                        "S": "c236a20b-c879-4960-b5b2-c0b607ade100"
                                    },
                                    {
                                        "S": "9d57757b-eae0-4011-a030-3367465bcb27"
                                    },
                                    {
                                        "S": "09a7c782-04ad-49b5-98cf-77fb75480d9f"
                                    },
                                    {
                                        "S": "b80f894b-032a-4724-b613-65cd6d40b80b"
                                    },
                                    {
                                        "S": "96f21bbd-ae3f-49fd-87f3-765862ef4abc"
                                    },
                                    {
                                        "S": "bce7f685-de5a-4a33-92eb-3c37064dac87"
                                    },
                                    {
                                        "S": "15d1546d-6284-41be-86af-2c1c722f93b1"
                                    },
                                    {
                                        "S": "542ad116-ed33-448a-a123-06cbcd7c1d4c"
                                    },
                                    {
                                        "S": "a4762196-7696-4fb8-b61f-446516650cb8"
                                    },
                                    {
                                        "S": "56c36c3f-9a39-4d90-ab17-f02b01462a86"
                                    },
                                    {
                                        "S": "7cd6cfd5-6960-4c36-a63a-e03a313faefc"
                                    },
                                    {
                                        "S": "6a688c0a-9dab-474c-979d-23e303312c78"
                                    },
                                    {
                                        "S": "81bd3248-f491-4721-a1ca-4cbca8c96442"
                                    },
                                    {
                                        "S": "ceb71f84-610b-4ecb-818e-989117dff0a7"
                                    },
                                    {
                                        "S": "eb386962-6997-4ab2-ad30-845797dd1686"
                                    },
                                    {
                                        "S": "a9806a61-432c-489f-9899-660d0b017259"
                                    },
                                    {
                                        "S": "d041ebe2-9a96-4e1e-8d66-be878022c137"
                                    },
                                    {
                                        "S": "40f377b0-2242-41d6-b215-e9ff8ace8b3d"
                                    },
                                    {
                                        "S": "61ef5d03-2505-41d6-b7b2-c6dd01c9deb9"
                                    },
                                    {
                                        "S": "f23eaa14-2069-47ff-b136-e6330788e7a9"
                                    },
                                    {
                                        "S": "52322a41-d11d-4e08-85fc-6eaf31b0741c"
                                    },
                                    {
                                        "S": "d2960efd-a226-4b15-b5ec-b64ccb99995e"
                                    },
                                    {
                                        "S": "1f6023e7-b7df-404f-9cb9-636178381c93"
                                    },
                                    {
                                        "S": "22906986-7e08-4dc4-97f2-4e24bf7e000a"
                                    },
                                    {
                                        "S": "ffaddb3a-e4ea-4bf2-b04a-13163a3b6b1f"
                                    },
                                    {
                                        "S": "eede5a3e-5525-4cfb-86d5-43fff8881929"
                                    },
                                    {
                                        "S": "d4262fc6-ef6c-4c8b-924f-925a13f95dde"
                                    },
                                    {
                                        "S": "5b6afa2b-cc29-4459-b767-2ad8f04f45c3"
                                    },
                                    {
                                        "S": "1b6c0d1d-30a3-4003-b591-10d95eb4019f"
                                    },
                                    {
                                        "S": "9e9749f7-e039-45e3-9227-04275ad25018"
                                    },
                                    {
                                        "S": "c487d626-363a-4864-86eb-1a96f924714d"
                                    },
                                    {
                                        "S": "246227b9-54ae-49a8-808d-1e9caf4fb537"
                                    },
                                    {
                                        "S": "02bd0de2-f8f5-49ed-905d-0e75153ef85a"
                                    },
                                    {
                                        "S": "0c32fd58-de1d-48d1-acb4-74b98642fd7d"
                                    },
                                    {
                                        "S": "569df81c-5a1e-4792-9b68-a0ad5a6d3868"
                                    },
                                    {
                                        "S": "30489f91-98b3-46ef-ac97-6e9b42dc8d95"
                                    },
                                    {
                                        "S": "dd141e74-8e84-470c-953a-0ae6e755d81d"
                                    },
                                    {
                                        "S": "5e69a3c8-324e-40f7-97da-5f22084c8093"
                                    },
                                    {
                                        "S": "c05aad78-c002-4207-b136-47e31ca14e89"
                                    },
                                    {
                                        "S": "50f36cc0-56e4-4d26-8017-1c2f552f32fb"
                                    },
                                    {
                                        "S": "b6e60877-4ea6-46d4-b1c7-605202048160"
                                    },
                                    {
                                        "S": "6a6005b1-15fe-4ce3-853e-815942e225b1"
                                    },
                                    {
                                        "S": "f35ffe86-4d9b-4c13-a20b-9e6fc6231ead"
                                    },
                                    {
                                        "S": "19bc527d-bfba-41da-85a9-fe38edab915d"
                                    },
                                    {
                                        "S": "95bbd0b8-7617-48e2-9292-57c3e4f85cbd"
                                    },
                                    {
                                        "S": "13027b3c-579c-4506-995d-032170b68b32"
                                    },
                                    {
                                        "S": "ff51d86f-4d7b-4601-a792-9eef58779717"
                                    },
                                    {
                                        "S": "f7128a8b-e62e-478e-ad97-c112fe030f89"
                                    },
                                    {
                                        "S": "5c784c7d-dd21-4ef5-9986-0451198681b9"
                                    },
                                    {
                                        "S": "6bafb757-e26e-457f-8362-ca8154950a21"
                                    },
                                    {
                                        "S": "776c8ec5-4518-4c91-84f8-f22442680efa"
                                    },
                                    {
                                        "S": "7f2c624b-9267-4624-b798-c10178e96ab3"
                                    },
                                    {
                                        "S": "e807f72e-c2b7-4cd1-a010-a2b1f15f7ee1"
                                    }
                                ]
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    }
                }
            },
            "experimentation": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": false
                    },
                    "disabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    },
                    "enabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    }
                }
            },
            "404-internal": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": true
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    }
                }
            },
            "broken-internal-links-internal": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": true
                    },
                    "disabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    }
                }
            },
            "soft-404s": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": false
                    },
                    "disabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    },
                    "enabled": {
                        "M": {
                            "sites": {
                                "L": [
                                    {
                                        "S": "d04f59a7-3962-40fa-99eb-bf47faa95026"
                                    },
                                    {
                                        "S": "cccdac43-1a22-4659-9086-b762f59b9928"
                                    },
                                    {
                                        "S": "5a377a31-b6c3-411c-8b00-62d7e1b116ac"
                                    },
                                    {
                                        "S": "542ad116-ed33-448a-a123-06cbcd7c1d4c"
                                    },
                                    {
                                        "S": "c2473d89-e997-458d-a86d-b4096649c12b"
                                    },
                                    {
                                        "S": "36e4848b-d6e5-4350-a7f9-610e78325966"
                                    },
                                    {
                                        "S": "cd31ac1d-b836-4883-bf68-775be68597ef"
                                    },
                                    {
                                        "S": "d1a5d531-8c3a-42a0-a39a-e7f4a72f4015"
                                    },
                                    {
                                        "S": "0f889afa-270c-46b1-b831-425818c3fdd4"
                                    },
                                    {
                                        "S": "87ef8777-ef4b-4ddc-b399-47b65083b5fd"
                                    },
                                    {
                                        "S": "97bff092-e8c6-4fbb-825f-e199dadf65d1"
                                    },
                                    {
                                        "S": "9c1c5fdc-de7a-42e7-8d76-97df716112f0"
                                    },
                                    {
                                        "S": "c236a20b-c879-4960-b5b2-c0b607ade100"
                                    },
                                    {
                                        "S": "9d57757b-eae0-4011-a030-3367465bcb27"
                                    },
                                    {
                                        "S": "09a7c782-04ad-49b5-98cf-77fb75480d9f"
                                    },
                                    {
                                        "S": "b80f894b-032a-4724-b613-65cd6d40b80b"
                                    },
                                    {
                                        "S": "96f21bbd-ae3f-49fd-87f3-765862ef4abc"
                                    },
                                    {
                                        "S": "bce7f685-de5a-4a33-92eb-3c37064dac87"
                                    },
                                    {
                                        "S": "15d1546d-6284-41be-86af-2c1c722f93b1"
                                    },
                                    {
                                        "S": "a4762196-7696-4fb8-b61f-446516650cb8"
                                    },
                                    {
                                        "S": "990c8eec-5eec-41e9-8fdd-38473813a924"
                                    },
                                    {
                                        "S": "56c36c3f-9a39-4d90-ab17-f02b01462a86"
                                    },
                                    {
                                        "S": "7cd6cfd5-6960-4c36-a63a-e03a313faefc"
                                    },
                                    {
                                        "S": "6a688c0a-9dab-474c-979d-23e303312c78"
                                    },
                                    {
                                        "S": "81bd3248-f491-4721-a1ca-4cbca8c96442"
                                    },
                                    {
                                        "S": "ceb71f84-610b-4ecb-818e-989117dff0a7"
                                    },
                                    {
                                        "S": "eb386962-6997-4ab2-ad30-845797dd1686"
                                    },
                                    {
                                        "S": "a9806a61-432c-489f-9899-660d0b017259"
                                    },
                                    {
                                        "S": "d041ebe2-9a96-4e1e-8d66-be878022c137"
                                    },
                                    {
                                        "S": "eb520448-0b9a-4d3c-a573-acfb4c97c11d"
                                    },
                                    {
                                        "S": "f7128a8b-e62e-478e-ad97-c112fe030f89"
                                    },
                                    {
                                        "S": "61ef5d03-2505-41d6-b7b2-c6dd01c9deb9"
                                    },
                                    {
                                        "S": "f23eaa14-2069-47ff-b136-e6330788e7a9"
                                    },
                                    {
                                        "S": "d2960efd-a226-4b15-b5ec-b64ccb99995e"
                                    },
                                    {
                                        "S": "d2b4a8ce-bf30-44f9-843f-18e1cdba7886"
                                    },
                                    {
                                        "S": "1f6023e7-b7df-404f-9cb9-636178381c93"
                                    },
                                    {
                                        "S": "da448d97-0bc0-4b49-8110-9ffc4e113f96"
                                    },
                                    {
                                        "S": "22906986-7e08-4dc4-97f2-4e24bf7e000a"
                                    },
                                    {
                                        "S": "f127adab-2e07-4f01-9721-0ea1859983aa"
                                    },
                                    {
                                        "S": "02bd0de2-f8f5-49ed-905d-0e75153ef85a"
                                    },
                                    {
                                        "S": "50f36cc0-56e4-4d26-8017-1c2f552f32fb"
                                    }
                                ]
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    }
                }
            },
            "meta-tags": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": false
                    },
                    "disabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    },
                    "enabled": {
                        "M": {
                            "sites": {
                                "L": [
                                    {
                                        "S": "d04f59a7-3962-40fa-99eb-bf47faa95026"
                                    },
                                    {
                                        "S": "cccdac43-1a22-4659-9086-b762f59b9928"
                                    },
                                    {
                                        "S": "5a377a31-b6c3-411c-8b00-62d7e1b116ac"
                                    },
                                    {
                                        "S": "542ad116-ed33-448a-a123-06cbcd7c1d4c"
                                    },
                                    {
                                        "S": "c2473d89-e997-458d-a86d-b4096649c12b"
                                    },
                                    {
                                        "S": "36e4848b-d6e5-4350-a7f9-610e78325966"
                                    },
                                    {
                                        "S": "cd31ac1d-b836-4883-bf68-775be68597ef"
                                    },
                                    {
                                        "S": "d1a5d531-8c3a-42a0-a39a-e7f4a72f4015"
                                    },
                                    {
                                        "S": "0f889afa-270c-46b1-b831-425818c3fdd4"
                                    },
                                    {
                                        "S": "87ef8777-ef4b-4ddc-b399-47b65083b5fd"
                                    },
                                    {
                                        "S": "97bff092-e8c6-4fbb-825f-e199dadf65d1"
                                    },
                                    {
                                        "S": "9c1c5fdc-de7a-42e7-8d76-97df716112f0"
                                    },
                                    {
                                        "S": "c236a20b-c879-4960-b5b2-c0b607ade100"
                                    },
                                    {
                                        "S": "9d57757b-eae0-4011-a030-3367465bcb27"
                                    },
                                    {
                                        "S": "09a7c782-04ad-49b5-98cf-77fb75480d9f"
                                    },
                                    {
                                        "S": "b80f894b-032a-4724-b613-65cd6d40b80b"
                                    },
                                    {
                                        "S": "96f21bbd-ae3f-49fd-87f3-765862ef4abc"
                                    },
                                    {
                                        "S": "bce7f685-de5a-4a33-92eb-3c37064dac87"
                                    },
                                    {
                                        "S": "15d1546d-6284-41be-86af-2c1c722f93b1"
                                    },
                                    {
                                        "S": "a4762196-7696-4fb8-b61f-446516650cb8"
                                    },
                                    {
                                        "S": "990c8eec-5eec-41e9-8fdd-38473813a924"
                                    },
                                    {
                                        "S": "56c36c3f-9a39-4d90-ab17-f02b01462a86"
                                    },
                                    {
                                        "S": "7cd6cfd5-6960-4c36-a63a-e03a313faefc"
                                    },
                                    {
                                        "S": "6a688c0a-9dab-474c-979d-23e303312c78"
                                    },
                                    {
                                        "S": "81bd3248-f491-4721-a1ca-4cbca8c96442"
                                    },
                                    {
                                        "S": "ceb71f84-610b-4ecb-818e-989117dff0a7"
                                    },
                                    {
                                        "S": "eb386962-6997-4ab2-ad30-845797dd1686"
                                    },
                                    {
                                        "S": "a9806a61-432c-489f-9899-660d0b017259"
                                    },
                                    {
                                        "S": "d041ebe2-9a96-4e1e-8d66-be878022c137"
                                    },
                                    {
                                        "S": "eb520448-0b9a-4d3c-a573-acfb4c97c11d"
                                    },
                                    {
                                        "S": "61ef5d03-2505-41d6-b7b2-c6dd01c9deb9"
                                    },
                                    {
                                        "S": "f23eaa14-2069-47ff-b136-e6330788e7a9"
                                    },
                                    {
                                        "S": "d2960efd-a226-4b15-b5ec-b64ccb99995e"
                                    },
                                    {
                                        "S": "d2b4a8ce-bf30-44f9-843f-18e1cdba7886"
                                    },
                                    {
                                        "S": "1f6023e7-b7df-404f-9cb9-636178381c93"
                                    },
                                    {
                                        "S": "da448d97-0bc0-4b49-8110-9ffc4e113f96"
                                    },
                                    {
                                        "S": "22906986-7e08-4dc4-97f2-4e24bf7e000a"
                                    },
                                    {
                                        "S": "f127adab-2e07-4f01-9721-0ea1859983aa"
                                    },
                                    {
                                        "S": "ffaddb3a-e4ea-4bf2-b04a-13163a3b6b1f"
                                    },
                                    {
                                        "S": "eb9568f4-3c1a-4bc1-bfd0-b8d435118eb2"
                                    },
                                    {
                                        "S": "d4262fc6-ef6c-4c8b-924f-925a13f95dde"
                                    },
                                    {
                                        "S": "78d91201-157d-41a8-a9ca-720e6318cbd8"
                                    },
                                    {
                                        "S": "1b6c0d1d-30a3-4003-b591-10d95eb4019f"
                                    },
                                    {
                                        "S": "9e9749f7-e039-45e3-9227-04275ad25018"
                                    },
                                    {
                                        "S": "246227b9-54ae-49a8-808d-1e9caf4fb537"
                                    },
                                    {
                                        "S": "569df81c-5a1e-4792-9b68-a0ad5a6d3868"
                                    },
                                    {
                                        "S": "30489f91-98b3-46ef-ac97-6e9b42dc8d95"
                                    },
                                    {
                                        "S": "7be95fa1-e532-410c-b6f8-6584ca92ac09"
                                    },
                                    {
                                        "S": "dd141e74-8e84-470c-953a-0ae6e755d81d"
                                    },
                                    {
                                        "S": "5e69a3c8-324e-40f7-97da-5f22084c8093"
                                    },
                                    {
                                        "S": "c05aad78-c002-4207-b136-47e31ca14e89"
                                    },
                                    {
                                        "S": "50f36cc0-56e4-4d26-8017-1c2f552f32fb"
                                    },
                                    {
                                        "S": "b6e60877-4ea6-46d4-b1c7-605202048160"
                                    },
                                    {
                                        "S": "6a6005b1-15fe-4ce3-853e-815942e225b1"
                                    },
                                    {
                                        "S": "44482500-5aa9-4046-90f1-db52d64fc6de"
                                    },
                                    {
                                        "S": "20fa4a27-9083-4275-b11c-29d104c8f75e"
                                    },
                                    {
                                        "S": "5bee18ec-474e-45a7-aa14-aba6340d3c70"
                                    },
                                    {
                                        "S": "95bbd0b8-7617-48e2-9292-57c3e4f85cbd"
                                    },
                                    {
                                        "S": "13027b3c-579c-4506-995d-032170b68b32"
                                    },
                                    {
                                        "S": "b424726b-639b-4077-a7f0-347d7d8cfca6"
                                    },
                                    {
                                        "S": "ff51d86f-4d7b-4601-a792-9eef58779717"
                                    },
                                    {
                                        "S": "f7128a8b-e62e-478e-ad97-c112fe030f89"
                                    },
                                    {
                                        "S": "5c784c7d-dd21-4ef5-9986-0451198681b9"
                                    },
                                    {
                                        "S": "12d892c5-779d-409f-b16b-56fba9304204"
                                    },
                                    {
                                        "S": "776c8ec5-4518-4c91-84f8-f22442680efa"
                                    },
                                    {
                                        "S": "7f2c624b-9267-4624-b798-c10178e96ab3"
                                    },
                                    {
                                        "S": "d6d24b64-386b-42ef-9410-c0c1defe13e1"
                                    },
                                    {
                                        "S": "e807f72e-c2b7-4cd1-a010-a2b1f15f7ee1"
                                    },
                                    {
                                        "S": "5824344d-fa1a-4b3f-8eb6-a6c6a3cff646"
                                    }
                                ]
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    }
                }
            },
            "geo-brand-presence-daily": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": false
                    },
                    "disabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "LLMO"
                            }
                        ]
                    },
                    "enabled": {
                        "M": {
                            "sites": {
                                "L": [
                                    {
                                        "S": "df893117-db25-4a34-aa97-5f5a87a34cd8"
                                    },
                                    {
                                        "S": "cccdac43-1a22-4659-9086-b762f59b9928"
                                    }
                                ]
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    }
                }
            },
            "organic-traffic-internal": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": true
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    }
                }
            },
            "structured-data-auto-suggest": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": false
                    },
                    "disabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    },
                    "enabled": {
                        "M": {
                            "sites": {
                                "L": [
                                    {
                                        "S": "916e7978-0375-4b8f-a5bd-75d88113b10f"
                                    },
                                    {
                                        "S": "cccdac43-1a22-4659-9086-b762f59b9928"
                                    },
                                    {
                                        "S": "36e4848b-d6e5-4350-a7f9-610e78325966"
                                    },
                                    {
                                        "S": "0f889afa-270c-46b1-b831-425818c3fdd4"
                                    },
                                    {
                                        "S": "40f377b0-2242-41d6-b215-e9ff8ace8b3d"
                                    },
                                    {
                                        "S": "52322a41-d11d-4e08-85fc-6eaf31b0741c"
                                    },
                                    {
                                        "S": "0c32fd58-de1d-48d1-acb4-74b98642fd7d"
                                    }
                                ]
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "dependencies": {
                        "L": [
                            {
                                "M": {
                                    "handler": {
                                        "S": "structured-data"
                                    }
                                }
                            }
                        ]
                    }
                }
            },
            "cwv-auto-fix": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": false
                    },
                    "disabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    },
                    "enabled": {
                        "M": {
                            "sites": {
                                "L": [
                                    {
                                        "S": "f4acd9af-c9d8-4fd6-926f-618a4733da71"
                                    }
                                ]
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    }
                }
            },
            "security-csp-auto-suggest": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": true
                    },
                    "disabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    },
                    "enabled": {
                        "M": {
                            "sites": {
                                "L": [
                                    {
                                        "S": "ffaddb3a-e4ea-4bf2-b04a-13163a3b6b1f"
                                    },
                                    {
                                        "S": "4605dbad-dacf-4323-b44c-0110756587d7"
                                    }
                                ]
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    }
                }
            },
            "mismatch": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": true
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    }
                }
            },
            "demo-url": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": true
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    }
                }
            },
            "canonical-preflight": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": true
                    },
                    "disabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    },
                    "enabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    }
                }
            },
            "product-metatags-auto-suggest": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": false
                    },
                    "disabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    },
                    "enabled": {
                        "M": {
                            "sites": {
                                "L": [
                                    {
                                        "S": "cccdac43-1a22-4659-9086-b762f59b9928"
                                    },
                                    {
                                        "S": "c236a20b-c879-4960-b5b2-c0b607ade100"
                                    }
                                ]
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    }
                }
            },
            "security-vulnerabilities-auto-suggest": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": false
                    },
                    "disabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    },
                    "enabled": {
                        "M": {
                            "sites": {
                                "L": [
                                    {
                                        "S": "60710df6-3cc8-43df-9d6c-8540dfd1982e"
                                    },
                                    {
                                        "S": "c944b5c9-5d81-4e9b-9ce5-b463562facf2"
                                    },
                                    {
                                        "S": "e12fc51a-c9fd-484f-a5a8-e62b4f5662d7"
                                    }
                                ]
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    }
                }
            },
            "a11y-mystique-auto-suggest": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": false
                    },
                    "disabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    },
                    "enabled": {
                        "M": {
                            "sites": {
                                "L": [
                                    {
                                        "S": "87ef8777-ef4b-4ddc-b399-47b65083b5fd"
                                    },
                                    {
                                        "S": "36e4848b-d6e5-4350-a7f9-610e78325966"
                                    },
                                    {
                                        "S": "d2960efd-a226-4b15-b5ec-b64ccb99995e"
                                    },
                                    {
                                        "S": "a4762196-7696-4fb8-b61f-446516650cb8"
                                    },
                                    {
                                        "S": "d1a5d531-8c3a-42a0-a39a-e7f4a72f4015"
                                    },
                                    {
                                        "S": "c236a20b-c879-4960-b5b2-c0b607ade100"
                                    },
                                    {
                                        "S": "0f889afa-270c-46b1-b831-425818c3fdd4"
                                    },
                                    {
                                        "S": "12552d40-a3ae-46da-9a17-b99b0e5bc0dc"
                                    },
                                    {
                                        "S": "50f36cc0-56e4-4d26-8017-1c2f552f32fb"
                                    },
                                    {
                                        "S": "246227b9-54ae-49a8-808d-1e9caf4fb537"
                                    },
                                    {
                                        "S": "15d1546d-6284-41be-86af-2c1c722f93b1"
                                    },
                                    {
                                        "S": "3f0a2fc2-ba3f-4153-acb8-73bdcae14392"
                                    },
                                    {
                                        "S": "aabd3cb1-5300-4b0f-80db-b4c2502bfff0"
                                    },
                                    {
                                        "S": "74d8b124-f68c-457f-bc03-3df823d02621"
                                    },
                                    {
                                        "S": "19d61aaa-09bd-430d-9d4e-e17bc3b9b5ba"
                                    }
                                ]
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    }
                }
            },
            "cwv": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": false
                    },
                    "disabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    },
                    "enabled": {
                        "M": {
                            "sites": {
                                "L": [
                                    {
                                        "S": "97eea6f3-497c-4f9e-86db-7848b6a7db77"
                                    },
                                    {
                                        "S": "c81ff7c9-cea3-4cba-9438-6d62d26d160f"
                                    },
                                    {
                                        "S": "cccdac43-1a22-4659-9086-b762f59b9928"
                                    },
                                    {
                                        "S": "916e7978-0375-4b8f-a5bd-75d88113b10f"
                                    },
                                    {
                                        "S": "542ad116-ed33-448a-a123-06cbcd7c1d4c"
                                    },
                                    {
                                        "S": "9688cb89-daab-4f7a-b87f-f46401c98226"
                                    },
                                    {
                                        "S": "193649cd-2a34-4b2e-9b33-2ba129884aae"
                                    },
                                    {
                                        "S": "a673d9e3-8949-45a1-8b93-f4b7c31e88e1"
                                    },
                                    {
                                        "S": "36e4848b-d6e5-4350-a7f9-610e78325966"
                                    },
                                    {
                                        "S": "d5605edb-d3ef-4b0e-801f-322edb2eeeab"
                                    },
                                    {
                                        "S": "9ab0575a-c238-4470-ae82-9d37fb2d0e78"
                                    },
                                    {
                                        "S": "044ea848-2c33-4d12-be75-bcc6c4461dba"
                                    },
                                    {
                                        "S": "5a377a31-b6c3-411c-8b00-62d7e1b116ac"
                                    },
                                    {
                                        "S": "c2473d89-e997-458d-a86d-b4096649c12b"
                                    },
                                    {
                                        "S": "12d892c5-779d-409f-b16b-56fba9304204"
                                    },
                                    {
                                        "S": "103cabfc-7fd9-4469-a55f-3c991f3fb2bd"
                                    },
                                    {
                                        "S": "d04f59a7-3962-40fa-99eb-bf47faa95026"
                                    },
                                    {
                                        "S": "24ef8828-151d-4336-896e-ba5ddfa14e36"
                                    },
                                    {
                                        "S": "3b097bac-e687-4560-b4f9-b1630324f5de"
                                    },
                                    {
                                        "S": "0ceeef1f-c56e-4c31-b8d3-55af6b9509c7"
                                    },
                                    {
                                        "S": "5283706b-2a41-477f-b157-e511aaa6879a"
                                    },
                                    {
                                        "S": "71356f79-3793-49d5-9c66-f7ecf675a8c8"
                                    },
                                    {
                                        "S": "6bafb757-e26e-457f-8362-ca8154950a21"
                                    },
                                    {
                                        "S": "10bd2142-4e88-471c-8089-69b8ea0049cc"
                                    },
                                    {
                                        "S": "eeeeb765-ffa3-482b-9c72-a58a8408a8a5"
                                    },
                                    {
                                        "S": "f557fec6-d3d1-4332-ac88-54e8c8220b99"
                                    },
                                    {
                                        "S": "78aed5ca-1275-4d44-ab10-26cba6b3e674"
                                    },
                                    {
                                        "S": "177a58eb-25ad-4112-99c7-72f6522614a2"
                                    },
                                    {
                                        "S": "9a066d50-77fe-402f-b3ff-e4deffcef704"
                                    },
                                    {
                                        "S": "d66539f0-29ee-4315-b2b8-6db3c4ac7451"
                                    },
                                    {
                                        "S": "9d52e380-f7ad-4d42-9b35-94ba810a4826"
                                    },
                                    {
                                        "S": "7e67eaae-e7aa-4eec-9c02-1fe52391bac4"
                                    },
                                    {
                                        "S": "d2160477-946b-49dc-b30c-1dfd9f04df94"
                                    },
                                    {
                                        "S": "769bf1c4-2d98-4ba6-a73a-13cfc2dcb212"
                                    },
                                    {
                                        "S": "7bb8009e-f6df-4bc5-8666-da3fc783ae5c"
                                    },
                                    {
                                        "S": "18b6c759-e7ed-44f1-84c0-2cfd8bb4eedf"
                                    },
                                    {
                                        "S": "07876307-2f6e-4de5-afc2-b16a647e0ce2"
                                    },
                                    {
                                        "S": "978d8b97-79c2-4213-9b5c-2e8f30c95a48"
                                    },
                                    {
                                        "S": "694b80ae-b548-41d6-8725-bf19dc8b07ee"
                                    },
                                    {
                                        "S": "258e1a22-2899-497d-b933-5cebfa293286"
                                    },
                                    {
                                        "S": "0b466e25-a71a-43ce-b970-15312bef9402"
                                    },
                                    {
                                        "S": "2c4dc52b-1f38-4ae7-9bec-f55569ed0d80"
                                    },
                                    {
                                        "S": "8161fb85-2807-4183-af7e-05225258d7c1"
                                    },
                                    {
                                        "S": "cb51cacd-21f2-48ce-95e7-2ab660b9cd15"
                                    },
                                    {
                                        "S": "729fbfaf-48db-4d65-8924-4f0a9795bbd9"
                                    },
                                    {
                                        "S": "94839300-8542-438b-94ca-a0f3fc859f20"
                                    },
                                    {
                                        "S": "eed3cb09-7fb1-4f94-80db-7d2372d4edc6"
                                    },
                                    {
                                        "S": "c9ab366e-368d-4213-a7f0-c3786c781478"
                                    },
                                    {
                                        "S": "b80f894b-032a-4724-b613-65cd6d40b80b"
                                    },
                                    {
                                        "S": "8d541086-f5e9-40e3-bcec-215efac3ec6f"
                                    },
                                    {
                                        "S": "96f21bbd-ae3f-49fd-87f3-765862ef4abc"
                                    },
                                    {
                                        "S": "d9d5b628-6129-412e-aebf-3ee113c751a0"
                                    },
                                    {
                                        "S": "22002006-9932-49ce-a81c-8f24baab6e6b"
                                    },
                                    {
                                        "S": "fd07b3ae-4d0c-425a-a466-8441a3b13f69"
                                    },
                                    {
                                        "S": "9dd52c74-5f38-4f4f-8939-2aab999adc76"
                                    },
                                    {
                                        "S": "8b53b412-1548-46ae-abf6-1a0da2006444"
                                    },
                                    {
                                        "S": "d1a5d531-8c3a-42a0-a39a-e7f4a72f4015"
                                    },
                                    {
                                        "S": "0f889afa-270c-46b1-b831-425818c3fdd4"
                                    },
                                    {
                                        "S": "87ef8777-ef4b-4ddc-b399-47b65083b5fd"
                                    },
                                    {
                                        "S": "97bff092-e8c6-4fbb-825f-e199dadf65d1"
                                    },
                                    {
                                        "S": "9c1c5fdc-de7a-42e7-8d76-97df716112f0"
                                    },
                                    {
                                        "S": "c236a20b-c879-4960-b5b2-c0b607ade100"
                                    },
                                    {
                                        "S": "9d57757b-eae0-4011-a030-3367465bcb27"
                                    },
                                    {
                                        "S": "09a7c782-04ad-49b5-98cf-77fb75480d9f"
                                    },
                                    {
                                        "S": "3fd44cf2-c9f8-40ee-9d9b-22c296ebb633"
                                    },
                                    {
                                        "S": "bce7f685-de5a-4a33-92eb-3c37064dac87"
                                    },
                                    {
                                        "S": "15d1546d-6284-41be-86af-2c1c722f93b1"
                                    },
                                    {
                                        "S": "a4762196-7696-4fb8-b61f-446516650cb8"
                                    },
                                    {
                                        "S": "56c36c3f-9a39-4d90-ab17-f02b01462a86"
                                    },
                                    {
                                        "S": "7cd6cfd5-6960-4c36-a63a-e03a313faefc"
                                    },
                                    {
                                        "S": "6a688c0a-9dab-474c-979d-23e303312c78"
                                    },
                                    {
                                        "S": "81bd3248-f491-4721-a1ca-4cbca8c96442"
                                    },
                                    {
                                        "S": "ceb71f84-610b-4ecb-818e-989117dff0a7"
                                    },
                                    {
                                        "S": "eb386962-6997-4ab2-ad30-845797dd1686"
                                    },
                                    {
                                        "S": "a9806a61-432c-489f-9899-660d0b017259"
                                    },
                                    {
                                        "S": "d041ebe2-9a96-4e1e-8d66-be878022c137"
                                    },
                                    {
                                        "S": "61ef5d03-2505-41d6-b7b2-c6dd01c9deb9"
                                    },
                                    {
                                        "S": "f23eaa14-2069-47ff-b136-e6330788e7a9"
                                    },
                                    {
                                        "S": "d2960efd-a226-4b15-b5ec-b64ccb99995e"
                                    },
                                    {
                                        "S": "1f6023e7-b7df-404f-9cb9-636178381c93"
                                    },
                                    {
                                        "S": "da448d97-0bc0-4b49-8110-9ffc4e113f96"
                                    },
                                    {
                                        "S": "22906986-7e08-4dc4-97f2-4e24bf7e000a"
                                    },
                                    {
                                        "S": "d4262fc6-ef6c-4c8b-924f-925a13f95dde"
                                    },
                                    {
                                        "S": "1b6c0d1d-30a3-4003-b591-10d95eb4019f"
                                    },
                                    {
                                        "S": "9e9749f7-e039-45e3-9227-04275ad25018"
                                    },
                                    {
                                        "S": "246227b9-54ae-49a8-808d-1e9caf4fb537"
                                    },
                                    {
                                        "S": "569df81c-5a1e-4792-9b68-a0ad5a6d3868"
                                    },
                                    {
                                        "S": "30489f91-98b3-46ef-ac97-6e9b42dc8d95"
                                    },
                                    {
                                        "S": "dd141e74-8e84-470c-953a-0ae6e755d81d"
                                    },
                                    {
                                        "S": "5e69a3c8-324e-40f7-97da-5f22084c8093"
                                    },
                                    {
                                        "S": "c05aad78-c002-4207-b136-47e31ca14e89"
                                    },
                                    {
                                        "S": "50f36cc0-56e4-4d26-8017-1c2f552f32fb"
                                    },
                                    {
                                        "S": "b6e60877-4ea6-46d4-b1c7-605202048160"
                                    },
                                    {
                                        "S": "6a6005b1-15fe-4ce3-853e-815942e225b1"
                                    },
                                    {
                                        "S": "95bbd0b8-7617-48e2-9292-57c3e4f85cbd"
                                    },
                                    {
                                        "S": "13027b3c-579c-4506-995d-032170b68b32"
                                    },
                                    {
                                        "S": "f7128a8b-e62e-478e-ad97-c112fe030f89"
                                    },
                                    {
                                        "S": "5c784c7d-dd21-4ef5-9986-0451198681b9"
                                    },
                                    {
                                        "S": "776c8ec5-4518-4c91-84f8-f22442680efa"
                                    },
                                    {
                                        "S": "7f2c624b-9267-4624-b798-c10178e96ab3"
                                    },
                                    {
                                        "S": "e807f72e-c2b7-4cd1-a010-a2b1f15f7ee1"
                                    },
                                    {
                                        "S": "ad3d5bb7-9e85-4195-94e8-833cc5a73253"
                                    }
                                ]
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    }
                }
            },
            "broken-backlinks-auto-fix": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": false
                    },
                    "disabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    },
                    "enabled": {
                        "M": {
                            "sites": {
                                "L": [
                                    {
                                        "S": "36e4848b-d6e5-4350-a7f9-610e78325966"
                                    },
                                    {
                                        "S": "0f889afa-270c-46b1-b831-425818c3fdd4"
                                    },
                                    {
                                        "S": "5175a307-988c-4b56-a871-d6cadc5efb03"
                                    },
                                    {
                                        "S": "f127adab-2e07-4f01-9721-0ea1859983aa"
                                    },
                                    {
                                        "S": "5c0cf22b-2323-4b03-b170-c7e15f2b4fc6"
                                    },
                                    {
                                        "S": "ffaddb3a-e4ea-4bf2-b04a-13163a3b6b1f"
                                    },
                                    {
                                        "S": "c236a20b-c879-4960-b5b2-c0b607ade100"
                                    },
                                    {
                                        "S": "cccdac43-1a22-4659-9086-b762f59b9928"
                                    },
                                    {
                                        "S": "97bff092-e8c6-4fbb-825f-e199dadf65d1"
                                    },
                                    {
                                        "S": "f7128a8b-e62e-478e-ad97-c112fe030f89"
                                    },
                                    {
                                        "S": "5c784c7d-dd21-4ef5-9986-0451198681b9"
                                    },
                                    {
                                        "S": "776c8ec5-4518-4c91-84f8-f22442680efa"
                                    },
                                    {
                                        "S": "7f2c624b-9267-4624-b798-c10178e96ab3"
                                    },
                                    {
                                        "S": "81bd3248-f491-4721-a1ca-4cbca8c96442"
                                    },
                                    {
                                        "S": "e807f72e-c2b7-4cd1-a010-a2b1f15f7ee1"
                                    },
                                    {
                                        "S": "b6e60877-4ea6-46d4-b1c7-605202048160"
                                    }
                                ]
                            }
                        }
                    }
                }
            },
            "alt-text-auto-fix": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": false
                    },
                    "disabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    },
                    "enabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    }
                }
            },
            "broken-backlinks-auto-suggest": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": true
                    },
                    "disabled": {
                        "M": {
                            "sites": {
                                "L": [
                                    {
                                        "S": "f35ffe86-4d9b-4c13-a20b-9e6fc6231ead"
                                    },
                                    {
                                        "S": "906aadc7-0505-4cb5-9ecd-cb6bbc463aab"
                                    },
                                    {
                                        "S": "c87f1637-ad0e-4694-b5e4-941eb3e59099"
                                    },
                                    {
                                        "S": "5bee18ec-474e-45a7-aa14-aba6340d3c70"
                                    },
                                    {
                                        "S": "78084675-d658-45a1-903c-0e51db07f283"
                                    },
                                    {
                                        "S": "47f0014e-0b2d-4131-8c44-63b652acaa90"
                                    },
                                    {
                                        "S": "0572c386-d504-4560-8f62-3f50484bbc14"
                                    },
                                    {
                                        "S": "1fa0bec9-2224-4323-af5c-cb7cb3288344"
                                    },
                                    {
                                        "S": "905fa594-b188-4796-b0bc-4a46f86a4c21"
                                    },
                                    {
                                        "S": "c8df9f07-83d0-4866-8398-60f722dc606a"
                                    },
                                    {
                                        "S": "0dd8f91f-be96-4324-865f-6dd8456f5673"
                                    }
                                ]
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    },
                    "enabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "dependencies": {
                        "L": [
                            {
                                "M": {
                                    "handler": {
                                        "S": "scrape-top-pages"
                                    }
                                }
                            }
                        ]
                    }
                }
            },
            "accessibility-mobile": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": false
                    },
                    "disabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    },
                    "enabled": {
                        "M": {
                            "sites": {
                                "L": [
                                    {
                                        "S": "87ef8777-ef4b-4ddc-b399-47b65083b5fd"
                                    }
                                ]
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    }
                }
            },
            "broken-backlinks-external": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": false
                    },
                    "enabled": {
                        "M": {
                            "sites": {
                                "L": [
                                    {
                                        "S": "7be95fa1-e532-410c-b6f8-6584ca92ac09"
                                    },
                                    {
                                        "S": "36e4848b-d6e5-4350-a7f9-610e78325966"
                                    },
                                    {
                                        "S": "97eea6f3-497c-4f9e-86db-7848b6a7db77"
                                    },
                                    {
                                        "S": "d5605edb-d3ef-4b0e-801f-322edb2eeeab"
                                    },
                                    {
                                        "S": "9ab0575a-c238-4470-ae82-9d37fb2d0e78"
                                    },
                                    {
                                        "S": "044ea848-2c33-4d12-be75-bcc6c4461dba"
                                    }
                                ]
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    }
                }
            },
            "geo-brand-presence": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": false
                    },
                    "disabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "LLMO"
                            }
                        ]
                    },
                    "enabled": {
                        "M": {
                            "sites": {
                                "L": [
                                    {
                                        "S": "c2473d89-e997-458d-a86d-b4096649c12b"
                                    },
                                    {
                                        "S": "cccdac43-1a22-4659-9086-b762f59b9928"
                                    },
                                    {
                                        "S": "0c32fd58-de1d-48d1-acb4-74b98642fd7d"
                                    },
                                    {
                                        "S": "d5605edb-d3ef-4b0e-801f-322edb2eeeab"
                                    },
                                    {
                                        "S": "654b782e-4de6-45ae-93eb-5e77f8d2a8be"
                                    },
                                    {
                                        "S": "d1a5d531-8c3a-42a0-a39a-e7f4a72f4015"
                                    },
                                    {
                                        "S": "19bc527d-bfba-41da-85a9-fe38edab915d"
                                    },
                                    {
                                        "S": "367bfb05-6300-4112-90e0-87d1ad92413b"
                                    },
                                    {
                                        "S": "abe091f5-65d6-488a-aad1-cc1cf6bec25b"
                                    },
                                    {
                                        "S": "4c6b7ad2-c402-4354-b549-5ffe5e153f69"
                                    },
                                    {
                                        "S": "43dfec0c-c21e-4f6a-b896-e82e01e8a189"
                                    },
                                    {
                                        "S": "b1555a54-48b4-47ee-97c1-438257bd3839"
                                    },
                                    {
                                        "S": "3abcdede-b53f-4e7e-9d73-34e8316364c7"
                                    },
                                    {
                                        "S": "6fdcadaf-04e1-4411-aeeb-daa146df44d7"
                                    },
                                    {
                                        "S": "bb961426-c338-45d6-bae3-2b8701a62826"
                                    },
                                    {
                                        "S": "b707e5c2-66c0-43b2-9739-55a0c498fe91"
                                    },
                                    {
                                        "S": "f7f99ad5-99a2-43e9-9b0a-b1d0da5893cf"
                                    },
                                    {
                                        "S": "6b742ebf-1ab0-4478-9254-ea8e561aa7b4"
                                    },
                                    {
                                        "S": "f000abcd-cec1-40c6-a9a1-7fa12b3e2d6c"
                                    },
                                    {
                                        "S": "0fe19d0c-2b42-48b9-9694-3ff6cbe12f89"
                                    },
                                    {
                                        "S": "ec457c65-2809-4b2d-bf71-d444e77de480"
                                    },
                                    {
                                        "S": "0572c386-d504-4560-8f62-3f50484bbc14"
                                    },
                                    {
                                        "S": "9a873d5d-a181-407e-ac59-e7ef444f15fc"
                                    },
                                    {
                                        "S": "ddafe3af-97b7-4975-8334-b10de7df76c5"
                                    },
                                    {
                                        "S": "74922aa7-15eb-4438-beaa-2f2af48f9621"
                                    },
                                    {
                                        "S": "13c2b5f6-d338-4502-bb90-324a429683f9"
                                    },
                                    {
                                        "S": "a12e4af3-27a8-49cf-a2a5-a7e57a990991"
                                    },
                                    {
                                        "S": "23f63ae8-d27b-43cb-9631-c784ef86433e"
                                    },
                                    {
                                        "S": "38fbd289-03df-4f34-80ea-9333d4e4d6d7"
                                    },
                                    {
                                        "S": "6d4ea2bb-f7b2-49d3-af5d-0ec4579c7a9b"
                                    },
                                    {
                                        "S": "b9fdacaf-30ed-4150-ac66-883c9cc66f91"
                                    },
                                    {
                                        "S": "b51318fd-ebf9-4987-bf10-77e5ef16f742"
                                    },
                                    {
                                        "S": "0c7beaaf-9b37-4010-bdae-37cbeec2ca96"
                                    },
                                    {
                                        "S": "7a3409e7-6941-45da-8ee6-e7c3fe07bcdb"
                                    },
                                    {
                                        "S": "c617bfe6-bc36-4ef9-b320-2c816a9c0d32"
                                    },
                                    {
                                        "S": "65182878-007e-4931-a81a-7467fae5c88d"
                                    },
                                    {
                                        "S": "bea9d9d3-a57e-44ef-ad61-231275a8ec2b"
                                    },
                                    {
                                        "S": "178cbdfe-f80f-4b03-9213-ae56057f8de3"
                                    },
                                    {
                                        "S": "12d892c5-779d-409f-b16b-56fba9304204"
                                    },
                                    {
                                        "S": "adce2108-d9e3-441a-8827-201af7fbfdc0"
                                    },
                                    {
                                        "S": "96b65b91-0bec-4f5b-9789-f9cd5f91e0fe"
                                    },
                                    {
                                        "S": "d04f59a7-3962-40fa-99eb-bf47faa95026"
                                    },
                                    {
                                        "S": "d79a4266-b12f-4fdb-8e45-0a75134b4710"
                                    },
                                    {
                                        "S": "67d3e39a-3279-4e55-9a9a-eb4c6475dee1"
                                    },
                                    {
                                        "S": "432a32c9-a7ec-4357-92aa-6f578356bcb4"
                                    },
                                    {
                                        "S": "cdb99f9e-df5e-4289-a896-99c4b8908f1c"
                                    },
                                    {
                                        "S": "71a460a5-2e81-4b11-9cd0-c93741911f7f"
                                    },
                                    {
                                        "S": "f3fc07e9-7226-49dd-917c-7f7355df85c1"
                                    },
                                    {
                                        "S": "648bffec-279e-450a-bc65-4fae9bf968c5"
                                    },
                                    {
                                        "S": "ff7b3145-541f-43fc-96a3-187b6ba9336f"
                                    },
                                    {
                                        "S": "d2960efd-a226-4b15-b5ec-b64ccb99995e"
                                    },
                                    {
                                        "S": "8254bd9e-8335-496f-8027-cf67157adfe9"
                                    },
                                    {
                                        "S": "16104fb8-b61d-43a4-9836-888b9f3eaa1a"
                                    },
                                    {
                                        "S": "64b47eec-d3d3-46c0-95cd-d0cc02045ee8"
                                    },
                                    {
                                        "S": "10031ba1-2182-4386-9eec-8eabd85c7022"
                                    },
                                    {
                                        "S": "72ffb29e-09ef-4e87-bcd6-d58f4f27afa8"
                                    },
                                    {
                                        "S": "ac337e40-c610-4b95-a0c0-43f605058fe4"
                                    },
                                    {
                                        "S": "457afb19-dcc9-41c7-8d93-f29a8c871e37"
                                    },
                                    {
                                        "S": "559a41c0-379e-4ba3-9035-3d4a91e97988"
                                    },
                                    {
                                        "S": "34f30d1f-2665-4401-b243-40e1afc02307"
                                    },
                                    {
                                        "S": "12d54932-e963-4783-aac3-4b1edbc27cde"
                                    },
                                    {
                                        "S": "2c735382-0497-42a6-a435-1efa7d75921c"
                                    },
                                    {
                                        "S": "9ba371e5-ed92-4a5a-a8cf-15a2989704b7"
                                    },
                                    {
                                        "S": "1ed6fb38-1f95-4e3c-ac9c-c0bdcdbde8da"
                                    },
                                    {
                                        "S": "1eedc2f0-5b30-4e87-8d5e-7e87efd62c2d"
                                    },
                                    {
                                        "S": "7be95fa1-e532-410c-b6f8-6584ca92ac09"
                                    },
                                    {
                                        "S": "c3d29462-b0b2-44a9-a531-15ef28325d7e"
                                    },
                                    {
                                        "S": "36e4848b-d6e5-4350-a7f9-610e78325966"
                                    },
                                    {
                                        "S": "f35ffe86-4d9b-4c13-a20b-9e6fc6231ead"
                                    },
                                    {
                                        "S": "19d61aaa-09bd-430d-9d4e-e17bc3b9b5ba"
                                    },
                                    {
                                        "S": "f753f464-53ba-4c04-82a0-c0271808e1f5"
                                    },
                                    {
                                        "S": "415b4ae8-e6f8-4be7-a5c8-76605c1cad56"
                                    },
                                    {
                                        "S": "1b7592da-da6f-4efe-a702-a70442f87155"
                                    },
                                    {
                                        "S": "3f5c649c-3666-4171-9cc5-50511b669362"
                                    },
                                    {
                                        "S": "822e1ffb-9313-4188-bb44-3d2cc52b3c3d"
                                    },
                                    {
                                        "S": "4560c5a1-c2b8-4188-b2d3-330886ef90bc"
                                    },
                                    {
                                        "S": "408cd1be-d781-429d-a360-09943ed9d705"
                                    },
                                    {
                                        "S": "b5e1885d-bd39-45c6-a39f-f0c478f820d5"
                                    },
                                    {
                                        "S": "c236a20b-c879-4960-b5b2-c0b607ade100"
                                    },
                                    {
                                        "S": "9b5b02d3-9e01-49af-bb7f-1a4c9faf6729"
                                    },
                                    {
                                        "S": "db8e44df-8a4d-4f0f-b049-3315ff6afbdc"
                                    },
                                    {
                                        "S": "6bd5cad1-9000-4fd5-8fc6-d232b34325f7"
                                    },
                                    {
                                        "S": "e54754be-9217-4fb6-8937-48337b22e8b5"
                                    },
                                    {
                                        "S": "eb39e797-ab5e-496a-95ee-469499c8867a"
                                    }
                                ]
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    }
                }
            },
            "experimentation-opportunities-internal": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": false
                    },
                    "enabled": {
                        "M": {
                            "sites": {
                                "L": [
                                    {
                                        "S": "c2473d89-e997-458d-a86d-b4096649c12b"
                                    }
                                ]
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    }
                }
            },
            "broken-internal-links": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": false
                    },
                    "disabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    },
                    "enabled": {
                        "M": {
                            "sites": {
                                "L": [
                                    {
                                        "S": "193649cd-2a34-4b2e-9b33-2ba129884aae"
                                    },
                                    {
                                        "S": "97eea6f3-497c-4f9e-86db-7848b6a7db77"
                                    },
                                    {
                                        "S": "d04f59a7-3962-40fa-99eb-bf47faa95026"
                                    },
                                    {
                                        "S": "5a377a31-b6c3-411c-8b00-62d7e1b116ac"
                                    },
                                    {
                                        "S": "12d892c5-779d-409f-b16b-56fba9304204"
                                    },
                                    {
                                        "S": "cccdac43-1a22-4659-9086-b762f59b9928"
                                    },
                                    {
                                        "S": "c2473d89-e997-458d-a86d-b4096649c12b"
                                    },
                                    {
                                        "S": "9ab0575a-c238-4470-ae82-9d37fb2d0e78"
                                    },
                                    {
                                        "S": "d5605edb-d3ef-4b0e-801f-322edb2eeeab"
                                    },
                                    {
                                        "S": "103cabfc-7fd9-4469-a55f-3c991f3fb2bd"
                                    },
                                    {
                                        "S": "36e4848b-d6e5-4350-a7f9-610e78325966"
                                    },
                                    {
                                        "S": "29a308cd-a5b6-48d4-873f-b54f6d4c886e"
                                    },
                                    {
                                        "S": "c236a20b-c879-4960-b5b2-c0b607ade100"
                                    },
                                    {
                                        "S": "d1a5d531-8c3a-42a0-a39a-e7f4a72f4015"
                                    },
                                    {
                                        "S": "9688cb89-daab-4f7a-b87f-f46401c98226"
                                    },
                                    {
                                        "S": "6b796871-f0ad-4b9e-a11d-b045376d1454"
                                    },
                                    {
                                        "S": "97bff092-e8c6-4fbb-825f-e199dadf65d1"
                                    },
                                    {
                                        "S": "0f889afa-270c-46b1-b831-425818c3fdd4"
                                    },
                                    {
                                        "S": "87ef8777-ef4b-4ddc-b399-47b65083b5fd"
                                    },
                                    {
                                        "S": "9c1c5fdc-de7a-42e7-8d76-97df716112f0"
                                    },
                                    {
                                        "S": "9d57757b-eae0-4011-a030-3367465bcb27"
                                    },
                                    {
                                        "S": "09a7c782-04ad-49b5-98cf-77fb75480d9f"
                                    },
                                    {
                                        "S": "b80f894b-032a-4724-b613-65cd6d40b80b"
                                    },
                                    {
                                        "S": "96f21bbd-ae3f-49fd-87f3-765862ef4abc"
                                    },
                                    {
                                        "S": "bce7f685-de5a-4a33-92eb-3c37064dac87"
                                    },
                                    {
                                        "S": "15d1546d-6284-41be-86af-2c1c722f93b1"
                                    },
                                    {
                                        "S": "542ad116-ed33-448a-a123-06cbcd7c1d4c"
                                    },
                                    {
                                        "S": "a4762196-7696-4fb8-b61f-446516650cb8"
                                    },
                                    {
                                        "S": "56c36c3f-9a39-4d90-ab17-f02b01462a86"
                                    },
                                    {
                                        "S": "7cd6cfd5-6960-4c36-a63a-e03a313faefc"
                                    },
                                    {
                                        "S": "6a688c0a-9dab-474c-979d-23e303312c78"
                                    },
                                    {
                                        "S": "81bd3248-f491-4721-a1ca-4cbca8c96442"
                                    },
                                    {
                                        "S": "ceb71f84-610b-4ecb-818e-989117dff0a7"
                                    },
                                    {
                                        "S": "eb386962-6997-4ab2-ad30-845797dd1686"
                                    },
                                    {
                                        "S": "a9806a61-432c-489f-9899-660d0b017259"
                                    },
                                    {
                                        "S": "d041ebe2-9a96-4e1e-8d66-be878022c137"
                                    },
                                    {
                                        "S": "eb520448-0b9a-4d3c-a573-acfb4c97c11d"
                                    },
                                    {
                                        "S": "61ef5d03-2505-41d6-b7b2-c6dd01c9deb9"
                                    },
                                    {
                                        "S": "f23eaa14-2069-47ff-b136-e6330788e7a9"
                                    },
                                    {
                                        "S": "5ea9f41b-3a2e-4a39-876a-d1f76a7d0fb0"
                                    },
                                    {
                                        "S": "d2960efd-a226-4b15-b5ec-b64ccb99995e"
                                    },
                                    {
                                        "S": "d2b4a8ce-bf30-44f9-843f-18e1cdba7886"
                                    },
                                    {
                                        "S": "19bc527d-bfba-41da-85a9-fe38edab915d"
                                    },
                                    {
                                        "S": "1f6023e7-b7df-404f-9cb9-636178381c93"
                                    },
                                    {
                                        "S": "22906986-7e08-4dc4-97f2-4e24bf7e000a"
                                    },
                                    {
                                        "S": "ffaddb3a-e4ea-4bf2-b04a-13163a3b6b1f"
                                    },
                                    {
                                        "S": "d4262fc6-ef6c-4c8b-924f-925a13f95dde"
                                    },
                                    {
                                        "S": "78d91201-157d-41a8-a9ca-720e6318cbd8"
                                    },
                                    {
                                        "S": "1b6c0d1d-30a3-4003-b591-10d95eb4019f"
                                    },
                                    {
                                        "S": "9e9749f7-e039-45e3-9227-04275ad25018"
                                    },
                                    {
                                        "S": "246227b9-54ae-49a8-808d-1e9caf4fb537"
                                    },
                                    {
                                        "S": "569df81c-5a1e-4792-9b68-a0ad5a6d3868"
                                    },
                                    {
                                        "S": "30489f91-98b3-46ef-ac97-6e9b42dc8d95"
                                    },
                                    {
                                        "S": "dd141e74-8e84-470c-953a-0ae6e755d81d"
                                    },
                                    {
                                        "S": "5e69a3c8-324e-40f7-97da-5f22084c8093"
                                    },
                                    {
                                        "S": "c05aad78-c002-4207-b136-47e31ca14e89"
                                    },
                                    {
                                        "S": "50f36cc0-56e4-4d26-8017-1c2f552f32fb"
                                    },
                                    {
                                        "S": "b6e60877-4ea6-46d4-b1c7-605202048160"
                                    },
                                    {
                                        "S": "6a6005b1-15fe-4ce3-853e-815942e225b1"
                                    },
                                    {
                                        "S": "5175a307-988c-4b56-a871-d6cadc5efb03"
                                    },
                                    {
                                        "S": "95bbd0b8-7617-48e2-9292-57c3e4f85cbd"
                                    },
                                    {
                                        "S": "13027b3c-579c-4506-995d-032170b68b32"
                                    },
                                    {
                                        "S": "f7128a8b-e62e-478e-ad97-c112fe030f89"
                                    },
                                    {
                                        "S": "5c784c7d-dd21-4ef5-9986-0451198681b9"
                                    },
                                    {
                                        "S": "12552d40-a3ae-46da-9a17-b99b0e5bc0dc"
                                    },
                                    {
                                        "S": "776c8ec5-4518-4c91-84f8-f22442680efa"
                                    },
                                    {
                                        "S": "7f2c624b-9267-4624-b798-c10178e96ab3"
                                    },
                                    {
                                        "S": "d6d24b64-386b-42ef-9410-c0c1defe13e1"
                                    },
                                    {
                                        "S": "e807f72e-c2b7-4cd1-a010-a2b1f15f7ee1"
                                    }
                                ]
                            }
                        }
                    }
                }
            },
            "site-detection": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": false
                    },
                    "enabled": {
                        "M": {
                            "sites": {
                                "L": [
                                    {
                                        "S": "9ab0575a-c238-4470-ae82-9d37fb2d0e78"
                                    }
                                ]
                            }
                        }
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    }
                }
            },
            "meta-tags-auto-suggest": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": false
                    },
                    "disabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    },
                    "enabled": {
                        "M": {
                            "sites": {
                                "L": [
                                    {
                                        "S": "d1a5d531-8c3a-42a0-a39a-e7f4a72f4015"
                                    },
                                    {
                                        "S": "0f889afa-270c-46b1-b831-425818c3fdd4"
                                    },
                                    {
                                        "S": "87ef8777-ef4b-4ddc-b399-47b65083b5fd"
                                    },
                                    {
                                        "S": "97bff092-e8c6-4fbb-825f-e199dadf65d1"
                                    },
                                    {
                                        "S": "9c1c5fdc-de7a-42e7-8d76-97df716112f0"
                                    },
                                    {
                                        "S": "c236a20b-c879-4960-b5b2-c0b607ade100"
                                    },
                                    {
                                        "S": "9d57757b-eae0-4011-a030-3367465bcb27"
                                    },
                                    {
                                        "S": "09a7c782-04ad-49b5-98cf-77fb75480d9f"
                                    },
                                    {
                                        "S": "b80f894b-032a-4724-b613-65cd6d40b80b"
                                    },
                                    {
                                        "S": "96f21bbd-ae3f-49fd-87f3-765862ef4abc"
                                    },
                                    {
                                        "S": "bce7f685-de5a-4a33-92eb-3c37064dac87"
                                    },
                                    {
                                        "S": "15d1546d-6284-41be-86af-2c1c722f93b1"
                                    },
                                    {
                                        "S": "542ad116-ed33-448a-a123-06cbcd7c1d4c"
                                    },
                                    {
                                        "S": "a4762196-7696-4fb8-b61f-446516650cb8"
                                    },
                                    {
                                        "S": "990c8eec-5eec-41e9-8fdd-38473813a924"
                                    },
                                    {
                                        "S": "56c36c3f-9a39-4d90-ab17-f02b01462a86"
                                    },
                                    {
                                        "S": "7cd6cfd5-6960-4c36-a63a-e03a313faefc"
                                    },
                                    {
                                        "S": "6a688c0a-9dab-474c-979d-23e303312c78"
                                    },
                                    {
                                        "S": "81bd3248-f491-4721-a1ca-4cbca8c96442"
                                    },
                                    {
                                        "S": "ceb71f84-610b-4ecb-818e-989117dff0a7"
                                    },
                                    {
                                        "S": "eb386962-6997-4ab2-ad30-845797dd1686"
                                    },
                                    {
                                        "S": "d041ebe2-9a96-4e1e-8d66-be878022c137"
                                    },
                                    {
                                        "S": "61ef5d03-2505-41d6-b7b2-c6dd01c9deb9"
                                    },
                                    {
                                        "S": "59579bb7-7c96-41c2-9159-d6cded5733cd"
                                    },
                                    {
                                        "S": "b694021e-b9c3-413c-9930-34692b513bd6"
                                    },
                                    {
                                        "S": "d2960efd-a226-4b15-b5ec-b64ccb99995e"
                                    },
                                    {
                                        "S": "1f6023e7-b7df-404f-9cb9-636178381c93"
                                    },
                                    {
                                        "S": "da448d97-0bc0-4b49-8110-9ffc4e113f96"
                                    },
                                    {
                                        "S": "36e4848b-d6e5-4350-a7f9-610e78325966"
                                    },
                                    {
                                        "S": "22906986-7e08-4dc4-97f2-4e24bf7e000a"
                                    },
                                    {
                                        "S": "02bd0de2-f8f5-49ed-905d-0e75153ef85a"
                                    },
                                    {
                                        "S": "c2473d89-e997-458d-a86d-b4096649c12b"
                                    },
                                    {
                                        "S": "ffaddb3a-e4ea-4bf2-b04a-13163a3b6b1f"
                                    },
                                    {
                                        "S": "eb9568f4-3c1a-4bc1-bfd0-b8d435118eb2"
                                    },
                                    {
                                        "S": "d4262fc6-ef6c-4c8b-924f-925a13f95dde"
                                    },
                                    {
                                        "S": "1b6c0d1d-30a3-4003-b591-10d95eb4019f"
                                    },
                                    {
                                        "S": "9e9749f7-e039-45e3-9227-04275ad25018"
                                    },
                                    {
                                        "S": "cccdac43-1a22-4659-9086-b762f59b9928"
                                    },
                                    {
                                        "S": "569df81c-5a1e-4792-9b68-a0ad5a6d3868"
                                    },
                                    {
                                        "S": "30489f91-98b3-46ef-ac97-6e9b42dc8d95"
                                    },
                                    {
                                        "S": "7be95fa1-e532-410c-b6f8-6584ca92ac09"
                                    },
                                    {
                                        "S": "dd141e74-8e84-470c-953a-0ae6e755d81d"
                                    },
                                    {
                                        "S": "5a377a31-b6c3-411c-8b00-62d7e1b116ac"
                                    },
                                    {
                                        "S": "5e69a3c8-324e-40f7-97da-5f22084c8093"
                                    },
                                    {
                                        "S": "c05aad78-c002-4207-b136-47e31ca14e89"
                                    },
                                    {
                                        "S": "50f36cc0-56e4-4d26-8017-1c2f552f32fb"
                                    },
                                    {
                                        "S": "b6e60877-4ea6-46d4-b1c7-605202048160"
                                    },
                                    {
                                        "S": "6a6005b1-15fe-4ce3-853e-815942e225b1"
                                    },
                                    {
                                        "S": "44482500-5aa9-4046-90f1-db52d64fc6de"
                                    },
                                    {
                                        "S": "20fa4a27-9083-4275-b11c-29d104c8f75e"
                                    },
                                    {
                                        "S": "5bee18ec-474e-45a7-aa14-aba6340d3c70"
                                    },
                                    {
                                        "S": "95bbd0b8-7617-48e2-9292-57c3e4f85cbd"
                                    },
                                    {
                                        "S": "13027b3c-579c-4506-995d-032170b68b32"
                                    },
                                    {
                                        "S": "ff51d86f-4d7b-4601-a792-9eef58779717"
                                    },
                                    {
                                        "S": "f7128a8b-e62e-478e-ad97-c112fe030f89"
                                    },
                                    {
                                        "S": "5c784c7d-dd21-4ef5-9986-0451198681b9"
                                    },
                                    {
                                        "S": "776c8ec5-4518-4c91-84f8-f22442680efa"
                                    },
                                    {
                                        "S": "12d892c5-779d-409f-b16b-56fba9304204"
                                    },
                                    {
                                        "S": "7f2c624b-9267-4624-b798-c10178e96ab3"
                                    },
                                    {
                                        "S": "e807f72e-c2b7-4cd1-a010-a2b1f15f7ee1"
                                    },
                                    {
                                        "S": "5824344d-fa1a-4b3f-8eb6-a6c6a3cff646"
                                    }
                                ]
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    }
                }
            },
            "sitemap": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": true
                    },
                    "disabled": {
                        "M": {
                            "sites": {
                                "L": [
                                    {
                                        "S": "eb520448-0b9a-4d3c-a573-acfb4c97c11d"
                                    },
                                    {
                                        "S": "02bd0de2-f8f5-49ed-905d-0e75153ef85a"
                                    },
                                    {
                                        "S": "7f1cc65a-b16b-4986-b564-86c4b1190e55"
                                    },
                                    {
                                        "S": "f35ffe86-4d9b-4c13-a20b-9e6fc6231ead"
                                    },
                                    {
                                        "S": "906aadc7-0505-4cb5-9ecd-cb6bbc463aab"
                                    },
                                    {
                                        "S": "c87f1637-ad0e-4694-b5e4-941eb3e59099"
                                    },
                                    {
                                        "S": "5bee18ec-474e-45a7-aa14-aba6340d3c70"
                                    },
                                    {
                                        "S": "78084675-d658-45a1-903c-0e51db07f283"
                                    },
                                    {
                                        "S": "47f0014e-0b2d-4131-8c44-63b652acaa90"
                                    },
                                    {
                                        "S": "0572c386-d504-4560-8f62-3f50484bbc14"
                                    },
                                    {
                                        "S": "1fa0bec9-2224-4323-af5c-cb7cb3288344"
                                    },
                                    {
                                        "S": "905fa594-b188-4796-b0bc-4a46f86a4c21"
                                    },
                                    {
                                        "S": "c8df9f07-83d0-4866-8398-60f722dc606a"
                                    },
                                    {
                                        "S": "0dd8f91f-be96-4324-865f-6dd8456f5673"
                                    },
                                    {
                                        "S": "4605dbad-dacf-4323-b44c-0110756587d7"
                                    }
                                ]
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    },
                    "enabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    }
                }
            },
            "404-external": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": false
                    },
                    "enabled": {
                        "M": {
                            "sites": {
                                "L": [
                                    {
                                        "S": "9a90868e-a56c-4340-909e-686bf82d58a0"
                                    },
                                    {
                                        "S": "5bcee0ac-4626-44e3-9d06-8143ff03f0ad"
                                    },
                                    {
                                        "S": "9ab0575a-c238-4470-ae82-9d37fb2d0e78"
                                    },
                                    {
                                        "S": "d5605edb-d3ef-4b0e-801f-322edb2eeeab"
                                    },
                                    {
                                        "S": "044ea848-2c33-4d12-be75-bcc6c4461dba"
                                    }
                                ]
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    }
                }
            },
            "meta-tags-auto-fix": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": false
                    },
                    "disabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    },
                    "enabled": {
                        "M": {
                            "sites": {
                                "L": [
                                    {
                                        "S": "36e4848b-d6e5-4350-a7f9-610e78325966"
                                    },
                                    {
                                        "S": "0f889afa-270c-46b1-b831-425818c3fdd4"
                                    },
                                    {
                                        "S": "52322a41-d11d-4e08-85fc-6eaf31b0741c"
                                    },
                                    {
                                        "S": "5175a307-988c-4b56-a871-d6cadc5efb03"
                                    },
                                    {
                                        "S": "f127adab-2e07-4f01-9721-0ea1859983aa"
                                    },
                                    {
                                        "S": "5c0cf22b-2323-4b03-b170-c7e15f2b4fc6"
                                    },
                                    {
                                        "S": "5d13a94e-db34-47d2-b3e4-4374d174b0b1"
                                    },
                                    {
                                        "S": "78d91201-157d-41a8-a9ca-720e6318cbd8"
                                    },
                                    {
                                        "S": "ffaddb3a-e4ea-4bf2-b04a-13163a3b6b1f"
                                    },
                                    {
                                        "S": "9e9749f7-e039-45e3-9227-04275ad25018"
                                    },
                                    {
                                        "S": "569df81c-5a1e-4792-9b68-a0ad5a6d3868"
                                    },
                                    {
                                        "S": "97bff092-e8c6-4fbb-825f-e199dadf65d1"
                                    },
                                    {
                                        "S": "f7128a8b-e62e-478e-ad97-c112fe030f89"
                                    },
                                    {
                                        "S": "5c784c7d-dd21-4ef5-9986-0451198681b9"
                                    },
                                    {
                                        "S": "5bee18ec-474e-45a7-aa14-aba6340d3c70"
                                    },
                                    {
                                        "S": "776c8ec5-4518-4c91-84f8-f22442680efa"
                                    },
                                    {
                                        "S": "cccdac43-1a22-4659-9086-b762f59b9928"
                                    },
                                    {
                                        "S": "7f2c624b-9267-4624-b798-c10178e96ab3"
                                    },
                                    {
                                        "S": "81bd3248-f491-4721-a1ca-4cbca8c96442"
                                    },
                                    {
                                        "S": "e807f72e-c2b7-4cd1-a010-a2b1f15f7ee1"
                                    }
                                ]
                            }
                        }
                    }
                }
            },
            "structured-data": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": false
                    },
                    "disabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    },
                    "enabled": {
                        "M": {
                            "sites": {
                                "L": [
                                    {
                                        "S": "d04f59a7-3962-40fa-99eb-bf47faa95026"
                                    },
                                    {
                                        "S": "97eea6f3-497c-4f9e-86db-7848b6a7db77"
                                    },
                                    {
                                        "S": "5a377a31-b6c3-411c-8b00-62d7e1b116ac"
                                    },
                                    {
                                        "S": "c81ff7c9-cea3-4cba-9438-6d62d26d160f"
                                    },
                                    {
                                        "S": "ba2010ef-ac81-475c-89e1-3628bae31d28"
                                    },
                                    {
                                        "S": "12d892c5-779d-409f-b16b-56fba9304204"
                                    },
                                    {
                                        "S": "cccdac43-1a22-4659-9086-b762f59b9928"
                                    },
                                    {
                                        "S": "916e7978-0375-4b8f-a5bd-75d88113b10f"
                                    },
                                    {
                                        "S": "36e4848b-d6e5-4350-a7f9-610e78325966"
                                    },
                                    {
                                        "S": "0f889afa-270c-46b1-b831-425818c3fdd4"
                                    },
                                    {
                                        "S": "15d1546d-6284-41be-86af-2c1c722f93b1"
                                    },
                                    {
                                        "S": "542ad116-ed33-448a-a123-06cbcd7c1d4c"
                                    },
                                    {
                                        "S": "a4762196-7696-4fb8-b61f-446516650cb8"
                                    },
                                    {
                                        "S": "56c36c3f-9a39-4d90-ab17-f02b01462a86"
                                    },
                                    {
                                        "S": "eb520448-0b9a-4d3c-a573-acfb4c97c11d"
                                    },
                                    {
                                        "S": "7cd6cfd5-6960-4c36-a63a-e03a313faefc"
                                    },
                                    {
                                        "S": "6a688c0a-9dab-474c-979d-23e303312c78"
                                    },
                                    {
                                        "S": "81bd3248-f491-4721-a1ca-4cbca8c96442"
                                    },
                                    {
                                        "S": "ceb71f84-610b-4ecb-818e-989117dff0a7"
                                    },
                                    {
                                        "S": "eb386962-6997-4ab2-ad30-845797dd1686"
                                    },
                                    {
                                        "S": "a9806a61-432c-489f-9899-660d0b017259"
                                    },
                                    {
                                        "S": "d041ebe2-9a96-4e1e-8d66-be878022c137"
                                    },
                                    {
                                        "S": "40f377b0-2242-41d6-b215-e9ff8ace8b3d"
                                    },
                                    {
                                        "S": "61ef5d03-2505-41d6-b7b2-c6dd01c9deb9"
                                    },
                                    {
                                        "S": "f23eaa14-2069-47ff-b136-e6330788e7a9"
                                    },
                                    {
                                        "S": "52322a41-d11d-4e08-85fc-6eaf31b0741c"
                                    },
                                    {
                                        "S": "f7128a8b-e62e-478e-ad97-c112fe030f89"
                                    },
                                    {
                                        "S": "d2960efd-a226-4b15-b5ec-b64ccb99995e"
                                    },
                                    {
                                        "S": "1f6023e7-b7df-404f-9cb9-636178381c93"
                                    },
                                    {
                                        "S": "22906986-7e08-4dc4-97f2-4e24bf7e000a"
                                    },
                                    {
                                        "S": "ffaddb3a-e4ea-4bf2-b04a-13163a3b6b1f"
                                    },
                                    {
                                        "S": "d4262fc6-ef6c-4c8b-924f-925a13f95dde"
                                    },
                                    {
                                        "S": "1b6c0d1d-30a3-4003-b591-10d95eb4019f"
                                    },
                                    {
                                        "S": "9e9749f7-e039-45e3-9227-04275ad25018"
                                    },
                                    {
                                        "S": "c487d626-363a-4864-86eb-1a96f924714d"
                                    },
                                    {
                                        "S": "246227b9-54ae-49a8-808d-1e9caf4fb537"
                                    },
                                    {
                                        "S": "0c32fd58-de1d-48d1-acb4-74b98642fd7d"
                                    },
                                    {
                                        "S": "569df81c-5a1e-4792-9b68-a0ad5a6d3868"
                                    },
                                    {
                                        "S": "30489f91-98b3-46ef-ac97-6e9b42dc8d95"
                                    },
                                    {
                                        "S": "f35ffe86-4d9b-4c13-a20b-9e6fc6231ead"
                                    },
                                    {
                                        "S": "19bc527d-bfba-41da-85a9-fe38edab915d"
                                    },
                                    {
                                        "S": "95bbd0b8-7617-48e2-9292-57c3e4f85cbd"
                                    },
                                    {
                                        "S": "13027b3c-579c-4506-995d-032170b68b32"
                                    },
                                    {
                                        "S": "ff51d86f-4d7b-4601-a792-9eef58779717"
                                    },
                                    {
                                        "S": "6bafb757-e26e-457f-8362-ca8154950a21"
                                    },
                                    {
                                        "S": "c2473d89-e997-458d-a86d-b4096649c12b"
                                    }
                                ]
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "dependencies": {
                        "L": [
                            {
                                "M": {
                                    "handler": {
                                        "S": "scrape-top-pages"
                                    }
                                }
                            }
                        ]
                    }
                }
            },
            "experimentation-ess-monthly": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": false
                    },
                    "enabled": {
                        "M": {
                            "sites": {
                                "L": [
                                    {
                                        "S": "7be95fa1-e532-410c-b6f8-6584ca92ac09"
                                    },
                                    {
                                        "S": "36e4848b-d6e5-4350-a7f9-610e78325966"
                                    },
                                    {
                                        "S": "9ab0575a-c238-4470-ae82-9d37fb2d0e78"
                                    },
                                    {
                                        "S": "40973a5f-5eb8-46be-8d42-c51d73548bf4"
                                    },
                                    {
                                        "S": "cccdac43-1a22-4659-9086-b762f59b9928"
                                    },
                                    {
                                        "S": "907ee921-62ee-4e7d-9276-15119c4f4924"
                                    },
                                    {
                                        "S": "340e9cec-1c49-4367-973d-0235c06b441a"
                                    },
                                    {
                                        "S": "1eedc2f0-5b30-4e87-8d5e-7e87efd62c2d"
                                    },
                                    {
                                        "S": "0d296d9c-393e-4603-8bd7-f908d948062e"
                                    },
                                    {
                                        "S": "d04f59a7-3962-40fa-99eb-bf47faa95026"
                                    },
                                    {
                                        "S": "78b0ba3e-9ab9-4031-8f46-08bde01d7b6c"
                                    },
                                    {
                                        "S": "542ad116-ed33-448a-a123-06cbcd7c1d4c"
                                    },
                                    {
                                        "S": "1cae9ee7-cbc9-4fa9-9d64-af52b8ccc996"
                                    },
                                    {
                                        "S": "2be1302c-f877-471f-9a6b-03e282dc94c3"
                                    },
                                    {
                                        "S": "42b4e20a-218e-4e64-b8e1-4315d6ac0c97"
                                    }
                                ]
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    }
                }
            },
            "canonical": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": true
                    },
                    "disabled": {
                        "M": {
                            "sites": {
                                "L": [
                                    {
                                        "S": "f7128a8b-e62e-478e-ad97-c112fe030f89"
                                    }
                                ]
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    },
                    "enabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    }
                }
            },
            "prerender": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": true
                    },
                    "disabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "LLMO"
                            }
                        ]
                    },
                    "enabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    }
                }
            },
            "content-fragment-broken-links": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": false
                    },
                    "disabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "enabled": {
                        "M": {
                            "sites": {
                                "L": [
                                    {
                                        "S": "3e9c2eab-b7ae-4366-aab7-00b37e722f94"
                                    }
                                ]
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    }
                }
            },
            "llmo-referral-traffic": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": false
                    },
                    "disabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    },
                    "enabled": {
                        "M": {
                            "sites": {
                                "L": [
                                    {
                                        "S": "c2473d89-e997-458d-a86d-b4096649c12b"
                                    },
                                    {
                                        "S": "d5605edb-d3ef-4b0e-801f-322edb2eeeab"
                                    },
                                    {
                                        "S": "cccdac43-1a22-4659-9086-b762f59b9928"
                                    },
                                    {
                                        "S": "367bfb05-6300-4112-90e0-87d1ad92413b"
                                    },
                                    {
                                        "S": "abe091f5-65d6-488a-aad1-cc1cf6bec25b"
                                    },
                                    {
                                        "S": "028147f6-4a7a-4325-a758-376c460a559c"
                                    },
                                    {
                                        "S": "4c6b7ad2-c402-4354-b549-5ffe5e153f69"
                                    },
                                    {
                                        "S": "43dfec0c-c21e-4f6a-b896-e82e01e8a189"
                                    },
                                    {
                                        "S": "b1555a54-48b4-47ee-97c1-438257bd3839"
                                    },
                                    {
                                        "S": "3abcdede-b53f-4e7e-9d73-34e8316364c7"
                                    },
                                    {
                                        "S": "6fdcadaf-04e1-4411-aeeb-daa146df44d7"
                                    },
                                    {
                                        "S": "bb961426-c338-45d6-bae3-2b8701a62826"
                                    },
                                    {
                                        "S": "f7f99ad5-99a2-43e9-9b0a-b1d0da5893cf"
                                    },
                                    {
                                        "S": "b707e5c2-66c0-43b2-9739-55a0c498fe91"
                                    },
                                    {
                                        "S": "ddafe3af-97b7-4975-8334-b10de7df76c5"
                                    },
                                    {
                                        "S": "6b742ebf-1ab0-4478-9254-ea8e561aa7b4"
                                    },
                                    {
                                        "S": "f000abcd-cec1-40c6-a9a1-7fa12b3e2d6c"
                                    },
                                    {
                                        "S": "0fe19d0c-2b42-48b9-9694-3ff6cbe12f89"
                                    },
                                    {
                                        "S": "ec457c65-2809-4b2d-bf71-d444e77de480"
                                    },
                                    {
                                        "S": "0572c386-d504-4560-8f62-3f50484bbc14"
                                    },
                                    {
                                        "S": "74922aa7-15eb-4438-beaa-2f2af48f9621"
                                    },
                                    {
                                        "S": "13c2b5f6-d338-4502-bb90-324a429683f9"
                                    },
                                    {
                                        "S": "a12e4af3-27a8-49cf-a2a5-a7e57a990991"
                                    },
                                    {
                                        "S": "23f63ae8-d27b-43cb-9631-c784ef86433e"
                                    },
                                    {
                                        "S": "38fbd289-03df-4f34-80ea-9333d4e4d6d7"
                                    },
                                    {
                                        "S": "6d4ea2bb-f7b2-49d3-af5d-0ec4579c7a9b"
                                    },
                                    {
                                        "S": "b9fdacaf-30ed-4150-ac66-883c9cc66f91"
                                    },
                                    {
                                        "S": "b51318fd-ebf9-4987-bf10-77e5ef16f742"
                                    },
                                    {
                                        "S": "0c7beaaf-9b37-4010-bdae-37cbeec2ca96"
                                    },
                                    {
                                        "S": "7a3409e7-6941-45da-8ee6-e7c3fe07bcdb"
                                    },
                                    {
                                        "S": "c617bfe6-bc36-4ef9-b320-2c816a9c0d32"
                                    },
                                    {
                                        "S": "65182878-007e-4931-a81a-7467fae5c88d"
                                    },
                                    {
                                        "S": "bea9d9d3-a57e-44ef-ad61-231275a8ec2b"
                                    },
                                    {
                                        "S": "178cbdfe-f80f-4b03-9213-ae56057f8de3"
                                    },
                                    {
                                        "S": "12d892c5-779d-409f-b16b-56fba9304204"
                                    },
                                    {
                                        "S": "adce2108-d9e3-441a-8827-201af7fbfdc0"
                                    },
                                    {
                                        "S": "96b65b91-0bec-4f5b-9789-f9cd5f91e0fe"
                                    },
                                    {
                                        "S": "d04f59a7-3962-40fa-99eb-bf47faa95026"
                                    },
                                    {
                                        "S": "ff51d86f-4d7b-4601-a792-9eef58779717"
                                    },
                                    {
                                        "S": "d79a4266-b12f-4fdb-8e45-0a75134b4710"
                                    },
                                    {
                                        "S": "67d3e39a-3279-4e55-9a9a-eb4c6475dee1"
                                    },
                                    {
                                        "S": "432a32c9-a7ec-4357-92aa-6f578356bcb4"
                                    },
                                    {
                                        "S": "cdb99f9e-df5e-4289-a896-99c4b8908f1c"
                                    },
                                    {
                                        "S": "71a460a5-2e81-4b11-9cd0-c93741911f7f"
                                    },
                                    {
                                        "S": "f3fc07e9-7226-49dd-917c-7f7355df85c1"
                                    },
                                    {
                                        "S": "648bffec-279e-450a-bc65-4fae9bf968c5"
                                    },
                                    {
                                        "S": "d2960efd-a226-4b15-b5ec-b64ccb99995e"
                                    },
                                    {
                                        "S": "8254bd9e-8335-496f-8027-cf67157adfe9"
                                    },
                                    {
                                        "S": "16104fb8-b61d-43a4-9836-888b9f3eaa1a"
                                    },
                                    {
                                        "S": "64b47eec-d3d3-46c0-95cd-d0cc02045ee8"
                                    },
                                    {
                                        "S": "10031ba1-2182-4386-9eec-8eabd85c7022"
                                    },
                                    {
                                        "S": "72ffb29e-09ef-4e87-bcd6-d58f4f27afa8"
                                    },
                                    {
                                        "S": "ac337e40-c610-4b95-a0c0-43f605058fe4"
                                    },
                                    {
                                        "S": "457afb19-dcc9-41c7-8d93-f29a8c871e37"
                                    },
                                    {
                                        "S": "559a41c0-379e-4ba3-9035-3d4a91e97988"
                                    },
                                    {
                                        "S": "34f30d1f-2665-4401-b243-40e1afc02307"
                                    },
                                    {
                                        "S": "12d54932-e963-4783-aac3-4b1edbc27cde"
                                    },
                                    {
                                        "S": "2c735382-0497-42a6-a435-1efa7d75921c"
                                    },
                                    {
                                        "S": "9ba371e5-ed92-4a5a-a8cf-15a2989704b7"
                                    },
                                    {
                                        "S": "1ed6fb38-1f95-4e3c-ac9c-c0bdcdbde8da"
                                    },
                                    {
                                        "S": "1eedc2f0-5b30-4e87-8d5e-7e87efd62c2d"
                                    },
                                    {
                                        "S": "36e4848b-d6e5-4350-a7f9-610e78325966"
                                    },
                                    {
                                        "S": "f35ffe86-4d9b-4c13-a20b-9e6fc6231ead"
                                    },
                                    {
                                        "S": "19d61aaa-09bd-430d-9d4e-e17bc3b9b5ba"
                                    },
                                    {
                                        "S": "f753f464-53ba-4c04-82a0-c0271808e1f5"
                                    },
                                    {
                                        "S": "415b4ae8-e6f8-4be7-a5c8-76605c1cad56"
                                    },
                                    {
                                        "S": "1b7592da-da6f-4efe-a702-a70442f87155"
                                    },
                                    {
                                        "S": "3f5c649c-3666-4171-9cc5-50511b669362"
                                    },
                                    {
                                        "S": "822e1ffb-9313-4188-bb44-3d2cc52b3c3d"
                                    },
                                    {
                                        "S": "4560c5a1-c2b8-4188-b2d3-330886ef90bc"
                                    },
                                    {
                                        "S": "408cd1be-d781-429d-a360-09943ed9d705"
                                    },
                                    {
                                        "S": "b5e1885d-bd39-45c6-a39f-f0c478f820d5"
                                    },
                                    {
                                        "S": "c236a20b-c879-4960-b5b2-c0b607ade100"
                                    },
                                    {
                                        "S": "ff7b3145-541f-43fc-96a3-187b6ba9336f"
                                    },
                                    {
                                        "S": "9b5b02d3-9e01-49af-bb7f-1a4c9faf6729"
                                    },
                                    {
                                        "S": "db8e44df-8a4d-4f0f-b049-3315ff6afbdc"
                                    },
                                    {
                                        "S": "6bd5cad1-9000-4fd5-8fc6-d232b34325f7"
                                    },
                                    {
                                        "S": "e54754be-9217-4fb6-8937-48337b22e8b5"
                                    },
                                    {
                                        "S": "eb39e797-ab5e-496a-95ee-469499c8867a"
                                    }
                                ]
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    }
                }
            },
            "page-intent": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": false
                    },
                    "disabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    },
                    "enabled": {
                        "M": {
                            "sites": {
                                "L": [
                                    {
                                        "S": "cccdac43-1a22-4659-9086-b762f59b9928"
                                    },
                                    {
                                        "S": "c2473d89-e997-458d-a86d-b4096649c12b"
                                    }
                                ]
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    }
                }
            },
            "hreflang": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": true
                    },
                    "disabled": {
                        "M": {
                            "sites": {
                                "L": [
                                    {
                                        "S": "f7128a8b-e62e-478e-ad97-c112fe030f89"
                                    }
                                ]
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    },
                    "enabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    }
                }
            },
            "lhs-desktop": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": true
                    },
                    "disabled": {
                        "M": {
                            "sites": {
                                "L": [
                                    {
                                        "S": "7be95fa1-e532-410c-b6f8-6584ca92ac09"
                                    },
                                    {
                                        "S": "7f1cc65a-b16b-4986-b564-86c4b1190e55"
                                    },
                                    {
                                        "S": "4605dbad-dacf-4323-b44c-0110756587d7"
                                    }
                                ]
                            }
                        }
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    },
                    "enabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    }
                }
            },
            "security-permissions-redundant": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": false
                    },
                    "disabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    },
                    "enabled": {
                        "M": {
                            "sites": {
                                "L": [
                                    {
                                        "S": "aa4b7d3d-c2a8-4179-b878-86e5efe78ce5"
                                    }
                                ]
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "dependencies": {
                        "L": []
                    }
                }
            },
            "product-metatags": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": false
                    },
                    "disabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    },
                    "enabled": {
                        "M": {
                            "sites": {
                                "L": [
                                    {
                                        "S": "cccdac43-1a22-4659-9086-b762f59b9928"
                                    },
                                    {
                                        "S": "40f377b0-2242-41d6-b215-e9ff8ace8b3d"
                                    },
                                    {
                                        "S": "7f2c624b-9267-4624-b798-c10178e96ab3"
                                    },
                                    {
                                        "S": "776c8ec5-4518-4c91-84f8-f22442680efa"
                                    },
                                    {
                                        "S": "81bd3248-f491-4721-a1ca-4cbca8c96442"
                                    },
                                    {
                                        "S": "e807f72e-c2b7-4cd1-a010-a2b1f15f7ee1"
                                    },
                                    {
                                        "S": "c236a20b-c879-4960-b5b2-c0b607ade100"
                                    }
                                ]
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    }
                }
            },
            "cdn-logs-report": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": false
                    },
                    "disabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    },
                    "enabled": {
                        "M": {
                            "sites": {
                                "L": [
                                    {
                                        "S": "2c735382-0497-42a6-a435-1efa7d75921c"
                                    },
                                    {
                                        "S": "028147f6-4a7a-4325-a758-376c460a559c"
                                    },
                                    {
                                        "S": "d2960efd-a226-4b15-b5ec-b64ccb99995e"
                                    },
                                    {
                                        "S": "8254bd9e-8335-496f-8027-cf67157adfe9"
                                    },
                                    {
                                        "S": "12d54932-e963-4783-aac3-4b1edbc27cde"
                                    },
                                    {
                                        "S": "16104fb8-b61d-43a4-9836-888b9f3eaa1a"
                                    },
                                    {
                                        "S": "64b47eec-d3d3-46c0-95cd-d0cc02045ee8"
                                    },
                                    {
                                        "S": "10031ba1-2182-4386-9eec-8eabd85c7022"
                                    },
                                    {
                                        "S": "72ffb29e-09ef-4e87-bcd6-d58f4f27afa8"
                                    },
                                    {
                                        "S": "ac337e40-c610-4b95-a0c0-43f605058fe4"
                                    },
                                    {
                                        "S": "457afb19-dcc9-41c7-8d93-f29a8c871e37"
                                    },
                                    {
                                        "S": "559a41c0-379e-4ba3-9035-3d4a91e97988"
                                    },
                                    {
                                        "S": "34f30d1f-2665-4401-b243-40e1afc02307"
                                    },
                                    {
                                        "S": "9ba371e5-ed92-4a5a-a8cf-15a2989704b7"
                                    },
                                    {
                                        "S": "36e4848b-d6e5-4350-a7f9-610e78325966"
                                    },
                                    {
                                        "S": "bb961426-c338-45d6-bae3-2b8701a62826"
                                    },
                                    {
                                        "S": "f35ffe86-4d9b-4c13-a20b-9e6fc6231ead"
                                    },
                                    {
                                        "S": "38fbd289-03df-4f34-80ea-9333d4e4d6d7"
                                    },
                                    {
                                        "S": "19d61aaa-09bd-430d-9d4e-e17bc3b9b5ba"
                                    },
                                    {
                                        "S": "f753f464-53ba-4c04-82a0-c0271808e1f5"
                                    },
                                    {
                                        "S": "415b4ae8-e6f8-4be7-a5c8-76605c1cad56"
                                    },
                                    {
                                        "S": "1b7592da-da6f-4efe-a702-a70442f87155"
                                    },
                                    {
                                        "S": "3f5c649c-3666-4171-9cc5-50511b669362"
                                    },
                                    {
                                        "S": "822e1ffb-9313-4188-bb44-3d2cc52b3c3d"
                                    },
                                    {
                                        "S": "4560c5a1-c2b8-4188-b2d3-330886ef90bc"
                                    },
                                    {
                                        "S": "408cd1be-d781-429d-a360-09943ed9d705"
                                    },
                                    {
                                        "S": "b5e1885d-bd39-45c6-a39f-f0c478f820d5"
                                    },
                                    {
                                        "S": "c236a20b-c879-4960-b5b2-c0b607ade100"
                                    },
                                    {
                                        "S": "db8e44df-8a4d-4f0f-b049-3315ff6afbdc"
                                    },
                                    {
                                        "S": "6bd5cad1-9000-4fd5-8fc6-d232b34325f7"
                                    },
                                    {
                                        "S": "e54754be-9217-4fb6-8937-48337b22e8b5"
                                    },
                                    {
                                        "S": "eb39e797-ab5e-496a-95ee-469499c8867a"
                                    },
                                    {
                                        "S": "cccdac43-1a22-4659-9086-b762f59b9928"
                                    }
                                ]
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    }
                }
            },
            "metatags-preflight": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": true
                    },
                    "disabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    },
                    "enabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    }
                }
            },
            "audit-status-processor": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": true
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    }
                }
            },
            "conversion-internal": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": true
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    }
                }
            },
            "summarization": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": false
                    },
                    "disabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    },
                    "enabled": {
                        "M": {
                            "sites": {
                                "L": [
                                    {
                                        "S": "c236a20b-c879-4960-b5b2-c0b607ade100"
                                    },
                                    {
                                        "S": "cccdac43-1a22-4659-9086-b762f59b9928"
                                    },
                                    {
                                        "S": "c2473d89-e997-458d-a86d-b4096649c12b"
                                    },
                                    {
                                        "S": "2c735382-0497-42a6-a435-1efa7d75921c"
                                    },
                                    {
                                        "S": "028147f6-4a7a-4325-a758-376c460a559c"
                                    },
                                    {
                                        "S": "12d54932-e963-4783-aac3-4b1edbc27cde"
                                    },
                                    {
                                        "S": "38fbd289-03df-4f34-80ea-9333d4e4d6d7"
                                    }
                                ]
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "dependencies": {
                        "L": [
                            {
                                "M": {
                                    "handler": {
                                        "S": "scrape-top-pages"
                                    }
                                }
                            }
                        ]
                    }
                }
            },
            "usage-metrics-internal": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": false
                    },
                    "disabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    },
                    "enabled": {
                        "M": {
                            "sites": {
                                "L": [
                                    {
                                        "S": "36e4848b-d6e5-4350-a7f9-610e78325966"
                                    },
                                    {
                                        "S": "97bff092-e8c6-4fbb-825f-e199dadf65d1"
                                    }
                                ]
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    }
                }
            },
            "lorem-ipsum-preflight": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": true
                    },
                    "disabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    },
                    "enabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    }
                }
            },
            "page-type-detection": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": false
                    },
                    "disabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    },
                    "enabled": {
                        "M": {
                            "sites": {
                                "L": [
                                    {
                                        "S": "cccdac43-1a22-4659-9086-b762f59b9928"
                                    }
                                ]
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    }
                }
            },
            "experimentation-ess-daily": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": false
                    },
                    "disabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    },
                    "enabled": {
                        "M": {
                            "sites": {
                                "L": [
                                    {
                                        "S": "193649cd-2a34-4b2e-9b33-2ba129884aae"
                                    },
                                    {
                                        "S": "36e4848b-d6e5-4350-a7f9-610e78325966"
                                    },
                                    {
                                        "S": "9ab0575a-c238-4470-ae82-9d37fb2d0e78"
                                    },
                                    {
                                        "S": "40973a5f-5eb8-46be-8d42-c51d73548bf4"
                                    },
                                    {
                                        "S": "cccdac43-1a22-4659-9086-b762f59b9928"
                                    },
                                    {
                                        "S": "907ee921-62ee-4e7d-9276-15119c4f4924"
                                    },
                                    {
                                        "S": "340e9cec-1c49-4367-973d-0235c06b441a"
                                    },
                                    {
                                        "S": "1eedc2f0-5b30-4e87-8d5e-7e87efd62c2d"
                                    },
                                    {
                                        "S": "0d296d9c-393e-4603-8bd7-f908d948062e"
                                    },
                                    {
                                        "S": "d04f59a7-3962-40fa-99eb-bf47faa95026"
                                    },
                                    {
                                        "S": "78b0ba3e-9ab9-4031-8f46-08bde01d7b6c"
                                    },
                                    {
                                        "S": "542ad116-ed33-448a-a123-06cbcd7c1d4c"
                                    },
                                    {
                                        "S": "1cae9ee7-cbc9-4fa9-9d64-af52b8ccc996"
                                    },
                                    {
                                        "S": "2be1302c-f877-471f-9a6b-03e282dc94c3"
                                    },
                                    {
                                        "S": "42b4e20a-218e-4e64-b8e1-4315d6ac0c97"
                                    },
                                    {
                                        "S": "97eea6f3-497c-4f9e-86db-7848b6a7db77"
                                    },
                                    {
                                        "S": "569df81c-5a1e-4792-9b68-a0ad5a6d3868"
                                    },
                                    {
                                        "S": "30489f91-98b3-46ef-ac97-6e9b42dc8d95"
                                    }
                                ]
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    }
                }
            },
            "broken-internal-links-external": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": false
                    },
                    "enabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    }
                }
            },
            "readability-preflight": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": true
                    },
                    "disabled": {
                        "M": {
                            "sites": {
                                "L": [
                                    {
                                        "S": "b694021e-b9c3-413c-9930-34692b513bd6"
                                    },
                                    {
                                        "S": "d5605edb-d3ef-4b0e-801f-322edb2eeeab"
                                    }
                                ]
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    },
                    "enabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    }
                }
            },
            "forms-opportunities": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": false
                    },
                    "disabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    },
                    "enabled": {
                        "M": {
                            "sites": {
                                "L": [
                                    {
                                        "S": "1cae9ee7-cbc9-4fa9-9d64-af52b8ccc996"
                                    },
                                    {
                                        "S": "8d6c1e2c-bfe6-416b-9578-9963c3e30e71"
                                    },
                                    {
                                        "S": "36e4848b-d6e5-4350-a7f9-610e78325966"
                                    },
                                    {
                                        "S": "5a377a31-b6c3-411c-8b00-62d7e1b116ac"
                                    },
                                    {
                                        "S": "cace79e5-967d-4fa6-93de-fb2c8bba8f95"
                                    },
                                    {
                                        "S": "87dcfd45-0899-4f34-8584-c644cc94ff4a"
                                    },
                                    {
                                        "S": "04fb3fbe-e84f-4268-bb6f-5d0706bbe3c0"
                                    },
                                    {
                                        "S": "df6d67d1-cc64-465d-8ddf-92d55b4e385e"
                                    },
                                    {
                                        "S": "97bff092-e8c6-4fbb-825f-e199dadf65d1"
                                    },
                                    {
                                        "S": "f3fc07e9-7226-49dd-917c-7f7355df85c1"
                                    },
                                    {
                                        "S": "d1a5d531-8c3a-42a0-a39a-e7f4a72f4015"
                                    },
                                    {
                                        "S": "0f889afa-270c-46b1-b831-425818c3fdd4"
                                    },
                                    {
                                        "S": "87ef8777-ef4b-4ddc-b399-47b65083b5fd"
                                    },
                                    {
                                        "S": "9c1c5fdc-de7a-42e7-8d76-97df716112f0"
                                    },
                                    {
                                        "S": "c236a20b-c879-4960-b5b2-c0b607ade100"
                                    },
                                    {
                                        "S": "9d57757b-eae0-4011-a030-3367465bcb27"
                                    },
                                    {
                                        "S": "09a7c782-04ad-49b5-98cf-77fb75480d9f"
                                    },
                                    {
                                        "S": "b80f894b-032a-4724-b613-65cd6d40b80b"
                                    },
                                    {
                                        "S": "96f21bbd-ae3f-49fd-87f3-765862ef4abc"
                                    },
                                    {
                                        "S": "bce7f685-de5a-4a33-92eb-3c37064dac87"
                                    },
                                    {
                                        "S": "bfc4a90e-214e-41a1-8aaf-c7959fa90173"
                                    },
                                    {
                                        "S": "5e69a3c8-324e-40f7-97da-5f22084c8093"
                                    },
                                    {
                                        "S": "d04f59a7-3962-40fa-99eb-bf47faa95026"
                                    },
                                    {
                                        "S": "15d1546d-6284-41be-86af-2c1c722f93b1"
                                    },
                                    {
                                        "S": "542ad116-ed33-448a-a123-06cbcd7c1d4c"
                                    },
                                    {
                                        "S": "a4762196-7696-4fb8-b61f-446516650cb8"
                                    },
                                    {
                                        "S": "9688cb89-daab-4f7a-b87f-f46401c98226"
                                    },
                                    {
                                        "S": "7e67eaae-e7aa-4eec-9c02-1fe52391bac4"
                                    },
                                    {
                                        "S": "2c4dc52b-1f38-4ae7-9bec-f55569ed0d80"
                                    },
                                    {
                                        "S": "12d892c5-779d-409f-b16b-56fba9304204"
                                    },
                                    {
                                        "S": "432a32c9-a7ec-4357-92aa-6f578356bcb4"
                                    },
                                    {
                                        "S": "6b86c813-bddc-4192-a4e8-ce20a8f7fe20"
                                    },
                                    {
                                        "S": "56c36c3f-9a39-4d90-ab17-f02b01462a86"
                                    },
                                    {
                                        "S": "7cd6cfd5-6960-4c36-a63a-e03a313faefc"
                                    },
                                    {
                                        "S": "6a688c0a-9dab-474c-979d-23e303312c78"
                                    },
                                    {
                                        "S": "81bd3248-f491-4721-a1ca-4cbca8c96442"
                                    },
                                    {
                                        "S": "ceb71f84-610b-4ecb-818e-989117dff0a7"
                                    },
                                    {
                                        "S": "eb386962-6997-4ab2-ad30-845797dd1686"
                                    },
                                    {
                                        "S": "a9806a61-432c-489f-9899-660d0b017259"
                                    },
                                    {
                                        "S": "d041ebe2-9a96-4e1e-8d66-be878022c137"
                                    },
                                    {
                                        "S": "6db31e6c-bce9-4a7f-8ea0-f8055e295f0c"
                                    },
                                    {
                                        "S": "f6245385-9cb1-4764-85ab-56c03efbf2af"
                                    },
                                    {
                                        "S": "aa6fd3db-6611-4342-b9b5-ac1ca1c9b569"
                                    },
                                    {
                                        "S": "c05aad78-c002-4207-b136-47e31ca14e89"
                                    },
                                    {
                                        "S": "19bc527d-bfba-41da-85a9-fe38edab915d"
                                    },
                                    {
                                        "S": "c7a4eae4-4fbe-4e4f-9c89-3d4085d179c6"
                                    },
                                    {
                                        "S": "11d4b4a2-8849-4b72-93f1-b2136ac44662"
                                    },
                                    {
                                        "S": "d2960efd-a226-4b15-b5ec-b64ccb99995e"
                                    },
                                    {
                                        "S": "edd864c1-1069-4a73-923f-fde995a852d1"
                                    },
                                    {
                                        "S": "5c246ec6-6e2e-48d3-971f-add208195fae"
                                    },
                                    {
                                        "S": "96f2db48-7a6b-493e-80ad-bfcaf589a948"
                                    },
                                    {
                                        "S": "b498004e-a166-4bba-b126-34c4e05bcf8a"
                                    },
                                    {
                                        "S": "dc87755c-0c0a-435a-9bb4-e8ffedb4be6b"
                                    },
                                    {
                                        "S": "ddad78ec-292f-4967-a567-0fc34012d21f"
                                    },
                                    {
                                        "S": "fc5f351e-4645-46bf-846e-512bc283b42e"
                                    },
                                    {
                                        "S": "0f56fde5-98a5-47fe-bdb7-ecda6c962319"
                                    },
                                    {
                                        "S": "a5045196-d4f0-4bd8-8742-cb8149994cf0"
                                    },
                                    {
                                        "S": "0c32fd58-de1d-48d1-acb4-74b98642fd7d"
                                    },
                                    {
                                        "S": "eb9568f4-3c1a-4bc1-bfd0-b8d435118eb2"
                                    },
                                    {
                                        "S": "f753edb1-6af5-4463-abe1-7e31f5bba419"
                                    },
                                    {
                                        "S": "4c54ebcb-f49e-4379-8807-e7a2d512410c"
                                    },
                                    {
                                        "S": "eb520448-0b9a-4d3c-a573-acfb4c97c11d"
                                    },
                                    {
                                        "S": "f7128a8b-e62e-478e-ad97-c112fe030f89"
                                    },
                                    {
                                        "S": "0ceeef1f-c56e-4c31-b8d3-55af6b9509c7"
                                    },
                                    {
                                        "S": "61ef5d03-2505-41d6-b7b2-c6dd01c9deb9"
                                    },
                                    {
                                        "S": "7f1cc65a-b16b-4986-b564-86c4b1190e55"
                                    },
                                    {
                                        "S": "52322a41-d11d-4e08-85fc-6eaf31b0741c"
                                    },
                                    {
                                        "S": "f23eaa14-2069-47ff-b136-e6330788e7a9"
                                    },
                                    {
                                        "S": "e7742bdd-1eda-4042-8901-0cb166328456"
                                    },
                                    {
                                        "S": "eeeeb765-ffa3-482b-9c72-a58a8408a8a5"
                                    },
                                    {
                                        "S": "6bafb757-e26e-457f-8362-ca8154950a21"
                                    },
                                    {
                                        "S": "abbcdbc5-da80-40ed-af58-9f90e5b76db7"
                                    },
                                    {
                                        "S": "e1d6b478-3c7d-474b-a2e5-f10bd0088b5e"
                                    },
                                    {
                                        "S": "a608e648-4db5-495d-892a-30d5db5b9cee"
                                    },
                                    {
                                        "S": "b1555a54-48b4-47ee-97c1-438257bd3839"
                                    },
                                    {
                                        "S": "3b7725d0-a6c9-4dae-a395-d2272735f1f6"
                                    },
                                    {
                                        "S": "6b796871-f0ad-4b9e-a11d-b045376d1454"
                                    },
                                    {
                                        "S": "734dd059-5d9b-4849-948e-e4e06f4a7814"
                                    },
                                    {
                                        "S": "1f6023e7-b7df-404f-9cb9-636178381c93"
                                    },
                                    {
                                        "S": "22906986-7e08-4dc4-97f2-4e24bf7e000a"
                                    },
                                    {
                                        "S": "65acc889-0bef-49af-8884-a2da7b5e03d7"
                                    },
                                    {
                                        "S": "50f36cc0-56e4-4d26-8017-1c2f552f32fb"
                                    },
                                    {
                                        "S": "a519dda3-451f-4398-901e-d0b26ad07e47"
                                    },
                                    {
                                        "S": "ab607403-6702-4c99-8fe5-c990a307665d"
                                    },
                                    {
                                        "S": "9c41d7b4-59a3-4214-bf98-96d6d2c8751f"
                                    },
                                    {
                                        "S": "02bd0de2-f8f5-49ed-905d-0e75153ef85a"
                                    },
                                    {
                                        "S": "ffaddb3a-e4ea-4bf2-b04a-13163a3b6b1f"
                                    },
                                    {
                                        "S": "0776e3f2-2e3f-4690-be6a-7ab7e2c31883"
                                    },
                                    {
                                        "S": "2f24ba94-9fbd-4a86-a941-db52d491424e"
                                    },
                                    {
                                        "S": "e6506292-263a-42ca-979a-e3b62740329f"
                                    },
                                    {
                                        "S": "d9b680dd-6a67-4228-9af6-495909661583"
                                    },
                                    {
                                        "S": "246227b9-54ae-49a8-808d-1e9caf4fb537"
                                    },
                                    {
                                        "S": "0aaccd77-055e-4345-a6ee-321cc0484e47"
                                    },
                                    {
                                        "S": "d4262fc6-ef6c-4c8b-924f-925a13f95dde"
                                    },
                                    {
                                        "S": "3f0a2fc2-ba3f-4153-acb8-73bdcae14392"
                                    },
                                    {
                                        "S": "56934a03-edc4-4e60-82cc-74834447174a"
                                    },
                                    {
                                        "S": "47f0014e-0b2d-4131-8c44-63b652acaa90"
                                    },
                                    {
                                        "S": "49fcf0af-ef57-42ce-9d06-e0736caabea6"
                                    },
                                    {
                                        "S": "367bfb05-6300-4112-90e0-87d1ad92413b"
                                    },
                                    {
                                        "S": "f6312de2-a286-4f89-91fa-fda9b0fe4f27"
                                    },
                                    {
                                        "S": "71a460a5-2e81-4b11-9cd0-c93741911f7f"
                                    },
                                    {
                                        "S": "a255aae9-d6a8-4a1f-a2a8-dc4616e1373f"
                                    },
                                    {
                                        "S": "54ed9f60-7138-4871-88d0-14328f8bc63c"
                                    },
                                    {
                                        "S": "f22d06d3-b2fe-4d7f-ab8c-8c0163426474"
                                    },
                                    {
                                        "S": "6edf4a82-8f6f-49e0-89c5-d850d5e5bf0f"
                                    },
                                    {
                                        "S": "d885bac2-00b9-4f18-b754-49f1e200e667"
                                    },
                                    {
                                        "S": "5451b3a9-6d2b-4362-999f-e29982ace385"
                                    },
                                    {
                                        "S": "070517c7-d8aa-4d11-8641-1e4e76b9d144"
                                    },
                                    {
                                        "S": "1b6c0d1d-30a3-4003-b591-10d95eb4019f"
                                    },
                                    {
                                        "S": "9e9749f7-e039-45e3-9227-04275ad25018"
                                    },
                                    {
                                        "S": "597f382a-d6a2-4591-943c-5d21d60d1f35"
                                    },
                                    {
                                        "S": "c060c196-a30a-4b5f-ba50-c6aceafb8d9d"
                                    },
                                    {
                                        "S": "ca6f4a30-3161-4630-8b4f-f3293cf3ceac"
                                    },
                                    {
                                        "S": "486d7bae-0452-466f-bf18-58b50717da09"
                                    },
                                    {
                                        "S": "569df81c-5a1e-4792-9b68-a0ad5a6d3868"
                                    },
                                    {
                                        "S": "30489f91-98b3-46ef-ac97-6e9b42dc8d95"
                                    },
                                    {
                                        "S": "03f09eb8-0283-4cea-b66f-949cf0d00b4a"
                                    },
                                    {
                                        "S": "aabd3cb1-5300-4b0f-80db-b4c2502bfff0"
                                    },
                                    {
                                        "S": "b6317dcf-f1c5-4ca7-937c-3e58cf010a46"
                                    },
                                    {
                                        "S": "19d61aaa-09bd-430d-9d4e-e17bc3b9b5ba"
                                    },
                                    {
                                        "S": "f78b6163-0354-4f54-81a3-6a8958f6e2e3"
                                    },
                                    {
                                        "S": "14a55765-a281-4f6c-8a86-3d05b7d267bb"
                                    },
                                    {
                                        "S": "f50390e8-30fe-483d-a2a5-a029d10aa39c"
                                    },
                                    {
                                        "S": "67d3e39a-3279-4e55-9a9a-eb4c6475dee1"
                                    },
                                    {
                                        "S": "348c7b93-765a-431d-8af3-c800c9c31db8"
                                    },
                                    {
                                        "S": "cdfecbc1-31ce-4f6c-9813-679c84201f9f"
                                    },
                                    {
                                        "S": "dea6cdd3-caba-473b-aee8-b557e289a513"
                                    },
                                    {
                                        "S": "82b70a32-d7c4-42c5-ae1e-eacfb60fd3c5"
                                    },
                                    {
                                        "S": "16be0262-ac95-481c-aa03-cc7b2942152d"
                                    },
                                    {
                                        "S": "be52325c-b85b-41e4-b8cd-47a129336c41"
                                    },
                                    {
                                        "S": "07f9fe88-c952-4dd2-a05f-bc3eccd3499b"
                                    },
                                    {
                                        "S": "f4ba6fa7-7771-477e-88e0-ce112bb8dd79"
                                    },
                                    {
                                        "S": "8613ad87-e5af-4ab9-97f6-ce33b742f66f"
                                    },
                                    {
                                        "S": "8f252598-f022-4d5b-b49e-05a2fe8f556f"
                                    },
                                    {
                                        "S": "9e047a9c-6095-417f-8098-0ec7ead845e8"
                                    },
                                    {
                                        "S": "30a11c42-20e1-4c73-a632-c452e206e03a"
                                    },
                                    {
                                        "S": "997348b5-f37c-47fa-b3ef-b379192c9f89"
                                    },
                                    {
                                        "S": "5205b7bd-e147-441c-bd85-7892b7763f73"
                                    },
                                    {
                                        "S": "f6f7e938-0537-44af-be14-3bba2be58f79"
                                    },
                                    {
                                        "S": "51968111-019e-43f1-bf5d-9f8f36027139"
                                    },
                                    {
                                        "S": "bf68980b-0a16-45a5-99ca-4fd8d2d64db8"
                                    },
                                    {
                                        "S": "62804207-c6fd-4d8e-9a27-94131e6dbd17"
                                    },
                                    {
                                        "S": "9722023a-f120-4d4c-9287-826578a2c5e3"
                                    },
                                    {
                                        "S": "5824344d-fa1a-4b3f-8eb6-a6c6a3cff646"
                                    },
                                    {
                                        "S": "8a4c919c-09b2-4500-b26c-76c17e777126"
                                    },
                                    {
                                        "S": "ff84bf1a-e975-4556-8fa6-c0c167bb24c5"
                                    },
                                    {
                                        "S": "2b142daf-72ad-407c-8982-d50ae384334d"
                                    },
                                    {
                                        "S": "80d25e88-8a15-4ad7-8395-98b42072e6a2"
                                    },
                                    {
                                        "S": "6a6005b1-15fe-4ce3-853e-815942e225b1"
                                    },
                                    {
                                        "S": "b6e60877-4ea6-46d4-b1c7-605202048160"
                                    },
                                    {
                                        "S": "07f7f3be-9ff8-4368-b0d5-555792180316"
                                    },
                                    {
                                        "S": "2b25347e-607d-429c-980f-76cc41f49775"
                                    },
                                    {
                                        "S": "bfaec4c6-d79c-42b9-a5d0-e1e88f866957"
                                    },
                                    {
                                        "S": "f35ffe86-4d9b-4c13-a20b-9e6fc6231ead"
                                    },
                                    {
                                        "S": "b23519ea-0d21-451c-b1e8-6366d5373954"
                                    },
                                    {
                                        "S": "c65ad182-9713-4fcb-a71b-2ab32c2fbf75"
                                    },
                                    {
                                        "S": "46178eba-498b-436f-957e-0acf8b351f6d"
                                    },
                                    {
                                        "S": "ff7b3145-541f-43fc-96a3-187b6ba9336f"
                                    },
                                    {
                                        "S": "b6642eec-59d7-4578-bf50-00996ea8d130"
                                    },
                                    {
                                        "S": "841a7a98-025a-4618-98e6-525d56f3a82e"
                                    },
                                    {
                                        "S": "74a52929-b89d-4a1c-88ba-b7e2fdb564e9"
                                    },
                                    {
                                        "S": "9945effb-9f99-4d1a-acfa-e43fe95bc7d2"
                                    },
                                    {
                                        "S": "b5025675-66b8-4f1e-b3ed-f84f787ba8a3"
                                    },
                                    {
                                        "S": "c7f74a7e-e929-4e68-af25-1190d2364328"
                                    },
                                    {
                                        "S": "b6aee1b4-553e-44dc-8805-64e402af2cd2"
                                    },
                                    {
                                        "S": "35b969d3-bea1-451e-87d4-153b9c763289"
                                    },
                                    {
                                        "S": "5084bcd5-487d-4b37-ae2c-5d596624e98b"
                                    },
                                    {
                                        "S": "c8da37c6-afe3-4f95-ba6a-df959ad2c164"
                                    },
                                    {
                                        "S": "65a46b74-4537-46a9-ae56-dedc1a092b84"
                                    },
                                    {
                                        "S": "785dfc06-0775-400f-bf83-34e14e852ea4"
                                    },
                                    {
                                        "S": "4fd04b78-eb6b-4916-b654-7ff26f96064d"
                                    },
                                    {
                                        "S": "3e9aa9e6-9663-4ef3-9d63-a64c84a48695"
                                    },
                                    {
                                        "S": "c332479e-bf40-451e-abcc-a3b5138eb1a2"
                                    },
                                    {
                                        "S": "dd459168-ac59-42dd-b044-9de4936cbda8"
                                    },
                                    {
                                        "S": "d2276a76-966d-4946-8ae0-f55301b8e44d"
                                    },
                                    {
                                        "S": "259efacd-a3c4-4ab8-9932-aa908c08a0bd"
                                    },
                                    {
                                        "S": "01694097-6676-44a5-9a66-a73b45820522"
                                    },
                                    {
                                        "S": "daa84f98-be54-4560-93a0-b664d0de75fe"
                                    },
                                    {
                                        "S": "8ac9acd1-5c79-41fd-8175-d034a82a9af6"
                                    },
                                    {
                                        "S": "ee02545b-7044-4eb8-80f4-2f87f286d0d3"
                                    },
                                    {
                                        "S": "bbdc5699-28fa-48d9-ac8e-5cf1c8eb4b71"
                                    },
                                    {
                                        "S": "997d623d-f508-472e-a214-de379d329837"
                                    },
                                    {
                                        "S": "da55c0ec-8782-4b01-bc72-87b8e0f01003"
                                    },
                                    {
                                        "S": "0572c386-d504-4560-8f62-3f50484bbc14"
                                    },
                                    {
                                        "S": "95bbd0b8-7617-48e2-9292-57c3e4f85cbd"
                                    },
                                    {
                                        "S": "13027b3c-579c-4506-995d-032170b68b32"
                                    },
                                    {
                                        "S": "648bffec-279e-450a-bc65-4fae9bf968c5"
                                    },
                                    {
                                        "S": "cc86ea9a-3982-4418-acd5-950abc47294b"
                                    },
                                    {
                                        "S": "ff51d86f-4d7b-4601-a792-9eef58779717"
                                    },
                                    {
                                        "S": "74d8b124-f68c-457f-bc03-3df823d02621"
                                    },
                                    {
                                        "S": "d0a3ccb1-bb6a-43a1-a185-c9e7bb1e4b2e"
                                    },
                                    {
                                        "S": "32281b3a-eba1-470d-8a1b-ba7971a81373"
                                    },
                                    {
                                        "S": "7cb0e6bb-7926-4e81-89fe-ed998b77647f"
                                    },
                                    {
                                        "S": "bea22317-d986-4c3a-9da7-c32f3d5509bb"
                                    },
                                    {
                                        "S": "54464007-e9ac-4a87-8b73-51c7edbb7df1"
                                    },
                                    {
                                        "S": "b520b4cf-dc73-49de-8573-0eb44b123e0d"
                                    },
                                    {
                                        "S": "ad3d5bb7-9e85-4195-94e8-833cc5a73253"
                                    },
                                    {
                                        "S": "e3dea1d9-36b7-43ba-b4dc-3b25dca6c28e"
                                    },
                                    {
                                        "S": "5c784c7d-dd21-4ef5-9986-0451198681b9"
                                    },
                                    {
                                        "S": "776c8ec5-4518-4c91-84f8-f22442680efa"
                                    },
                                    {
                                        "S": "cccdac43-1a22-4659-9086-b762f59b9928"
                                    },
                                    {
                                        "S": "f3047de0-36c8-42df-a1b5-7929e24c29f4"
                                    },
                                    {
                                        "S": "3d8edb6b-3831-49ac-ae52-353914690b47"
                                    },
                                    {
                                        "S": "7f2c624b-9267-4624-b798-c10178e96ab3"
                                    },
                                    {
                                        "S": "e807f72e-c2b7-4cd1-a010-a2b1f15f7ee1"
                                    }
                                ]
                            }
                        }
                    }
                }
            },
            "conversion": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": true
                    },
                    "disabled": {
                        "M": {
                            "sites": {
                                "L": [
                                    {
                                        "S": "7f1cc65a-b16b-4986-b564-86c4b1190e55"
                                    },
                                    {
                                        "S": "02bd0de2-f8f5-49ed-905d-0e75153ef85a"
                                    },
                                    {
                                        "S": "4605dbad-dacf-4323-b44c-0110756587d7"
                                    }
                                ]
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    },
                    "enabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    }
                }
            },
            "costs": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": false
                    },
                    "enabled": {
                        "M": {
                            "sites": {
                                "L": [
                                    {
                                        "S": "7be95fa1-e532-410c-b6f8-6584ca92ac09"
                                    },
                                    {
                                        "S": "12d892c5-779d-409f-b16b-56fba9304204"
                                    }
                                ]
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    }
                }
            },
            "accessibility-auto-fix": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": false
                    },
                    "disabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    },
                    "enabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    }
                }
            },
            "llm-blocked": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": false
                    },
                    "disabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "LLMO"
                            },
                            {
                                "S": "ASO"
                            }
                        ]
                    },
                    "enabled": {
                        "M": {
                            "sites": {
                                "L": [
                                    {
                                        "S": "c236a20b-c879-4960-b5b2-c0b607ade100"
                                    },
                                    {
                                        "S": "c2473d89-e997-458d-a86d-b4096649c12b"
                                    },
                                    {
                                        "S": "b1555a54-48b4-47ee-97c1-438257bd3839"
                                    },
                                    {
                                        "S": "6edbef89-5196-4e3f-882f-348849124993"
                                    },
                                    {
                                        "S": "cccdac43-1a22-4659-9086-b762f59b9928"
                                    }
                                ]
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    }
                }
            },
            "sitemap-product-coverage": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": false
                    },
                    "disabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    },
                    "enabled": {
                        "M": {
                            "sites": {
                                "L": [
                                    {
                                        "S": "cccdac43-1a22-4659-9086-b762f59b9928"
                                    },
                                    {
                                        "S": "c236a20b-c879-4960-b5b2-c0b607ade100"
                                    }
                                ]
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    }
                }
            },
            "security-csp": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": true
                    },
                    "disabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    },
                    "enabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "dependencies": {
                        "L": []
                    }
                }
            },
            "cwv-external": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": false
                    },
                    "enabled": {
                        "M": {
                            "sites": {
                                "L": [
                                    {
                                        "S": "d5605edb-d3ef-4b0e-801f-322edb2eeeab"
                                    },
                                    {
                                        "S": "9ab0575a-c238-4470-ae82-9d37fb2d0e78"
                                    },
                                    {
                                        "S": "044ea848-2c33-4d12-be75-bcc6c4461dba"
                                    }
                                ]
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    }
                }
            },
            "preflight": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": false
                    },
                    "disabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    },
                    "enabled": {
                        "M": {
                            "sites": {
                                "L": [
                                    {
                                        "S": "59579bb7-7c96-41c2-9159-d6cded5733cd"
                                    },
                                    {
                                        "S": "b3e1839f-1304-40b2-a087-25781bcac163"
                                    },
                                    {
                                        "S": "4a4ffd7e-f86d-476b-8993-7cf7c408d3bd"
                                    },
                                    {
                                        "S": "c2473d89-e997-458d-a86d-b4096649c12b"
                                    },
                                    {
                                        "S": "42b4e20a-218e-4e64-b8e1-4315d6ac0c97"
                                    },
                                    {
                                        "S": "c487d626-363a-4864-86eb-1a96f924714d"
                                    },
                                    {
                                        "S": "7e2b0adc-ad21-443c-a126-8f0cbd535332"
                                    },
                                    {
                                        "S": "6895d027-d016-4bbf-a0c4-2662f03ec7c0"
                                    },
                                    {
                                        "S": "7cb65016-d944-428b-bfe5-b65b51a61a15"
                                    },
                                    {
                                        "S": "09c30d35-1c1b-4b16-8b2a-8ce32786c45e"
                                    },
                                    {
                                        "S": "dc2428a3-70e9-438d-9de4-de3a4e751f12"
                                    },
                                    {
                                        "S": "b424726b-639b-4077-a7f0-347d7d8cfca6"
                                    },
                                    {
                                        "S": "542ad116-ed33-448a-a123-06cbcd7c1d4c"
                                    }
                                ]
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    }
                }
            },
            "readability": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": true
                    },
                    "disabled": {
                        "M": {
                            "sites": {
                                "L": [
                                    {
                                        "S": "b694021e-b9c3-413c-9930-34692b513bd6"
                                    },
                                    {
                                        "S": "d5605edb-d3ef-4b0e-801f-322edb2eeeab"
                                    }
                                ]
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    },
                    "enabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    }
                }
            },
            "cdn-analysis": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": false
                    },
                    "disabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    },
                    "enabled": {
                        "M": {
                            "sites": {
                                "L": [
                                    {
                                        "S": "028147f6-4a7a-4325-a758-376c460a559c"
                                    },
                                    {
                                        "S": "2c735382-0497-42a6-a435-1efa7d75921c"
                                    },
                                    {
                                        "S": "12d54932-e963-4783-aac3-4b1edbc27cde"
                                    },
                                    {
                                        "S": "9ba371e5-ed92-4a5a-a8cf-15a2989704b7"
                                    },
                                    {
                                        "S": "36e4848b-d6e5-4350-a7f9-610e78325966"
                                    },
                                    {
                                        "S": "eb39e797-ab5e-496a-95ee-469499c8867a"
                                    },
                                    {
                                        "S": "c236a20b-c879-4960-b5b2-c0b607ade100"
                                    },
                                    {
                                        "S": "cccdac43-1a22-4659-9086-b762f59b9928"
                                    }
                                ]
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    }
                }
            },
            "paid": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": false
                    },
                    "disabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    },
                    "enabled": {
                        "M": {
                            "sites": {
                                "L": [
                                    {
                                        "S": "9ab0575a-c238-4470-ae82-9d37fb2d0e78"
                                    },
                                    {
                                        "S": "36e4848b-d6e5-4350-a7f9-610e78325966"
                                    },
                                    {
                                        "S": "cccdac43-1a22-4659-9086-b762f59b9928"
                                    },
                                    {
                                        "S": "f6312de2-a286-4f89-91fa-fda9b0fe4f27"
                                    },
                                    {
                                        "S": "bbdc5699-28fa-48d9-ac8e-5cf1c8eb4b71"
                                    },
                                    {
                                        "S": "50f36cc0-56e4-4d26-8017-1c2f552f32fb"
                                    },
                                    {
                                        "S": "246227b9-54ae-49a8-808d-1e9caf4fb537"
                                    },
                                    {
                                        "S": "c236a20b-c879-4960-b5b2-c0b607ade100"
                                    },
                                    {
                                        "S": "15d1546d-6284-41be-86af-2c1c722f93b1"
                                    },
                                    {
                                        "S": "d6d24b64-386b-42ef-9410-c0c1defe13e1"
                                    },
                                    {
                                        "S": "b9fdacaf-30ed-4150-ac66-883c9cc66f91"
                                    },
                                    {
                                        "S": "12d892c5-779d-409f-b16b-56fba9304204"
                                    }
                                ]
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    }
                }
            },
            "accessibility-auto-suggest": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": false
                    },
                    "disabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    },
                    "enabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    }
                }
            },
            "h1-count-preflight": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": true
                    },
                    "disabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    },
                    "enabled": {
                        "M": {
                            "sites": {
                                "L": []
                            },
                            "orgs": {
                                "L": []
                            }
                        }
                    }
                }
            },
            "sitemap-internal": {
                "M": {
                    "enabledByDefault": {
                        "BOOL": true
                    },
                    "productCodes": {
                        "L": [
                            {
                                "S": "ASO"
                            },
                            {
                                "S": "LLMO"
                            }
                        ]
                    }
                }
            }
        }
    },
    "__edb_v__": {
        "S": "1"
    },
    "updatedAt": {
        "S": "2025-10-17T12:34:26.741Z"
    },
    "queues": {
        "M": {
            "reports": {
                "S": "https://sqs.us-east-1.amazonaws.com/682033462621/spacecat-report-jobs"
            },
            "imports": {
                "S": "https://sqs.us-east-1.amazonaws.com/682033462621/spacecat-import-jobs"
            },
            "audits": {
                "S": "https://sqs.us-east-1.amazonaws.com/682033462621/spacecat-audit-jobs"
            },
            "scrapes": {
                "S": "https://sqs.us-east-1.amazonaws.com/682033462621/spacecat-scraping-jobs"
            }
        }
    },
    "sk": {
        "S": "$configuration_1"
    },
    "pk": {
        "S": "$spacecat#configurationid_50e609b2-5bfe-4aae-8810-3d57cb717bd0"
    },
    "gsi1pk": {
        "S": "all_configurations"
    }
},
*/

const SITE_IDS_TO_KEEP = new Set([
    'c2473d89-e997-458d-a86d-b4096649c12b',
    'cccdac43-1a22-4659-9086-b762f59b9928',
    '7be95fa1-e532-410c-b6f8-6584ca92ac09',
]);

async function createSeedData() {
  const inputFile = join(__dirname, '..', 'spacecat-services-data.dynamodata');
  const outputFile = join(__dirname, '..', 'spacecat-services-data-seed.dynamodata');

  console.log('📖 Processing DynamoDB dump...');
  console.log(`   Input: ${inputFile}`);
  console.log(`   Output: ${outputFile}\n`);

  const entityCounts = new Map();
  const keptEntityCounts = new Map();
  let latestConfiguration = null; // Store only the Configuration with highest version
  let configurationCount = 0;
  let totalRecords = 0;
  let keptRecords = 0;
  let isFirst = true;

  const writeStream = createWriteStream(outputFile, { encoding: 'utf8' });
  
  // Start the JSON array
  writeStream.write('[\n');

  const pipeline = chain([
    createReadStream(inputFile, { encoding: 'utf8' }),
    parser(),
    new StreamArray(),
  ]);

  pipeline.on('data', ({ value }) => {
    totalRecords++;
    
    if (totalRecords % 10000 === 0) {
      console.log(`Processed ${totalRecords} records, kept ${keptRecords}...`);
    }

    try {
      // Get entity type from __edb_e__ field
      const entityType = value.__edb_e__?.S || 'UNKNOWN';
      
      // Count all entities
      entityCounts.set(entityType, (entityCounts.get(entityType) || 0) + 1);
      
      // Filter: exclude certain entity types
      if (EXCLUDED_ENTITY_TYPES.has(entityType)) {
        return;
      }
      
      // Filter: only keep Sites with IDs in SITE_IDS_TO_KEEP
      if (entityType === 'Site') {
        const siteId = value.siteId?.S;
        if (!siteId || !SITE_IDS_TO_KEEP.has(siteId)) {
          return;
        }
      }
      
      // Filter: only keep SiteTopPage entities for allowed sites
      if (entityType === 'SiteTopPage') {
        const siteId = value.siteId?.S;
        if (!siteId || !SITE_IDS_TO_KEEP.has(siteId)) {
          return;
        }
      }
      
      // Special handling for Configuration: keep only the one with highest version
      if (entityType === 'Configuration') {
        configurationCount++;
        const currentVersion = parseInt(value.version?.N || '0', 10);
        const latestVersion = latestConfiguration ? parseInt(latestConfiguration.version?.N || '0', 10) : -1;
        
        if (currentVersion > latestVersion) {
          latestConfiguration = value;
        }
        return;
      }
      
      // Add comma before all records except the first
      if (!isFirst) {
        writeStream.write(',\n');
      }
      isFirst = false;
      
      // Write the record
      writeStream.write(JSON.stringify(value));
      keptRecords++;
      
      // Count kept entities
      keptEntityCounts.set(entityType, (keptEntityCounts.get(entityType) || 0) + 1);
    } catch (error) {
      console.error(`Error processing record ${totalRecords}:`, error.message);
    }
  });

  pipeline.on('end', () => {
    // Write the Configuration with the highest version
    if (latestConfiguration) {
      // Write the configuration with highest version
      if (!isFirst) {
        writeStream.write(',\n');
      }
      writeStream.write(JSON.stringify(latestConfiguration));
      keptRecords++;
      keptEntityCounts.set('Configuration', 1);
      
      console.log(`\n📝 Kept Configuration with version ${latestConfiguration.version?.N} (found ${configurationCount} total configurations)`);
    }
    
    // Close the JSON array
    writeStream.write('\n]\n');
    writeStream.end();
    
    console.log(`\n✅ Processing completed!`);
    console.log(`\n📊 Summary:`);
    console.log(`   Total records processed: ${totalRecords.toLocaleString()}`);
    console.log(`   Records kept: ${keptRecords.toLocaleString()}`);
    console.log(`   Records excluded: ${(totalRecords - keptRecords).toLocaleString()}`);
    console.log(`   Reduction: ${((1 - keptRecords / totalRecords) * 100).toFixed(2)}%\n`);
    
    // Sort by count (descending)
    const sortedAll = Array.from(entityCounts.entries())
      .sort((a, b) => b[1] - a[1]);
    
    console.log('📋 Entity Types (All vs Kept):\n');
    console.log('Entity Type'.padEnd(30) + 'Total'.padStart(12) + 'Kept'.padStart(12) + 'Status'.padStart(15));
    console.log('='.repeat(69));
    
    for (const [entityType, count] of sortedAll) {
      const kept = keptEntityCounts.get(entityType) || 0;
      const status = kept > 0 ? '✓ Kept' : '✗ Excluded';
      console.log(
        entityType.padEnd(30) + 
        count.toLocaleString().padStart(12) + 
        kept.toLocaleString().padStart(12) + 
        status.padStart(15)
      );
    }
    
    console.log('\n' + '='.repeat(69));
    console.log(`\n✅ Seed file created: ${outputFile}`);
  });

  pipeline.on('error', (error) => {
    console.error('❌ Stream error:', error);
    writeStream.end();
    process.exit(1);
  });
}

createSeedData().catch((error) => {
  console.error('❌ Failed to create seed data:', error);
  process.exit(1);
});