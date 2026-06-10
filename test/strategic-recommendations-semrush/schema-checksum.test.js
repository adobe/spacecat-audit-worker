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
 * The three row contracts (`shared-semrush-row`, `shared-citation-row`,
 * `shared-persona-row`) are AUTHORITATIVELY owned by the llmo-data-retrieval-service
 * (DRS) repo at `docs/contracts/`. This repo vendors byte-for-byte copies under
 * `src/strategic-recommendations-semrush/` so the writer/validator can run without
 * a runtime dependency on DRS.
 *
 * This test pins the expected sha256 of each vendored copy. CI only checks out this
 * repo, so it cannot reach the DRS files — instead it asserts each vendored copy
 * still matches its pinned hash. If you intentionally re-vendor an updated schema
 * FROM DRS, update the EXPECTED_SHA256 entry below in the same commit.
 *
 * When the sibling DRS repo IS present (mysticat workspace), it additionally
 * cross-checks the vendored copy against the authoritative copy by sha.
 */

import { readFileSync, existsSync } from 'fs';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
import { expect } from 'chai';
import {
  REQUIRED_FIELDS,
  TAG_VALUES,
  DELETED_VALUES,
  MAX_LENGTHS,
  AUX_REQUIRED_FIELDS,
  AUX_DELETED_VALUES,
  CITATION_MAX_LENGTHS,
  PERSONA_MAX_LENGTHS,
} from '../../src/strategic-recommendations-semrush/schema-derived.js';

// sha256 of the authoritative DRS schemas, vendored here. Update on deliberate re-vendor.
const SCHEMAS = [
  {
    name: 'shared-semrush-row.schema.v1.json',
    sha: '6c2d8fa69826279fbdd2e52f198ed8e19b2c5480a7185f688766e823cab97f34',
  },
  {
    name: 'shared-citation-row.schema.v1.json',
    sha: '8478774df50c8c318423845cdcc583ad6eda9d45cac64616b5ed82f10ce1285d',
  },
  {
    name: 'shared-persona-row.schema.v1.json',
    sha: '382462b15ef446663366ef4f2b1362d24bbaeb2d8e80c37a555863adb1b3dfe8',
  },
];

const vendoredPath = (name) => fileURLToPath(new URL(
  `../../src/strategic-recommendations-semrush/${name}`,
  import.meta.url,
));

// Best-effort cross-check against the authoritative DRS copies when this repo is
// checked out inside the mysticat workspace (sibling repo). Skipped in CI where
// DRS is not present.
const drsPath = (name) => fileURLToPath(new URL(
  `../../../llmo-data-retrieval-service/docs/contracts/${name}`,
  import.meta.url,
));

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function loadVendored(name) {
  return JSON.parse(readFileSync(vendoredPath(name), 'utf8'));
}

// Extracts { field: maxLength } for every property that declares a maxLength.
function maxLengthsOf(schema) {
  const out = {};
  Object.entries(schema.properties).forEach(([field, def]) => {
    if (typeof def.maxLength === 'number') {
      out[field] = def.maxLength;
    }
  });
  return out;
}

describe('strategic-recommendations-semrush schema checksum drift', () => {
  SCHEMAS.forEach(({ name, sha }) => {
    describe(name, () => {
      it('vendored schema matches the pinned authoritative sha256', () => {
        expect(existsSync(vendoredPath(name)), `vendored schema missing at ${vendoredPath(name)}`).to.equal(true);
        expect(sha256(vendoredPath(name))).to.equal(sha);
      });

      it('vendored copy matches the DRS authoritative copy when present (sibling repo)', function checkDrs() {
        if (!existsSync(drsPath(name))) {
          this.skip();
          return;
        }
        expect(sha256(drsPath(name))).to.equal(
          sha256(vendoredPath(name)),
          `${name} has drifted from the DRS authoritative copy — re-vendor and update the pinned sha`,
        );
      });
    });
  });

  // The validator inputs in schema-derived.js are inlined as constants (not read
  // from the JSON at runtime — that read broke the bundle). These assertions are
  // the other half of the drift guard: they fail if the inlined constants drift
  // from the vendored JSON, so a contract change must update both in one commit.
  describe('inlined Semrush constants match the vendored JSON', () => {
    const schema = loadVendored('shared-semrush-row.schema.v1.json');

    it('REQUIRED_FIELDS === schema.required', () => {
      expect(REQUIRED_FIELDS).to.deep.equal(schema.required);
    });

    it('TAG_VALUES === schema.properties.tag.enum', () => {
      expect(TAG_VALUES).to.deep.equal(schema.properties.tag.enum);
    });

    it('DELETED_VALUES === schema.properties.deleted.enum', () => {
      expect(DELETED_VALUES).to.deep.equal(schema.properties.deleted.enum);
    });

    it('MAX_LENGTHS === schema.properties[*].maxLength', () => {
      expect(MAX_LENGTHS).to.deep.equal(maxLengthsOf(schema));
    });
  });

  describe('inlined auxiliary constants match the vendored JSON', () => {
    const citation = loadVendored('shared-citation-row.schema.v1.json');
    const persona = loadVendored('shared-persona-row.schema.v1.json');

    it('AUX_REQUIRED_FIELDS === citation.required === persona.required', () => {
      expect(AUX_REQUIRED_FIELDS).to.deep.equal(citation.required);
      expect(AUX_REQUIRED_FIELDS).to.deep.equal(persona.required);
    });

    it('AUX_DELETED_VALUES === both schemas\' deleted.enum', () => {
      expect(AUX_DELETED_VALUES).to.deep.equal(citation.properties.deleted.enum);
      expect(AUX_DELETED_VALUES).to.deep.equal(persona.properties.deleted.enum);
    });

    it('tag has NO enum in the auxiliary schemas (free-form)', () => {
      expect(citation.properties.tag.enum).to.equal(undefined);
      expect(persona.properties.tag.enum).to.equal(undefined);
    });

    it('CITATION_MAX_LENGTHS === citation.properties[*].maxLength', () => {
      expect(CITATION_MAX_LENGTHS).to.deep.equal(maxLengthsOf(citation));
    });

    it('PERSONA_MAX_LENGTHS === persona.properties[*].maxLength', () => {
      expect(PERSONA_MAX_LENGTHS).to.deep.equal(maxLengthsOf(persona));
    });
  });
});
