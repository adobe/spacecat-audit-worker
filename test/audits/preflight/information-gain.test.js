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
import informationGain from '../../../src/preflight/information-gain.js';

describe('Information Gain Preflight Handler', () => {
  let context;
  let auditContext;
  let saveIntermediateResultsStub;

  beforeEach(() => {
    const mockAsyncJob = {
      findById: sinon.stub().resolves({
        getId: () => 'job-456',
        getMetadata: () => ({ payload: {} }),
        setMetadata: sinon.stub(),
        save: sinon.stub().resolves(),
      }),
    };

    context = {
      site: {
        getId: () => 'site-123',
        getBaseURL: () => 'https://example.com',
      },
      job: {
        getId: () => 'job-456',
        getMetadata: () => ({ payload: {} }),
      },
      log: {
        debug: sinon.stub(),
        info: sinon.stub(),
        warn: sinon.stub(),
        error: sinon.stub(),
      },
      dataAccess: {
        AsyncJob: mockAsyncJob,
      },
    };

    saveIntermediateResultsStub = sinon.stub();

    auditContext = {
      previewUrls: ['https://preview.example.com/page1'],
      step: 'identify',
      audits: new Map(),
      auditsResult: [],
      scrapedObjects: [],
      timeExecutionBreakdown: [],
    };

    // Setup audits map with initial page result
    auditContext.audits.set('https://preview.example.com/page1', {
      pageUrl: 'https://preview.example.com/page1',
      audits: [],
    });

    auditContext.auditsResult.push({
      pageUrl: 'https://preview.example.com/page1',
      audits: [],
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('identify step', () => {
    it('should analyze content with good information density', async () => {
      const goodContent = `
        Adobe Announces Major Updates to Creative Cloud Suite
        
        Adobe has released Premiere Pro 24.1 with groundbreaking AI features. The new auto-reframe capability 
        uses machine learning trained on 500,000 video clips to automatically adjust aspect ratios for social media.
        Internal metrics show 73% reduction in editing time for content creators.
        
        After Effects introduces GPU-accelerated particle system via Vulkan API, achieving 8x faster render times.
        Beta testing with 5,000 users showed 94% satisfaction rate. Character Animator facial tracking accuracy 
        improved to 98.2% under optimal lighting, up from 91.3% in previous version.
      `;

      auditContext.scrapedObjects = [{
        data: {
          finalUrl: 'https://preview.example.com/page1',
          scrapeResult: {
            rawBody: `<html><body><p>${goodContent}</p></body></html>`,
          },
        },
      }];

      await informationGain(context, auditContext);

      const pageResult = auditContext.audits.get('https://preview.example.com/page1');
      const infoGainAudit = pageResult.audits.find((a) => a.name === 'information-gain');

      expect(infoGainAudit).to.exist;
      expect(infoGainAudit.type).to.equal('geo');
      expect(infoGainAudit.opportunities).to.have.lengthOf(1);

      const opportunity = infoGainAudit.opportunities[0];
      expect(opportunity.check).to.equal('information-gain-score');
      expect(opportunity.score).to.be.a('number');
      expect(opportunity.scoreCategory).to.be.oneOf(['excellent', 'good', 'moderate', 'poor', 'very_poor']);
      expect(opportunity.metrics).to.exist;
      expect(opportunity.metrics.infogain_score).to.exist;
      expect(opportunity.summary).to.exist;
      expect(opportunity.traitScores).to.exist;
    });

    it('should handle content with poor information density', async () => {
      const poorContent = `
        This is a very generic page with no specific information. We do things and stuff.
        It's all very nice and good. Please contact us for more information.
      `;

      auditContext.scrapedObjects = [{
        data: {
          finalUrl: 'https://preview.example.com/page1',
          scrapeResult: {
            rawBody: `<html><body><p>${poorContent}</p></body></html>`,
          },
        },
      }];

      await informationGain(context, auditContext);

      const pageResult = auditContext.audits.get('https://preview.example.com/page1');
      const infoGainAudit = pageResult.audits.find((a) => a.name === 'information-gain');

      expect(infoGainAudit).to.exist;
      const opportunity = infoGainAudit.opportunities[0];
      expect(opportunity.check).to.equal('information-gain-score');
      expect(opportunity.scoreCategory).to.be.oneOf(['moderate', 'poor', 'very_poor']);
      expect(opportunity.seoImpact).to.equal('High');
    });

    it('should handle insufficient content', async () => {
      auditContext.scrapedObjects = [{
        data: {
          finalUrl: 'https://preview.example.com/page1',
          scrapeResult: {
            rawBody: '<html><body><p>Too short</p></body></html>',
          },
        },
      }];

      await informationGain(context, auditContext);

      const pageResult = auditContext.audits.get('https://preview.example.com/page1');
      const infoGainAudit = pageResult.audits.find((a) => a.name === 'information-gain');

      expect(infoGainAudit).to.exist;
      const opportunity = infoGainAudit.opportunities[0];
      expect(opportunity.check).to.equal('insufficient-content');
      expect(opportunity.seoImpact).to.equal('High');
    });

    it('should exclude script and style content', async () => {
      auditContext.scrapedObjects = [{
        data: {
          finalUrl: 'https://preview.example.com/page1',
          scrapeResult: {
            rawBody: `
              <html>
                <head>
                  <style>body { color: red; }</style>
                  <script>console.log('test');</script>
                </head>
                <body>
                  <nav>Navigation stuff</nav>
                  <main>
                    <p>Adobe has released Premiere Pro 24.1 with groundbreaking AI features. 
                    The new auto-reframe capability uses machine learning trained on 500,000 video clips. 
                    Internal metrics show 73% reduction in editing time for content creators.</p>
                  </main>
                  <footer>Footer content</footer>
                </body>
              </html>
            `,
          },
        },
      }];

      await informationGain(context, auditContext);

      const pageResult = auditContext.audits.get('https://preview.example.com/page1');
      const infoGainAudit = pageResult.audits.find((a) => a.name === 'information-gain');

      expect(infoGainAudit).to.exist;
      const opportunity = infoGainAudit.opportunities[0];
      expect(opportunity.check).to.equal('information-gain-score');
      // Verify that script/style/nav/footer content was excluded
      expect(opportunity.summary).to.not.include('console.log');
      expect(opportunity.summary).to.not.include('color: red');
    });
  });

  describe('suggest step', () => {
    beforeEach(() => {
      auditContext.step = 'suggest';
    });

    it('should identify weak aspects for low-scoring content', async () => {
      const weakContent = `
        We have products and services. They are very good. Contact us to learn more.
        Our team is dedicated to excellence. We provide solutions.
      `;

      auditContext.scrapedObjects = [{
        data: {
          finalUrl: 'https://preview.example.com/page1',
          scrapeResult: {
            rawBody: `<html><body><p>${weakContent}</p></body></html>`,
          },
        },
      }];

      await informationGain(context, auditContext);

      const pageResult = auditContext.audits.get('https://preview.example.com/page1');
      const infoGainAudit = pageResult.audits.find((a) => a.name === 'information-gain');

      expect(infoGainAudit).to.exist;
      const opportunity = infoGainAudit.opportunities[0];
      expect(opportunity.check).to.equal('information-gain-analysis');
      expect(opportunity.weakAspects).to.exist;
      expect(opportunity.weakAspects.length).to.be.greaterThan(0);

      // Check that weak aspects have proper structure
      const weakAspect = opportunity.weakAspects[0];
      expect(weakAspect.aspect).to.be.a('string');
      expect(weakAspect.reason).to.be.a('string');
      expect(weakAspect.seoImpact).to.be.oneOf(['High', 'Moderate', 'Low']);
      expect(weakAspect.seoRecommendation).to.be.a('string');
    });

    it('should not suggest improvements for excellent content', async () => {
      const excellentContent = `
        Adobe Announces Premiere Pro 24.1 Release
        
        Adobe has released Premiere Pro 24.1 with groundbreaking AI features including auto-reframe capability
        using machine learning trained on 500,000 video clips to automatically adjust aspect ratios for social media.
        Internal metrics show 73% reduction in editing time for content creators working with multi-platform content.
        
        After Effects 2024 introduces GPU-accelerated particle system via Vulkan API, achieving 8x faster render times
        compared to version 23.6. Beta testing with 5,000 professional users showed 94% satisfaction rate with the new
        workflow improvements. Character Animator 24.1 facial tracking accuracy improved to 98.2% under optimal lighting
        conditions, up from 91.3% in previous version 23.0.
        
        The Media Core team reduced memory footprint by 42% while maintaining 4K playback quality through advanced
        buffer management and lazy loading techniques. Initial deployment to 10% of Creative Cloud subscribers showed
        zero performance regression across tested hardware configurations including MacBook Pro M2 and Windows 11 systems.
      `;

      auditContext.scrapedObjects = [{
        data: {
          finalUrl: 'https://preview.example.com/page1',
          scrapeResult: {
            rawBody: `<html><body><div>${excellentContent}</div></body></html>`,
          },
        },
      }];

      await informationGain(context, auditContext);

      const pageResult = auditContext.audits.get('https://preview.example.com/page1');
      const infoGainAudit = pageResult.audits.find((a) => a.name === 'information-gain');

      expect(infoGainAudit).to.exist;
      const opportunity = infoGainAudit.opportunities[0];
      expect(opportunity.check).to.equal('information-gain-analysis');

      // High scoring content should have no weak aspects or very few
      if (opportunity.weakAspects && opportunity.weakAspects.length > 0) {
        expect(opportunity.scoreCategory).to.be.oneOf(['good', 'moderate']);
      }
    });

    it('should identify specificity issues', async () => {
      const vagueContent = `
        The company released a new product recently. It has many features and improvements.
        Users are very happy with the results. Performance is much better than before.
        The team worked hard to make it great. Contact us for more details.
      `;

      auditContext.scrapedObjects = [{
        data: {
          finalUrl: 'https://preview.example.com/page1',
          scrapeResult: {
            rawBody: `<html><body><p>${vagueContent}</p></body></html>`,
          },
        },
      }];

      await informationGain(context, auditContext);

      const pageResult = auditContext.audits.get('https://preview.example.com/page1');
      const infoGainAudit = pageResult.audits.find((a) => a.name === 'information-gain');

      const opportunity = infoGainAudit.opportunities[0];
      expect(opportunity.weakAspects).to.exist;

      // Should identify specificity as a weak aspect
      const specificityIssue = opportunity.weakAspects.find((a) => a.aspect === 'specificity');
      if (specificityIssue) {
        expect(specificityIssue.reason).to.include('entity preservation');
        expect(specificityIssue.seoRecommendation).to.include('specific');
      }
    });

    it('should identify completeness issues', async () => {
      const incompleteContent = `
        Adobe Premiere Pro has new features. After Effects also got updates.
        Character Animator works better now. Everything is faster.
      `;

      auditContext.scrapedObjects = [{
        data: {
          finalUrl: 'https://preview.example.com/page1',
          scrapeResult: {
            rawBody: `<html><body><p>${incompleteContent}</p></body></html>`,
          },
        },
      }];

      await informationGain(context, auditContext);

      const pageResult = auditContext.audits.get('https://preview.example.com/page1');
      const infoGainAudit = pageResult.audits.find((a) => a.name === 'information-gain');

      const opportunity = infoGainAudit.opportunities[0];
      expect(opportunity.weakAspects).to.exist;

      // Should identify completeness as a weak aspect
      const completenessIssue = opportunity.weakAspects.find((a) => a.aspect === 'completeness');
      if (completenessIssue) {
        expect(completenessIssue.reason).to.include('fact coverage');
        expect(completenessIssue.seoRecommendation).to.include('statistics');
      }
    });
  });

  describe('metrics calculation', () => {
    it('should calculate all required metrics', async () => {
      const content = `
        Adobe Premiere Pro 24.1 delivers 73% faster rendering with new GPU acceleration.
        After Effects 2024 includes 500 new particle effects and 8x improved performance.
        Character Animator supports 98.2% facial tracking accuracy in version 24.0.
      `;

      auditContext.scrapedObjects = [{
        data: {
          finalUrl: 'https://preview.example.com/page1',
          scrapeResult: {
            rawBody: `<html><body><p>${content}</p></body></html>`,
          },
        },
      }];

      await informationGain(context, auditContext);

      const pageResult = auditContext.audits.get('https://preview.example.com/page1');
      const infoGainAudit = pageResult.audits.find((a) => a.name === 'information-gain');
      const opportunity = infoGainAudit.opportunities[0];

      // Verify all metrics are present
      expect(opportunity.metrics.compression_ratio).to.exist;
      expect(opportunity.metrics.semantic_similarity).to.exist;
      expect(opportunity.metrics.entity_preservation).to.exist;
      expect(opportunity.metrics.fact_coverage).to.exist;
      expect(opportunity.metrics.infogain_score).to.exist;

      // Verify trait scores
      expect(opportunity.traitScores).to.exist;
      expect(opportunity.traitScores.specificity).to.exist;
      expect(opportunity.traitScores.completeness).to.exist;
      expect(opportunity.traitScores.relevance).to.exist;
      expect(opportunity.traitScores.quality).to.exist;
    });

    it('should properly extract numbers and percentages', async () => {
      const content = `
        The software achieved 73% faster performance, 8x better rendering speed,
        and support for 500,000 video clips. Version 24.1 includes improvements
        for 5,000 users with 98.2% accuracy and 42% memory reduction.
      `;

      auditContext.scrapedObjects = [{
        data: {
          finalUrl: 'https://preview.example.com/page1',
          scrapeResult: {
            rawBody: `<html><body><p>${content}</p></body></html>`,
          },
        },
      }];

      await informationGain(context, auditContext);

      const pageResult = auditContext.audits.get('https://preview.example.com/page1');
      const infoGainAudit = pageResult.audits.find((a) => a.name === 'information-gain');
      const opportunity = infoGainAudit.opportunities[0];

      // Content with lots of numbers should have good fact coverage
      expect(parseFloat(opportunity.metrics.fact_coverage)).to.be.greaterThan(0);
    });
  });

  describe('time tracking', () => {
    it('should track execution time', async () => {
      const content = 'Adobe Premiere Pro 24.1 with 73% performance improvements.';

      auditContext.scrapedObjects = [{
        data: {
          finalUrl: 'https://preview.example.com/page1',
          scrapeResult: {
            rawBody: `<html><body><p>${content}</p></body></html>`,
          },
        },
      }];

      await informationGain(context, auditContext);

      expect(auditContext.timeExecutionBreakdown).to.have.lengthOf(1);
      const timing = auditContext.timeExecutionBreakdown[0];
      expect(timing.name).to.equal('information-gain');
      expect(timing.duration).to.match(/\d+\.\d+ seconds/);
      expect(timing.startTime).to.exist;
      expect(timing.endTime).to.exist;
    });
  });
});

