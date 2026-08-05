/*
 * Copyright 2026 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

import { expect } from 'chai';
import sinon from 'sinon';
import { fetchWindow } from '../../../src/gsc-search-analytics/fetch.js';

describe('fetchWindow', () => {
  it('aggregates paginated page rows', async () => {
    const google = { getOrganicSearchData: sinon.stub() };
    google.getOrganicSearchData.onCall(0).resolves({
      data: {
        rows: Array.from({ length: 1000 }, (_, i) => ({
          keys: [`https://s/p${i}`], clicks: 1, impressions: 10, ctr: 0.1, position: 5,
        })),
      },
    });
    google.getOrganicSearchData.onCall(1).resolves({
      data: { rows: [{ keys: ['https://s/last'], clicks: 2, impressions: 20, ctr: 0.1, position: 4 }] },
    });

    const rows = await fetchWindow(
      google,
      new Date('2026-03-02T00:00:00Z'),
      new Date('2026-05-24T00:00:00Z'),
    );

    expect(rows).to.have.length(1001);
    expect(google.getOrganicSearchData.callCount).to.equal(2);
  });

  it('stops on an empty/short page and tolerates a missing rows field', async () => {
    const google = { getOrganicSearchData: sinon.stub().resolves({ data: {} }) };
    const rows = await fetchWindow(
      google,
      new Date('2026-03-02T00:00:00Z'),
      new Date('2026-05-24T00:00:00Z'),
    );
    expect(rows).to.have.length(0);
    expect(google.getOrganicSearchData.callCount).to.equal(1);
  });
});
