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

import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import chaiAsPromised from 'chai-as-promised';
import {
  isValidOffsiteAnalysis,
  resolveEvergreenOffsiteOpportunity,
  isSuppressedRun,
} from '../../src/common/offsite-refresh.js';

use(sinonChai);
use(chaiAsPromised);

describe('offsite-refresh', () => {
  let sandbox;
  let log;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    log = {
      info: sandbox.spy(), error: sandbox.spy(), warn: sandbox.spy(), debug: sandbox.spy(),
    };
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('isValidOffsiteAnalysis', () => {
    it('returns true for a well-formed payload without an opportunity field', () => {
      expect(isValidOffsiteAnalysis({ suggestions: [] }, 'cited-analysis')).to.be.true;
    });

    it('returns true for a well-formed payload with a plain-object opportunity field', () => {
      expect(isValidOffsiteAnalysis({
        suggestions: [],
        opportunity: { status: 'NEW' },
      }, 'cited-analysis')).to.be.true;
    });

    it('returns false for null', () => {
      expect(isValidOffsiteAnalysis(null, 'cited-analysis')).to.be.false;
    });

    it('returns false for undefined', () => {
      expect(isValidOffsiteAnalysis(undefined, 'cited-analysis')).to.be.false;
    });

    it('returns false for a non-object (string)', () => {
      expect(isValidOffsiteAnalysis('not an object', 'cited-analysis')).to.be.false;
    });

    it('returns false for an array', () => {
      expect(isValidOffsiteAnalysis(['a', 'b'], 'cited-analysis')).to.be.false;
    });

    it('returns false when opportunity is an array', () => {
      expect(isValidOffsiteAnalysis({ opportunity: ['bad'] }, 'cited-analysis')).to.be.false;
    });

    it('returns false when opportunity is a string', () => {
      expect(isValidOffsiteAnalysis({ opportunity: 'bad' }, 'cited-analysis')).to.be.false;
    });

    it('returns false when opportunity is null', () => {
      expect(isValidOffsiteAnalysis({ opportunity: null }, 'cited-analysis')).to.be.false;
    });

    it('returns true when opportunity.type matches the expected type', () => {
      expect(isValidOffsiteAnalysis({
        opportunity: { type: 'cited-analysis' },
      }, 'cited-analysis')).to.be.true;
    });

    it('returns true when opportunity.type is absent (defaults to the expected type)', () => {
      expect(isValidOffsiteAnalysis({ opportunity: { status: 'NEW' } }, 'cited-analysis')).to.be.true;
    });

    it('returns false when opportunity.type disagrees with the expected type (cross-type hijack)', () => {
      // A cited-analysis message carrying opportunity.type: 'reddit-analysis' must be
      // rejected outright, not silently routed against Reddit's evergreen opportunity.
      expect(isValidOffsiteAnalysis({
        opportunity: { type: 'reddit-analysis' },
      }, 'cited-analysis')).to.be.false;
    });
  });

  describe('resolveEvergreenOpportunity', () => {
    it('returns null when no opportunities exist for the site', async () => {
      const dataAccess = { Opportunity: { allBySiteIdAndStatus: sandbox.stub().resolves([]) } };

      const result = await resolveEvergreenOffsiteOpportunity({
        dataAccess, siteId: 'site-1', auditType: 'cited-analysis', log,
      });

      expect(result).to.be.null;
    });

    it('treats a nullish resolved value as no opportunities', async () => {
      const dataAccess = {
        Opportunity: { allBySiteIdAndStatus: sandbox.stub().resolves(undefined) },
      };

      const result = await resolveEvergreenOffsiteOpportunity({
        dataAccess, siteId: 'site-1', auditType: 'cited-analysis', log,
      });

      expect(result).to.be.null;
    });

    it('logs and rethrows when the fetch itself fails, rather than returning null', async () => {
      const dataAccess = {
        Opportunity: { allBySiteIdAndStatus: sandbox.stub().rejects(new Error('DB down')) },
      };

      await expect(resolveEvergreenOffsiteOpportunity({
        dataAccess, siteId: 'site-1', auditType: 'cited-analysis', log,
      })).to.be.rejectedWith('DB down');

      expect(log.error).to.have.been.calledWith(sinon.match(/DB down/));
    });

    it('returns the single matching opportunity without touching it', async () => {
      const only = {
        getType: () => 'cited-analysis',
        getId: () => 'only-opp',
      };
      const dataAccess = {
        Opportunity: { allBySiteIdAndStatus: sandbox.stub().resolves([only]) },
      };

      const result = await resolveEvergreenOffsiteOpportunity({
        dataAccess, siteId: 'site-1', auditType: 'cited-analysis', log,
      });

      expect(result).to.equal(only);
    });

    it('ignores opportunities of a different type', async () => {
      const other = { getType: () => 'reddit-analysis', getId: () => 'other-opp' };
      const dataAccess = {
        Opportunity: { allBySiteIdAndStatus: sandbox.stub().resolves([other]) },
      };

      const result = await resolveEvergreenOffsiteOpportunity({
        dataAccess, siteId: 'site-1', auditType: 'cited-analysis', log,
      });

      expect(result).to.be.null;
    });

    it('retires all but the most-recently-updated duplicate to IGNORED via a single saveMany', async () => {
      const oldest = {
        getType: () => 'cited-analysis',
        getId: () => 'oldest',
        getUpdatedAt: () => '2024-01-01T00:00:00.000Z',
        setStatus: sandbox.stub(),
        setUpdatedBy: sandbox.stub(),
      };
      const middle = {
        getType: () => 'cited-analysis',
        getId: () => 'middle',
        getUpdatedAt: () => '2025-01-01T00:00:00.000Z',
        setStatus: sandbox.stub(),
        setUpdatedBy: sandbox.stub(),
      };
      const newest = {
        getType: () => 'cited-analysis',
        getId: () => 'newest',
        getUpdatedAt: () => '2026-01-01T00:00:00.000Z',
        setStatus: sandbox.stub(),
        setUpdatedBy: sandbox.stub(),
      };
      const saveManyStub = sandbox.stub().resolves();
      const dataAccess = {
        Opportunity: {
          allBySiteIdAndStatus: sandbox.stub().resolves([oldest, newest, middle]),
          saveMany: saveManyStub,
        },
      };

      const result = await resolveEvergreenOffsiteOpportunity({
        dataAccess, siteId: 'site-1', auditType: 'cited-analysis', log,
      });

      expect(result).to.equal(newest);
      expect(oldest.setStatus).to.have.been.calledWith('IGNORED');
      expect(middle.setStatus).to.have.been.calledWith('IGNORED');
      expect(newest.setStatus).to.not.have.been.called;
      // A single bulk write, never a per-item save() (repo's no-N+1 rule). Order follows
      // the descending-by-updatedAt sort used to pick the evergreen one (middle, then oldest).
      expect(saveManyStub).to.have.been.calledOnce;
      expect(saveManyStub.firstCall.args[0]).to.deep.equal([middle, oldest]);
    });

    it('propagates the error when saveMany fails, rather than swallowing it', async () => {
      const older = {
        getType: () => 'cited-analysis',
        getId: () => 'older',
        getUpdatedAt: () => '2024-01-01T00:00:00.000Z',
        setStatus: sandbox.stub(),
        setUpdatedBy: sandbox.stub(),
      };
      const newer = {
        getType: () => 'cited-analysis',
        getId: () => 'newer',
        getUpdatedAt: () => '2026-01-01T00:00:00.000Z',
        setStatus: sandbox.stub(),
        setUpdatedBy: sandbox.stub(),
      };
      const dataAccess = {
        Opportunity: {
          allBySiteIdAndStatus: sandbox.stub().resolves([older, newer]),
          saveMany: sandbox.stub().rejects(new Error('save failed')),
        },
      };

      // A failed retirement means the "single evergreen opportunity" invariant this
      // function promises no longer holds — the caller must not proceed as if it did.
      await expect(resolveEvergreenOffsiteOpportunity({
        dataAccess, siteId: 'site-1', auditType: 'cited-analysis', log,
      })).to.be.rejectedWith('save failed');
    });
  });

  describe('isSuppressedRun', () => {
    it('returns true when the incoming run is IGNORED', () => {
      expect(isSuppressedRun('IGNORED')).to.be.true;
    });

    it('returns false when the incoming run is NEW', () => {
      expect(isSuppressedRun('NEW')).to.be.false;
    });

    it('returns false for any other status', () => {
      expect(isSuppressedRun('RESOLVED')).to.be.false;
    });
  });
});
