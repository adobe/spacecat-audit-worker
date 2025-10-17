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

export function createInDepthReportOpportunity(week, year, deviceType = 'Desktop') {
  const capitalizedDevice = deviceType.charAt(0).toUpperCase() + deviceType.slice(1);
  return {
    runbook: 'https://adobe.sharepoint.com/:w:/r/sites/aemsites-engineering/Shared%20Documents/3%20-%20Experience%20Success/SpaceCat/Runbooks/Experience_Success_Studio_Runbook_Template.docx?d=w5ec0880fdc7a41c786c7409157f5de48&csf=1&web=1&e=vXnRVq',
    origin: 'AUTOMATION',
    type: 'generic-opportunity',
    title: `Accessibility report - ${capitalizedDevice} - Week ${week} - ${year} - in-depth`,
    description: `This report provides an in-depth overview of various accessibility issues identified across different web pages on ${deviceType} devices. It categorizes issues based on their severity and impact, offering detailed descriptions and recommended fixes. The report covers critical aspects such as ARIA attributes, keyboard navigation, and screen reader compatibility to ensure a more inclusive and accessible web experience for all users.`,
    tags: [
      'a11y',
    ],
    status: 'IGNORED',
  };
}

export function createEnhancedReportOpportunity(week, year, deviceType = 'Desktop') {
  const capitalizedDevice = deviceType.charAt(0).toUpperCase() + deviceType.slice(1);
  return {
    runbook: 'https://adobe.sharepoint.com/:w:/r/sites/aemsites-engineering/Shared%20Documents/3%20-%20Experience%20Success/SpaceCat/Runbooks/Experience_Success_Studio_Runbook_Template.docx?d=w5ec0880fdc7a41c786c7409157f5de48&csf=1&web=1&e=vXnRVq',
    origin: 'AUTOMATION',
    type: 'generic-opportunity',
    title: `Enhancing accessibility for the top 10 most-visited pages - ${capitalizedDevice} - Week ${week} - ${year}`,
    description: `Here are some optimization suggestions that could help solve the accessibility issues found on the top 10 most-visited pages on ${deviceType} devices.`,
    tags: [
      'a11y',
    ],
    status: 'IGNORED',
  };
}

export function createFixedVsNewReportOpportunity(week, year, deviceType = 'Desktop') {
  const capitalizedDevice = deviceType.charAt(0).toUpperCase() + deviceType.slice(1);
  return {
    runbook: 'https://adobe.sharepoint.com/:w:/r/sites/aemsites-engineering/Shared%20Documents/3%20-%20Experience%20Success/SpaceCat/Runbooks/Experience_Success_Studio_Runbook_Template.docx?d=w5ec0880fdc7a41c786c7409157f5de48&csf=1&web=1&e=vXnRVq',
    origin: 'AUTOMATION',
    type: 'generic-opportunity',
    title: `Accessibility report Fixed vs New Issues - ${capitalizedDevice} - Week ${week} - ${year}`,
    description: `This report provides a comprehensive analysis of accessibility issues on ${deviceType} devices, highlighting both resolved and newly identified problems. It aims to track progress in improving accessibility and identify areas requiring further attention.`,
    tags: [
      'a11y',
    ],
    status: 'IGNORED',
  };
}

export function createBaseReportOpportunity(week, year, deviceType = 'Desktop') {
  const capitalizedDevice = deviceType.charAt(0).toUpperCase() + deviceType.slice(1);
  return {
    runbook: 'https://adobe.sharepoint.com/:w:/r/sites/aemsites-engineering/Shared%20Documents/3%20-%20Experience%20Success/SpaceCat/Runbooks/Experience_Success_Studio_Runbook_Template.docx?d=w5ec0880fdc7a41c786c7409157f5de48&csf=1&web=1&e=vXnRVq',
    origin: 'AUTOMATION',
    type: 'generic-opportunity',
    title: `Accessibility report - ${capitalizedDevice} - Week ${week} - ${year}`,
    description: `A web accessibility audit is an assessment of how well your website and digital assets conform to the needs of people with disabilities and if they follow the Web Content Accessibility Guidelines (WCAG). ${capitalizedDevice} only.`,
    tags: [
      'a11y',
    ],
    status: 'IGNORED',
  };
}

export function createReportOpportunitySuggestionInstance(suggestionValue) {
  return [
    {
      type: 'CODE_CHANGE',
      rank: 1,
      status: 'NEW',
      data: {
        suggestionValue,
      },
    },
  ];
}

/**
 * Creates or updates suggestion instance with device-specific markdown
 * @param {string|Object} suggestionValue - Either existing object or new markdown string
 * @param {string} deviceType - 'desktop' or 'mobile'
 * @param {string} markdownContent - The markdown content for this device
 * @returns {Array} Suggestion instance array
 */
export function createOrUpdateDeviceSpecificSuggestion(
  suggestionValue,
  deviceType,
  markdownContent,
) {
  let updatedSuggestionValue;

  if (typeof suggestionValue === 'string') {
    // First device creating the suggestion (legacy case or when no existing suggestion)
    updatedSuggestionValue = {};
    if (deviceType === 'desktop') {
      updatedSuggestionValue['accessibility-desktop'] = suggestionValue;
    } else {
      updatedSuggestionValue['accessibility-mobile'] = suggestionValue;
    }
  } else if (typeof suggestionValue === 'object' && suggestionValue !== null) {
    // Existing object - update with new device content
    updatedSuggestionValue = { ...suggestionValue };
    updatedSuggestionValue[`accessibility-${deviceType}`] = markdownContent;
  } else {
    // New object structure
    updatedSuggestionValue = {};
    updatedSuggestionValue[`accessibility-${deviceType}`] = markdownContent;
  }

  return createReportOpportunitySuggestionInstance(updatedSuggestionValue);
}

export function createAccessibilityAssistiveOpportunity() {
  return {
    runbook: 'https://adobe.sharepoint.com/:w:/r/sites/aemsites-engineering/Shared%20Documents/3%20-%20Experience%20Success/SpaceCat/Runbooks/Experience_Success_Studio_Runbook_Template.docx?d=w5ec0880fdc7a41c786c7409157f5de48&csf=1&web=1&e=vXnRVq',
    origin: 'AUTOMATION',
    type: 'a11y-assistive',
    title: 'Accessibility - Assistive technology is incompatible on site',
    description: 'This report provides a structured overview of all detected accessibility issues across your website, organized by severity and page. Each issue includes WCAG guidelines, impact assessment, and actionable recommendations for improvement.',
    tags: [
      'a11y',
    ],
    status: 'NEW',
    data: {
      dataSources: ['axe-core'],
    },
  };
}

export function createAccessibilityColorContrastOpportunity() {
  return {
    runbook: 'https://adobe.sharepoint.com/:w:/r/sites/aemsites-engineering/Shared%20Documents/3%20-%20Experience%20Success/SpaceCat/Runbooks/Experience_Success_Studio_Runbook_Template.docx?d=w5ec0880fdc7a41c786c7409157f5de48&csf=1&web=1&e=vXnRVq',
    origin: 'AUTOMATION',
    type: 'a11y-color-contrast',
    title: 'Accessibility - Color contrast is insufficient on site',
    description: 'This report provides a structured overview of all detected accessibility issues across your website, organized by severity and page. Each issue includes WCAG guidelines, impact assessment, and actionable recommendations for improvement.',
    tags: [
      'a11y',
    ],
    status: 'NEW',
    data: {
      dataSources: ['axe-core'],
    },
  };
}
