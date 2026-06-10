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

/**
 * Schema checksum-drift guard.
 *
 * The row contract `shared-semrush-row.schema.v1.json` is AUTHORITATIVELY owned by
 * the llmo-data-retrieval-service (DRS) repo at
 * `docs/contracts/shared-semrush-row.schema.v1.json`. This repo vendors a copy at
 * `src/strategic-recommendations-semrush/shared-semrush-row.schema.v1.json` so the
 * writer/validator can run without a runtime dependency on DRS.
 *
 * This test pins the expected sha256 of the vendored copy. CI only checks out this
 * repo, so it cannot reach the DRS file — instead it asserts the vendored copy
 * still matches the pinned hash. If you intentionally re-vendor an updated schema
 * FROM DRS, update EXPECTED_SHA256 below to the new value in the same commit.
 *
 * If DRS changes the authoritative schema and this copy is NOT re-vendored, this
 * test stays green here but a matching test in DRS (and a manual re-vendor) is the
 * intended drift signal — the two repos single-source the same file by sha.
 */

import { readFileSync, existsSync } from 'fs';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
import { expect } from 'chai';

// sha256 of the authoritative DRS schema, vendored here. Update on deliberate re-vendor.
const EXPECTED_SHA256 = '6c2d8fa69826279fbdd2e52f198ed8e19b2c5480a7185f688766e823cab97f34';

const VENDORED_PATH = fileURLToPath(new URL(
  '../../src/strategic-recommendations-semrush/shared-semrush-row.schema.v1.json',
  import.meta.url,
));

// Best-effort cross-check against the authoritative DRS copy when this repo is
// checked out inside the mysticat workspace (sibling repo). Skipped in CI where
// DRS is not present.
const DRS_AUTHORITATIVE_PATH = fileURLToPath(new URL(
  '../../../llmo-data-retrieval-service/docs/contracts/shared-semrush-row.schema.v1.json',
  import.meta.url,
));

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

describe('strategic-recommendations-semrush schema checksum drift', () => {
  it('vendored schema matches the pinned authoritative sha256', () => {
    expect(existsSync(VENDORED_PATH), `vendored schema missing at ${VENDORED_PATH}`).to.equal(true);
    expect(sha256(VENDORED_PATH)).to.equal(EXPECTED_SHA256);
  });

  it('vendored copy matches the DRS authoritative copy when present (sibling repo)', function checkDrs() {
    if (!existsSync(DRS_AUTHORITATIVE_PATH)) {
      this.skip();
      return;
    }
    expect(sha256(DRS_AUTHORITATIVE_PATH)).to.equal(
      sha256(VENDORED_PATH),
      'vendored schema has drifted from the DRS authoritative copy — re-vendor and update EXPECTED_SHA256',
    );
  });
});
