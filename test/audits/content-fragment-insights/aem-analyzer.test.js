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
import esmock from 'esmock';

describe('AemAnalyzer', () => {
  let AemAnalyzer;
  let mockAemClient;
  let mockFragmentAnalyzer;
  let context;
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
    };

    mockFragmentAnalyzer = {
      findUnusedFragments: sinon.stub(),
    };

    const AemAnalyzerModule = await esmock(
      '../../../src/content-fragment-insights/aem-analyzer.js',
      {
        '../../../src/content-fragment-insights/clients/aem-client.js': {
          AemClient: {
            createFrom: sinon.stub().returns(mockAemClient),
          },
        },
        '../../../src/content-fragment-insights/fragment-analyzer.js': {
          FragmentAnalyzer: sinon.stub().returns(mockFragmentAnalyzer),
        },
      },
    );

    AemAnalyzer = AemAnalyzerModule.AemAnalyzer;

    context = { log };
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('constructor', () => {
    it('should initialize with default values', () => {
      const analyzer = new AemAnalyzer(context);

      expect(analyzer.log).to.equal(log);
      expect(analyzer.rootPath).to.equal(AemAnalyzer.DEFAULT_FRAGMENT_ROOT_PATH);
      expect(analyzer.fragments).to.be.an('array').that.is.empty;
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
      const analyzer = new AemAnalyzer(context);

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
      const analyzer = new AemAnalyzer(context);

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

    it('should stop at max pages limit', async () => {
      const analyzer = new AemAnalyzer(context);

      mockAemClient.getFragments.resolves({
        items: [
          {
            path: '/content/dam/fragment',
            status: 'new',
            created: { at: '2024-01-01T00:00:00.000Z' },
            modified: null,
            published: null,
          },
        ],
        cursor: 'next-page',
      });

      await analyzer.fetchAllFragments();

      expect(mockAemClient.getFragments.callCount).to.equal(AemAnalyzer.MAX_PAGES);
    });

    it('should skip null fragments from parseFragment', async () => {
      const analyzer = new AemAnalyzer(context);

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
      const analyzer = new AemAnalyzer(context);

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
      const analyzer = new AemAnalyzer(context);

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
      const analyzer = new AemAnalyzer(context);

      mockAemClient.getFragments.resolves({
        items: [],
        cursor: null,
      });

      await analyzer.fetchAllFragments();

      expect(analyzer.fragments).to.be.an('array').that.is.empty;
    });
  });

  describe('findUnusedFragments', () => {
    it('should return unused fragments with totals', async () => {
      const analyzer = new AemAnalyzer(context);

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
      expect(result.unusedFragments).to.have.lengthOf(1);
    });

    it('should return empty unused fragments when none found', async () => {
      const analyzer = new AemAnalyzer(context);

      mockAemClient.getFragments.resolves({
        items: [],
        cursor: null,
      });

      mockFragmentAnalyzer.findUnusedFragments.returns([]);

      const result = await analyzer.findUnusedFragments();

      expect(result.totalFragments).to.equal(0);
      expect(result.totalUnused).to.equal(0);
      expect(result.unusedFragments).to.be.an('array').that.is.empty;
    });

    it('should call fetchAllFragments before analysis', async () => {
      const analyzer = new AemAnalyzer(context);

      mockAemClient.getFragments.resolves({
        items: [],
        cursor: null,
      });

      mockFragmentAnalyzer.findUnusedFragments.returns([]);

      await analyzer.findUnusedFragments();

      expect(mockAemClient.getFragments).to.have.been.called;
    });

    it('should pass fragments to analyzer', async () => {
      const analyzer = new AemAnalyzer(context);

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

    it('should have correct MAX_PAGES', () => {
      expect(AemAnalyzer.MAX_PAGES).to.equal(20);
    });
  });
});

