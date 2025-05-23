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

import {
  createInDepthReportOpportunity,
  createEnhancedReportOpportunity,
  createFixedVsNewReportOpportunity,
  createBaseReportOpportunity,
  createReportOpportunitySuggestionInstance,
} from '../../../src/accessibility/utils/reportOppty.js';

describe('Accessibility Report Opportunity Utils', () => {
  describe('createInDepthReportOpportunity', () => {
    it('should create correct in-depth report opportunity structure', () => {
      const week = 42;
      const year = 2024;

      const opportunity = createInDepthReportOpportunity(week, year);

      expect(opportunity).to.deep.equal({
        runbook: 'https://adobe.sharepoint.com/:w:/r/sites/aemsites-engineering/Shared%20Documents/3%20-%20Experience%20Success/SpaceCat/Runbooks/Experience_Success_Studio_Runbook_Template.docx?d=w5ec0880fdc7a41c786c7409157f5de48&csf=1&web=1&e=vXnRVq',
        origin: 'AUTOMATION',
        type: 'generic-opportunity',
        title: 'Accessibility report - Desktop - Week 42 - 2024 - in-depth',
        description: 'This report provides an in-depth overview of various accessibility issues identified across different web pages. It categorizes issues based on their severity and impact, offering detailed descriptions and recommended fixes. The report covers critical aspects such as ARIA attributes, keyboard navigation, and screen reader compatibility to ensure a more inclusive and accessible web experience for all users.',
        tags: ['a11y'],
        status: 'IGNORED',
      });
    });

    it('should handle different week and year values', () => {
      const week = 1;
      const year = 2025;

      const opportunity = createInDepthReportOpportunity(week, year);

      expect(opportunity.title).to.equal('Accessibility report - Desktop - Week 1 - 2025 - in-depth');
    });
  });

  describe('createEnhancedReportOpportunity', () => {
    it('should create correct enhanced report opportunity structure', () => {
      const week = 25;
      const year = 2024;

      const opportunity = createEnhancedReportOpportunity(week, year);

      expect(opportunity).to.deep.equal({
        runbook: 'https://adobe.sharepoint.com/:w:/r/sites/aemsites-engineering/Shared%20Documents/3%20-%20Experience%20Success/SpaceCat/Runbooks/Experience_Success_Studio_Runbook_Template.docx?d=w5ec0880fdc7a41c786c7409157f5de48&csf=1&web=1&e=vXnRVq',
        origin: 'AUTOMATION',
        type: 'generic-opportunity',
        title: 'Enhancing accessibility for the top 10 most-visited pages - Desktop - Week 25 - 2024',
        description: 'Here are some optimization suggestions that could help solve the accessibility issues found on the top 10 most-visited pages.',
        tags: ['a11y'],
        status: 'IGNORED',
      });
    });
  });

  describe('createFixedVsNewReportOpportunity', () => {
    it('should create correct fixed vs new report opportunity structure', () => {
      const week = 30;
      const year = 2024;

      const opportunity = createFixedVsNewReportOpportunity(week, year);

      expect(opportunity).to.deep.equal({
        runbook: 'https://adobe.sharepoint.com/:w:/r/sites/aemsites-engineering/Shared%20Documents/3%20-%20Experience%20Success/SpaceCat/Runbooks/Experience_Success_Studio_Runbook_Template.docx?d=w5ec0880fdc7a41c786c7409157f5de48&csf=1&web=1&e=vXnRVq',
        origin: 'AUTOMATION',
        type: 'generic-opportunity',
        title: 'Accessibility report Fixed vs New Issues - Desktop - Week 30 - 2024',
        description: 'This report provides a comprehensive analysis of accessibility issues, highlighting both resolved and newly identified problems. It aims to track progress in improving accessibility and identify areas requiring further attention.',
        tags: ['a11y'],
        status: 'IGNORED',
      });
    });
  });

  describe('createBaseReportOpportunity', () => {
    it('should create correct base report opportunity structure', () => {
      const week = 15;
      const year = 2024;

      const opportunity = createBaseReportOpportunity(week, year);

      expect(opportunity).to.deep.equal({
        runbook: 'https://adobe.sharepoint.com/:w:/r/sites/aemsites-engineering/Shared%20Documents/3%20-%20Experience%20Success/SpaceCat/Runbooks/Experience_Success_Studio_Runbook_Template.docx?d=w5ec0880fdc7a41c786c7409157f5de48&csf=1&web=1&e=vXnRVq',
        origin: 'AUTOMATION',
        type: 'generic-opportunity',
        title: 'Accessibility report - Desktop - Week 15 - 2024',
        description: 'A web accessibility audit is an assessment of how well your website and digital assets conform to the needs of people with disabilities and if they follow the Web Content Accessibility Guidelines (WCAG). Desktop only.',
        tags: ['a11y'],
        status: 'IGNORED',
      });
    });
  });

  describe('createReportOpportunitySuggestionInstance', () => {
    it('should create correct suggestion instance structure', () => {
      const suggestionValue = 'Test accessibility suggestion content';

      const suggestion = createReportOpportunitySuggestionInstance(suggestionValue);

      expect(suggestion).to.deep.equal([
        {
          type: 'CONTENT_UPDATE',
          rank: 1,
          status: 'NEW',
          data: {
            suggestionValue: 'Test accessibility suggestion content',
          },
        },
      ]);
    });

    it('should handle empty suggestion value', () => {
      const suggestionValue = '';

      const suggestion = createReportOpportunitySuggestionInstance(suggestionValue);

      expect(suggestion[0].data.suggestionValue).to.equal('');
    });

    it('should handle null suggestion value', () => {
      const suggestionValue = null;

      const suggestion = createReportOpportunitySuggestionInstance(suggestionValue);

      expect(suggestion[0].data.suggestionValue).to.be.null;
    });

    it('should handle complex suggestion value', () => {
      const suggestionValue = {
        title: 'Fix color contrast',
        description: 'Ensure text has sufficient contrast ratio',
        priority: 'high',
      };

      const suggestion = createReportOpportunitySuggestionInstance(suggestionValue);

      expect(suggestion[0].data.suggestionValue).to.deep.equal(suggestionValue);
    });
  });

  describe('all opportunity types', () => {
    it('should have consistent structure across all opportunity types', () => {
      const week = 20;
      const year = 2024;

      const inDepth = createInDepthReportOpportunity(week, year);
      const enhanced = createEnhancedReportOpportunity(week, year);
      const fixedVsNew = createFixedVsNewReportOpportunity(week, year);
      const base = createBaseReportOpportunity(week, year);

      // All should have these common properties
      [inDepth, enhanced, fixedVsNew, base].forEach((opportunity) => {
        expect(opportunity).to.have.property('runbook');
        expect(opportunity).to.have.property('origin', 'AUTOMATION');
        expect(opportunity).to.have.property('type', 'generic-opportunity');
        expect(opportunity).to.have.property('title');
        expect(opportunity).to.have.property('description');
        expect(opportunity).to.have.property('tags');
        expect(opportunity).to.have.property('status', 'IGNORED');

        expect(opportunity.tags).to.deep.equal(['a11y']);
        expect(opportunity.runbook).to.be.a('string').and.to.include('adobe.sharepoint.com');
      });
    });

    it('should have unique titles for different opportunity types', () => {
      const week = 10;
      const year = 2024;

      const inDepth = createInDepthReportOpportunity(week, year);
      const enhanced = createEnhancedReportOpportunity(week, year);
      const fixedVsNew = createFixedVsNewReportOpportunity(week, year);
      const base = createBaseReportOpportunity(week, year);

      const titles = [inDepth.title, enhanced.title, fixedVsNew.title, base.title];

      // All titles should be unique
      expect(new Set(titles).size).to.equal(4);

      // All should contain week and year
      titles.forEach((title) => {
        expect(title).to.include('Week 10');
        expect(title).to.include('2024');
        expect(title).to.include('Desktop');
      });
    });

    it('should handle edge case week and year values', () => {
      const edgeCases = [
        { week: 0, year: 2024 },
        { week: 53, year: 2024 },
        { week: 1, year: 1900 },
        { week: 52, year: 2100 },
      ];

      edgeCases.forEach(({ week, year }) => {
        expect(() => createInDepthReportOpportunity(week, year)).to.not.throw();
        expect(() => createEnhancedReportOpportunity(week, year)).to.not.throw();
        expect(() => createFixedVsNewReportOpportunity(week, year)).to.not.throw();
        expect(() => createBaseReportOpportunity(week, year)).to.not.throw();
      });
    });
  });
});
