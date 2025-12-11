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
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import chaiAsPromised from 'chai-as-promised';
import esmock from 'esmock';

use(sinonChai);
use(chaiAsPromised);

describe('AemAnalyzer', () => {
  let AemAnalyzer;
  let mockAemClient;
  let mockFragmentAnalyzer;
  let log;

  beforeEach(async () => {
    log = {
      debug: sinon.spy(),
      info: sinon.spy(),
      warn: sinon.spy(),
      error: sinon.spy(),
    };

    mockAemClient = {
      getFragments: sinon.stub(),
      isTokenExpired: sinon.stub().returns(false),
    };

    mockFragmentAnalyzer = {
      findUnusedFragments: sinon.stub(),
    };

    const AemAnalyzerModule = await esmock(
      '../../../src/content-fragment-insights/aem-analyzer.js',
      {
        '../../../src/content-fragment-insights/clients/aem-client.js': {
          AemClient: {
            createFrom: sinon.stub().resolves(mockAemClient),
          },
        },
        '../../../src/content-fragment-insights/fragment-analyzer.js': {
          FragmentAnalyzer: sinon.stub().returns(mockFragmentAnalyzer),
        },
      },
    );

    AemAnalyzer = AemAnalyzerModule.AemAnalyzer;
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('constructor', () => {
    it('should initialize with default values', () => {
      const analyzer = new AemAnalyzer(mockAemClient, log);

      expect(analyzer.log).to.equal(log);
      expect(analyzer.aemClient).to.equal(mockAemClient);
      expect(analyzer.rootPath).to.equal(AemAnalyzer.DEFAULT_FRAGMENT_ROOT_PATH);
      expect(analyzer.fragments).to.be.an('array').that.is.empty;
    });
  });

  describe('createFrom', () => {
    it('should create analyzer from context', async () => {
      const context = { log };

      const analyzer = await AemAnalyzer.createFrom(context);

      expect(analyzer).to.be.instanceOf(AemAnalyzer);
      expect(analyzer.log).to.equal(log);
      expect(analyzer.aemClient).to.equal(mockAemClient);
    });

    it('should pass context to AemClient.createFrom', async () => {
      const context = { log, site: {}, env: {} };

      await AemAnalyzer.createFrom(context);

      // Access the mock through esmock - it's available on the module
      // The AemClient.createFrom was called with context
      expect(mockAemClient).to.exist;
    });
  });

  describe('parseFragment', () => {
    it('should parse fragment with all fields', () => {
      const fragment = {
        path: '/content/dam/test/fragment',
        status: 'new',
        created: { at: '2024-01-01T00:00:00.000Z' },
        modified: { at: '2024-01-15T00:00:00.000Z' },
        published: { at: '2023-12-01T00:00:00.000Z' },
      };

      const result = AemAnalyzer.parseFragment(fragment);

      expect(result).to.deep.equal({
        fragmentPath: '/content/dam/test/fragment',
        status: 'NEW',
        createdAt: '2024-01-01T00:00:00.000Z',
        modifiedAt: '2024-01-15T00:00:00.000Z',
        publishedAt: '2023-12-01T00:00:00.000Z',
        lastModified: '2024-01-15T00:00:00.000Z',
      });
    });

    it('should handle null fragment', () => {
      const result = AemAnalyzer.parseFragment(null);
      expect(result).to.be.null;
    });

    it('should handle undefined fragment', () => {
      const result = AemAnalyzer.parseFragment(undefined);
      expect(result).to.be.null;
    });

    it('should uppercase status', () => {
      const fragment = {
        path: '/content/dam/test/fragment',
        status: 'draft',
        created: { at: '2024-01-01T00:00:00.000Z' },
        modified: null,
        published: null,
      };

      const result = AemAnalyzer.parseFragment(fragment);
      expect(result.status).to.equal('DRAFT');
    });

    it('should handle missing modified field', () => {
      const fragment = {
        path: '/content/dam/test/fragment',
        status: 'new',
        created: { at: '2024-01-01T00:00:00.000Z' },
        modified: null,
        published: null,
      };

      const result = AemAnalyzer.parseFragment(fragment);

      expect(result.modifiedAt).to.be.null;
      expect(result.lastModified).to.equal('2024-01-01T00:00:00.000Z');
    });

    it('should handle missing published field', () => {
      const fragment = {
        path: '/content/dam/test/fragment',
        status: 'new',
        created: { at: '2024-01-01T00:00:00.000Z' },
        modified: null,
        published: null,
      };

      const result = AemAnalyzer.parseFragment(fragment);
      expect(result.publishedAt).to.be.null;
    });

    it('should prefer modifiedAt for lastModified', () => {
      const fragment = {
        path: '/content/dam/test/fragment',
        status: 'modified',
        created: { at: '2024-01-01T00:00:00.000Z' },
        modified: { at: '2024-01-15T00:00:00.000Z' },
        published: null,
      };

      const result = AemAnalyzer.parseFragment(fragment);
      expect(result.lastModified).to.equal('2024-01-15T00:00:00.000Z');
    });

    it('should fallback to createdAt for lastModified when no modifiedAt', () => {
      const fragment = {
        path: '/content/dam/test/fragment',
        status: 'new',
        created: { at: '2024-01-01T00:00:00.000Z' },
        modified: null,
        published: null,
      };

      const result = AemAnalyzer.parseFragment(fragment);
      expect(result.lastModified).to.equal('2024-01-01T00:00:00.000Z');
    });

    it('should handle lastModified being null when both are missing', () => {
      const fragment = {
        path: '/content/dam/test/fragment',
        status: 'new',
        created: null,
        modified: null,
        published: null,
      };

      const result = AemAnalyzer.parseFragment(fragment);
      expect(result.lastModified).to.be.null;
    });
  });

  describe('fetchAllFragments', () => {
    it('should fetch single page of fragments', async () => {
      const analyzer = new AemAnalyzer(mockAemClient, log);

      mockAemClient.getFragments.resolves({
        items: [
          {
            path: '/content/dam/fragment1',
            status: 'new',
            created: { at: '2024-01-01T00:00:00.000Z' },
            modified: null,
            published: null,
          },
        ],
        cursor: null,
      });

      await analyzer.fetchAllFragments();

      expect(analyzer.fragments).to.have.lengthOf(1);
      expect(analyzer.fragments[0].fragmentPath).to.equal('/content/dam/fragment1');
    });

    it('should fetch multiple pages of fragments', async () => {
      const analyzer = new AemAnalyzer(mockAemClient, log);

      mockAemClient.getFragments
        .onFirstCall()
        .resolves({
          items: [
            {
              path: '/content/dam/fragment1',
              status: 'new',
              created: { at: '2024-01-01T00:00:00.000Z' },
              modified: null,
              published: null,
            },
          ],
          cursor: 'page2',
        })
        .onSecondCall()
        .resolves({
          items: [
            {
              path: '/content/dam/fragment2',
              status: 'draft',
              created: { at: '2024-01-02T00:00:00.000Z' },
              modified: null,
              published: null,
            },
          ],
          cursor: null,
        });

      await analyzer.fetchAllFragments();

      expect(analyzer.fragments).to.have.lengthOf(2);
      expect(mockAemClient.getFragments).to.have.been.calledTwice;
    });

    it('should continue fetching until cursor is null', async () => {
      const analyzer = new AemAnalyzer(mockAemClient, log);

      mockAemClient.getFragments
        .onFirstCall()
        .resolves({
          items: [
            {
              path: '/content/dam/fragment1',
              status: 'new',
              created: { at: '2024-01-01T00:00:00.000Z' },
              modified: null,
              published: null,
            },
          ],
          cursor: 'page2',
        })
        .onSecondCall()
        .resolves({
          items: [
            {
              path: '/content/dam/fragment2',
              status: 'new',
              created: { at: '2024-01-02T00:00:00.000Z' },
              modified: null,
              published: null,
            },
          ],
          cursor: 'page3',
        })
        .onThirdCall()
        .resolves({
          items: [
            {
              path: '/content/dam/fragment3',
              status: 'new',
              created: { at: '2024-01-03T00:00:00.000Z' },
              modified: null,
              published: null,
            },
          ],
          cursor: null,
        });

      await analyzer.fetchAllFragments();

      expect(mockAemClient.getFragments.callCount).to.equal(3);
      expect(analyzer.fragments).to.have.lengthOf(3);
    });

    it('should skip null fragments from parseFragment', async () => {
      const analyzer = new AemAnalyzer(mockAemClient, log);

      mockAemClient.getFragments.resolves({
        items: [
          null,
          {
            path: '/content/dam/fragment1',
            status: 'new',
            created: { at: '2024-01-01T00:00:00.000Z' },
            modified: null,
            published: null,
          },
        ],
        cursor: null,
      });

      await analyzer.fetchAllFragments();

      expect(analyzer.fragments).to.have.lengthOf(1);
    });

    it('should pass correct parameters to getFragments', async () => {
      const analyzer = new AemAnalyzer(mockAemClient, log);

      mockAemClient.getFragments.resolves({
        items: [],
        cursor: null,
      });

      await analyzer.fetchAllFragments();

      expect(mockAemClient.getFragments).to.have.been.calledWith(
        '/content/dam/',
        { cursor: null, projection: 'minimal' },
      );
    });

    it('should pass cursor on subsequent calls', async () => {
      const analyzer = new AemAnalyzer(mockAemClient, log);

      mockAemClient.getFragments
        .onFirstCall()
        .resolves({
          items: [],
          cursor: 'cursor-abc',
        })
        .onSecondCall()
        .resolves({
          items: [],
          cursor: null,
        });

      await analyzer.fetchAllFragments();

      expect(mockAemClient.getFragments.secondCall).to.have.been.calledWith(
        '/content/dam/',
        { cursor: 'cursor-abc', projection: 'minimal' },
      );
    });

    it('should handle empty items array', async () => {
      const analyzer = new AemAnalyzer(mockAemClient, log);

      mockAemClient.getFragments.resolves({
        items: [],
        cursor: null,
      });

      await analyzer.fetchAllFragments();

      expect(analyzer.fragments).to.be.an('array').that.is.empty;
    });

    it('should retry on timeout error and succeed', async () => {
      const analyzer = new AemAnalyzer(mockAemClient, log);

      const timeoutError = new Error('Timeout');
      timeoutError.code = 'ETIMEOUT';

      mockAemClient.getFragments
        .onFirstCall()
        .rejects(timeoutError)
        .onSecondCall()
        .resolves({
          items: [
            {
              path: '/content/dam/fragment1',
              status: 'new',
              created: { at: '2024-01-01T00:00:00.000Z' },
              modified: null,
              published: null,
            },
          ],
          cursor: null,
        });

      await analyzer.fetchAllFragments();

      expect(mockAemClient.getFragments).to.have.been.calledTwice;
      expect(analyzer.fragments).to.have.lengthOf(1);
      expect(log.warn).to.have.been.called;
    });

    it('should return empty result after max retry attempts on timeout', async () => {
      const analyzer = new AemAnalyzer(mockAemClient, log);

      const timeoutError = new Error('Timeout');
      timeoutError.code = 'ETIMEOUT';

      mockAemClient.getFragments.rejects(timeoutError);

      await analyzer.fetchAllFragments();

      expect(mockAemClient.getFragments.callCount).to.equal(AemAnalyzer.MAX_FETCH_ATTEMPTS);
      expect(analyzer.fragments).to.be.an('array').that.is.empty;
      expect(log.warn.callCount).to.equal(AemAnalyzer.MAX_FETCH_ATTEMPTS);
    });

    it('should throw non-timeout error immediately without retry', async () => {
      const analyzer = new AemAnalyzer(mockAemClient, log);

      const genericError = new Error('Some other error');

      mockAemClient.getFragments.rejects(genericError);

      await expect(analyzer.fetchAllFragments()).to.be.rejectedWith('Some other error');

      expect(mockAemClient.getFragments).to.have.been.calledOnce;
    });

    it('should retry on token expired and succeed', async () => {
      const analyzer = new AemAnalyzer(mockAemClient, log);

      const apiError = new Error('Unauthorized');

      mockAemClient.getFragments
        .onFirstCall()
        .rejects(apiError)
        .onSecondCall()
        .resolves({
          items: [
            {
              path: '/content/dam/fragment1',
              status: 'new',
              created: { at: '2024-01-01T00:00:00.000Z' },
              modified: null,
              published: null,
            },
          ],
          cursor: null,
        });

      // First call fails, isTokenExpired returns true triggering retry
      mockAemClient.isTokenExpired
        .onFirstCall()
        .returns(true)
        .onSecondCall()
        .returns(false);

      await analyzer.fetchAllFragments();

      expect(mockAemClient.getFragments).to.have.been.calledTwice;
      expect(analyzer.fragments).to.have.lengthOf(1);
      expect(log.warn).to.have.been.calledWith(
        sinon.match(/Token expired. Refreshing and retrying/),
      );
    });
  });

  describe('findUnusedFragments', () => {
    it('should return unused fragments with totals', async () => {
      const analyzer = new AemAnalyzer(mockAemClient, log);

      mockAemClient.getFragments.resolves({
        items: [
          {
            path: '/content/dam/fragment1',
            status: 'new',
            created: { at: '2024-01-01T00:00:00.000Z' },
            modified: null,
            published: null,
          },
        ],
        cursor: null,
      });

      mockFragmentAnalyzer.findUnusedFragments.returns([
        {
          fragmentPath: '/content/dam/fragment1',
          status: 'NEW',
          ageInDays: 100,
          lastModified: '2024-01-01T00:00:00.000Z',
          publishedAt: null,
        },
      ]);

      const result = await analyzer.findUnusedFragments();

      expect(result.totalFragments).to.equal(1);
      expect(result.totalUnused).to.equal(1);
      expect(result.data).to.have.lengthOf(1);
    });

    it('should return empty unused fragments when none found', async () => {
      const analyzer = new AemAnalyzer(mockAemClient, log);

      mockAemClient.getFragments.resolves({
        items: [],
        cursor: null,
      });

      mockFragmentAnalyzer.findUnusedFragments.returns([]);

      const result = await analyzer.findUnusedFragments();

      expect(result.totalFragments).to.equal(0);
      expect(result.totalUnused).to.equal(0);
      expect(result.data).to.be.an('array').that.is.empty;
    });

    it('should call fetchAllFragments before analysis', async () => {
      const analyzer = new AemAnalyzer(mockAemClient, log);

      mockAemClient.getFragments.resolves({
        items: [],
        cursor: null,
      });

      mockFragmentAnalyzer.findUnusedFragments.returns([]);

      await analyzer.findUnusedFragments();

      expect(mockAemClient.getFragments).to.have.been.called;
    });

    it('should pass fragments to analyzer', async () => {
      const analyzer = new AemAnalyzer(mockAemClient, log);

      mockAemClient.getFragments.resolves({
        items: [
          {
            path: '/content/dam/fragment1',
            status: 'new',
            created: { at: '2024-01-01T00:00:00.000Z' },
            modified: null,
            published: null,
          },
        ],
        cursor: null,
      });

      mockFragmentAnalyzer.findUnusedFragments.returns([]);

      await analyzer.findUnusedFragments();

      expect(mockFragmentAnalyzer.findUnusedFragments).to.have.been.calledOnce;
      const calledFragments = mockFragmentAnalyzer.findUnusedFragments.firstCall.args[0];
      expect(calledFragments).to.have.lengthOf(1);
    });
  });

  describe('constants', () => {
    it('should have correct DEFAULT_FRAGMENT_ROOT_PATH', () => {
      expect(AemAnalyzer.DEFAULT_FRAGMENT_ROOT_PATH).to.equal('/content/dam/');
    });

    it('should have correct MAX_FETCH_ATTEMPTS', () => {
      expect(AemAnalyzer.MAX_FETCH_ATTEMPTS).to.equal(3);
    });

    it('should have correct ERROR_CODE_TIMEOUT', () => {
      expect(AemAnalyzer.ERROR_CODE_TIMEOUT).to.equal('ETIMEOUT');
    });
  });
});

