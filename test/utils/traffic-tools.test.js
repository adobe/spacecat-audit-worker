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

import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import { AWSAthenaClient } from '@adobe/spacecat-shared-athena-client';
import { TrafficTools } from '../../src/utils/traffic-tools.js';
import { MockContextBuilder } from '../shared.js';

use(sinonChai);
use(chaiAsPromised);

describe('TrafficTools', () => {
  let context;
  let trafficTools;
  let athenaClientStub;

  beforeEach(() => {
    context = new MockContextBuilder()
      .withSandbox(sinon.createSandbox())
      .build();

    context.env = {
      RUM_METRICS_DATABASE: 'test_db',
      RUM_METRICS_COMPACT_TABLE: 'test_table',
      S3_IMPORTER_BUCKET_NAME: 'test-bucket',
    };

    trafficTools = new TrafficTools(context);

    // Stub AWSAthenaClient
    athenaClientStub = {
      query: sinon.stub(),
    };
    sinon.stub(AWSAthenaClient, 'fromContext').returns(athenaClientStub);
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('constructor', () => {
    it('should initialize with context', () => {
      expect(trafficTools.context).to.equal(context);
      expect(trafficTools.env).to.equal(context.env);
      expect(trafficTools.log).to.equal(context.log);
    });
  });

  describe('generateTemporalCondition', () => {
    it('should generate temporal condition for 4 weeks', () => {
      const condition = trafficTools.generateTemporalCondition();

      // Should contain 4 week conditions
      const orCount = (condition.match(/OR/g) || []).length;
      expect(orCount).to.equal(3); // 4 conditions = 3 ORs

      // Should contain week and year
      expect(condition).to.match(/week=\d+/);
      expect(condition).to.match(/year=\d+/);
      expect(condition).to.include('(');
      expect(condition).to.include(')');
    });

    it('should generate valid SQL format', () => {
      const condition = trafficTools.generateTemporalCondition();

      // Check format: (week=N AND year=YYYY) OR ...
      const pattern = /\(week=\d+ AND year=\d+\)/g;
      const matches = condition.match(pattern);
      expect(matches).to.have.length(4);
    });
  });

  describe('fetchTrafficData', () => {
    it('should fetch traffic data from Athena', async () => {
      const mockResults = [
        { path: '/page1', trf_type: 'paid', pageviews: '1000' },
        { path: '/page1', trf_type: 'earned', pageviews: '500' },
      ];

      athenaClientStub.query.resolves(mockResults);

      const results = await trafficTools.fetchTrafficData(
        'test-site-id',
        '(week=51 AND year=2025)',
      );

      expect(results).to.deep.equal(mockResults);
      expect(athenaClientStub.query).to.have.been.calledOnce;
      expect(AWSAthenaClient.fromContext).to.have.been.calledWith(
        context,
        sinon.match(/s3:\/\/test-bucket\/rum-metrics-compact\/temp\/out\/traffic-tools\/test-site-id-\d+/),
      );
    });

    it('should throw error if S3_IMPORTER_BUCKET_NAME is not provided', async () => {
      delete context.env.S3_IMPORTER_BUCKET_NAME;
      const newTrafficTools = new TrafficTools(context);

      await expect(newTrafficTools.fetchTrafficData('test-site-id', '(week=51 AND year=2025)'))
        .to.be.rejectedWith('S3_IMPORTER_BUCKET_NAME must be provided for traffic tools');
    });

    it('should use default database and table names', async () => {
      delete context.env.RUM_METRICS_DATABASE;
      delete context.env.RUM_METRICS_COMPACT_TABLE;
      const newTrafficTools = new TrafficTools(context);

      athenaClientStub.query.resolves([]);

      await newTrafficTools.fetchTrafficData('test-site-id', '(week=51 AND year=2025)');

      const queryCall = athenaClientStub.query.getCall(0);
      expect(queryCall.args[0]).to.include('rum_metrics.compact_metrics');
    });
  });

  describe('calculatePredominantTraffic', () => {
    it('should return "paid" when paid traffic is predominant', () => {
      const breakdown = { paid: 70, earned: 20, owned: 10 };
      const result = trafficTools.calculatePredominantTraffic(breakdown, 60);
      expect(result).to.equal('paid');
    });

    it('should return "earned" when earned traffic is predominant', () => {
      const breakdown = { paid: 20, earned: 65, owned: 15 };
      const result = trafficTools.calculatePredominantTraffic(breakdown, 60);
      expect(result).to.equal('earned');
    });

    it('should return "owned" when owned traffic is predominant', () => {
      const breakdown = { paid: 15, earned: 20, owned: 65 };
      const result = trafficTools.calculatePredominantTraffic(breakdown, 60);
      expect(result).to.equal('owned');
    });

    it('should return "mixed" when no traffic type is clearly predominant', () => {
      const breakdown = { paid: 35, earned: 33, owned: 32 };
      const result = trafficTools.calculatePredominantTraffic(breakdown, 40);
      expect(result).to.equal('mixed');
    });

    it('should respect the percentage threshold', () => {
      const breakdown = { paid: 60, earned: 25, owned: 15 };

      // With 50% threshold, paid is predominant: 60 >= 50
      expect(trafficTools.calculatePredominantTraffic(breakdown, 50)).to.equal('paid');

      // With 70% threshold, it becomes mixed: 60 < 70
      expect(trafficTools.calculatePredominantTraffic(breakdown, 70)).to.equal('mixed');
    });

    it('should handle missing traffic types', () => {
      const breakdown = { paid: 100 };
      const result = trafficTools.calculatePredominantTraffic(breakdown, 10);
      expect(result).to.equal('paid');
    });
  });

  describe('determinePredominantTraffic', () => {
    beforeEach(() => {
      sinon.stub(trafficTools, 'generateTemporalCondition').returns('(week=51 AND year=2025)');
    });

    it('should return empty object for empty URL array', async () => {
      const result = await trafficTools.determinePredominantTraffic([], 'site-id', 10);
      expect(result).to.deep.equal({});
    });

    it('should analyze traffic for multiple URLs', async () => {
      const mockAthenaResults = [
        { path: '/page1', trf_type: 'paid', pageviews: '700' },
        { path: '/page1', trf_type: 'earned', pageviews: '200' },
        { path: '/page1', trf_type: 'owned', pageviews: '100' },
        { path: '/page2', trf_type: 'earned', pageviews: '600' },
        { path: '/page2', trf_type: 'paid', pageviews: '400' },
      ];

      athenaClientStub.query.resolves(mockAthenaResults);

      const urls = [
        'https://example.com/page1',
        'https://example.com/page2',
      ];

      const result = await trafficTools.determinePredominantTraffic(
        urls,
        'test-site-id',
        60,
      );

      expect(result).to.have.property('https://example.com/page1');
      expect(result).to.have.property('https://example.com/page2');

      // page1: 70% paid, 20% earned, 10% owned -> paid is predominant (70 >= 60)
      expect(result['https://example.com/page1'].predominantTraffic).to.equal('paid');
      expect(result['https://example.com/page1'].details.paid).to.equal(70);
      expect(result['https://example.com/page1'].details.earned).to.equal(20);
      expect(result['https://example.com/page1'].details.owned).to.equal(10);

      // page2: 60% earned, 40% paid -> earned is predominant (60 >= 60)
      expect(result['https://example.com/page2'].predominantTraffic).to.equal('earned');
      expect(result['https://example.com/page2'].details.earned).to.equal(60);
      expect(result['https://example.com/page2'].details.paid).to.equal(40);
      expect(result['https://example.com/page2'].details.owned).to.equal(0);
    });

    it('should handle URLs with no traffic data', async () => {
      athenaClientStub.query.resolves([
        { path: '/page1', trf_type: 'paid', pageviews: '1000' },
      ]);

      const urls = [
        'https://example.com/page1',
        'https://example.com/page-no-data',
      ];

      const result = await trafficTools.determinePredominantTraffic(
        urls,
        'test-site-id',
        10,
      );

      expect(result['https://example.com/page-no-data'].predominantTraffic).to.equal('no traffic');
      expect(result['https://example.com/page-no-data'].details).to.deep.equal({
        paid: 0,
        earned: 0,
        owned: 0,
      });
    });

    it('should handle URLs that are just paths', async () => {
      athenaClientStub.query.resolves([
        { path: '/page1', trf_type: 'paid', pageviews: '1000' },
      ]);

      const urls = ['/page1'];

      const result = await trafficTools.determinePredominantTraffic(
        urls,
        'test-site-id',
        10,
      );

      expect(result['/page1'].predominantTraffic).to.equal('paid');
      expect(result['/page1'].details.paid).to.equal(100);
    });

    it('should handle malformed URLs gracefully', async () => {
      athenaClientStub.query.resolves([
        { path: '/page1', trf_type: 'paid', pageviews: '1000' },
      ]);

      const urls = ['page1']; // No leading slash

      const result = await trafficTools.determinePredominantTraffic(
        urls,
        'test-site-id',
        10,
      );

      expect(result).to.have.property('page1');
      expect(result.page1.predominantTraffic).to.equal('paid');
    });

    it('should handle traffic data with trf_type field', async () => {
      athenaClientStub.query.resolves([
        { path: '/page1', trf_type: 'paid', pageviews: '1000' },
      ]);

      const urls = ['https://example.com/page1'];

      const result = await trafficTools.determinePredominantTraffic(
        urls,
        'test-site-id',
        10,
      );

      expect(result['https://example.com/page1'].predominantTraffic).to.equal('paid');
    });

    it('should log appropriate messages', async () => {
      athenaClientStub.query.resolves([]);

      const urls = ['https://example.com/page1'];

      await trafficTools.determinePredominantTraffic(
        urls,
        'test-site-id',
        10,
      );

      expect(context.log.info).to.have.been.calledWith(
        sinon.match(/Determining predominant traffic for 1 URLs with threshold 10%/),
      );
      expect(context.log.info).to.have.been.calledWith(
        sinon.match(/Predominant traffic analysis complete for 1 URLs/),
      );
    });

    it('should correctly calculate percentages for mixed traffic', async () => {
      athenaClientStub.query.resolves([
        { path: '/page1', trf_type: 'paid', pageviews: '400' },
        { path: '/page1', trf_type: 'earned', pageviews: '350' },
        { path: '/page1', trf_type: 'owned', pageviews: '250' },
      ]);

      const urls = ['https://example.com/page1'];

      const result = await trafficTools.determinePredominantTraffic(
        urls,
        'test-site-id',
        50,
      );

      expect(result['https://example.com/page1'].predominantTraffic).to.equal('mixed');
      expect(result['https://example.com/page1'].details.paid).to.equal(40);
      expect(result['https://example.com/page1'].details.earned).to.equal(35);
      expect(result['https://example.com/page1'].details.owned).to.equal(25);
    });

    it('should handle missing pageviews data (null/undefined)', async () => {
      athenaClientStub.query.resolves([
        { path: '/page1', trf_type: 'paid', pageviews: null },
        { path: '/page1', trf_type: 'earned', pageviews: undefined },
        { path: '/page1', trf_type: 'owned', pageviews: '' },
      ]);

      const urls = ['https://example.com/page1'];

      const result = await trafficTools.determinePredominantTraffic(
        urls,
        'test-site-id',
        10,
      );

      // All pageviews are 0, so no traffic
      expect(result['https://example.com/page1'].predominantTraffic).to.equal('no traffic');
      expect(result['https://example.com/page1'].details.paid).to.equal(0);
      expect(result['https://example.com/page1'].details.earned).to.equal(0);
      expect(result['https://example.com/page1'].details.owned).to.equal(0);
    });
  });
});
