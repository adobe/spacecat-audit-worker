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

/* eslint-env mocha */

import { expect } from 'chai';
import { createOpportunityData } from '../../../src/external-links/opportunity-data-mapper.js';

describe('Opportunity Data Mapper', () => {
  describe('createOpportunityData', () => {
    it('should create opportunity data with correct structure', () => {
      const kpiDeltas = { projectedTrafficLost: 100, projectedTrafficValue: 200 };
      const result = createOpportunityData({ kpiDeltas });
      expect(result).to.have.property('runbook');
      expect(result).to.have.property('origin', 'AUTOMATION');
      expect(result).to.have.property('title');
      expect(result).to.have.property('description');
      expect(result).to.have.property('guidance');
      expect(result).to.have.property('tags');
      expect(result.data).to.deep.include(kpiDeltas);
    });
  });
});
