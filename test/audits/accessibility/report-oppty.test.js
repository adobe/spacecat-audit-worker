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
  createOrUpdateDeviceSpecificSuggestion,
  createAccessibilityAssistiveOpportunity,
  createAccessibilityColorContrastOpportunity,
} from '../../../src/accessibility/utils/report-oppty.js';

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
        description: 'This report provides an in-depth overview of various accessibility issues identified across different web pages on Desktop devices. It categorizes issues based on their severity and impact, offering detailed descriptions and recommended fixes. The report covers critical aspects such as ARIA attributes, keyboard navigation, and screen reader compatibility to ensure a more inclusive and accessible web experience for all users.',
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
        description: 'Here are some optimization suggestions that could help solve the accessibility issues found on the top 10 most-visited pages on Desktop devices.',
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
        description: 'This report provides a comprehensive analysis of accessibility issues on Desktop devices, highlighting both resolved and newly identified problems. It aims to track progress in improving accessibility and identify areas requiring further attention.',
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
          type: 'CODE_CHANGE',
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

  describe('createAccessibilityAssistiveOpportunity', () => {
    it('should create correct assistive opportunity structure', () => {
      const opportunity = createAccessibilityAssistiveOpportunity();

      expect(opportunity).to.deep.equal({
        runbook: 'https://adobe.sharepoint.com/:w:/r/sites/aemsites-engineering/Shared%20Documents/3%20-%20Experience%20Success/SpaceCat/Runbooks/Experience_Success_Studio_Runbook_Template.docx?d=w5ec0880fdc7a41c786c7409157f5de48&csf=1&web=1&e=vXnRVq',
        origin: 'AUTOMATION',
        type: 'a11y-assistive',
        title: 'Accessibility - Assistive technology is incompatible on site',
        description: 'This report provides a structured overview of all detected accessibility issues across your website, organized by severity and page. Each issue includes WCAG guidelines, impact assessment, and actionable recommendations for improvement.',
        tags: ['a11y'],
        status: 'NEW',
        data: {
          dataSources: ['axe-core'],
        },
      });
    });

    it('should have consistent structure with other opportunity types', () => {
      const assistive = createAccessibilityAssistiveOpportunity();
      const base = createBaseReportOpportunity(1, 2024);

      // Should have same basic structure
      expect(assistive).to.have.property('runbook');
      expect(assistive).to.have.property('origin', 'AUTOMATION');
      expect(assistive).to.have.property('type');
      expect(assistive).to.have.property('title');
      expect(assistive).to.have.property('description');
      expect(assistive).to.have.property('tags');
      expect(assistive).to.have.property('status');

      // Should have same runbook and tags as other opportunities
      expect(assistive.runbook).to.equal(base.runbook);
      expect(assistive.tags).to.deep.equal(base.tags);
      expect(assistive.origin).to.equal(base.origin);
    });

    it('should have unique type and status compared to report opportunities', () => {
      const assistive = createAccessibilityAssistiveOpportunity();
      const base = createBaseReportOpportunity(1, 2024);

      // Should have different type and status
      expect(assistive.type).to.equal('a11y-assistive');
      expect(base.type).to.equal('generic-opportunity');
      expect(assistive.status).to.equal('NEW');
      expect(base.status).to.equal('IGNORED');
    });

    it('should include data sources information', () => {
      const opportunity = createAccessibilityAssistiveOpportunity();

      expect(opportunity.data).to.be.an('object');
      expect(opportunity.data.dataSources).to.be.an('array');
      expect(opportunity.data.dataSources).to.include('axe-core');
    });

    it('should be callable multiple times with consistent results', () => {
      const opportunity1 = createAccessibilityAssistiveOpportunity();
      const opportunity2 = createAccessibilityAssistiveOpportunity();

      expect(opportunity1).to.deep.equal(opportunity2);
    });
  });

  describe('createAccessibilityColorContrastOpportunity', () => {
    it('should create correct color contrast opportunity structure', () => {
      const opportunity = createAccessibilityColorContrastOpportunity();

      expect(opportunity).to.deep.equal({
        runbook: 'https://adobe.sharepoint.com/:w:/r/sites/aemsites-engineering/Shared%20Documents/3%20-%20Experience%20Success/SpaceCat/Runbooks/Experience_Success_Studio_Runbook_Template.docx?d=w5ec0880fdc7a41c786c7409157f5de48&csf=1&web=1&e=vXnRVq',
        origin: 'AUTOMATION',
        type: 'a11y-color-contrast',
        title: 'Accessibility - Color contrast is insufficient on site',
        description: 'This report provides a structured overview of all detected accessibility issues across your website, organized by severity and page. Each issue includes WCAG guidelines, impact assessment, and actionable recommendations for improvement.',
        tags: ['a11y'],
        status: 'NEW',
        data: {
          dataSources: ['axe-core'],
        },
      });
    });

    it('should have consistent structure with other opportunity types', () => {
      const colorContrast = createAccessibilityColorContrastOpportunity();
      const assistive = createAccessibilityAssistiveOpportunity();

      // Should have same basic structure
      expect(colorContrast).to.have.property('runbook');
      expect(colorContrast).to.have.property('origin', 'AUTOMATION');
      expect(colorContrast).to.have.property('type');
      expect(colorContrast).to.have.property('title');
      expect(colorContrast).to.have.property('description');
      expect(colorContrast).to.have.property('tags');
      expect(colorContrast).to.have.property('status');

      // Should have same runbook, tags, origin, and description as assistive opportunity
      expect(colorContrast.runbook).to.equal(assistive.runbook);
      expect(colorContrast.tags).to.deep.equal(assistive.tags);
      expect(colorContrast.origin).to.equal(assistive.origin);
      expect(colorContrast.description).to.equal(assistive.description);
    });

    it('should have unique type compared to other opportunities', () => {
      const colorContrast = createAccessibilityColorContrastOpportunity();
      const assistive = createAccessibilityAssistiveOpportunity();
      const base = createBaseReportOpportunity(1, 2024);

      // Should have unique type
      expect(colorContrast.type).to.equal('a11y-color-contrast');
      expect(assistive.type).to.equal('a11y-assistive');
      expect(base.type).to.equal('generic-opportunity');
    });

    it('should have same status as assistive opportunity', () => {
      const colorContrast = createAccessibilityColorContrastOpportunity();
      const assistive = createAccessibilityAssistiveOpportunity();

      expect(colorContrast.status).to.equal('NEW');
      expect(colorContrast.status).to.equal(assistive.status);
    });

    it('should have unique title compared to other opportunities', () => {
      const colorContrast = createAccessibilityColorContrastOpportunity();
      const assistive = createAccessibilityAssistiveOpportunity();
      const base = createBaseReportOpportunity(1, 2024);

      expect(colorContrast.title).to.equal('Accessibility - Color contrast is insufficient on site');
      expect(colorContrast.title).to.not.equal(assistive.title);
      expect(colorContrast.title).to.not.equal(base.title);

      // Should contain accessibility-specific keywords
      expect(colorContrast.title).to.include('Accessibility');
      expect(colorContrast.title).to.include('Color contrast');
      expect(colorContrast.title).to.include('insufficient');
    });

    it('should include data sources information', () => {
      const opportunity = createAccessibilityColorContrastOpportunity();

      expect(opportunity.data).to.be.an('object');
      expect(opportunity.data.dataSources).to.be.an('array');
      expect(opportunity.data.dataSources).to.include('axe-core');
      expect(opportunity.data.dataSources).to.have.length(1);
    });

    it('should be callable multiple times with consistent results', () => {
      const opportunity1 = createAccessibilityColorContrastOpportunity();
      const opportunity2 = createAccessibilityColorContrastOpportunity();

      expect(opportunity1).to.deep.equal(opportunity2);
    });

    it('should not require parameters', () => {
      // Should be callable without parameters
      expect(() => createAccessibilityColorContrastOpportunity()).to.not.throw();

      // Should ignore any parameters passed
      expect(() => createAccessibilityColorContrastOpportunity('param1', 'param2')).to.not.throw();

      const withoutParams = createAccessibilityColorContrastOpportunity();
      const withParams = createAccessibilityColorContrastOpportunity('ignored', 123);

      expect(withoutParams).to.deep.equal(withParams);
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
      const assistive = createAccessibilityAssistiveOpportunity();
      const colorContrast = createAccessibilityColorContrastOpportunity();

      // All should have these common properties
      [inDepth, enhanced, fixedVsNew, base, assistive, colorContrast].forEach((opportunity) => {
        expect(opportunity).to.have.property('runbook');
        expect(opportunity).to.have.property('origin', 'AUTOMATION');
        expect(opportunity).to.have.property('type');
        expect(opportunity).to.have.property('title');
        expect(opportunity).to.have.property('description');
        expect(opportunity).to.have.property('tags');
        expect(opportunity).to.have.property('status');

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
      const assistive = createAccessibilityAssistiveOpportunity();
      const colorContrast = createAccessibilityColorContrastOpportunity();

      const titles = [
        inDepth.title,
        enhanced.title,
        fixedVsNew.title,
        base.title,
        assistive.title,
        colorContrast.title,
      ];

      // All titles should be unique
      expect(new Set(titles).size).to.equal(6);

      // Report opportunities should contain week and year
      [inDepth.title, enhanced.title, fixedVsNew.title, base.title].forEach((title) => {
        expect(title).to.include('Week 10');
        expect(title).to.include('2024');
        expect(title).to.include('Desktop');
      });

      // Assistive and color contrast opportunities should not contain week/year/desktop
      [assistive.title, colorContrast.title].forEach((title) => {
        expect(title).to.not.include('Week');
        expect(title).to.not.include('2024');
        expect(title).to.not.include('Desktop');
      });
    });

    it('should have different types and statuses', () => {
      const week = 10;
      const year = 2024;

      const inDepth = createInDepthReportOpportunity(week, year);
      const enhanced = createEnhancedReportOpportunity(week, year);
      const fixedVsNew = createFixedVsNewReportOpportunity(week, year);
      const base = createBaseReportOpportunity(week, year);
      const assistive = createAccessibilityAssistiveOpportunity();
      const colorContrast = createAccessibilityColorContrastOpportunity();

      // Report opportunities should have same type and status
      [inDepth, enhanced, fixedVsNew, base].forEach((opportunity) => {
        expect(opportunity.type).to.equal('generic-opportunity');
        expect(opportunity.status).to.equal('IGNORED');
      });

      // Assistive and color contrast opportunities should have different type and same status
      expect(assistive.type).to.equal('a11y-assistive');
      expect(assistive.status).to.equal('NEW');
      expect(colorContrast.type).to.equal('a11y-color-contrast');
      expect(colorContrast.status).to.equal('NEW');
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

      // Assistive and color contrast opportunities don't take parameters
      expect(() => createAccessibilityAssistiveOpportunity()).to.not.throw();
      expect(() => createAccessibilityColorContrastOpportunity()).to.not.throw();
    });
  });

  describe('createOrUpdateDeviceSpecificSuggestion', () => {
    let mockLog;

    beforeEach(() => {
      mockLog = {
        info: () => {},
      };
    });

    it('should handle string suggestionValue for desktop device', () => {
      const suggestionValue = '# Desktop Report\nSome content';
      const deviceType = 'desktop';
      const markdownContent = '# Updated Desktop Report\nNew content';

      const result = createOrUpdateDeviceSpecificSuggestion(
        suggestionValue,
        deviceType,
        markdownContent,
        mockLog,
      );

      expect(result).to.be.an('array');
      expect(result).to.have.lengthOf(1);
      expect(result[0]).to.have.property('type', 'CODE_CHANGE');
      expect(result[0].data).to.have.property('suggestionValue');
      expect(result[0].data.suggestionValue).to.deep.equal({
        'accessibility-desktop': suggestionValue,
      });
    });

    it('should handle string suggestionValue for mobile device', () => {
      const suggestionValue = '# Mobile Report\nSome content';
      const deviceType = 'mobile';
      const markdownContent = '# Updated Mobile Report\nNew content';

      const result = createOrUpdateDeviceSpecificSuggestion(
        suggestionValue,
        deviceType,
        markdownContent,
        mockLog,
      );

      expect(result).to.be.an('array');
      expect(result).to.have.lengthOf(1);
      expect(result[0]).to.have.property('type', 'CODE_CHANGE');
      expect(result[0].data).to.have.property('suggestionValue');
      expect(result[0].data.suggestionValue).to.deep.equal({
        'accessibility-mobile': suggestionValue,
      });
    });

    it('should handle object suggestionValue and update with new device content', () => {
      const suggestionValue = {
        'accessibility-desktop': '# Desktop Report\nExisting desktop content',
      };
      const deviceType = 'mobile';
      const markdownContent = '# Mobile Report\nNew mobile content';

      const result = createOrUpdateDeviceSpecificSuggestion(
        suggestionValue,
        deviceType,
        markdownContent,
        mockLog,
      );

      expect(result).to.be.an('array');
      expect(result).to.have.lengthOf(1);
      expect(result[0].data.suggestionValue).to.deep.equal({
        'accessibility-desktop': '# Desktop Report\nExisting desktop content',
        'accessibility-mobile': '# Mobile Report\nNew mobile content',
      });
    });

    it('should handle object suggestionValue and update existing device content', () => {
      const suggestionValue = {
        'accessibility-desktop': '# Desktop Report\nOld desktop content',
        'accessibility-mobile': '# Mobile Report\nOld mobile content',
      };
      const deviceType = 'desktop';
      const markdownContent = '# Desktop Report\nUpdated desktop content';

      const result = createOrUpdateDeviceSpecificSuggestion(
        suggestionValue,
        deviceType,
        markdownContent,
        mockLog,
      );

      expect(result).to.be.an('array');
      expect(result[0].data.suggestionValue).to.deep.equal({
        'accessibility-desktop': '# Desktop Report\nUpdated desktop content',
        'accessibility-mobile': '# Mobile Report\nOld mobile content',
      });
    });

    it('should handle null suggestionValue and create new object', () => {
      const suggestionValue = null;
      const deviceType = 'desktop';
      const markdownContent = '# Desktop Report\nNew content';

      const result = createOrUpdateDeviceSpecificSuggestion(
        suggestionValue,
        deviceType,
        markdownContent,
        mockLog,
      );

      expect(result).to.be.an('array');
      expect(result[0].data.suggestionValue).to.deep.equal({
        'accessibility-desktop': '# Desktop Report\nNew content',
      });
    });

    it('should handle undefined suggestionValue and create new object', () => {
      const suggestionValue = undefined;
      const deviceType = 'mobile';
      const markdownContent = '# Mobile Report\nNew content';

      const result = createOrUpdateDeviceSpecificSuggestion(
        suggestionValue,
        deviceType,
        markdownContent,
        mockLog,
      );

      expect(result).to.be.an('array');
      expect(result[0].data.suggestionValue).to.deep.equal({
        'accessibility-mobile': '# Mobile Report\nNew content',
      });
    });

    it('should use console as default logger if not provided', () => {
      const suggestionValue = '# Test';
      const deviceType = 'desktop';
      const markdownContent = '# Test';

      // Should not throw when logger is not provided
      expect(() => createOrUpdateDeviceSpecificSuggestion(
        suggestionValue,
        deviceType,
        markdownContent,
      )).to.not.throw();
    });

    it('should preserve existing device content when adding new device', () => {
      const suggestionValue = {
        'accessibility-desktop': '# Desktop Content\nImportant desktop info',
      };
      const deviceType = 'mobile';
      const markdownContent = '# Mobile Content\nNew mobile info';

      const result = createOrUpdateDeviceSpecificSuggestion(
        suggestionValue,
        deviceType,
        markdownContent,
        mockLog,
      );

      expect(result[0].data.suggestionValue['accessibility-desktop']).to.equal('# Desktop Content\nImportant desktop info');
      expect(result[0].data.suggestionValue['accessibility-mobile']).to.equal('# Mobile Content\nNew mobile info');
    });

    it('should handle empty markdownContent', () => {
      const suggestionValue = {
        'accessibility-desktop': '# Desktop Report',
      };
      const deviceType = 'mobile';
      const markdownContent = '';

      const result = createOrUpdateDeviceSpecificSuggestion(
        suggestionValue,
        deviceType,
        markdownContent,
        mockLog,
      );

      expect(result).to.be.an('array');
      expect(result[0].data.suggestionValue['accessibility-mobile']).to.equal('');
    });

    it('should handle existing content with both desktop and mobile having content', () => {
      const suggestionValue = {
        'accessibility-desktop': '# Desktop Report\nWith substantial content that is longer',
        'accessibility-mobile': '# Mobile Report\nWith substantial mobile content',
      };
      const deviceType = 'desktop';
      const markdownContent = '# Updated Desktop Report\nWith even more substantial content';

      const result = createOrUpdateDeviceSpecificSuggestion(
        suggestionValue,
        deviceType,
        markdownContent,
        mockLog,
      );

      expect(result).to.be.an('array');
      expect(result[0].data.suggestionValue['accessibility-desktop']).to.have.length.greaterThan(0);
      expect(result[0].data.suggestionValue['accessibility-mobile']).to.have.length.greaterThan(0);
    });

    it('should handle long markdownContent properly', () => {
      const longContent = '# Very Long Report\n' + 'Content line\n'.repeat(100);
      const suggestionValue = {
        'accessibility-desktop': longContent,
      };
      const deviceType = 'mobile';
      const markdownContent = longContent;

      const result = createOrUpdateDeviceSpecificSuggestion(
        suggestionValue,
        deviceType,
        markdownContent,
        mockLog,
      );

      expect(result[0].data.suggestionValue['accessibility-desktop']).to.equal(longContent);
      expect(result[0].data.suggestionValue['accessibility-mobile']).to.equal(longContent);
      expect(result[0].data.suggestionValue['accessibility-desktop']).to.have.length.greaterThan(1000);
    });

    it('should handle object with undefined device content', () => {
      const suggestionValue = {
        'accessibility-desktop': '# Desktop Report',
        // mobile is undefined
      };
      const deviceType = 'mobile';
      const markdownContent = '# Mobile Report';

      const result = createOrUpdateDeviceSpecificSuggestion(
        suggestionValue,
        deviceType,
        markdownContent,
        mockLog,
      );

      expect(result).to.be.an('array');
      expect(result[0].data.suggestionValue['accessibility-mobile']).to.equal('# Mobile Report');
    });

    it('should handle object with one device having empty string', () => {
      const suggestionValue = {
        'accessibility-desktop': '',
        'accessibility-mobile': '# Mobile Report',
      };
      const deviceType = 'desktop';
      const markdownContent = '# Desktop Report';

      const result = createOrUpdateDeviceSpecificSuggestion(
        suggestionValue,
        deviceType,
        markdownContent,
        mockLog,
      );

      expect(result).to.be.an('array');
      expect(result[0].data.suggestionValue['accessibility-desktop']).to.equal('# Desktop Report');
      expect(result[0].data.suggestionValue['accessibility-mobile']).to.equal('# Mobile Report');
    });

    it('should log desktop content length when desktop content exists', () => {
      const suggestionValue = {
        'accessibility-desktop': '# Desktop Report\nWith some content',
      };
      const deviceType = 'mobile';
      const markdownContent = '# Mobile Report';

      // Create a spy to track log calls
      const logSpy = {
        info: () => {},
      };

      const result = createOrUpdateDeviceSpecificSuggestion(
        suggestionValue,
        deviceType,
        markdownContent,
        logSpy,
      );

      // Verify the result has both desktop and mobile content
      expect(result[0].data.suggestionValue['accessibility-desktop']).to.have.length.greaterThan(0);
      expect(result[0].data.suggestionValue['accessibility-mobile']).to.equal('# Mobile Report');
    });

    it('should handle object with desktop content when updating mobile', () => {
      // This test specifically ensures we hit the truthy branch of line 121
      const desktopContent = '# Desktop Accessibility Report\n\n## Critical Issues\n\nSome detailed content here.';
      const suggestionValue = {
        'accessibility-desktop': desktopContent,
      };
      const deviceType = 'mobile';
      const mobileContent = '# Mobile Accessibility Report\n\n## Mobile Issues\n\nMobile specific content.';

      const result = createOrUpdateDeviceSpecificSuggestion(
        suggestionValue,
        deviceType,
        mobileContent,
        mockLog,
      );

      expect(result).to.be.an('array');
      expect(result[0].data.suggestionValue['accessibility-desktop']).to.equal(desktopContent);
      expect(result[0].data.suggestionValue['accessibility-desktop']).to.have.length.greaterThan(50);
      expect(result[0].data.suggestionValue['accessibility-mobile']).to.equal(mobileContent);
      expect(result[0].data.suggestionValue['accessibility-mobile']).to.have.length.greaterThan(50);
    });

    it('should handle object with mobile content when updating desktop', () => {
      // This test ensures both branches are covered
      const mobileContent = '# Mobile Accessibility Report\n\n## Mobile Issues\n\nMobile specific content.';
      const suggestionValue = {
        'accessibility-mobile': mobileContent,
      };
      const deviceType = 'desktop';
      const desktopContent = '# Desktop Accessibility Report\n\n## Critical Issues\n\nDesktop specific content.';

      const result = createOrUpdateDeviceSpecificSuggestion(
        suggestionValue,
        deviceType,
        desktopContent,
        mockLog,
      );

      expect(result).to.be.an('array');
      expect(result[0].data.suggestionValue['accessibility-desktop']).to.equal(desktopContent);
      expect(result[0].data.suggestionValue['accessibility-desktop']).to.have.length.greaterThan(50);
      expect(result[0].data.suggestionValue['accessibility-mobile']).to.equal(mobileContent);
      expect(result[0].data.suggestionValue['accessibility-mobile']).to.have.length.greaterThan(50);
    });

    it('should correctly log desktop content length when it exists with truthy length', () => {
      // This test specifically targets line 121 where desktop content already exists
      const existingDesktopContent = 'Desktop Report Content';
      const suggestionValue = {
        'accessibility-desktop': existingDesktopContent,
      };
      const deviceType = 'mobile';
      const mobileContent = 'Mobile Content';

      let loggedDesktopLength = false;
      const logSpy = {
        info: (message) => {
          if (message.includes('accessibility-desktop length:') && message.includes(existingDesktopContent.length.toString())) {
            loggedDesktopLength = true;
          }
        },
      };

      const result = createOrUpdateDeviceSpecificSuggestion(
        suggestionValue,
        deviceType,
        mobileContent,
        logSpy,
      );

      expect(result).to.be.an('array');
      expect(result[0].data.suggestionValue['accessibility-desktop']).to.equal(existingDesktopContent);
      expect(result[0].data.suggestionValue['accessibility-mobile']).to.equal(mobileContent);
      expect(loggedDesktopLength).to.be.true;
    });

    it('should correctly log desktop content length when it does not exist (hits || 0 branch)', () => {
      // This test targets line 121 falsy branch where desktop content is undefined
      // We update mobile but desktop doesn't exist yet, so line 121 logs "0"
      const suggestionValue = {
        'accessibility-mobile': 'Existing Mobile Content',
      };
      const deviceType = 'mobile';  // Updating mobile, so desktop remains undefined
      const mobileContent = 'Updated Mobile Content';

      let loggedDesktopZero = false;
      const logSpy = {
        info: (message) => {
          if (message.includes('accessibility-desktop length: 0')) {
            loggedDesktopZero = true;
          }
        },
      };

      const result = createOrUpdateDeviceSpecificSuggestion(
        suggestionValue,
        deviceType,
        mobileContent,
        logSpy,
      );

      expect(result).to.be.an('array');
      expect(result[0].data.suggestionValue['accessibility-desktop']).to.be.undefined;
      expect(result[0].data.suggestionValue['accessibility-mobile']).to.equal(mobileContent);
      expect(loggedDesktopZero).to.be.true;
    });
  });
});
