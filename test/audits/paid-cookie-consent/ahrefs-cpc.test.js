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
import sinon from 'sinon';
import {
  fetchCPCData,
  getCPCForTrafficType,
  calculateEstimatedCost,
  getCPCData,
  calculateProjectedTrafficValue,
} from '../../../src/paid-cookie-consent/ahrefs-cpc.js';

describe('Ahrefs CPC', () => {
  let context;
  let log;

  beforeEach(() => {
    log = {
      info: sinon.stub(),
      debug: sinon.stub(),
      warn: sinon.stub(),
      error: sinon.stub(),
    };

    context = {
      s3: {
        s3Client: {
          send: sinon.stub(),
        },
      },
    };
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('fetchCPCData', () => {
    it('should calculate both organic and paid CPC when data exists', async () => {
      const mockData = {
        organicTraffic: 800172,
        organicCost: 152846.44,
        paidTraffic: 927,
        paidCost: 289.55,
      };

      context.s3.s3Client.send.resolves({
        Body: { transformToString: () => Promise.resolve(JSON.stringify(mockData)) },
      });

      const result = await fetchCPCData(context, 'test-bucket', 'site123', log);

      expect(result.organicCPC).to.be.approximately(0.191, 0.001);
      expect(result.paidCPC).to.be.approximately(0.312, 0.001);
      expect(result.source).to.equal('ahrefs');
    });

    it('should use default CPC when traffic is zero', async () => {
      const mockData = {
        organicTraffic: 0,
        organicCost: 0,
        paidTraffic: 0,
        paidCost: 0,
      };

      context.s3.s3Client.send.resolves({
        Body: { transformToString: () => Promise.resolve(JSON.stringify(mockData)) },
      });

      const result = await fetchCPCData(context, 'test-bucket', 'site123', log);

      expect(result.organicCPC).to.equal(0.8);
      expect(result.paidCPC).to.equal(0.8);
      expect(result.source).to.equal('ahrefs');
    });

    it('should return default CPC when S3 fetch fails', async () => {
      context.s3.s3Client.send.rejects(new Error('File not found'));

      const result = await fetchCPCData(context, 'test-bucket', 'site123', log);

      expect(result.organicCPC).to.equal(0.8);
      expect(result.paidCPC).to.equal(0.8);
      expect(result.source).to.equal('default');
      expect(log.warn.calledOnce).to.be.true;
    });
  });

  describe('getCPCForTrafficType', () => {
    const cpcData = { organicCPC: 0.5, paidCPC: 1.0 };

    it('should return paidCPC for paid traffic', () => {
      expect(getCPCForTrafficType('paid', cpcData)).to.equal(1.0);
    });

    it('should return organicCPC for earned traffic', () => {
      expect(getCPCForTrafficType('earned', cpcData)).to.equal(0.5);
    });

    it('should return organicCPC for owned traffic', () => {
      expect(getCPCForTrafficType('owned', cpcData)).to.equal(0.5);
    });

    it('should return organicCPC for organic traffic', () => {
      expect(getCPCForTrafficType('organic', cpcData)).to.equal(0.5);
    });
  });

  describe('calculateEstimatedCost', () => {
    it('should calculate cost correctly', () => {
      expect(calculateEstimatedCost(1000, 0.5)).to.equal(500);
      expect(calculateEstimatedCost(5000, 1.25)).to.equal(6250);
    });

    it('should return 0 when loss is 0', () => {
      expect(calculateEstimatedCost(0, 0.5)).to.equal(0);
    });
  });

  describe('getCPCData', () => {
    it('should fetch CPC data using context environment', async () => {
      const mockData = {
        organicTraffic: 1000,
        organicCost: 500,
        paidTraffic: 200,
        paidCost: 100,
      };

      context.s3.s3Client.send.resolves({
        Body: { transformToString: () => Promise.resolve(JSON.stringify(mockData)) },
      });

      context.log = log;
      context.env = { S3_IMPORTER_BUCKET_NAME: 'test-bucket' };

      const result = await getCPCData(context, 'site123');

      expect(result.organicCPC).to.equal(0.5);
      expect(result.paidCPC).to.equal(0.5);
      expect(result.source).to.equal('ahrefs');
      expect(log.info.called).to.be.true;
    });
  });

  describe('calculateProjectedTrafficValue', () => {
    const cpcData = { organicCPC: 0.5, paidCPC: 1.0 };

    it('should calculate total value across all traffic types', () => {
      const byTrafficType = {
        paid: { loss: 100 },
        earned: { loss: 200 },
        owned: { loss: 300 },
      };

      // paid: 100 * 1.0 = 100, earned: 200 * 0.5 = 100, owned: 300 * 0.5 = 150
      const result = calculateProjectedTrafficValue(byTrafficType, cpcData);
      expect(result).to.equal(350);
    });

    it('should return 0 when no traffic types', () => {
      const result = calculateProjectedTrafficValue({}, cpcData);
      expect(result).to.equal(0);
    });

    it('should handle single traffic type', () => {
      const byTrafficType = { paid: { loss: 50 } };
      const result = calculateProjectedTrafficValue(byTrafficType, cpcData);
      expect(result).to.equal(50); // 50 * 1.0
    });
  });
});

