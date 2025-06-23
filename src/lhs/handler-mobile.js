/*
 * Copyright 2024 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

import { AuditBuilder } from '../common/audit-builder.js';
import { PSI_STRATEGY_MOBILE } from '../support/psi-client.js';
import createLHSAuditRunner from './lib.js';
import { cspOpportunityAndSuggestions } from './csp.js';

export default new AuditBuilder()
  .withRunner(createLHSAuditRunner(PSI_STRATEGY_MOBILE))
  // default impl strips slash, which is incorrect
  .withUrlResolver((site) => site.getBaseURL())
  .withPostProcessors([cspOpportunityAndSuggestions])
  .build();
