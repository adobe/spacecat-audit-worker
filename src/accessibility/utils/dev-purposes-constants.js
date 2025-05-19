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

export const lastWeek = {
  overall: {
    violations: {
      total: 2387,
      critical: {
        count: 948,
        items: {
          'aria-allowed-attr': {
            count: 499,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/name-role-value.html',
            successCriteriaNumber: '412',
          },
          'aria-required-parent': {
            count: 364,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/info-and-relationships.html',
            successCriteriaNumber: '131',
          },
          'button-name': {
            count: 73,
            description: 'Buttons must have discernible text',
            level: 'A',
            understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/name-role-value.html',
            successCriteriaNumber: '412',
          },
          'select-name': {
            count: 3,
            description: 'Select element must have an accessible name',
            level: 'A',
            understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/name-role-value.html',
            successCriteriaNumber: '412',
          },
          'image-alt': {
            count: 9,
            description: 'Images must have alternative text',
            level: 'A',
            understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/non-text-content.html',
            successCriteriaNumber: '111',
          },
        },
      },
      serious: {
        count: 1439,
        items: {
          'aria-prohibited-attr': {
            count: 67,
            description: 'Elements must only use permitted ARIA attributes',
            level: 'A',
            understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/name-role-value.html',
            successCriteriaNumber: '412',
          },
          'color-contrast': {
            count: 972,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html',
            successCriteriaNumber: '143',
          },
          'link-name': {
            count: 110,
            description: 'Links must have discernible text',
            level: 'A',
            understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/link-purpose-in-context.html',
            successCriteriaNumber: '244',
          },
          list: {
            count: 267,
            description: '<ul> and <ol> must only directly contain <li>, <script> or <template> elements',
            level: 'A',
            understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/info-and-relationships.html',
            successCriteriaNumber: '131',
          },
          'scrollable-region-focusable': {
            count: 12,
            description: 'Scrollable region must have keyboard access',
            level: 'A',
            understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/keyboard.html',
            successCriteriaNumber: '211',
          },
          'target-size': {
            count: 3,
            description: 'All touch targets must be 24px large, or leave sufficient space',
            level: 'AA',
            understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html',
            successCriteriaNumber: '258',
          },
          'link-in-text-block': {
            count: 8,
            description: 'Links must be distinguishable without relying on color',
            level: 'A',
            understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html',
            successCriteriaNumber: '141',
          },
        },
      },
    },
    traffic: 0,
  },
  'https://www.bamboohr.com/pl-pages/onboarding': {
    violations: {
      total: 13,
      critical: {
        count: 0,
        items: {},
      },
      serious: {
        count: 13,
        items: {
          'aria-prohibited-attr': {
            count: 1,
            description: 'Elements must only use permitted ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div aria-label="Drift Widget messenger icon" id="widgetIcon" class="chatWidget">',
            ],
            failureSummary: 'Fix all of the following:\n  aria-label attribute cannot be used on a div with no valid role attribute.',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-prohibited-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'color-contrast': {
            count: 11,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="FirstName_879386" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_879386" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_879386" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<label for="Title_879386" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_879386" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_879386" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_879386" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count</label>',
              '<label for="Country_879386" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
        },
      },
    },
    traffic: '35760',
  },
  'https://www.bamboohr.com/demo': {
    violations: {
      total: 14,
      critical: {
        count: 5,
        items: {
          'aria-allowed-attr': {
            count: 5,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="nav-section has-sub-menu" am-region="Our Platform" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Solutions" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Why BambooHR" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Resources" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="About" aria-expanded="false">',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
        },
      },
      serious: {
        count: 9,
        items: {
          'color-contrast': {
            count: 8,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<label for="FirstName_935424" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_935424" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_935424" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<label for="Title_935424" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_935424" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_935424" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_935424" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count</label>',
              '<label for="Country_935424" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.12 (foreground color: #95918f, background color: #ffffff, font size: 9.0pt (12px), font weight: normal). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
        },
      },
    },
    traffic: '44400',
  },
  'https://www.bamboohr.com/pl-pages/easier-customer-testimonials': {
    violations: {
      total: 19,
      critical: {
        count: 5,
        items: {
          'aria-allowed-attr': {
            count: 5,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="accordion" aria-selected="true">',
              '<h2 id="track-hours-manage-benefits--run-payroll-in-one-place" class="tabs-title" aria-selected="true">Track Hours, Manage Benefits &amp; Run Payroll in One Place</h2>',
              '<h2 id="quickly-hire--onboard-the-best-talent" class="tabs-title" aria-selected="false">Quickly Hire &amp; Onboard the Best Talent</h2>',
              '<h2 id="make-strategic-data-driven-decisions" class="tabs-title" aria-selected="false">Make Strategic, Data-Driven Decisions</h2>',
              '<h2 id="create-a-thriving-work-environment" class="tabs-title" aria-selected="false">Create a Thriving Work Environment</h2>',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-selected="true"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
        },
      },
      serious: {
        count: 14,
        items: {
          'aria-prohibited-attr': {
            count: 1,
            description: 'Elements must only use permitted ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div aria-label="Drift Widget messenger icon" id="widgetIcon" class="chatWidget">',
            ],
            failureSummary: 'Fix all of the following:\n  aria-label attribute cannot be used on a div with no valid role attribute.',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-prohibited-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'color-contrast': {
            count: 12,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<h1 id="see-how-bamboohr-makes-life-easier-for-these-hr-pros">See how BambooHR makes life easier for these HR pros.</h1>',
              '<label for="FirstName_725964" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_725964" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_725964" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<label for="Title_725964" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_725964" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_725964" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_725964" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count</label>',
              '<label for="Country_725964" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
        },
      },
    },
    traffic: '116200',
  },
  'https://www.bamboohr.com/pl-pages/bamboohr-software-basics': {
    violations: {
      total: 13,
      critical: {
        count: 0,
        items: {},
      },
      serious: {
        count: 13,
        items: {
          'aria-prohibited-attr': {
            count: 1,
            description: 'Elements must only use permitted ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div aria-label="Drift Widget messenger icon" id="widgetIcon" class="chatWidget">',
            ],
            failureSummary: 'Fix all of the following:\n  aria-label attribute cannot be used on a div with no valid role attribute.',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-prohibited-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'color-contrast': {
            count: 11,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="FirstName_996553" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_996553" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_996553" id="LblEmail" class="mktoLabel mktoHasWidth">Business Email*</label>',
              '<label for="Title_996553" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_996553" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_996553" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_996553" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count</label>',
              '<label for="Country_996553" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
        },
      },
    },
    traffic: '218260',
  },
  'https://www.bamboohr.com/unsubscribe/': {
    violations: {
      total: 14,
      critical: {
        count: 9,
        items: {
          'aria-allowed-attr': {
            count: 5,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="nav-section has-sub-menu" am-region="Our Platform" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Solutions" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Why BambooHR" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Resources" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="About" aria-expanded="false">',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 5,
        items: {
          'color-contrast': {
            count: 4,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="Email_433573" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Email Address</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
        },
      },
    },
    traffic: '44300',
  },
  'https://www.bamboohr.com/pl-pages/bamboohr-software': {
    violations: {
      total: 17,
      critical: {
        count: 4,
        items: {
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 13,
        items: {
          'aria-prohibited-attr': {
            count: 1,
            description: 'Elements must only use permitted ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div aria-label="Drift Widget messenger icon" id="widgetIcon" class="chatWidget">',
            ],
            failureSummary: 'Fix all of the following:\n  aria-label attribute cannot be used on a div with no valid role attribute.',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-prohibited-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'color-contrast': {
            count: 11,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="FirstName_914832" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_914832" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_914832" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<label for="Title_914832" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_914832" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_914832" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_914832" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count</label>',
              '<label for="Country_914832" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
        },
      },
    },
    traffic: '84600',
  },
  'https://www.bamboohr.com/pl/onboarding-checklist': {
    violations: {
      total: 20,
      critical: {
        count: 7,
        items: {
          'aria-allowed-attr': {
            count: 3,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 13,
        items: {
          'aria-prohibited-attr': {
            count: 1,
            description: 'Elements must only use permitted ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div aria-label="Drift Widget messenger icon" id="widgetIcon" class="chatWidget">',
            ],
            failureSummary: 'Fix all of the following:\n  aria-label attribute cannot be used on a div with no valid role attribute.',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-prohibited-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'color-contrast': {
            count: 11,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="FirstName_219767" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_219767" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_219767" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<label for="Title_219767" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_219767" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_219767" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_219767" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count </label>',
              '<label for="Country_219767" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
        },
      },
    },
    traffic: '45700',
  },
  'https://www.bamboohr.com/careers/': {
    violations: {
      total: 44,
      critical: {
        count: 38,
        items: {
          'aria-allowed-attr': {
            count: 22,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="nav-section has-sub-menu" am-region="Our Platform" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Solutions" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Why BambooHR" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Resources" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="About" aria-expanded="false">',
              '<div class="accordion" aria-selected="true">',
              '<h2 id="our-mission" class="tabs-title" aria-selected="true">Our Mission</h2>',
              '<h2 id="our-vision" class="tabs-title" aria-selected="false">Our Vision</h2>',
              '<h2 id="our-values" class="tabs-title" aria-selected="false">Our Values</h2>',
              '<h2 id="our-history" class="tabs-title" aria-selected="false">Our History</h2>',
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="accordion" aria-selected="true">',
              '<h2 id="what-happens-after-i-apply" class="tabs-title" aria-selected="true">What happens after I apply?</h2>',
              '<h2 id="what-does-bamboohr-do" class="tabs-title" aria-selected="false">What does BambooHR do?</h2>',
              '<h2 id="how-do-you-decide-compensation" class="tabs-title" aria-selected="false">How do you decide compensation?</h2>',
              '<h2 id="is-there-a-dress-code" class="tabs-title" aria-selected="false">Is there a dress code?</h2>',
              '<div class="has-image card" aria-expanded="false">',
              '<div class="has-image card" aria-expanded="false">',
              '<div class="has-image card" aria-expanded="false">',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
          'button-name': {
            count: 9,
            description: 'Buttons must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<button class="selected"></button>',
              '<button></button>',
              '<button></button>',
              '<button></button>',
              '<button></button>',
              '<button></button>',
              '<button></button>',
              '<button class="prev disabled">',
              '<button class="next">',
            ],
            failureSummary: "Fix any of the following:\n  Element does not have inner text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute\n  Element does not have an implicit (wrapped) <label>\n  Element does not have an explicit <label>\n  Element's default semantics were not overridden with role=\"none\" or role=\"presentation\"",
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/button-name?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'select-name': {
            count: 3,
            description: 'Select element must have an accessible name',
            level: 'A',
            htmlWithIssues: [
              '<select class="listing-filter-dropdown" id="listing-filter-dropdown-department" data-filter-key="department">',
              '<select class="listing-filter-dropdown" id="listing-filter-dropdown-state" data-filter-key="jobLocState">',
              '<select class="listing-filter-dropdown" id="listing-filter-dropdown-remote-in-office" data-filter-key="jobLocRemote">',
            ],
            failureSummary: "Fix any of the following:\n  Element does not have an implicit (wrapped) <label>\n  Element does not have an explicit <label>\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute\n  Element's default semantics were not overridden with role=\"none\" or role=\"presentation\"",
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/select-name?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
        },
      },
      serious: {
        count: 6,
        items: {
          'aria-prohibited-attr': {
            count: 1,
            description: 'Elements must only use permitted ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div aria-label="Drift Widget messenger icon" id="widgetIcon" class="chatWidget">',
            ],
            failureSummary: 'Fix all of the following:\n  aria-label attribute cannot be used on a div with no valid role attribute.',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-prohibited-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
          list: {
            count: 3,
            description: '<ul> and <ol> must only directly contain <li>, <script> or <template> elements',
            level: 'A',
            htmlWithIssues: [
              '<ul class="listing-cards-results article">',
              '<ul class="listing-cards-results date">',
              '<ul class="listing-results">',
            ],
            failureSummary: 'Fix all of the following:\n  List element has direct children that are not allowed: div',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/list?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
          'scrollable-region-focusable': {
            count: 1,
            description: 'Scrollable region must have keyboard access',
            level: 'A',
            htmlWithIssues: [
              '<div class="carousel style-7 block" data-block-name="carousel" data-block-status="loaded" data-scroll-to-offset="-1">',
            ],
            failureSummary: 'Fix any of the following:\n  Element should have focusable content\n  Element should be focusable',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/scrollable-region-focusable?application=playwright',
            successCriteriaTags: [
              'wcag211',
              'wcag213',
            ],
          },
        },
      },
    },
    traffic: '51800',
  },
  'https://www.bamboohr.com/signup/': {
    violations: {
      total: 10,
      critical: {
        count: 4,
        items: {
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 6,
        items: {
          'color-contrast': {
            count: 5,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="Employees_Text__c" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count</label>',
              '<label for="Country" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
        },
      },
    },
    traffic: '108200',
  },
  'https://www.bamboohr.com/resources/ebooks/the-definitive-guide-to-onboarding': {
    violations: {
      total: 20,
      critical: {
        count: 12,
        items: {
          'aria-allowed-attr': {
            count: 5,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="nav-section has-sub-menu" am-region="Our Platform" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Solutions" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Why BambooHR" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Resources" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="About" aria-expanded="false">',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
          'button-name': {
            count: 3,
            description: 'Buttons must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<button class="selected"></button>',
              '<button class=""></button>',
              '<button class=""></button>',
            ],
            failureSummary: "Fix any of the following:\n  Element does not have inner text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute\n  Element does not have an implicit (wrapped) <label>\n  Element does not have an explicit <label>\n  Element's default semantics were not overridden with role=\"none\" or role=\"presentation\"",
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/button-name?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
        },
      },
      serious: {
        count: 8,
        items: {
          'aria-prohibited-attr': {
            count: 1,
            description: 'Elements must only use permitted ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div aria-label="Drift Widget messenger icon" id="widgetIcon" class="chatWidget">',
            ],
            failureSummary: 'Fix all of the following:\n  aria-label attribute cannot be used on a div with no valid role attribute.',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-prohibited-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'color-contrast': {
            count: 3,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
          'target-size': {
            count: 3,
            description: 'All touch targets must be 24px large, or leave sufficient space',
            level: 'AA',
            htmlWithIssues: [
              '<button class="selected"></button>',
              '<button class=""></button>',
              '<button class=""></button>',
            ],
            failureSummary: 'Fix any of the following:\n  Target has insufficient size (8px by 8px, should be at least 24px by 24px)\n  Target has insufficient space to its closest neighbors. Safe clickable space has a diameter of 16px instead of at least 24px.',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/target-size?application=playwright',
            successCriteriaTags: [
              'wcag258',
            ],
          },
        },
      },
    },
    traffic: '92060',
  },
  'https://www.bamboohr.com/homepage-customer': {
    violations: {
      total: 24,
      critical: {
        count: 15,
        items: {
          'aria-allowed-attr': {
            count: 11,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="nav-section has-sub-menu" am-region="Our Platform" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Solutions" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Why BambooHR" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Resources" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="About" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="has-image card" aria-expanded="false">',
              '<div class="has-image card" aria-expanded="false">',
              '<div class="has-image card" aria-expanded="false">',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 9,
        items: {
          'aria-prohibited-attr': {
            count: 1,
            description: 'Elements must only use permitted ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div aria-label="Drift Widget messenger icon" id="widgetIcon" class="chatWidget">',
            ],
            failureSummary: 'Fix all of the following:\n  aria-label attribute cannot be used on a div with no valid role attribute.',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-prohibited-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'link-name': {
            count: 6,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
              '<a href="https://www.facebook.com/bamboohr/" title="" rel="noopener" target="_blank">',
              '<a href="https://twitter.com/bamboohr/" title="" rel="noopener" target="_blank">',
              '<a href="https://www.instagram.com/bamboohr/" title="" rel="noopener" target="_blank">',
              '<a href="http://www.linkedin.com/company/bamboohr/" title="" rel="noopener" target="_blank">',
              '<a href="https://www.youtube.com/user/bamboohr/" title="" rel="noopener" target="_blank">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
          list: {
            count: 2,
            description: '<ul> and <ol> must only directly contain <li>, <script> or <template> elements',
            level: 'A',
            htmlWithIssues: [
              '<ul class="listing-cards-results date-simple">',
              '<ul class="listing-cards-results date-simple">',
            ],
            failureSummary: 'Fix all of the following:\n  List element has direct children that are not allowed: div',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/list?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
    },
    traffic: '85200',
  },
  'https://www.bamboohr.com/webinars/': {
    violations: {
      total: 15,
      critical: {
        count: 9,
        items: {
          'aria-allowed-attr': {
            count: 5,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="nav-section has-sub-menu" am-region="Our Platform" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Solutions" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Why BambooHR" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Resources" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="About" aria-expanded="false">',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 6,
        items: {
          'color-contrast': {
            count: 3,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
          list: {
            count: 2,
            description: '<ul> and <ol> must only directly contain <li>, <script> or <template> elements',
            level: 'A',
            htmlWithIssues: [
              '<ul class="listing-cards-results date">',
              '<ul class="listing-results">',
            ],
            failureSummary: 'Fix all of the following:\n  List element has direct children that are not allowed: div',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/list?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
    },
    traffic: '53700',
  },
  'https://www.bamboohr.com/pl-pages/hr-software': {
    violations: {
      total: 17,
      critical: {
        count: 4,
        items: {
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 13,
        items: {
          'aria-prohibited-attr': {
            count: 1,
            description: 'Elements must only use permitted ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div aria-label="Drift Widget messenger icon" id="widgetIcon" class="chatWidget">',
            ],
            failureSummary: 'Fix all of the following:\n  aria-label attribute cannot be used on a div with no valid role attribute.',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-prohibited-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'color-contrast': {
            count: 11,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="FirstName_384829" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_384829" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_384829" id="LblEmail" class="mktoLabel mktoHasWidth">Business Email*</label>',
              '<label for="Title_384829" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_384829" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_384829" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_384829" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count</label>',
              '<label for="Country_384829" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
        },
      },
    },
    traffic: '41060',
  },
  'https://www.bamboohr.com/pricing/': {
    violations: {
      total: 33,
      critical: {
        count: 20,
        items: {
          'aria-allowed-attr': {
            count: 10,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="nav-section has-sub-menu" am-region="Our Platform" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Solutions" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Why BambooHR" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Resources" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="About" aria-expanded="false">',
              '<h2 id="how-much-does-bamboohr-cost" class="tabs-title" aria-selected="true">How much does BambooHR cost?</h2>',
              '<h2 id="what-payment-methods-do-you-accept" class="tabs-title" aria-selected="false">What payment methods do you accept?</h2>',
              '<h2 id="do-you-offer-discounts" class="tabs-title" aria-selected="false">Do you offer discounts?</h2>',
              '<h2 id="does-bamboohr-integrate-with-other-software" class="tabs-title" aria-selected="false">Does BambooHR integrate with other software?</h2>',
              '<h2 id="how-difficult-is-it-to-switch-to-bamboohr-payroll" class="tabs-title" aria-selected="false">How difficult is it to switch to BambooHR Payroll?</h2>',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
          'button-name': {
            count: 6,
            description: 'Buttons must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<button class="selected"></button>',
              '<button></button>',
              '<button></button>',
              '<button></button>',
              '<button class="prev disabled">',
              '<button class="next">',
            ],
            failureSummary: "Fix any of the following:\n  Element does not have inner text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute\n  Element does not have an implicit (wrapped) <label>\n  Element does not have an explicit <label>\n  Element's default semantics were not overridden with role=\"none\" or role=\"presentation\"",
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/button-name?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
        },
      },
      serious: {
        count: 13,
        items: {
          'color-contrast': {
            count: 11,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="FirstName_772216" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_772216" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_772216" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<label for="Title_772216" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_772216" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_772216" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_772216" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count</label>',
              '<label for="Country_772216" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
          'scrollable-region-focusable': {
            count: 1,
            description: 'Scrollable region must have keyboard access',
            level: 'A',
            htmlWithIssues: [
              '<div class="carousel style-6 block" data-block-name="carousel" data-block-status="loaded" data-scroll-to-offset="-1">',
            ],
            failureSummary: 'Fix any of the following:\n  Element should have focusable content\n  Element should be focusable',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/scrollable-region-focusable?application=playwright',
            successCriteriaTags: [
              'wcag211',
              'wcag213',
            ],
          },
        },
      },
    },
    traffic: '41100',
  },
  'https://www.bamboohr.com/pl-pages/competitors/rippling': {
    violations: {
      total: 20,
      critical: {
        count: 7,
        items: {
          'aria-allowed-attr': {
            count: 3,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div data-align="center" class="has-image card" aria-expanded="false">',
              '<div data-align="center" class="has-image card" aria-expanded="false">',
              '<div data-align="center" class="has-image card" aria-expanded="false">',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 13,
        items: {
          'aria-prohibited-attr': {
            count: 1,
            description: 'Elements must only use permitted ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div aria-label="Drift Widget messenger icon" id="widgetIcon" class="chatWidget">',
            ],
            failureSummary: 'Fix all of the following:\n  aria-label attribute cannot be used on a div with no valid role attribute.',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-prohibited-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'color-contrast': {
            count: 11,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="FirstName_696944" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_696944" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_696944" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<label for="Title_696944" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_696944" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_696944" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_696944" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count</label>',
              '<label for="Country_696944" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
        },
      },
    },
    traffic: '39600',
  },
  'https://www.bamboohr.com/pl-pages/hr-time-tracking': {
    violations: {
      total: 24,
      critical: {
        count: 10,
        items: {
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
          'button-name': {
            count: 6,
            description: 'Buttons must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<button class=""></button>',
              '<button class=""></button>',
              '<button class=""></button>',
              '<button class=""></button>',
              '<button class="selected"></button>',
              '<button></button>',
            ],
            failureSummary: "Fix any of the following:\n  Element does not have inner text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute\n  Element does not have an implicit (wrapped) <label>\n  Element does not have an explicit <label>\n  Element's default semantics were not overridden with role=\"none\" or role=\"presentation\"",
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/button-name?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
        },
      },
      serious: {
        count: 14,
        items: {
          'aria-prohibited-attr': {
            count: 1,
            description: 'Elements must only use permitted ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div aria-label="Drift Widget messenger icon" id="widgetIcon" class="chatWidget">',
            ],
            failureSummary: 'Fix all of the following:\n  aria-label attribute cannot be used on a div with no valid role attribute.',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-prohibited-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'color-contrast': {
            count: 11,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="FirstName_662767" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_662767" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_662767" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<label for="Title_662767" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_662767" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_662767" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_662767" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count</label>',
              '<label for="Country_662767" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
          'scrollable-region-focusable': {
            count: 1,
            description: 'Scrollable region must have keyboard access',
            level: 'A',
            htmlWithIssues: [
              '<div class="carousel style-3 auto-play g2-card block" data-block-name="carousel" data-block-status="loaded" data-scroll-to-offset="-1">',
            ],
            failureSummary: 'Fix any of the following:\n  Element should have focusable content\n  Element should be focusable',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/scrollable-region-focusable?application=playwright',
            successCriteriaTags: [
              'wcag211',
              'wcag213',
            ],
          },
        },
      },
    },
    traffic: '112100',
  },
  'https://www.bamboohr.com/blog/': {
    violations: {
      total: 20,
      critical: {
        count: 6,
        items: {
          'aria-allowed-attr': {
            count: 2,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="nav-section has-sub-menu" am-region="Categories" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Our Platform" aria-expanded="false">',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 14,
        items: {
          'color-contrast': {
            count: 13,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/blog/">Blog</a>',
              '<div class="article-feed-card-date">Apr 11, 2025</div>',
              '<div class="article-feed-card-date">Jan 30, 2025</div>',
              '<div class="article-feed-card-date">Apr 28, 2025</div>',
              '<div class="article-feed-card-date">Apr 25, 2025</div>',
              '<div class="article-feed-card-date">Apr 17, 2025</div>',
              '<div class="article-feed-card-date">Apr 11, 2025</div>',
              '<div class="article-feed-card-date">Apr 11, 2025</div>',
              '<div class="article-feed-card-date">Apr 11, 2025</div>',
              '<div class="article-feed-card-date">Apr 11, 2025</div>',
              '<div class="article-feed-card-date">Apr 11, 2025</div>',
              '<div class="article-feed-card-date">Apr 11, 2025</div>',
              '<div class="article-feed-card-date">Apr 07, 2025</div>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.35 (foreground color: #599d15, background color: #ffffff, font size: 12.8pt (17px), font weight: normal). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
        },
      },
    },
    traffic: '34000',
  },
  'https://www.bamboohr.com/careers/application': {
    violations: {
      total: 12,
      critical: {
        count: 10,
        items: {
          'aria-allowed-attr': {
            count: 5,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="nav-section has-sub-menu" am-region="Our Platform" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Solutions" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Why BambooHR" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Resources" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="About" aria-expanded="false">',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
          'image-alt': {
            count: 1,
            description: 'Images must have alternative text',
            level: 'A',
            htmlWithIssues: [
              '<img src="https://arttrk.com/pixel/?ad_log=referer&amp;action=lead&amp;pixid=e1669dc1-e6fd-4b1e-a2d6-37cf7b7bf483" width="1" height="1" border="0">',
            ],
            failureSummary: "Fix any of the following:\n  Element does not have an alt attribute\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute\n  Element's default semantics were not overridden with role=\"none\" or role=\"presentation\"",
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/image-alt?application=playwright',
            successCriteriaTags: [
              'wcag111',
            ],
          },
        },
      },
      serious: {
        count: 2,
        items: {
          'aria-prohibited-attr': {
            count: 1,
            description: 'Elements must only use permitted ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div aria-label="Drift Widget messenger icon" id="widgetIcon" class="chatWidget">',
            ],
            failureSummary: 'Fix all of the following:\n  aria-label attribute cannot be used on a div with no valid role attribute.',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-prohibited-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
        },
      },
    },
    traffic: '78700',
  },
  'https://www.bamboohr.com/blog/employees-do-the-right-thing': {
    violations: {
      total: 10,
      critical: {
        count: 7,
        items: {
          'aria-allowed-attr': {
            count: 3,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="nav-section has-sub-menu" am-region="Categories" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Our Platform" aria-expanded="false">',
              '<div class="toc-title" aria-selected="false">Table of Contents</div>',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 3,
        items: {
          'color-contrast': {
            count: 1,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/blog/">Blog</a>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.35 (foreground color: #599d15, background color: #ffffff, font size: 12.8pt (17px), font weight: normal). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-in-text-block': {
            count: 1,
            description: 'Links must be distinguishable without relying on color',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.linkedin.com/in/mattnesmith/" rel="noopener" target="_blank">LinkedIn</a>',
            ],
            failureSummary: 'Fix any of the following:\n  The link has insufficient color contrast of 2.34:1 with the surrounding text. (Minimum contrast is 3:1, link text: #2e7918, surrounding text: #38312f)\n  The link has no styling (such as underline) to distinguish it from the surrounding text',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-in-text-block?application=playwright',
            successCriteriaTags: [
              'wcag141',
            ],
          },
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
        },
      },
    },
    traffic: '52000',
  },
  'https://www.bamboohr.com/pl-pages/easier-upgrade-your-hr': {
    violations: {
      total: 21,
      critical: {
        count: 13,
        items: {
          'aria-allowed-attr': {
            count: 9,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div id="cabinet-peaks-medical-center" class="tabs-title" aria-selected="true">',
              '<div id="avidbots" class="tabs-title" aria-selected="false">',
              '<div id="cti" class="tabs-title" aria-selected="false">',
              '<div class="has-image card" aria-expanded="false">',
              '<div class="has-image card" aria-expanded="false">',
              '<div class="has-image card" aria-expanded="false">',
              '<div class="has-image card" aria-expanded="false">',
              '<div class="has-image card" aria-expanded="false">',
              '<div class="has-image card" aria-expanded="false">',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-selected="true"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 8,
        items: {
          'aria-prohibited-attr': {
            count: 1,
            description: 'Elements must only use permitted ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div aria-label="Drift Widget messenger icon" id="widgetIcon" class="chatWidget">',
            ],
            failureSummary: 'Fix all of the following:\n  aria-label attribute cannot be used on a div with no valid role attribute.',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-prohibited-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'color-contrast': {
            count: 6,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<h1 id="upgrade-to-easier-hr">Upgrade to Easier HR</h1>',
              '<label for="Email_104396" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<div class="mktoHtmlText mktoHasWidth">My data will be handled according to the <a href="https://www.bamboohr.com/legal/privacy-policy" target="_blank">Privacy Notice</a>.</div>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
        },
      },
    },
    traffic: '112800',
  },
  'https://www.bamboohr.com/resources/ebooks/definitive-guide-company-culture': {
    violations: {
      total: 13,
      critical: {
        count: 9,
        items: {
          'aria-allowed-attr': {
            count: 5,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="nav-section has-sub-menu" am-region="Our Platform" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Solutions" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Why BambooHR" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Resources" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="About" aria-expanded="false">',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 4,
        items: {
          'aria-prohibited-attr': {
            count: 1,
            description: 'Elements must only use permitted ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div aria-label="Drift Widget messenger icon" id="widgetIcon" class="chatWidget">',
            ],
            failureSummary: 'Fix all of the following:\n  aria-label attribute cannot be used on a div with no valid role attribute.',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-prohibited-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'color-contrast': {
            count: 2,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
        },
      },
    },
    traffic: '51200',
  },
  'https://www.bamboohr.com/pl-pages/bamboohr-overview': {
    violations: {
      total: 29,
      critical: {
        count: 19,
        items: {
          'aria-allowed-attr': {
            count: 8,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div id="hiring--onboarding" class="tabs-title" aria-selected="true">',
              '<div id="payroll-time--benefits" class="tabs-title" aria-selected="false">',
              '<div id="employee-experience--performance" class="tabs-title" aria-selected="false">',
              '<div id="hr-data--reporting" class="tabs-title" aria-selected="false">',
              '<div id="integration-marketplace" class="tabs-title" aria-selected="false">',
              '<div class="has-image card" aria-expanded="false">',
              '<div class="has-image card" aria-expanded="false">',
              '<div class="has-image card" aria-expanded="false">',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-selected="true"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
          'button-name': {
            count: 7,
            description: 'Buttons must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<button class="selected"></button>',
              '<button></button>',
              '<button></button>',
              '<button></button>',
              '<button></button>',
              '<button class="prev disabled">',
              '<button class="next">',
            ],
            failureSummary: "Fix any of the following:\n  Element does not have inner text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute\n  Element does not have an implicit (wrapped) <label>\n  Element does not have an explicit <label>\n  Element's default semantics were not overridden with role=\"none\" or role=\"presentation\"",
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/button-name?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
        },
      },
      serious: {
        count: 10,
        items: {
          'aria-prohibited-attr': {
            count: 1,
            description: 'Elements must only use permitted ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div aria-label="Drift Widget messenger icon" id="widgetIcon" class="chatWidget">',
            ],
            failureSummary: 'Fix all of the following:\n  aria-label attribute cannot be used on a div with no valid role attribute.',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-prohibited-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'color-contrast': {
            count: 7,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<h1 id="making-hr-easier-for-you-and-your-team">Making HR Easier for you and your team</h1>',
              '<label for="Email_264724" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<div class="mktoHtmlText mktoHasWidth">My data will be handled according to the <a href="https://www.bamboohr.com/legal/privacy-policy" target="_blank">Privacy Notice</a>.</div>',
              '<strong>I love just being able to go to one place for everything</strong>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
          'scrollable-region-focusable': {
            count: 1,
            description: 'Scrollable region must have keyboard access',
            level: 'A',
            htmlWithIssues: [
              '<div class="carousel style-7 transparent block" data-block-name="carousel" data-block-status="loaded" data-scroll-to-offset="-1">',
            ],
            failureSummary: 'Fix any of the following:\n  Element should have focusable content\n  Element should be focusable',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/scrollable-region-focusable?application=playwright',
            successCriteriaTags: [
              'wcag211',
              'wcag213',
            ],
          },
        },
      },
    },
    traffic: '56400',
  },
  'https://www.bamboohr.com/': {
    violations: {
      total: 38,
      critical: {
        count: 33,
        items: {
          'aria-allowed-attr': {
            count: 23,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="nav-section has-sub-menu" am-region="Our Platform" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Solutions" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Why BambooHR" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Resources" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="About" aria-expanded="false">',
              '<div class="card" aria-expanded="false"><h5 id="product-announcement">Product Announcement</h5><p>Say hello to Employee Community!</p><p class="button-container"><a href="/hr-software/employee-community" title="Learn More" class="accent caret-link caret-link-theme-color">Learn More</a></p></div>',
              '<div class="card" aria-expanded="false">',
              '<div class="accordion" aria-selected="true">',
              '<h2 id="payroll-time--benefits" class="tabs-title" aria-selected="true">Payroll, Time &amp; Benefits</h2>',
              '<h2 id="hiring--onboarding" class="tabs-title" aria-selected="false">Hiring &amp; Onboarding</h2>',
              '<h2 id="hr-data--reporting" class="tabs-title" aria-selected="false">HR Data &amp; Reporting</h2>',
              '<h2 id="employee-experience--performance" class="tabs-title" aria-selected="false">Employee Experience &amp; Performance</h2>',
              '<div data-align="center" class="has-image card" aria-expanded="false">',
              '<div data-align="center" class="has-image card" aria-expanded="false">',
              '<div data-align="center" class="has-image card" aria-expanded="false">',
              '<div class="accordion" aria-selected="true">',
              '<h2 id="what-does-bamboohr-do" class="tabs-title" aria-selected="true">What does BambooHR do?</h2>',
              '<h2 id="does-bamboohr-do-payroll" class="tabs-title" aria-selected="false">Does BambooHR do payroll?</h2>',
              '<h2 id="how-much-does-bamboohr-cost" class="tabs-title" aria-selected="false">How much does BambooHR cost?</h2>',
              '<h2 id="how-many-countries-is-bamboohr-in" class="tabs-title" aria-selected="false">How many countries is BambooHR in?</h2>',
              '<h2 id="is-your-support-team-outsourced" class="tabs-title" aria-selected="false">Is your support team outsourced?</h2>',
              '<h2 id="is-bamboohr-a-peo" class="tabs-title" aria-selected="false">Is BambooHR a PEO?</h2>',
              "<h2 id=\"wheres-my-data-housed-how-secure-is-bamboohr\" class=\"tabs-title\" aria-selected=\"false\">Where's my data housed? How secure is BambooHR?</h2>",
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
          'button-name': {
            count: 6,
            description: 'Buttons must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<button class=""></button>',
              '<button class=""></button>',
              '<button class=""></button>',
              '<button class=""></button>',
              '<button class="selected"></button>',
              '<button></button>',
            ],
            failureSummary: "Fix any of the following:\n  Element does not have inner text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute\n  Element does not have an implicit (wrapped) <label>\n  Element does not have an explicit <label>\n  Element's default semantics were not overridden with role=\"none\" or role=\"presentation\"",
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/button-name?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
        },
      },
      serious: {
        count: 5,
        items: {
          'color-contrast': {
            count: 3,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
          'scrollable-region-focusable': {
            count: 1,
            description: 'Scrollable region must have keyboard access',
            level: 'A',
            htmlWithIssues: [
              '<div class="carousel style-3 auto-play g2-card block" data-block-name="carousel" data-block-status="loaded" data-scroll-to-offset="-1">',
            ],
            failureSummary: 'Fix any of the following:\n  Element should have focusable content\n  Element should be focusable',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/scrollable-region-focusable?application=playwright',
            successCriteriaTags: [
              'wcag211',
              'wcag213',
            ],
          },
        },
      },
    },
    traffic: '4597700',
  },
  'https://www.bamboohr.com/pl-pages/easier-hr-for-everyone': {
    violations: {
      total: 27,
      critical: {
        count: 12,
        items: {
          'aria-allowed-attr': {
            count: 3,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
          'button-name': {
            count: 5,
            description: 'Buttons must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<button class="selected"></button>',
              '<button></button>',
              '<button></button>',
              '<button class="prev disabled">',
              '<button class="next">',
            ],
            failureSummary: "Fix any of the following:\n  Element does not have inner text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute\n  Element does not have an implicit (wrapped) <label>\n  Element does not have an explicit <label>\n  Element's default semantics were not overridden with role=\"none\" or role=\"presentation\"",
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/button-name?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
        },
      },
      serious: {
        count: 15,
        items: {
          'aria-prohibited-attr': {
            count: 1,
            description: 'Elements must only use permitted ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div aria-label="Drift Widget messenger icon" id="widgetIcon" class="chatWidget">',
            ],
            failureSummary: 'Fix all of the following:\n  aria-label attribute cannot be used on a div with no valid role attribute.',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-prohibited-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'color-contrast': {
            count: 12,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="FirstName_815003" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_815003" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_815003" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<label for="Title_815003" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_815003" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_815003" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_815003" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count</label>',
              '<label for="Country_815003" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
              '<u>easier platform for yourself</u>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
          'scrollable-region-focusable': {
            count: 1,
            description: 'Scrollable region must have keyboard access',
            level: 'A',
            htmlWithIssues: [
              '<div class="carousel style-7 transparent block" data-block-name="carousel" data-block-status="loaded" data-scroll-to-offset="-1">',
            ],
            failureSummary: 'Fix any of the following:\n  Element should have focusable content\n  Element should be focusable',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/scrollable-region-focusable?application=playwright',
            successCriteriaTags: [
              'wcag211',
              'wcag213',
            ],
          },
        },
      },
    },
    traffic: '385100',
  },
  'https://www.bamboohr.com/pl-pages/easier-make-a-difference': {
    violations: {
      total: 27,
      critical: {
        count: 12,
        items: {
          'aria-allowed-attr': {
            count: 3,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
          'button-name': {
            count: 5,
            description: 'Buttons must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<button class="selected"></button>',
              '<button></button>',
              '<button></button>',
              '<button class="prev disabled">',
              '<button class="next">',
            ],
            failureSummary: "Fix any of the following:\n  Element does not have inner text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute\n  Element does not have an implicit (wrapped) <label>\n  Element does not have an explicit <label>\n  Element's default semantics were not overridden with role=\"none\" or role=\"presentation\"",
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/button-name?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
        },
      },
      serious: {
        count: 15,
        items: {
          'aria-prohibited-attr': {
            count: 1,
            description: 'Elements must only use permitted ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div aria-label="Drift Widget messenger icon" id="widgetIcon" class="chatWidget">',
            ],
            failureSummary: 'Fix all of the following:\n  aria-label attribute cannot be used on a div with no valid role attribute.',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-prohibited-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'color-contrast': {
            count: 12,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="FirstName_40489" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_40489" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_40489" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<label for="Title_40489" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_40489" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_40489" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_40489" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count</label>',
              '<label for="Country_40489" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
              '<u>Easily create a better workplace</u>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
          'scrollable-region-focusable': {
            count: 1,
            description: 'Scrollable region must have keyboard access',
            level: 'A',
            htmlWithIssues: [
              '<div class="carousel style-7 transparent block" data-block-name="carousel" data-block-status="loaded" data-scroll-to-offset="-1">',
            ],
            failureSummary: 'Fix any of the following:\n  Element should have focusable content\n  Element should be focusable',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/scrollable-region-focusable?application=playwright',
            successCriteriaTags: [
              'wcag211',
              'wcag213',
            ],
          },
        },
      },
    },
    traffic: '322500',
  },
  'https://www.bamboohr.com/pl-pages/employee-time-tracking': {
    violations: {
      total: 17,
      critical: {
        count: 4,
        items: {
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 13,
        items: {
          'aria-prohibited-attr': {
            count: 1,
            description: 'Elements must only use permitted ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div aria-label="Drift Widget messenger icon" id="widgetIcon" class="chatWidget">',
            ],
            failureSummary: 'Fix all of the following:\n  aria-label attribute cannot be used on a div with no valid role attribute.',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-prohibited-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'color-contrast': {
            count: 11,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="FirstName_339881" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_339881" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_339881" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<label for="Title_339881" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_339881" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_339881" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_339881" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count</label>',
              '<label for="Country_339881" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
        },
      },
    },
    traffic: '28100',
  },
  'https://www.bamboohr.com/legal/privacy-policy': {
    violations: {
      total: 11,
      critical: {
        count: 10,
        items: {
          'aria-allowed-attr': {
            count: 6,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="nav-section has-sub-menu" am-region="Our Platform" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Solutions" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Why BambooHR" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Resources" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="About" aria-expanded="false">',
              '<div class="toc-title" aria-selected="false">Table of Contents</div>',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 1,
        items: {
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
        },
      },
    },
    traffic: '24200',
  },
  'https://www.bamboohr.com/booking/live-demo-success': {
    violations: {
      total: 10,
      critical: {
        count: 9,
        items: {
          'aria-allowed-attr': {
            count: 5,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="nav-section has-sub-menu" am-region="Our Platform" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Solutions" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Why BambooHR" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Resources" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="About" aria-expanded="false">',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 1,
        items: {
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
        },
      },
    },
    traffic: '16900',
  },
  'https://www.bamboohr.com/integrations/listings/netsuite': {
    violations: {
      total: 19,
      critical: {
        count: 15,
        items: {
          'aria-allowed-attr': {
            count: 4,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="nav-section has-sub-menu" am-region="Categories" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Feature Comparisons" aria-expanded="false">',
              '<h2 id="overview" class="tabs-title" aria-selected="true">Overview</h2>',
              '<h2 id="integration" class="tabs-title" aria-selected="false">Integration</h2>',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
          'button-name': {
            count: 3,
            description: 'Buttons must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<button class="selected"></button>',
              '<button class=""></button>',
              '<button class=""></button>',
            ],
            failureSummary: "Fix any of the following:\n  Element does not have inner text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute\n  Element does not have an implicit (wrapped) <label>\n  Element does not have an explicit <label>\n  Element's default semantics were not overridden with role=\"none\" or role=\"presentation\"",
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/button-name?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'image-alt': {
            count: 4,
            description: 'Images must have alternative text',
            level: 'A',
            htmlWithIssues: [
              '<img src="/styles/integration-type.svg">',
              '<img src="/styles/data-flow-direction.svg">',
              '<img src="/styles/sync-trigger.svg">',
              '<img src="/styles/sync-frequency.svg">',
            ],
            failureSummary: "Fix any of the following:\n  Element does not have an alt attribute\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute\n  Element's default semantics were not overridden with role=\"none\" or role=\"presentation\"",
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/image-alt?application=playwright',
            successCriteriaTags: [
              'wcag111',
            ],
          },
        },
      },
      serious: {
        count: 4,
        items: {
          'aria-prohibited-attr': {
            count: 1,
            description: 'Elements must only use permitted ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div aria-label="Drift Widget messenger icon" id="widgetIcon" class="chatWidget">',
            ],
            failureSummary: 'Fix all of the following:\n  aria-label attribute cannot be used on a div with no valid role attribute.',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-prohibited-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'color-contrast': {
            count: 1,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/integrations/">Marketplace</a>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.35 (foreground color: #599d15, background color: #ffffff, font size: 12.8pt (17px), font weight: normal). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
          'scrollable-region-focusable': {
            count: 1,
            description: 'Scrollable region must have keyboard access',
            level: 'A',
            htmlWithIssues: [
              '<div class="carousel block" data-block-name="carousel" data-block-status="loaded" data-scroll-to-offset="-1">',
            ],
            failureSummary: 'Fix any of the following:\n  Element should have focusable content\n  Element should be focusable',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/scrollable-region-focusable?application=playwright',
            successCriteriaTags: [
              'wcag211',
              'wcag213',
            ],
          },
        },
      },
    },
    traffic: '23300',
  },
  'https://www.bamboohr.com/hr-software/mobile': {
    violations: {
      total: 18,
      critical: {
        count: 12,
        items: {
          'aria-allowed-attr': {
            count: 8,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="nav-section has-sub-menu" am-region="Our Platform" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Solutions" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Why BambooHR" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Resources" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="About" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 6,
        items: {
          'color-contrast': {
            count: 3,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-name': {
            count: 3,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
              '<a href="https://apps.apple.com/us/app/bamboohr/id587244049" title="" rel="noopener" target="_blank">',
              '<a href="https://play.google.com/store/apps/details?id=com.mokinetworks.bamboohr" title="" rel="noopener" target="_blank">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
        },
      },
    },
    traffic: '30700',
  },
  'https://www.bamboohr.com/pl-pages/pricing': {
    violations: {
      total: 29,
      critical: {
        count: 15,
        items: {
          'aria-allowed-attr': {
            count: 5,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<h2 id="how-much-does-bamboohr-cost" class="tabs-title" aria-selected="true">How much does BambooHR cost?</h2>',
              '<h2 id="what-payment-methods-do-you-accept" class="tabs-title" aria-selected="false">What payment methods do you accept?</h2>',
              '<h2 id="do-you-offer-discounts" class="tabs-title" aria-selected="false">Do you offer discounts?</h2>',
              '<h2 id="does-bamboohr-integrate-with-other-software" class="tabs-title" aria-selected="false">Does BambooHR integrate with other software?</h2>',
              '<h2 id="how-difficult-is-it-to-switch-to-bamboohr-payroll" class="tabs-title" aria-selected="false">How difficult is it to switch to BambooHR Payroll?</h2>',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-selected="true"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
          'button-name': {
            count: 6,
            description: 'Buttons must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<button class="selected"></button>',
              '<button></button>',
              '<button></button>',
              '<button></button>',
              '<button class="prev disabled">',
              '<button class="next">',
            ],
            failureSummary: "Fix any of the following:\n  Element does not have inner text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute\n  Element does not have an implicit (wrapped) <label>\n  Element does not have an explicit <label>\n  Element's default semantics were not overridden with role=\"none\" or role=\"presentation\"",
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/button-name?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
        },
      },
      serious: {
        count: 14,
        items: {
          'aria-prohibited-attr': {
            count: 1,
            description: 'Elements must only use permitted ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div aria-label="Drift Widget messenger icon" id="widgetIcon" class="chatWidget">',
            ],
            failureSummary: 'Fix all of the following:\n  aria-label attribute cannot be used on a div with no valid role attribute.',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-prohibited-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'color-contrast': {
            count: 11,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Bundle &amp; Save! Get a 15% discount when you combine Payroll and Benefits Administration with the Core or Pro plan.*</span>',
              '<a class="caret-link" href="#add-on-solutions">Learn More</a>',
              '<label for="FirstName_783374" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_783374" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_783374" id="LblEmail" class="mktoLabel mktoHasWidth">Business Email*</label>',
              '<label for="Title_783374" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_783374" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_783374" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_783374" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count</label>',
              '<label for="Country_783374" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
          'scrollable-region-focusable': {
            count: 1,
            description: 'Scrollable region must have keyboard access',
            level: 'A',
            htmlWithIssues: [
              '<div class="carousel style-6 block" data-block-name="carousel" data-block-status="loaded" data-scroll-to-offset="-1">',
            ],
            failureSummary: 'Fix any of the following:\n  Element should have focusable content\n  Element should be focusable',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/scrollable-region-focusable?application=playwright',
            successCriteriaTags: [
              'wcag211',
              'wcag213',
            ],
          },
        },
      },
    },
    traffic: '31400',
  },
  'https://www.bamboohr.com/integrations/': {
    violations: {
      total: 16,
      critical: {
        count: 6,
        items: {
          'aria-allowed-attr': {
            count: 2,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="nav-section has-sub-menu" am-region="Categories" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Feature Comparisons" aria-expanded="false">',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 10,
        items: {
          'aria-prohibited-attr': {
            count: 1,
            description: 'Elements must only use permitted ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div aria-label="Drift Widget messenger icon" id="widgetIcon" class="chatWidget">',
            ],
            failureSummary: 'Fix all of the following:\n  aria-label attribute cannot be used on a div with no valid role attribute.',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-prohibited-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'color-contrast': {
            count: 7,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/integrations/">Marketplace</a>',
              '<a href="https://www.bamboohr.com/integrations/listing-category/payroll" title="Payroll" class="button accent">Payroll</a>',
              '<a href="https://www.bamboohr.com/integrations/listing-category/performance" title="Performance" class="button accent">Performance</a>',
              '<a href="https://www.bamboohr.com/integrations/listing-category/applicant-tracking-systems" title="Applicant Tracking Systems" class="button accent">Applicant Tracking Systems</a>',
              '<a href="https://www.bamboohr.com/integrations/listing-category/time-tracking-scheduling" title="Time Tracking &amp; Scheduling" class="button accent">Time Tracking &amp; Scheduling</a>',
              '<a href="https://www.bamboohr.com/integrations/listing-category/learning-training" title="Learning &amp; Training" class="button accent">Learning &amp; Training</a>',
              '<a href="https://www.bamboohr.com/integrations/listing-category/benefits-administration" title="Benefits Administration" class="button accent">Benefits Administration</a>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.35 (foreground color: #599d15, background color: #ffffff, font size: 12.8pt (17px), font weight: normal). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-name': {
            count: 2,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
              '<a href="https://www.bamboohr.com/exp/benefits/bamboohr-benefits-administration?utm_campaign=BAMB-CM-BAC+jennifer+decker+marketplace+banner-2023EG&amp;utm_medium=expansion&amp;utm_source=marketplace-expansion&amp;utm_content=blank&amp;utm_term=blank" title="">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
        },
      },
    },
    traffic: '20300',
  },
  'https://www.bamboohr.com/pl-pages/separation-letters-guide': {
    violations: {
      total: 20,
      critical: {
        count: 7,
        items: {
          'aria-allowed-attr': {
            count: 3,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 13,
        items: {
          'aria-prohibited-attr': {
            count: 1,
            description: 'Elements must only use permitted ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div aria-label="Drift Widget messenger icon" id="widgetIcon" class="chatWidget">',
            ],
            failureSummary: 'Fix all of the following:\n  aria-label attribute cannot be used on a div with no valid role attribute.',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-prohibited-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'color-contrast': {
            count: 11,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="FirstName_590429" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_590429" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_590429" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<label for="Title_590429" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_590429" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_590429" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_590429" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count </label>',
              '<label for="Country_590429" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
        },
      },
    },
    traffic: '15100',
  },
  'https://www.bamboohr.com/unsubscribe/success': {
    violations: {
      total: 13,
      critical: {
        count: 9,
        items: {
          'aria-allowed-attr': {
            count: 5,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="nav-section has-sub-menu" am-region="Our Platform" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Solutions" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Why BambooHR" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Resources" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="About" aria-expanded="false">',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 4,
        items: {
          'color-contrast': {
            count: 3,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
        },
      },
    },
    traffic: '13300',
  },
  'https://www.bamboohr.com/legal/terms-of-service': {
    violations: {
      total: 11,
      critical: {
        count: 10,
        items: {
          'aria-allowed-attr': {
            count: 6,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="nav-section has-sub-menu" am-region="Our Platform" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Solutions" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Why BambooHR" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Resources" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="About" aria-expanded="false">',
              '<div class="toc-title" aria-selected="false">Table of Contents</div>',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 1,
        items: {
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
        },
      },
    },
    traffic: '31100',
  },
  'https://www.bamboohr.com/resources/ebooks/chatgpt-prompts-hr': {
    violations: {
      total: 22,
      critical: {
        count: 9,
        items: {
          'aria-allowed-attr': {
            count: 5,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="nav-section has-sub-menu" am-region="Our Platform" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Solutions" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Why BambooHR" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Resources" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="About" aria-expanded="false">',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 13,
        items: {
          'aria-prohibited-attr': {
            count: 1,
            description: 'Elements must only use permitted ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div aria-label="Drift Widget messenger icon" id="widgetIcon" class="chatWidget">',
            ],
            failureSummary: 'Fix all of the following:\n  aria-label attribute cannot be used on a div with no valid role attribute.',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-prohibited-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'color-contrast': {
            count: 11,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="FirstName_468822" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_468822" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_468822" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<label for="Title_468822" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_468822" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_468822" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_468822" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count </label>',
              '<label for="Country_468822" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
        },
      },
    },
    traffic: '21900',
  },
  'https://www.bamboohr.com/resources/hr-glossary/': {
    violations: {
      total: 14,
      critical: {
        count: 9,
        items: {
          'aria-allowed-attr': {
            count: 5,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="nav-section has-sub-menu" am-region="Our Platform" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Solutions" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Why BambooHR" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Resources" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="About" aria-expanded="false">',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 5,
        items: {
          'aria-prohibited-attr': {
            count: 1,
            description: 'Elements must only use permitted ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div aria-label="Drift Widget messenger icon" id="widgetIcon" class="chatWidget">',
            ],
            failureSummary: 'Fix all of the following:\n  aria-label attribute cannot be used on a div with no valid role attribute.',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-prohibited-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'color-contrast': {
            count: 3,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
        },
      },
    },
    traffic: '28900',
  },
  'https://www.bamboohr.com/pl-pages/human-resources': {
    violations: {
      total: 17,
      critical: {
        count: 4,
        items: {
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 13,
        items: {
          'aria-prohibited-attr': {
            count: 1,
            description: 'Elements must only use permitted ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div aria-label="Drift Widget messenger icon" id="widgetIcon" class="chatWidget">',
            ],
            failureSummary: 'Fix all of the following:\n  aria-label attribute cannot be used on a div with no valid role attribute.',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-prohibited-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'color-contrast': {
            count: 11,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="FirstName_38907" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_38907" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_38907" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<label for="Title_38907" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_38907" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_38907" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_38907" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count</label>',
              '<label for="Country_38907" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
        },
      },
    },
    traffic: '16700',
  },
  'https://www.bamboohr.com/pl/onboarding-checklist-a2': {
    violations: {
      total: 20,
      critical: {
        count: 7,
        items: {
          'aria-allowed-attr': {
            count: 3,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 13,
        items: {
          'aria-prohibited-attr': {
            count: 1,
            description: 'Elements must only use permitted ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div aria-label="Drift Widget messenger icon" id="widgetIcon" class="chatWidget">',
            ],
            failureSummary: 'Fix all of the following:\n  aria-label attribute cannot be used on a div with no valid role attribute.',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-prohibited-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'color-contrast': {
            count: 11,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="FirstName_993676" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_993676" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_993676" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<label for="Title_993676" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_993676" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_993676" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_993676" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count </label>',
              '<label for="Country_993676" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
        },
      },
    },
    traffic: '19660',
  },
  'https://www.bamboohr.com/pl-pages/pto-tracking': {
    violations: {
      total: 17,
      critical: {
        count: 4,
        items: {
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 13,
        items: {
          'aria-prohibited-attr': {
            count: 1,
            description: 'Elements must only use permitted ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div aria-label="Drift Widget messenger icon" id="widgetIcon" class="chatWidget">',
            ],
            failureSummary: 'Fix all of the following:\n  aria-label attribute cannot be used on a div with no valid role attribute.',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-prohibited-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'color-contrast': {
            count: 11,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="FirstName_657240" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_657240" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_657240" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<label for="Title_657240" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_657240" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_657240" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_657240" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count</label>',
              '<label for="Country_657240" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
        },
      },
    },
    traffic: '17200',
  },
  'https://www.bamboohr.com/pl/benefits-administration': {
    violations: {
      total: 17,
      critical: {
        count: 4,
        items: {
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 13,
        items: {
          'aria-prohibited-attr': {
            count: 1,
            description: 'Elements must only use permitted ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div aria-label="Drift Widget messenger icon" id="widgetIcon" class="chatWidget">',
            ],
            failureSummary: 'Fix all of the following:\n  aria-label attribute cannot be used on a div with no valid role attribute.',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-prohibited-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'color-contrast': {
            count: 11,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="FirstName_657393" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_657393" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_657393" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<label for="Title_657393" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_657393" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_657393" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_657393" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count</label>',
              '<label for="Country_657393" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
        },
      },
    },
    traffic: '26900',
  },
  'https://www.bamboohr.com/resources/': {
    violations: {
      total: 530,
      critical: {
        count: 9,
        items: {
          'aria-allowed-attr': {
            count: 5,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="nav-section has-sub-menu" am-region="Our Platform" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Solutions" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Why BambooHR" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Resources" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="About" aria-expanded="false">',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 521,
        items: {
          'aria-prohibited-attr': {
            count: 1,
            description: 'Elements must only use permitted ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div aria-label="Drift Widget messenger icon" id="widgetIcon" class="chatWidget">',
            ],
            failureSummary: 'Fix all of the following:\n  aria-label attribute cannot be used on a div with no valid role attribute.',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-prohibited-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'color-contrast': {
            count: 261,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<a href="/resources/ebooks/definitive-guide-to-performance-management" class="resource-card-link">Free Download</a>',
              '<a href="/resources/guides/the-definitive-guide-to-onboarding" class="resource-card-link">Read the Guide</a>',
              '<a href="/resources/ebooks/how-to-switch-payroll-providers-in-7-simple-steps" class="resource-card-link">Free Download</a>',
              "<a href=\"/resources/guides/hris-buyers-guide\" class=\"resource-card-link\">Read the HRIS Buyer's Guide</a>",
              '<a href="/resources/guides/10-questions-about-ai" class="resource-card-link">Read the Guide</a>',
              '<a href="/resources/ebooks/behind-the-scenes-ui-2024" class="resource-card-link">Read the Guide</a>',
              "<a href=\"/resources/guides/year-in-review-2024\" class=\"resource-card-link\">Read BambooHR's 2024 Year in Review</a>",
              '<a href="/resources/ebooks/the-definitive-guide-to-onboarding" class="resource-card-link">Get The Full Guide</a>',
              '<a href="/resources/ebooks/5-sure-fire-ways-to-set-goals-that-get-results" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/career-progression-report" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/employee-engagement" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/evaluating-and-rewarding-employee-performance" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/employee-experience-report" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/6-things-your-employees-will-fail-without" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/employee-wellbeing-faq-for-employees" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/developing-benefits-to-help-employees-stay" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/4-things-you-need-in-a-killer-performance-management-tool" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/how-to-solve-your-top-offboarding-problems" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/connected-leadership-how-to-invest-in-your-management-teams" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/coaching-to-create-concrete-results" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/how-to-retain-and-motivate-your-best-employees" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/how-to-use-benefits-to-create-a-culture-of-health-and-well-being" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/productivity-reward-recognition" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/seat-at-the-table" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/9-best-practices-to-master-performance-review" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/9-things-recruiters-do-they-shouldnt" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/fair-transparent-and-modern-a-360-guide-to-employer-brand" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/how-to-make-employees-feel-valued-at-work" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/how-bamboohr-enables-vital-hr-communication" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/guide-to-buying-hris" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/navigating-4-most-crucial-compensation-conversations" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/getting-smart-about-compensation" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/how-you-can-shave-20-off-hr-admin-time" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/definitive-guide-to-creating-comp-plan" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/diy-hr" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/13tips-smbs-great-talent" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/2018-employee-engagement-checklist-calendar" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/how-remote-work-affect-the-culture-conversation" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/how-your-attitude-toward-compliance-shapes-company-culture" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/the-hr-tech-buyers-guide" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/improve-how-you-evaluate" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/reward-and-recognition" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/your-total-rewards-questions-answered" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/danger-spreadsheets" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/hr-for-small-business-what-you-need-to-know" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/employee-wellbeing-faq-for-admins" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/diversity-a-major-asset" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/pros-and-cons-of-unlimited-vacation" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/optimizing-compensation-for-shared-trust" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/the-new-hire-onboarding-checklist-everything-you-need-to-know" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/getting-real-about-employee-engagement-how-to-get-started" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/guide-company-values" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/everything-you-need-to-know-about-communicating-pay" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/why-employee-engagement-matters-to-your-business" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/your-talent-acquisition-ecosystem-managing-the-employee-lifecycle" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/understanding-how-to-influence-the-employee-journey" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/11-leadership-lessons-from-todays-top-people-managers" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/managing-employee-turnover" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/modern-onboarding-to-accelerate-new-hire-success" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/paid-paid-vacation" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/aca-compliance" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/kiss-hr-stoneage-goodbye" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/hr-spreadsheets-hold-you-captive" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/reward-recognition-retention" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/useful-performance-management-takeaways-from-sports" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/using-compensation-to-motivate-performance" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/hr-tech-quick-ref-guide" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/guide-to-onboarding" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/hr-data-can-be-a-killer" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/employee-time-tracking" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/employee-engagement-ask-analyze-act" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/making-performance-management-positive" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/talent-pulse" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/the-2022-essential-retention-guide" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/scaling-your-small-business" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/the-hr-journey-through-2021" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/hr-save-the-day" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/pre-employment-drug-tests-a-primer" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/onboardings-and-offboardings" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/overcoming-spreadsheet-hurdles" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/recruiting-at-speed-text-and-social-media-hiring-tips-for-the-modern-recruiter" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/the-state-of-payroll" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/the-employee-experience-journey" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/recognition-in-the-workplace-breakthrough-secrets-and-stats" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/rethinking-the-great-resignation" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/smart-onboarding" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/unlocking-employee-engagement-the-missing-metric-for-engagement" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/the-employee-1-on-1-checklist-5-steps-how-5-reasons-why" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/top-onboarding-advice" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/what-employees-want-from-performance-management-and-how-to-provide-it" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/where-hr-analytics-makes-a-difference" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/time-management-for-organizations-and-their-people" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/recruiting-a-diverse-workforce" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/definitive-guide-company-culture" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/what-strategic-hr-means-and-how-to-achieve-it" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/20-exit-interview-questions" class="resource-card-link">Get the List</a>',
              '<a href="/resources/infographics/3-causes-of-employee-burnout-and-3-ways-to-prevent-it" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/healthcare" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/hybrid-work-expectations-vs-reality" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/state-of-workplace-distractions" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/what-your-executive-team-wants-from-hr-reports" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/2021-is-all-about-culture-and-employee-experience" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/human-resources-perceptions" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/how-reporting-elevates-hr" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/5-payroll-pain-points-solved-by-traxpayroll" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/bad-boss-index-2020" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/effective-performance-management-reviews" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/exit-interview-best-practices" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/what-matters-most-to-hr-teams-2" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/tips-time-off-requests" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/the-5-reasons-employees-are-leaving" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/perspectives-on-performance-management" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/the-dos-and-donts-of-a-hybrid-workplace" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/10-bamboohr-tips-for-better-faster-hiring" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/calculating-hr-the-real-value-of-hr-software" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/big-hr-small-hr-ideas" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/4-ways-the-bamboohr-ats-improves-your-hiring-process" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/decade-changed-the-workplace" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/employee-time-tracking" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/employee-satisfaction-today" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/employee-wellbeing-first-look" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/the-5-most-common-payroll-mistakes" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/strategic-hr" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/the-incredible-impact-of-effective-onboarding" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/workplace-dealbreakers" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/update-your-time-tracking-process" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/workplace-dress-codes" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/8-focus-areas-for-hr-best-practices" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/five-ways-bamboohr-elevates-your-performance-management" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/hours-worked-around-the-world" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/performance-management" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/reward-recognition" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/should-i-hire-this-candidate" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/5-ways-bamboohr-helps-you-overcome-top-hr-challenges-in-healthcare" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/current-company-culture-trends" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/how-bamboohr-meets-the-top-three-construction-industry-hr-challenges" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/measuring-enps" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/quick-guide-recruitment-process" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/hr-trends-2020" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/reward-and-recognition-what-really-motivates-employees" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/why-employee-engagement-matters-to-your-business" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/why-hr-is-so-important" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/what-are-hr-metrics" class="resource-card-link">Free Download</a>',
              '<a href="/resources/courses/improving-organizational-strategy-with-enps-feedback" class="resource-card-link">Watch Now</a>',
              '<a href="/resources/courses/how-to-measure-employee-satisfaction-with-enps" class="resource-card-link">Watch Now</a>',
              '<a href="/resources/courses/caring-for-the-whole-employee" class="resource-card-link">Watch Now</a>',
              '<a href="/resources/courses/rethink-recruiting" class="resource-card-link">Watch Now</a>',
              '<a href="/resources/courses/three-steps-to-more-influential-hr" class="resource-card-link">Watch Now</a>',
              '<a href="/resources/courses/the-business-of-employee-satisfaction" class="resource-card-link">Watch Now</a>',
              '<a href="/resources/courses/how-to-build-and-maintain-a-culture-of-performance" class="resource-card-link">Watch Now</a>',
              '<a href="/resources/whitepapers/getting-the-most-out-of-hcm-tech" class="resource-card-link">Free Download</a>',
              '<a href="/resources/whitepapers/what-recognized-employees-have-in-common" class="resource-card-link">Free Download</a>',
              '<a href="/resources/whitepapers/4-big-challenges-facing-hr-professionals-in-the-healthcare-industry" class="resource-card-link">Free Download</a>',
              '<a href="/resources/whitepapers/employee-absenteeism" class="resource-card-link">Free Download</a>',
              '<a href="/resources/whitepapers/ending-spreadsheet-chaos" class="resource-card-link">Free Download</a>',
              '<a href="/resources/whitepapers/5-reasons-to-use-ats" class="resource-card-link">Free Download</a>',
              '<a href="/resources/whitepapers/remote-employee-checklist" class="resource-card-link">Free Download</a>',
              '<a href="/resources/whitepapers/stop-using-spreadsheets" class="resource-card-link">Free Download</a>',
              '<a href="/resources/whitepapers/how-to-solve-your-top-onboarding-problems" class="resource-card-link">Free Download</a>',
              '<a href="/resources/whitepapers/communication-of-employee-benefits" class="resource-card-link">Free Download</a>',
              '<a href="/resources/whitepapers/culture-checklist" class="resource-card-link">Free Download</a>',
              '<a href="/resources/whitepapers/employee-development-checklist" class="resource-card-link">Free Download</a>',
              '<a href="/resources/whitepapers/5-essential-features-for-hr-software" class="resource-card-link">Free Download</a>',
              '<a href="/resources/whitepapers/compliance-checklist" class="resource-card-link">Free Download</a>',
              '<a href="/resources/whitepapers/how-to-write-a-job-description" class="resource-card-link">Free Download</a>',
              '<a href="/resources/whitepapers/insights-into-onboarding" class="resource-card-link">Free Download</a>',
              '<a href="/resources/whitepapers/resumes-dont-belong-in-email" class="resource-card-link">Free Download</a>',
              '<a href="/resources/whitepapers/challenges-in-healthcare" class="resource-card-link">Free Download</a>',
              '<a href="/resources/whitepapers/compensation-starter-kit" class="resource-card-link">Free Download</a>',
              '<a href="/resources/whitepapers/get-out-of-spreadsheets" class="resource-card-link">Free Download</a>',
              '<a href="/resources/whitepapers/streamlining-hr" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/employee-handbook-checklist" class="resource-card-link">Get the Checklist</a>',
              '<a href="/resources/ebooks/offboarding-checklist" class="resource-card-link">Get the Checklist</a>',
              '<a href="/resources/ebooks/new-teacher-onboarding-checklist" class="resource-card-link">Get the New Teacher Onboarding Checklist</a>',
              "<a href=\"/resources/ebooks/best-of-bamboohr-2024\" class=\"resource-card-link\">Get the BambooHR's 2024 Editor's Picks</a>",
              '<a href="/resources/ebooks/orientation-checklists-on-site-construction" class="resource-card-link">Get the On-Site Orientation Checklists</a>',
              '<a href="/resources/ebooks/onboarding-checklist-construction" class="resource-card-link">Get the Construction Onboarding Checklists</a>',
              '<a href="/resources/ebooks/hr-checklist-construction" class="resource-card-link">Get the Checklist</a>',
              '<a href="/resources/ebooks/peo-checklist" class="resource-card-link">Get the Checklist</a>',
              '<a href="/resources/videos/bamboohr-product-demo-payroll" class="resource-card-link">Watch Now</a>',
              '<a href="/resources/videos/bamboohr-product-demo-time-tracking" class="resource-card-link">Watch Now</a>',
              '<a href="/resources/videos/bamboohr-product-demo-core-system" class="resource-card-link">Watch Now</a>',
              '<a href="/resources/videos/bamboohr-product-demo-performance-management" class="resource-card-link">Watch Now</a>',
              '<a href="/resources/guides/definitive-guide-to-people-analytics" class="resource-card-link">Read the Guide</a>',
              '<a href="/resources/guides/how-to-hire-employees" class="resource-card-link">Free Download</a>',
              '<a href="/resources/guides/open-enrollment-communication-plan-templates" class="resource-card-link">Free Download</a>',
              '<a href="/resources/guides/definitive-guide-to-performance-management" class="resource-card-link">Free Download</a>',
              '<a href="/resources/guides/construction-employee-retention" class="resource-card-link">Free Download</a>',
              '<a href="/resources/guides/year-in-review-2023" class="resource-card-link">Read the Guide</a>',
              '<a href="/resources/guides/year-in-review-2023-c" class="resource-card-link">Read the Guide</a>',
              '<a href="/resources/guides/employee-happiness-index" class="resource-card-link">Read the Report</a>',
              '<a href="/resources/guides/workforce-insights-report-june" class="resource-card-link">Read the Report</a>',
              '<a href="/resources/ebooks/hr-higher-education" class="resource-card-link">Get the Guide</a>',
              '<a href="/resources/whitepapers/onboarding-survey-questions" class="resource-card-link">Download Now</a>',
              '<a href="/resources/ebooks/performance-scorecard" class="resource-card-link">Get the Template</a>',
              '<a href="/resources/ebooks/job-offer-letter-templates" class="resource-card-link">Get the Templates</a>',
              '<a href="/resources/guides/open-enrollment-survival-kit" class="resource-card-link">Get the Survival Kit</a>',
              '<a href="/resources/ebooks/best-of-ai" class="resource-card-link">Get the Learning Kit</a>',
              '<a href="/resources/ebooks/best-of-company-culture" class="resource-card-link">Get the Bundle</a>',
              '<a href="/resources/ebooks/best-of-performance-management" class="resource-card-link">Get the Bundle</a>',
              '<a href="/resources/ebooks/best-of-compensation" class="resource-card-link">Get the Bundle</a>',
              '<a href="/resources/ebooks/easier-culture-halloween" class="resource-card-link">Get the Bundle</a>',
              "<a href=\"/resources/ebooks/hr-software-shopping-bundle\" class=\"resource-card-link\">Get the HRIS Buyer's Kit</a>",
              '<a href="/resources/ebooks/tax-season-survival-kit" class="resource-card-link">Get the Kit</a>',
              '<a href="/resources/ebooks/small-business-bundle" class="resource-card-link">Get the Bundle</a>',
              '<a href="/resources/ebooks/panu-puikkonen" class="resource-card-link">Watch Now</a>',
              '<a href="/resources/ebooks/adam-bird-malin-freiman-moezzi" class="resource-card-link">Watch Now</a>',
              '<a href="/resources/ebooks/bridgett-mcgowen" class="resource-card-link">Watch Now</a>',
              '<a href="/resources/ebooks/jordan-greenstreet-megan-baker" class="resource-card-link">Watch Now</a>',
              '<a href="/resources/ebooks/nick-scholz" class="resource-card-link">Watch Now</a>',
              '<a href="/resources/ebooks/kenny-latimer" class="resource-card-link">Watch Now</a>',
              '<a href="/resources/ebooks/corey-ann-seldon" class="resource-card-link">Watch Now</a>',
              '<a href="/resources/data-at-work/data-stories/2023-data-privacy" class="resource-card-link">Read the Report</a>',
              '<a href="/resources/data-at-work/data-stories/2023-hiring-trends" class="resource-card-link">Read the Guide</a>',
              '<a href="/resources/data-at-work/data-stories/2024-return-to-office" class="resource-card-link">Read the Report</a>',
              '<a href="/resources/data-at-work/data-stories/2023-sick-guilt" class="resource-card-link">Read the Guide</a>',
              '<a href="/resources/data-at-work/data-stories/2023-human-resource-leadership" class="resource-card-link">Read the Guide</a>',
              '<a href="/resources/data-at-work/employee-happiness-index/q3-2023-employee-happiness-erodes" class="resource-card-link">Read the Report</a>',
              '<a href="/resources/data-at-work/employee-happiness-index/q2-2023-the-great-gloom" class="resource-card-link">Read the Report</a>',
              '<a href="/resources/data-at-work/employee-happiness-index/q4-2023-why-is-everyone-so-unhappy" class="resource-card-link">Read the Report</a>',
              '<a href="/resources/data-at-work/workforce-insights/mar-2024" class="resource-card-link">Read the Report</a>',
              '<a href="/resources/data-at-work/workforce-insights/apr-2024" class="resource-card-link">Read the Report</a>',
              '<a href="/resources/data-at-work/workforce-insights/jun-2024" class="resource-card-link">Read the Report</a>',
              '<a href="/resources/data-at-work/workforce-insights/may-2024" class="resource-card-link">Read the Report</a>',
              '<a href="/resources/data-at-work/data-stories/2023-onboarding-statistics" class="resource-card-link">Read the Report</a>',
              '<a href="/resources/data-at-work/employee-happiness-index/q2-2024-employee-happiness-plummets" class="resource-card-link">Read the Report</a>',
              '<a href="/resources/data-at-work/workforce-insights/feb-24" class="resource-card-link">Read the Report</a>',
              '<a href="/resources/data-at-work/employee-happiness-index/q1-2024" class="resource-card-link">Read the Report</a>',
              '<a href="/resources/data-at-work/workforce-insights/jul-2024" class="resource-card-link">Read the Report</a>',
              '<a href="/resources/data-at-work/workforce-insights/aug-2024" class="resource-card-link">Read the Report</a>',
              '<a href="/resources/data-at-work/data-stories/2024-compensation-trends" class="resource-card-link">Read the Report</a>',
              '<a href="/resources/data-at-work/workforce-insights/sep-2024" class="resource-card-link">Read the Report</a>',
              '<a href="/resources/data-at-work/employee-happiness-index/q3-2024-employee-happiness-rebounds" class="resource-card-link">Read the Report</a>',
              '<a href="/resources/data-at-work/data-stories/2025-compensation-trends" class="resource-card-link">Read the Report</a>',
              '<a href="/resources/data-at-work/workforce-insights/nov-2024" class="resource-card-link">Read the Report</a>',
              '<a href="/resources/data-at-work/workforce-insights/dec-2024" class="resource-card-link">Read the Report</a>',
              '<a href="/resources/data-at-work/employee-happiness-index/q4-2024-employee-happiness-survey" class="resource-card-link">Read the Report</a>',
              '<a href="/resources/data-at-work/employee-happiness-index/q4-2024-employee-satisfaction-survey" class="resource-card-link">Read the Report</a>',
              '<a href="/resources/data-at-work/workforce-insights/jan-2025" class="resource-card-link">Read the Report</a>',
              '<a href="/resources/data-at-work/workforce-insights/feb-2025" class="resource-card-link">Read the Report</a>',
              '<a href="/resources/data-at-work/workforce-insights/mar-2025" class="resource-card-link">Read the Report</a>',
              '<a href="/resources/ebooks/definitive-guide-to-internships" class="resource-card-link">Get the Guide</a>',
              '<a href="/resources/ebooks/definitive-guide-to-employee-retention" class="resource-card-link">Get the Guide</a>',
              '<a href="/resources/ebooks/peo-guide" class="resource-card-link">Get the Complete Guide to PEOs</a>',
              '<a href="/resources/ebooks/onboarding-mistakes" class="resource-card-link">Get the Guide</a>',
              '<a href="/resources/ebooks/compensation-benchmarking-2025" class="resource-card-link">Get the Benchmarking Report</a>',
              '<a href="/resources/ebooks/ai-in-hiring" class="resource-card-link">Get the Guide</a>',
              '<a href="/resources/ebooks/how-to-measure-employee-engagement" class="resource-card-link">Get the Guide</a>',
              '<a href="/resources/ebooks/chatgpt-prompts-hr" class="resource-card-link">Get the Guide</a>',
              '<a href="/resources/ebooks/hr-challenges-construction" class="resource-card-link">Get the Guide</a>',
              '<a href="/resources/ebooks/creative-ways-find-top-talent" class="resource-card-link">Get the Guide</a>',
              '<a href="/resources/ebooks/customize-bamboohr-construction" class="resource-card-link">Get the Guide</a>',
              '<a href="/resources/ebooks/easy-to-switch" class="resource-card-link">Get the Guide</a>',
              '<a href="/resources/ebooks/hr-innovator-quiz" class="resource-card-link">Take the Quiz</a>',
              '<a href="/resources/ebooks/bad-boss-index" class="resource-card-link">Get the Report</a>',
              '<a href="/resources/ebooks/hr-trends-healthcare" class="resource-card-link">Get the Guide</a>',
              '<a href="/resources/ebooks/hr-stereotypes" class="resource-card-link">Get the Guide</a>',
              '<a href="/resources/ebooks/hr-burnout" class="resource-card-link">Get the Guide</a>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
          list: {
            count: 258,
            description: '<ul> and <ol> must only directly contain <li>, <script> or <template> elements',
            level: 'A',
            htmlWithIssues: [
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
            ],
            failureSummary: 'Fix all of the following:\n  List element has direct children that are not allowed: div',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/list?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
    },
    traffic: '22600',
  },
  'https://www.bamboohr.com/pl-pages/hrm': {
    violations: {
      total: 17,
      critical: {
        count: 4,
        items: {
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 13,
        items: {
          'aria-prohibited-attr': {
            count: 1,
            description: 'Elements must only use permitted ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div aria-label="Drift Widget messenger icon" id="widgetIcon" class="chatWidget">',
            ],
            failureSummary: 'Fix all of the following:\n  aria-label attribute cannot be used on a div with no valid role attribute.',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-prohibited-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'color-contrast': {
            count: 11,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="FirstName_518243" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_518243" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_518243" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<label for="Title_518243" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_518243" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_518243" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_518243" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count</label>',
              '<label for="Country_518243" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
        },
      },
    },
    traffic: '16900',
  },
  'https://www.bamboohr.com/pl-pages/ats': {
    violations: {
      total: 17,
      critical: {
        count: 4,
        items: {
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 13,
        items: {
          'aria-prohibited-attr': {
            count: 1,
            description: 'Elements must only use permitted ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div aria-label="Drift Widget messenger icon" id="widgetIcon" class="chatWidget">',
            ],
            failureSummary: 'Fix all of the following:\n  aria-label attribute cannot be used on a div with no valid role attribute.',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-prohibited-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'color-contrast': {
            count: 11,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="FirstName_181177" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_181177" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_181177" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<label for="Title_181177" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_181177" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_181177" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_181177" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count</label>',
              '<label for="Country_181177" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
        },
      },
    },
    traffic: '22900',
  },
  'https://www.bamboohr.com/pl-pages/competitors/workday': {
    violations: {
      total: 30,
      critical: {
        count: 9,
        items: {
          'aria-allowed-attr': {
            count: 5,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 21,
        items: {
          'aria-prohibited-attr': {
            count: 1,
            description: 'Elements must only use permitted ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div aria-label="Drift Widget messenger icon" id="widgetIcon" class="chatWidget">',
            ],
            failureSummary: 'Fix all of the following:\n  aria-label attribute cannot be used on a div with no valid role attribute.',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-prohibited-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'color-contrast': {
            count: 19,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="FirstName_832042" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_832042" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_832042" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<label for="Title_832042" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_832042" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_832042" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_832042" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count</label>',
              '<label for="Country_832042" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
              '<h5 id="hiring">Hiring</h5>',
              '<h5 id="all-in-one-platform">All-in-One Platform</h5>',
              '<h5 id="customer-support">Customer Support</h5>',
              '<h5 id="scaling">Scaling</h5>',
              '<h5 id="employee-experience">Employee Experience</h5>',
              '<strong>Performance Management:</strong>',
              '<strong>Employee Satisfaction:</strong>',
              '<strong>Employee Wellbeing:</strong>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
        },
      },
    },
    traffic: '32400',
  },
  'https://www.bamboohr.com/resources/data-at-work/employee-happiness-index/q4-2024-employee-satisfaction-survey': {
    violations: {
      total: 18,
      critical: {
        count: 13,
        items: {
          'aria-allowed-attr': {
            count: 9,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="nav-section has-sub-menu" am-region="Our Platform" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Solutions" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Why BambooHR" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Resources" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="About" aria-expanded="false">',
              '<div class="toc-title" aria-selected="false">Table of Contents</div>',
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 5,
        items: {
          'aria-prohibited-attr': {
            count: 1,
            description: 'Elements must only use permitted ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div aria-label="Drift Widget messenger icon" id="widgetIcon" class="chatWidget">',
            ],
            failureSummary: 'Fix all of the following:\n  aria-label attribute cannot be used on a div with no valid role attribute.',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-prohibited-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'color-contrast': {
            count: 3,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
        },
      },
    },
    traffic: '13100',
  },
  'https://www.bamboohr.com/pl-pages/performance-management': {
    violations: {
      total: 17,
      critical: {
        count: 4,
        items: {
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 13,
        items: {
          'aria-prohibited-attr': {
            count: 1,
            description: 'Elements must only use permitted ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div aria-label="Drift Widget messenger icon" id="widgetIcon" class="chatWidget">',
            ],
            failureSummary: 'Fix all of the following:\n  aria-label attribute cannot be used on a div with no valid role attribute.',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-prohibited-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'color-contrast': {
            count: 11,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="FirstName_468725" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_468725" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_468725" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<label for="Title_468725" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_468725" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_468725" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_468725" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count</label>',
              '<label for="Country_468725" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
        },
      },
    },
    traffic: '13900',
  },
  'https://www.bamboohr.com/pl-pages/competitors/hibob': {
    violations: {
      total: 30,
      critical: {
        count: 9,
        items: {
          'aria-allowed-attr': {
            count: 5,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 21,
        items: {
          'aria-prohibited-attr': {
            count: 1,
            description: 'Elements must only use permitted ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div aria-label="Drift Widget messenger icon" id="widgetIcon" class="chatWidget">',
            ],
            failureSummary: 'Fix all of the following:\n  aria-label attribute cannot be used on a div with no valid role attribute.',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-prohibited-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'color-contrast': {
            count: 19,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="FirstName_809938" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_809938" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_809938" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<label for="Title_809938" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_809938" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_809938" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_809938" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count</label>',
              '<label for="Country_809938" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
              '<h5 id="hiring">Hiring</h5>',
              '<h5 id="all-in-one-platform">All-in-One Platform</h5>',
              '<h5 id="customer-support">Customer Support</h5>',
              '<h5 id="scaling">Scaling</h5>',
              '<h5 id="employee-experience">Employee Experience</h5>',
              '<strong>Performance Management:</strong>',
              '<strong>Employee Satisfaction:</strong>',
              '<strong>Employee Wellbeing:</strong>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
        },
      },
    },
    traffic: '14300',
  },
  'https://www.bamboohr.com/o2': {
    violations: {
      total: 38,
      critical: {
        count: 33,
        items: {
          'aria-allowed-attr': {
            count: 23,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="nav-section has-sub-menu" am-region="Our Platform" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Solutions" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Why BambooHR" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Resources" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="About" aria-expanded="false">',
              '<div class="card" aria-expanded="false"><h5 id="product-announcement">Product Announcement</h5><p>Say hello to Employee Community!</p><p class="button-container"><a href="/hr-software/employee-community" title="Learn More" class="accent caret-link caret-link-theme-color">Learn More</a></p></div>',
              '<div class="card" aria-expanded="false">',
              '<div class="accordion" aria-selected="true">',
              '<h2 id="payroll-time--benefits" class="tabs-title" aria-selected="true">Payroll, Time &amp; Benefits</h2>',
              '<h2 id="hiring--onboarding" class="tabs-title" aria-selected="false">Hiring &amp; Onboarding</h2>',
              '<h2 id="hr-data--reporting" class="tabs-title" aria-selected="false">HR Data &amp; Reporting</h2>',
              '<h2 id="employee-experience--performance" class="tabs-title" aria-selected="false">Employee Experience &amp; Performance</h2>',
              '<div data-align="center" class="has-image card" aria-expanded="false">',
              '<div data-align="center" class="has-image card" aria-expanded="false">',
              '<div data-align="center" class="has-image card" aria-expanded="false">',
              '<div class="accordion" aria-selected="true">',
              '<h2 id="what-does-bamboohr-do" class="tabs-title" aria-selected="true">What does BambooHR do?</h2>',
              '<h2 id="does-bamboohr-do-payroll" class="tabs-title" aria-selected="false">Does BambooHR do payroll?</h2>',
              '<h2 id="how-much-does-bamboohr-cost" class="tabs-title" aria-selected="false">How much does BambooHR cost?</h2>',
              '<h2 id="how-many-countries-is-bamboohr-in" class="tabs-title" aria-selected="false">How many countries is BambooHR in?</h2>',
              '<h2 id="is-your-support-team-outsourced" class="tabs-title" aria-selected="false">Is your support team outsourced?</h2>',
              '<h2 id="is-bamboohr-a-peo" class="tabs-title" aria-selected="false">Is BambooHR a PEO?</h2>',
              "<h2 id=\"wheres-my-data-housed-how-secure-is-bamboohr\" class=\"tabs-title\" aria-selected=\"false\">Where's my data housed? How secure is BambooHR?</h2>",
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
          'button-name': {
            count: 6,
            description: 'Buttons must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<button class=""></button>',
              '<button class=""></button>',
              '<button class=""></button>',
              '<button class="selected"></button>',
              '<button></button>',
              '<button></button>',
            ],
            failureSummary: "Fix any of the following:\n  Element does not have inner text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute\n  Element does not have an implicit (wrapped) <label>\n  Element does not have an explicit <label>\n  Element's default semantics were not overridden with role=\"none\" or role=\"presentation\"",
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/button-name?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
        },
      },
      serious: {
        count: 5,
        items: {
          'color-contrast': {
            count: 3,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
          'scrollable-region-focusable': {
            count: 1,
            description: 'Scrollable region must have keyboard access',
            level: 'A',
            htmlWithIssues: [
              '<div class="carousel style-3 auto-play g2-card block" data-block-name="carousel" data-block-status="loaded" data-scroll-to-offset="-1">',
            ],
            failureSummary: 'Fix any of the following:\n  Element should have focusable content\n  Element should be focusable',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/scrollable-region-focusable?application=playwright',
            successCriteriaTags: [
              'wcag211',
              'wcag213',
            ],
          },
        },
      },
    },
    traffic: '32160',
  },
  'https://www.bamboohr.com/o1': {
    violations: {
      total: 38,
      critical: {
        count: 33,
        items: {
          'aria-allowed-attr': {
            count: 23,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="nav-section has-sub-menu" am-region="Our Platform" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Solutions" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Why BambooHR" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Resources" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="About" aria-expanded="false">',
              '<div class="card" aria-expanded="false"><h5 id="product-announcement">Product Announcement</h5><p>Say hello to Employee Community!</p><p class="button-container"><a href="/hr-software/employee-community" title="Learn More" class="accent caret-link caret-link-theme-color">Learn More</a></p></div>',
              '<div class="card" aria-expanded="false">',
              '<div class="accordion" aria-selected="true">',
              '<h2 id="payroll-time--benefits" class="tabs-title" aria-selected="true">Payroll, Time &amp; Benefits</h2>',
              '<h2 id="hiring--onboarding" class="tabs-title" aria-selected="false">Hiring &amp; Onboarding</h2>',
              '<h2 id="hr-data--reporting" class="tabs-title" aria-selected="false">HR Data &amp; Reporting</h2>',
              '<h2 id="employee-experience--performance" class="tabs-title" aria-selected="false">Employee Experience &amp; Performance</h2>',
              '<div data-align="center" class="has-image card" aria-expanded="false">',
              '<div data-align="center" class="has-image card" aria-expanded="false">',
              '<div data-align="center" class="has-image card" aria-expanded="false">',
              '<div class="accordion" aria-selected="true">',
              '<h2 id="what-does-bamboohr-do" class="tabs-title" aria-selected="true">What does BambooHR do?</h2>',
              '<h2 id="does-bamboohr-do-payroll" class="tabs-title" aria-selected="false">Does BambooHR do payroll?</h2>',
              '<h2 id="how-much-does-bamboohr-cost" class="tabs-title" aria-selected="false">How much does BambooHR cost?</h2>',
              '<h2 id="how-many-countries-is-bamboohr-in" class="tabs-title" aria-selected="false">How many countries is BambooHR in?</h2>',
              '<h2 id="is-your-support-team-outsourced" class="tabs-title" aria-selected="false">Is your support team outsourced?</h2>',
              '<h2 id="is-bamboohr-a-peo" class="tabs-title" aria-selected="false">Is BambooHR a PEO?</h2>',
              "<h2 id=\"wheres-my-data-housed-how-secure-is-bamboohr\" class=\"tabs-title\" aria-selected=\"false\">Where's my data housed? How secure is BambooHR?</h2>",
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
          'button-name': {
            count: 6,
            description: 'Buttons must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<button class=""></button>',
              '<button class=""></button>',
              '<button class=""></button>',
              '<button class="selected"></button>',
              '<button></button>',
              '<button></button>',
            ],
            failureSummary: "Fix any of the following:\n  Element does not have inner text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute\n  Element does not have an implicit (wrapped) <label>\n  Element does not have an explicit <label>\n  Element's default semantics were not overridden with role=\"none\" or role=\"presentation\"",
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/button-name?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
        },
      },
      serious: {
        count: 5,
        items: {
          'color-contrast': {
            count: 3,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
          'scrollable-region-focusable': {
            count: 1,
            description: 'Scrollable region must have keyboard access',
            level: 'A',
            htmlWithIssues: [
              '<div class="carousel style-3 auto-play g2-card block" data-block-name="carousel" data-block-status="loaded" data-scroll-to-offset="-1">',
            ],
            failureSummary: 'Fix any of the following:\n  Element should have focusable content\n  Element should be focusable',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/scrollable-region-focusable?application=playwright',
            successCriteriaTags: [
              'wcag211',
              'wcag213',
            ],
          },
        },
      },
    },
    traffic: '26300',
  },
  'https://www.bamboohr.com/pl-pages/hr-toolkit': {
    violations: {
      total: 20,
      critical: {
        count: 7,
        items: {
          'aria-allowed-attr': {
            count: 3,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 13,
        items: {
          'aria-prohibited-attr': {
            count: 1,
            description: 'Elements must only use permitted ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div aria-label="Drift Widget messenger icon" id="widgetIcon" class="chatWidget">',
            ],
            failureSummary: 'Fix all of the following:\n  aria-label attribute cannot be used on a div with no valid role attribute.',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-prohibited-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'color-contrast': {
            count: 11,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="FirstName_565359" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_565359" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_565359" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<label for="Title_565359" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_565359" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_565359" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_565359" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count </label>',
              '<label for="Country_565359" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
        },
      },
    },
    traffic: '9100',
  },
  'https://www.bamboohr.com/pl/payroll-checklist': {
    violations: {
      total: 20,
      critical: {
        count: 7,
        items: {
          'aria-allowed-attr': {
            count: 3,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 13,
        items: {
          'aria-prohibited-attr': {
            count: 1,
            description: 'Elements must only use permitted ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div aria-label="Drift Widget messenger icon" id="widgetIcon" class="chatWidget">',
            ],
            failureSummary: 'Fix all of the following:\n  aria-label attribute cannot be used on a div with no valid role attribute.',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-prohibited-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'color-contrast': {
            count: 11,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="FirstName_446600" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_446600" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_446600" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<label for="Title_446600" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_446600" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_446600" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_446600" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count </label>',
              '<label for="Country_446600" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
        },
      },
    },
    traffic: '11300',
  },
  'https://www.bamboohr.com/pl-pages/employee-software': {
    violations: {
      total: 17,
      critical: {
        count: 4,
        items: {
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 13,
        items: {
          'aria-prohibited-attr': {
            count: 1,
            description: 'Elements must only use permitted ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div aria-label="Drift Widget messenger icon" id="widgetIcon" class="chatWidget">',
            ],
            failureSummary: 'Fix all of the following:\n  aria-label attribute cannot be used on a div with no valid role attribute.',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-prohibited-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'color-contrast': {
            count: 11,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="FirstName_97615" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_97615" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_97615" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<label for="Title_97615" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_97615" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_97615" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_97615" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count</label>',
              '<label for="Country_97615" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
        },
      },
    },
    traffic: '9700',
  },
  'https://www.bamboohr.com/pl/onboarding-checklist-a1': {
    violations: {
      total: 20,
      critical: {
        count: 7,
        items: {
          'aria-allowed-attr': {
            count: 3,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 13,
        items: {
          'aria-prohibited-attr': {
            count: 1,
            description: 'Elements must only use permitted ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div aria-label="Drift Widget messenger icon" id="widgetIcon" class="chatWidget">',
            ],
            failureSummary: 'Fix all of the following:\n  aria-label attribute cannot be used on a div with no valid role attribute.',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-prohibited-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'color-contrast': {
            count: 11,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="FirstName_599574" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_599574" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_599574" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<label for="Title_599574" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_599574" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_599574" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_599574" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count </label>',
              '<label for="Country_599574" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
        },
      },
    },
    traffic: '12640',
  },
  'https://www.bamboohr.com/resources/hr-glossary/generation-y': {
    violations: {
      total: 15,
      critical: {
        count: 10,
        items: {
          'aria-allowed-attr': {
            count: 6,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="nav-section has-sub-menu" am-region="Our Platform" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Solutions" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Why BambooHR" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Resources" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="About" aria-expanded="false">',
              '<div class="toc-title" aria-selected="false">Table of Contents</div>',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 5,
        items: {
          'aria-prohibited-attr': {
            count: 1,
            description: 'Elements must only use permitted ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div aria-label="Drift Widget messenger icon" id="widgetIcon" class="chatWidget">',
            ],
            failureSummary: 'Fix all of the following:\n  aria-label attribute cannot be used on a div with no valid role attribute.',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-prohibited-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'color-contrast': {
            count: 3,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
        },
      },
    },
    traffic: '11800',
  },
  'https://www.bamboohr.com/blog/employee-perks-incentives-ideas': {
    violations: {
      total: 10,
      critical: {
        count: 7,
        items: {
          'aria-allowed-attr': {
            count: 3,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="nav-section has-sub-menu" am-region="Categories" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Our Platform" aria-expanded="false">',
              '<div class="toc-title" aria-selected="false">Table of Contents</div>',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 3,
        items: {
          'color-contrast': {
            count: 1,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/blog/">Blog</a>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.35 (foreground color: #599d15, background color: #ffffff, font size: 12.8pt (17px), font weight: normal). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-in-text-block': {
            count: 1,
            description: 'Links must be distinguishable without relying on color',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.linkedin.com/in/mattnesmith/" rel="noopener" target="_blank">LinkedIn</a>',
            ],
            failureSummary: 'Fix any of the following:\n  The link has insufficient color contrast of 2.34:1 with the surrounding text. (Minimum contrast is 3:1, link text: #2e7918, surrounding text: #38312f)\n  The link has no styling (such as underline) to distinguish it from the surrounding text',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-in-text-block?application=playwright',
            successCriteriaTags: [
              'wcag141',
            ],
          },
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
        },
      },
    },
    traffic: '10300',
  },
  'https://www.bamboohr.com/hr-software/employee-self-onboarding': {
    violations: {
      total: 16,
      critical: {
        count: 12,
        items: {
          'aria-allowed-attr': {
            count: 8,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="nav-section has-sub-menu" am-region="Our Platform" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Solutions" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Why BambooHR" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Resources" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="About" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 4,
        items: {
          'color-contrast': {
            count: 3,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
        },
      },
    },
    traffic: '9000',
  },
  'https://www.bamboohr.com/pl/payroll-software-c': {
    violations: {
      total: 17,
      critical: {
        count: 4,
        items: {
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 13,
        items: {
          'aria-prohibited-attr': {
            count: 1,
            description: 'Elements must only use permitted ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div aria-label="Drift Widget messenger icon" id="widgetIcon" class="chatWidget">',
            ],
            failureSummary: 'Fix all of the following:\n  aria-label attribute cannot be used on a div with no valid role attribute.',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-prohibited-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'color-contrast': {
            count: 11,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="FirstName_5441" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_5441" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_5441" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<label for="Title_5441" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_5441" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_5441" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_5441" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count</label>',
              '<label for="Country_5441" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
        },
      },
    },
    traffic: '11900',
  },
  'https://www.bamboohr.com/integrations/listings/slack': {
    violations: {
      total: 21,
      critical: {
        count: 17,
        items: {
          'aria-allowed-attr': {
            count: 4,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="nav-section has-sub-menu" am-region="Categories" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Feature Comparisons" aria-expanded="false">',
              '<h2 id="overview" class="tabs-title" aria-selected="true">Overview</h2>',
              '<h2 id="integration" class="tabs-title" aria-selected="false">Integration</h2>',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
          'button-name': {
            count: 5,
            description: 'Buttons must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<button class=""></button>',
              '<button class=""></button>',
              '<button class=""></button>',
              '<button class=""></button>',
              '<button class="selected"></button>',
            ],
            failureSummary: "Fix any of the following:\n  Element does not have inner text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute\n  Element does not have an implicit (wrapped) <label>\n  Element does not have an explicit <label>\n  Element's default semantics were not overridden with role=\"none\" or role=\"presentation\"",
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/button-name?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'image-alt': {
            count: 4,
            description: 'Images must have alternative text',
            level: 'A',
            htmlWithIssues: [
              '<img src="/styles/integration-type.svg">',
              '<img src="/styles/data-flow-direction.svg">',
              '<img src="/styles/sync-trigger.svg">',
              '<img src="/styles/sync-frequency.svg">',
            ],
            failureSummary: "Fix any of the following:\n  Element does not have an alt attribute\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute\n  Element's default semantics were not overridden with role=\"none\" or role=\"presentation\"",
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/image-alt?application=playwright',
            successCriteriaTags: [
              'wcag111',
            ],
          },
        },
      },
      serious: {
        count: 4,
        items: {
          'aria-prohibited-attr': {
            count: 1,
            description: 'Elements must only use permitted ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div aria-label="Drift Widget messenger icon" id="widgetIcon" class="chatWidget">',
            ],
            failureSummary: 'Fix all of the following:\n  aria-label attribute cannot be used on a div with no valid role attribute.',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-prohibited-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'color-contrast': {
            count: 1,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/integrations/">Marketplace</a>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.35 (foreground color: #599d15, background color: #ffffff, font size: 12.8pt (17px), font weight: normal). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
          'scrollable-region-focusable': {
            count: 1,
            description: 'Scrollable region must have keyboard access',
            level: 'A',
            htmlWithIssues: [
              '<div class="carousel block" data-block-name="carousel" data-block-status="loaded" data-scroll-to-offset="-1">',
            ],
            failureSummary: 'Fix any of the following:\n  Element should have focusable content\n  Element should be focusable',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/scrollable-region-focusable?application=playwright',
            successCriteriaTags: [
              'wcag211',
              'wcag213',
            ],
          },
        },
      },
    },
    traffic: '9200',
  },
  'https://www.bamboohr.com/hr-software/employee-database-software': {
    violations: {
      total: 16,
      critical: {
        count: 12,
        items: {
          'aria-allowed-attr': {
            count: 8,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="nav-section has-sub-menu" am-region="Our Platform" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Solutions" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Why BambooHR" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Resources" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="About" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 4,
        items: {
          'color-contrast': {
            count: 3,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
        },
      },
    },
    traffic: '9500',
  },
  'https://www.bamboohr.com/hr-software/payroll': {
    violations: {
      total: 19,
      critical: {
        count: 15,
        items: {
          'aria-allowed-attr': {
            count: 11,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="nav-section has-sub-menu" am-region="Our Platform" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Solutions" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Why BambooHR" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Resources" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="About" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="has-image card" aria-expanded="false">',
              '<div class="has-image card" aria-expanded="false">',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 4,
        items: {
          'color-contrast': {
            count: 3,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
        },
      },
    },
    traffic: '11800',
  },
  'https://www.bamboohr.com/integrations/request-information': {
    violations: {
      total: 9,
      critical: {
        count: 6,
        items: {
          'aria-allowed-attr': {
            count: 2,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="nav-section has-sub-menu" am-region="Categories" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Feature Comparisons" aria-expanded="false">',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 3,
        items: {
          'aria-prohibited-attr': {
            count: 1,
            description: 'Elements must only use permitted ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div aria-label="Drift Widget messenger icon" id="widgetIcon" class="chatWidget">',
            ],
            failureSummary: 'Fix all of the following:\n  aria-label attribute cannot be used on a div with no valid role attribute.',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-prohibited-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'color-contrast': {
            count: 1,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/integrations/">Marketplace</a>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.35 (foreground color: #599d15, background color: #ffffff, font size: 12.8pt (17px), font weight: normal). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
        },
      },
    },
    traffic: '11900',
  },
  'https://www.bamboohr.com/hr-software/applicant-tracking': {
    violations: {
      total: 22,
      critical: {
        count: 16,
        items: {
          'aria-allowed-attr': {
            count: 12,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="nav-section has-sub-menu" am-region="Our Platform" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Solutions" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Why BambooHR" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Resources" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="About" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<h2 id="can-i-hire-using-the-bamboohr-mobile-app" class="tabs-title" aria-selected="true">Can I hire using the BambooHR® Mobile app?</h2>',
              '<h2 id="which-job-boards-do-you-integrate-with" class="tabs-title" aria-selected="false">Which job boards do you integrate with?</h2>',
              '<h2 id="can-i-send-offer-letters-to-be-signed-electronically" class="tabs-title" aria-selected="false">Can I send offer letters to be signed electronically?</h2>',
              '<h2 id="what-happens-when-someone-accepts-my-offer-letter" class="tabs-title" aria-selected="false">What happens when someone accepts my offer letter?</h2>',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 6,
        items: {
          'color-contrast': {
            count: 3,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-name': {
            count: 3,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
              '<a href="https://itunes.apple.com/us/app/bamboohr-hiring/id1334298219?mt=8" title="" rel="noopener" target="_blank">',
              '<a href="https://play.google.com/store/apps/details?id=com.bamboohr.hiring" title="" rel="noopener" target="_blank">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
        },
      },
    },
    traffic: '9100',
  },
  'https://www.bamboohr.com/about-bamboohr/contact/': {
    violations: {
      total: 37,
      critical: {
        count: 22,
        items: {
          'aria-allowed-attr': {
            count: 18,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="nav-section has-sub-menu" am-region="Our Platform" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Solutions" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Why BambooHR" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Resources" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="About" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="demo-card has-image card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="accordion" aria-selected="true">',
              '<h2 id="what-does-bamboohr-do" class="tabs-title" aria-selected="true">What does BambooHR do?</h2>',
              '<h2 id="does-bamboohr-do-payroll" class="tabs-title" aria-selected="false">Does BambooHR do payroll?</h2>',
              '<h2 id="how-much-does-bamboohr-cost" class="tabs-title" aria-selected="false">How much does BambooHR cost?</h2>',
              '<h2 id="how-many-countries-is-bamboohr-in" class="tabs-title" aria-selected="false">How many countries is BambooHR in?</h2>',
              '<h2 id="is-your-support-team-outsourced" class="tabs-title" aria-selected="false">Is your support team outsourced?</h2>',
              '<h2 id="is-bamboohr-a-peo" class="tabs-title" aria-selected="false">Is BambooHR a PEO?</h2>',
              "<h2 id=\"wheres-my-data-housed-how-secure-is-bamboohr\" class=\"tabs-title\" aria-selected=\"false\">Where's my data housed? How secure is BambooHR?</h2>",
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 15,
        items: {
          'color-contrast': {
            count: 14,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="FirstName_317300" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_317300" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_317300" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<strong>Company Name</strong>',
              '<label for="Phone_317300" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_317300" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count</label>',
              '<label for="Country_317300" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country:</label>',
              '<strong>Are you a BambooHR Customer?</strong>',
              '<strong>Subject</strong>',
              '<strong>Message</strong>',
              '<span>I authorize BambooHR to keep me informed about its products, services and events through emails and phone calls. My data will be handled according to the</span>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
        },
      },
    },
    traffic: '9800',
  },
  'https://www.bamboohr.com/pl-pages/employee-vacation-tracking': {
    violations: {
      total: 17,
      critical: {
        count: 4,
        items: {
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 13,
        items: {
          'aria-prohibited-attr': {
            count: 1,
            description: 'Elements must only use permitted ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div aria-label="Drift Widget messenger icon" id="widgetIcon" class="chatWidget">',
            ],
            failureSummary: 'Fix all of the following:\n  aria-label attribute cannot be used on a div with no valid role attribute.',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-prohibited-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'color-contrast': {
            count: 11,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="FirstName_107316" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_107316" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_107316" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<label for="Title_107316" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_107316" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_107316" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_107316" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count</label>',
              '<label for="Country_107316" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
        },
      },
    },
    traffic: '11600',
  },
  'https://www.bamboohr.com/resources/hr-glossary/alternative-dispute-resolution-adr': {
    violations: {
      total: 15,
      critical: {
        count: 10,
        items: {
          'aria-allowed-attr': {
            count: 6,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="nav-section has-sub-menu" am-region="Our Platform" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Solutions" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Why BambooHR" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Resources" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="About" aria-expanded="false">',
              '<div class="toc-title" aria-selected="false">Table of Contents</div>',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 5,
        items: {
          'aria-prohibited-attr': {
            count: 1,
            description: 'Elements must only use permitted ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div aria-label="Drift Widget messenger icon" id="widgetIcon" class="chatWidget">',
            ],
            failureSummary: 'Fix all of the following:\n  aria-label attribute cannot be used on a div with no valid role attribute.',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-prohibited-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'color-contrast': {
            count: 3,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
        },
      },
    },
    traffic: '10200',
  },
  'https://www.bamboohr.com/pl-pages/bamboohr-software-basics-b1': {
    violations: {
      total: 17,
      critical: {
        count: 4,
        items: {
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 13,
        items: {
          'aria-prohibited-attr': {
            count: 1,
            description: 'Elements must only use permitted ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div aria-label="Drift Widget messenger icon" id="widgetIcon" class="chatWidget">',
            ],
            failureSummary: 'Fix all of the following:\n  aria-label attribute cannot be used on a div with no valid role attribute.',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-prohibited-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'color-contrast': {
            count: 11,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="FirstName_334650" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_334650" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_334650" id="LblEmail" class="mktoLabel mktoHasWidth">Business Email*</label>',
              '<label for="Title_334650" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_334650" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_334650" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_334650" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count</label>',
              '<label for="Country_334650" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
        },
      },
    },
    traffic: '11500',
  },
  'https://www.bamboohr.com/customers/': {
    violations: {
      total: 14,
      critical: {
        count: 9,
        items: {
          'aria-allowed-attr': {
            count: 5,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="nav-section has-sub-menu" am-region="Our Platform" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Solutions" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Why BambooHR" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Resources" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="About" aria-expanded="false">',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 5,
        items: {
          'color-contrast': {
            count: 3,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
          list: {
            count: 1,
            description: '<ul> and <ol> must only directly contain <li>, <script> or <template> elements',
            level: 'A',
            htmlWithIssues: [
              '<ul class="listing-cards-results article">',
            ],
            failureSummary: 'Fix all of the following:\n  List element has direct children that are not allowed: div',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/list?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
    },
    traffic: '9600',
  },
  'https://www.bamboohr.com/hr-software/hr-platform': {
    violations: {
      total: 37,
      critical: {
        count: 18,
        items: {
          'aria-allowed-attr': {
            count: 14,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="nav-section has-sub-menu" am-region="Our Platform" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Solutions" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Why BambooHR" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Resources" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="About" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="has-image card" aria-expanded="false">',
              '<div class="has-image card" aria-expanded="false">',
              '<div class="has-image card" aria-expanded="false">',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 19,
        items: {
          'color-contrast': {
            count: 18,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<a href="https://www.bamboohr.com/employee-database-software/" title="Employee Records" class="button accent link">Employee Records</a>',
              '<a href="https://www.bamboohr.com/hr-reporting/" title="Reporting" class="button accent link">Reporting</a>',
              '<a href="https://www.bamboohr.com/mobile/" title="Mobile App" class="button accent link">Mobile App</a>',
              '<a href="https://www.bamboohr.com/applicant-tracking/" title="Applicant Tracking" class="button accent link">Applicant Tracking</a>',
              '<a href="https://www.bamboohr.com/employee-self-onboarding/" title="New Hire Onboarding" class="button accent link">New Hire Onboarding</a>',
              '<a href="https://www.bamboohr.com/employee-offboarding-software/" title="Offboarding" class="button accent link">Offboarding</a>',
              '<a href="https://www.bamboohr.com/performance-management/" title="Performance Management" class="button accent link">Performance Management</a>',
              '<a href="https://www.bamboohr.com/employee-net-promoter-score-software/" title="Employee Satisfaction with eNPS®" class="button accent link">Employee Satisfaction with eNPS®</a>',
              '<a href="https://www.bamboohr.com/employee-wellbeing/" title="Employee Wellbeing" class="button accent link">Employee Wellbeing</a>',
              '<a href="/hr-software/total-rewards" title="Total Rewards" class="button accent link">Total Rewards</a>',
              '<a href="/hr-software/employee-community" title="Employee Community" class="button accent link">Employee Community</a>',
              '<a href="https://www.bamboohr.com/payroll-software/" title="Payroll" class="button accent link">Payroll</a>',
              '<a href="https://www.bamboohr.com/paid-time-off/" title="PTO Tracking" class="button accent link">PTO Tracking</a>',
              '<a href="https://www.bamboohr.com/time-tracking-software/" title="Time Tracking" class="button accent link">Time Tracking</a>',
              '<a href="https://www.bamboohr.com/hr-software/benefits-administration/" title="Benefits Administration" class="button accent link">Benefits Administration</a>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
        },
      },
    },
    traffic: '9900',
  },
  'https://www.bamboohr.com/resources/ebooks/how-to-measure-employee-engagement': {
    violations: {
      total: 22,
      critical: {
        count: 9,
        items: {
          'aria-allowed-attr': {
            count: 5,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="nav-section has-sub-menu" am-region="Our Platform" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Solutions" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Why BambooHR" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Resources" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="About" aria-expanded="false">',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 13,
        items: {
          'aria-prohibited-attr': {
            count: 1,
            description: 'Elements must only use permitted ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div aria-label="Drift Widget messenger icon" id="widgetIcon" class="chatWidget">',
            ],
            failureSummary: 'Fix all of the following:\n  aria-label attribute cannot be used on a div with no valid role attribute.',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-prohibited-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'color-contrast': {
            count: 11,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="FirstName_52578" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_52578" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_52578" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<label for="Title_52578" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_52578" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_52578" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_52578" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count </label>',
              '<label for="Country_52578" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
        },
      },
    },
    traffic: '12000',
  },
  'https://www.bamboohr.com/blog/furloughs-vs-layoffs': {
    violations: {
      total: 10,
      critical: {
        count: 7,
        items: {
          'aria-allowed-attr': {
            count: 3,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="nav-section has-sub-menu" am-region="Categories" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Our Platform" aria-expanded="false">',
              '<div class="toc-title" aria-selected="false">Table of Contents</div>',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 3,
        items: {
          'color-contrast': {
            count: 1,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/blog/">Blog</a>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.35 (foreground color: #599d15, background color: #ffffff, font size: 12.8pt (17px), font weight: normal). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-in-text-block': {
            count: 1,
            description: 'Links must be distinguishable without relying on color',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.linkedin.com/in/mattnesmith/" rel="noopener" target="_blank">LinkedIn</a>',
            ],
            failureSummary: 'Fix any of the following:\n  The link has insufficient color contrast of 2.34:1 with the surrounding text. (Minimum contrast is 3:1, link text: #2e7918, surrounding text: #38312f)\n  The link has no styling (such as underline) to distinguish it from the surrounding text',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-in-text-block?application=playwright',
            successCriteriaTags: [
              'wcag141',
            ],
          },
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
        },
      },
    },
    traffic: '9200',
  },
  'https://www.bamboohr.com/product-updates/': {
    violations: {
      total: 11,
      critical: {
        count: 9,
        items: {
          'aria-allowed-attr': {
            count: 5,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="nav-section has-sub-menu" am-region="Our Platform" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Solutions" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Why BambooHR" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Resources" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="About" aria-expanded="false">',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 2,
        items: {
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
          list: {
            count: 1,
            description: '<ul> and <ol> must only directly contain <li>, <script> or <template> elements',
            level: 'A',
            htmlWithIssues: [
              '<ul class="listing-results">',
            ],
            failureSummary: 'Fix all of the following:\n  List element has direct children that are not allowed: div',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/list?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
    },
    traffic: '10800',
  },
  'https://www.bamboohr.com/resources/hr-glossary/qualifying-life-event': {
    violations: {
      total: 16,
      critical: {
        count: 11,
        items: {
          'aria-allowed-attr': {
            count: 7,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="nav-section has-sub-menu" am-region="Our Platform" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Solutions" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Why BambooHR" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Resources" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="About" aria-expanded="false">',
              '<div class="toc-title" aria-selected="false">Table of Contents</div>',
              '<div class="toc-title" aria-selected="false">Table of Contents</div>',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 5,
        items: {
          'aria-prohibited-attr': {
            count: 1,
            description: 'Elements must only use permitted ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div aria-label="Drift Widget messenger icon" id="widgetIcon" class="chatWidget">',
            ],
            failureSummary: 'Fix all of the following:\n  aria-label attribute cannot be used on a div with no valid role attribute.',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-prohibited-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'color-contrast': {
            count: 3,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
        },
      },
    },
    traffic: '9200',
  },
  'https://www.bamboohr.com/resources/ebooks/the-definitive-guide-to-onboarding-k1': {
    violations: {
      total: 22,
      critical: {
        count: 9,
        items: {
          'aria-allowed-attr': {
            count: 5,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="nav-section has-sub-menu" am-region="Our Platform" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Solutions" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Why BambooHR" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Resources" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="About" aria-expanded="false">',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 13,
        items: {
          'aria-prohibited-attr': {
            count: 1,
            description: 'Elements must only use permitted ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div aria-label="Drift Widget messenger icon" id="widgetIcon" class="chatWidget">',
            ],
            failureSummary: 'Fix all of the following:\n  aria-label attribute cannot be used on a div with no valid role attribute.',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-prohibited-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'color-contrast': {
            count: 11,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="FirstName_233776" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_233776" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_233776" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<label for="Title_233776" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_233776" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_233776" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_233776" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count </label>',
              '<label for="Country_233776" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
        },
      },
    },
    traffic: '13100',
  },
  'https://www.bamboohr.com/compare-plans/activate/core': {
    violations: {
      total: 37,
      critical: {
        count: 29,
        items: {
          'aria-allowed-attr': {
            count: 25,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="accordion" aria-selected="true">',
              '<h2 id="ai-powered-assistance" class="tabs-title" aria-selected="true">AI-Powered Assistance</h2>',
              '<h2 id="improved-hiring-efficiency" class="tabs-title" aria-selected="false">Improved Hiring Efficiency</h2>',
              '<h2 id="stronger-employee-retention" class="tabs-title" aria-selected="false">Stronger Employee Retention</h2>',
              '<h2 id="new-customization-options" class="tabs-title" aria-selected="false">New Customization Options</h2>',
              '<h2 id="instant-ai-topic-summaries" class="tabs-title" aria-selected="false">Instant AI Topic Summaries</h2>',
              '<div class="accordion" aria-selected="true">',
              '<h2 id="why-are-you-retiring-the-essentials-and-advantage-plans" class="tabs-title" aria-selected="true">Why are you retiring the Essentials and Advantage plans?</h2>',
              '<h2 id="are-there-options-for-remaining-on-essentials-or-advantage" class="tabs-title" aria-selected="false">Are there options for remaining on Essentials or Advantage?</h2>',
              '<h2 id="when-will-this-change-take-effect" class="tabs-title" aria-selected="false">When will this change take effect?</h2>',
              '<h2 id="will-there-be-any-disruption-in-the-system-when-the-transition-is-made" class="tabs-title" aria-selected="false">Will there be any disruption in the system when the transition is made?</h2>',
              '<h2 id="can-i-upgrade-to-my-new-plan-early" class="tabs-title" aria-selected="false">Can I upgrade to my new plan early?</h2>',
              '<h2 id="how-will-this-migration-impact-me-or-my-account" class="tabs-title" aria-selected="false">How will this migration impact me or my account?</h2>',
              '<h2 id="what-resources-are-available-to-set-up-my-new-features" class="tabs-title" aria-selected="false">What resources are available to set up my new features?</h2>',
              '<h2 id="was-i-notified-of-this-change-when-and-how" class="tabs-title" aria-selected="false">Was I notified of this change? When and how?</h2>',
              '<h2 id="what-new-features-or-benefits-are-included-in-the-core-plan" class="tabs-title" aria-selected="false">What new features or benefits are included in the Core Plan?</h2>',
              '<h2 id="what-new-features-or-benefits-are-included-in-the-pro-plan" class="tabs-title" aria-selected="false">What new features or benefits are included in the Pro Plan?</h2>',
              '<h2 id="how-can-i-find-out-what-my-current-plan-and-price-are" class="tabs-title" aria-selected="false">How can I find out what my current plan and price are?</h2>',
              '<h2 id="how-does-this-affect-my-current-contract-with-bamboohr" class="tabs-title" aria-selected="false">How does this affect my current contract with BambooHR?</h2>',
              '<h2 id="how-will-this-impact-my-prepaid-account" class="tabs-title" aria-selected="false">How will this impact my prepaid account?</h2>',
              '<h2 id="how-will-this-impact-my-nonprofit-discount" class="tabs-title" aria-selected="false">How will this impact my nonprofit discount?</h2>',
              '<h2 id="how-will-this-impact-my-related-entities-parentchild-discount" class="tabs-title" aria-selected="false">How will this impact my related entities (parent/child) discount?</h2>',
              '<h2 id="can-you-give-me-more-details-about-the-bundle-discount" class="tabs-title" aria-selected="false">Can you give me more details about the bundle discount?</h2>',
              '<h2 id="where-can-i-learn-more-about-the-bamboohr-subscription-adjustment-and-pricing-policies" class="tabs-title" aria-selected="false">Where can I learn more about the BambooHR subscription adjustment and pricing policies?</h2>',
              '<h2 id="who-do-i-contact-if-i-have-additional-questions" class="tabs-title" aria-selected="false">Who do I contact if I have additional questions?</h2>',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-selected="true"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 8,
        items: {
          'aria-prohibited-attr': {
            count: 1,
            description: 'Elements must only use permitted ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div aria-label="Drift Widget messenger icon" id="widgetIcon" class="chatWidget">',
            ],
            failureSummary: 'Fix all of the following:\n  aria-label attribute cannot be used on a div with no valid role attribute.',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-prohibited-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'color-contrast': {
            count: 6,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<strong>Core</strong>',
              '<p>Your New Plan</p>',
              '<a href="https://help.bamboohr.com/s/article/1177289#upgrading-to-the-core-package" title="Learn More" class="button accent" rel="noopener" target="_blank">Learn More</a>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
        },
      },
    },
    traffic: '11700',
  },
  'https://www.bamboohr.com/pl/interview-scorecard-template': {
    violations: {
      total: 13,
      critical: {
        count: 0,
        items: {},
      },
      serious: {
        count: 13,
        items: {
          'aria-prohibited-attr': {
            count: 1,
            description: 'Elements must only use permitted ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div aria-label="Drift Widget messenger icon" id="widgetIcon" class="chatWidget">',
            ],
            failureSummary: 'Fix all of the following:\n  aria-label attribute cannot be used on a div with no valid role attribute.',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-prohibited-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'color-contrast': {
            count: 11,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="FirstName_302241" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_302241" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_302241" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<label for="Title_302241" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_302241" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_302241" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_302241" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count </label>',
              '<label for="Country_302241" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
        },
      },
    },
    traffic: '6800',
  },
  'https://www.bamboohr.com/pl-pages/intl-en/hr-software': {
    violations: {
      total: 13,
      critical: {
        count: 0,
        items: {},
      },
      serious: {
        count: 13,
        items: {
          'aria-prohibited-attr': {
            count: 1,
            description: 'Elements must only use permitted ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div aria-label="Drift Widget messenger icon" id="widgetIcon" class="chatWidget">',
            ],
            failureSummary: 'Fix all of the following:\n  aria-label attribute cannot be used on a div with no valid role attribute.',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-prohibited-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'color-contrast': {
            count: 11,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="FirstName_459279" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_459279" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_459279" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<label for="Title_459279" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_459279" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_459279" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_459279" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count</label>',
              '<label for="Country_459279" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
        },
      },
    },
    traffic: '7000',
  },
  'https://www.bamboohr.com/pl-pages/competitors/gusto': {
    violations: {
      total: 13,
      critical: {
        count: 0,
        items: {},
      },
      serious: {
        count: 13,
        items: {
          'aria-prohibited-attr': {
            count: 1,
            description: 'Elements must only use permitted ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div aria-label="Drift Widget messenger icon" id="widgetIcon" class="chatWidget">',
            ],
            failureSummary: 'Fix all of the following:\n  aria-label attribute cannot be used on a div with no valid role attribute.',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-prohibited-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'color-contrast': {
            count: 11,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="FirstName_679650" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_679650" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_679650" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<label for="Title_679650" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_679650" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_679650" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_679650" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count</label>',
              '<label for="Country_679650" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
        },
      },
    },
    traffic: '8400',
  },
  'https://www.bamboohr.com/why-bamboohr/': {
    violations: {
      total: 9,
      critical: {
        count: 5,
        items: {
          'aria-allowed-attr': {
            count: 5,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="nav-section has-sub-menu" am-region="Our Platform" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Solutions" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Why BambooHR" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Resources" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="About" aria-expanded="false">',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
        },
      },
      serious: {
        count: 4,
        items: {
          'color-contrast': {
            count: 3,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
        },
      },
    },
    traffic: '7500',
  },
  'https://www.bamboohr.com/pl-pages/timesheets': {
    violations: {
      total: 13,
      critical: {
        count: 0,
        items: {},
      },
      serious: {
        count: 13,
        items: {
          'aria-prohibited-attr': {
            count: 1,
            description: 'Elements must only use permitted ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div aria-label="Drift Widget messenger icon" id="widgetIcon" class="chatWidget">',
            ],
            failureSummary: 'Fix all of the following:\n  aria-label attribute cannot be used on a div with no valid role attribute.',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-prohibited-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'color-contrast': {
            count: 11,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="FirstName_561728" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_561728" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_561728" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<label for="Title_561728" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_561728" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_561728" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_561728" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count</label>',
              '<label for="Country_561728" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
        },
      },
    },
    traffic: '8000',
  },
  'https://www.bamboohr.com/pl-pages/competitors/isolved': {
    violations: {
      total: 30,
      critical: {
        count: 9,
        items: {
          'aria-allowed-attr': {
            count: 5,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 21,
        items: {
          'aria-prohibited-attr': {
            count: 1,
            description: 'Elements must only use permitted ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div aria-label="Drift Widget messenger icon" id="widgetIcon" class="chatWidget">',
            ],
            failureSummary: 'Fix all of the following:\n  aria-label attribute cannot be used on a div with no valid role attribute.',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-prohibited-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'color-contrast': {
            count: 19,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="FirstName_195022" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_195022" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_195022" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<label for="Title_195022" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_195022" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_195022" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_195022" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count</label>',
              '<label for="Country_195022" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
              '<h5 id="hiring">Hiring</h5>',
              '<h5 id="all-in-one-platform">All-in-One Platform</h5>',
              '<h5 id="customer-support">Customer Support</h5>',
              '<h5 id="scaling">Scaling</h5>',
              '<h5 id="employee-experience">Employee Experience</h5>',
              '<strong>Performance Management:</strong>',
              '<strong>Employee Satisfaction:</strong>',
              '<strong>Employee Wellbeing:</strong>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
        },
      },
    },
    traffic: '8200',
  },
  'https://www.bamboohr.com/legal/': {
    violations: {
      total: 23,
      critical: {
        count: 22,
        items: {
          'aria-allowed-attr': {
            count: 18,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="nav-section has-sub-menu" am-region="Our Platform" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Solutions" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Why BambooHR" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Resources" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="About" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 1,
        items: {
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
        },
      },
    },
    traffic: '8300',
  },
  'https://www.bamboohr.com/pl-pages/employee-database': {
    violations: {
      total: 17,
      critical: {
        count: 4,
        items: {
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 13,
        items: {
          'aria-prohibited-attr': {
            count: 1,
            description: 'Elements must only use permitted ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div aria-label="Drift Widget messenger icon" id="widgetIcon" class="chatWidget">',
            ],
            failureSummary: 'Fix all of the following:\n  aria-label attribute cannot be used on a div with no valid role attribute.',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-prohibited-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'color-contrast': {
            count: 11,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="FirstName_207133" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_207133" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_207133" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<label for="Title_207133" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_207133" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_207133" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_207133" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count</label>',
              '<label for="Country_207133" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
        },
      },
    },
    traffic: '6300',
  },
  'https://www.bamboohr.com/pl-pages/competitors/goco': {
    violations: {
      total: 17,
      critical: {
        count: 4,
        items: {
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 13,
        items: {
          'aria-prohibited-attr': {
            count: 1,
            description: 'Elements must only use permitted ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div aria-label="Drift Widget messenger icon" id="widgetIcon" class="chatWidget">',
            ],
            failureSummary: 'Fix all of the following:\n  aria-label attribute cannot be used on a div with no valid role attribute.',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-prohibited-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'color-contrast': {
            count: 11,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="FirstName_470850" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_470850" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_470850" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<label for="Title_470850" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_470850" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_470850" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_470850" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count</label>',
              '<label for="Country_470850" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
        },
      },
    },
    traffic: '6600',
  },
  'https://www.bamboohr.com/resources/ebooks/job-offer-letter-templates': {
    violations: {
      total: 22,
      critical: {
        count: 9,
        items: {
          'aria-allowed-attr': {
            count: 5,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="nav-section has-sub-menu" am-region="Our Platform" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Solutions" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Why BambooHR" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Resources" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="About" aria-expanded="false">',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 13,
        items: {
          'aria-prohibited-attr': {
            count: 1,
            description: 'Elements must only use permitted ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div aria-label="Drift Widget messenger icon" id="widgetIcon" class="chatWidget">',
            ],
            failureSummary: 'Fix all of the following:\n  aria-label attribute cannot be used on a div with no valid role attribute.',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-prohibited-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'color-contrast': {
            count: 11,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="FirstName_918358" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_918358" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_918358" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<label for="Title_918358" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_918358" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_918358" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_918358" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count </label>',
              '<label for="Country_918358" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
        },
      },
    },
    traffic: '7500',
  },
  'https://www.bamboohr.com/pl-pages/recruitment': {
    violations: {
      total: 17,
      critical: {
        count: 4,
        items: {
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 13,
        items: {
          'aria-prohibited-attr': {
            count: 1,
            description: 'Elements must only use permitted ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div aria-label="Drift Widget messenger icon" id="widgetIcon" class="chatWidget">',
            ],
            failureSummary: 'Fix all of the following:\n  aria-label attribute cannot be used on a div with no valid role attribute.',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-prohibited-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'color-contrast': {
            count: 11,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="FirstName_487808" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_487808" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_487808" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<label for="Title_487808" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_487808" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_487808" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_487808" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count</label>',
              '<label for="Country_487808" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
        },
      },
    },
    traffic: '7500',
  },
  'https://www.bamboohr.com/hr-software/payroll-software': {
    violations: {
      total: 16,
      critical: {
        count: 12,
        items: {
          'aria-allowed-attr': {
            count: 8,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="nav-section has-sub-menu" am-region="Our Platform" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Solutions" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Why BambooHR" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Resources" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="About" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 4,
        items: {
          'color-contrast': {
            count: 3,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
        },
      },
    },
    traffic: '6600',
  },
  'https://www.bamboohr.com/resources/guides/the-definitive-guide-to-onboarding': {
    violations: {
      total: 22,
      critical: {
        count: 17,
        items: {
          'aria-allowed-attr': {
            count: 13,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="nav-section has-sub-menu" am-region="Our Platform" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Solutions" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Why BambooHR" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Resources" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="About" aria-expanded="false">',
              '<div class="toc-title" aria-selected="false">Table of Contents</div>',
              '<div class="accordion" aria-selected="true">',
              '<h2 id="who-should-be-involved-in-employee-onboarding" class="tabs-title" aria-selected="true">Who should be involved in employee onboarding?</h2>',
              '<h2 id="can-you-start-onboarding-before-the-employees-first-day" class="tabs-title" aria-selected="false">Can you start onboarding before the employee’s first day?</h2>',
              '<h2 id="how-do-you-develop-an-onboarding-process-for-the-first-time" class="tabs-title" aria-selected="false">How do you develop an onboarding process for the first time?</h2>',
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 5,
        items: {
          'aria-prohibited-attr': {
            count: 1,
            description: 'Elements must only use permitted ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div aria-label="Drift Widget messenger icon" id="widgetIcon" class="chatWidget">',
            ],
            failureSummary: 'Fix all of the following:\n  aria-label attribute cannot be used on a div with no valid role attribute.',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-prohibited-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'color-contrast': {
            count: 3,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
        },
      },
    },
    traffic: '6700',
  },
  'https://www.bamboohr.com/pl-pages/employee-time-clock': {
    violations: {
      total: 17,
      critical: {
        count: 4,
        items: {
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 13,
        items: {
          'aria-prohibited-attr': {
            count: 1,
            description: 'Elements must only use permitted ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div aria-label="Drift Widget messenger icon" id="widgetIcon" class="chatWidget">',
            ],
            failureSummary: 'Fix all of the following:\n  aria-label attribute cannot be used on a div with no valid role attribute.',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-prohibited-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'color-contrast': {
            count: 11,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="FirstName_585768" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_585768" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_585768" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<label for="Title_585768" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_585768" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_585768" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_585768" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count</label>',
              '<label for="Country_585768" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
        },
      },
    },
    traffic: '6000',
  },
  'https://www.bamboohr.com/pl-pages/human-resource-management': {
    violations: {
      total: 17,
      critical: {
        count: 4,
        items: {
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 13,
        items: {
          'aria-prohibited-attr': {
            count: 1,
            description: 'Elements must only use permitted ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div aria-label="Drift Widget messenger icon" id="widgetIcon" class="chatWidget">',
            ],
            failureSummary: 'Fix all of the following:\n  aria-label attribute cannot be used on a div with no valid role attribute.',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-prohibited-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'color-contrast': {
            count: 11,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="FirstName_350323" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_350323" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_350323" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<label for="Title_350323" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_350323" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_350323" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_350323" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count</label>',
              '<label for="Country_350323" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
        },
      },
    },
    traffic: '6300',
  },
  'https://www.bamboohr.com/pl-pages/human-resources-software': {
    violations: {
      total: 17,
      critical: {
        count: 4,
        items: {
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 13,
        items: {
          'aria-prohibited-attr': {
            count: 1,
            description: 'Elements must only use permitted ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div aria-label="Drift Widget messenger icon" id="widgetIcon" class="chatWidget">',
            ],
            failureSummary: 'Fix all of the following:\n  aria-label attribute cannot be used on a div with no valid role attribute.',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-prohibited-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'color-contrast': {
            count: 11,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="FirstName_852030" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_852030" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_852030" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<label for="Title_852030" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_852030" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_852030" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_852030" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count</label>',
              '<label for="Country_852030" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
        },
      },
    },
    traffic: '6200',
  },
  'https://www.bamboohr.com/pl-pages/intl-en/onboarding': {
    violations: {
      total: 17,
      critical: {
        count: 4,
        items: {
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 13,
        items: {
          'aria-prohibited-attr': {
            count: 1,
            description: 'Elements must only use permitted ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div aria-label="Drift Widget messenger icon" id="widgetIcon" class="chatWidget">',
            ],
            failureSummary: 'Fix all of the following:\n  aria-label attribute cannot be used on a div with no valid role attribute.',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-prohibited-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'color-contrast': {
            count: 11,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="FirstName_294515" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_294515" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_294515" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<label for="Title_294515" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_294515" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_294515" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_294515" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count</label>',
              '<label for="Country_294515" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
        },
      },
    },
    traffic: '6200',
  },
  'https://www.bamboohr.com/pl-pages/applicant-tracking-system': {
    violations: {
      total: 17,
      critical: {
        count: 4,
        items: {
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 13,
        items: {
          'aria-prohibited-attr': {
            count: 1,
            description: 'Elements must only use permitted ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div aria-label="Drift Widget messenger icon" id="widgetIcon" class="chatWidget">',
            ],
            failureSummary: 'Fix all of the following:\n  aria-label attribute cannot be used on a div with no valid role attribute.',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-prohibited-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'color-contrast': {
            count: 11,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="FirstName_418133" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_418133" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_418133" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<label for="Title_418133" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_418133" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_418133" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_418133" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count</label>',
              '<label for="Country_418133" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
        },
      },
    },
    traffic: '8040',
  },
  'https://www.bamboohr.com/blog/tips-increasing-workplace-efficiency': {
    violations: {
      total: 10,
      critical: {
        count: 7,
        items: {
          'aria-allowed-attr': {
            count: 3,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="nav-section has-sub-menu" am-region="Categories" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Our Platform" aria-expanded="false">',
              '<div class="toc-title" aria-selected="false">Table of Contents</div>',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 3,
        items: {
          'color-contrast': {
            count: 1,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/blog/">Blog</a>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.35 (foreground color: #599d15, background color: #ffffff, font size: 12.8pt (17px), font weight: normal). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-in-text-block': {
            count: 1,
            description: 'Links must be distinguishable without relying on color',
            level: 'A',
            htmlWithIssues: [
              '<a href="http://www.linkedin.com/in/briankimanderson" rel="noopener" target="_blank">LinkedIn</a>',
            ],
            failureSummary: 'Fix any of the following:\n  The link has insufficient color contrast of 2.34:1 with the surrounding text. (Minimum contrast is 3:1, link text: #2e7918, surrounding text: #38312f)\n  The link has no styling (such as underline) to distinguish it from the surrounding text',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-in-text-block?application=playwright',
            successCriteriaTags: [
              'wcag141',
            ],
          },
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
        },
      },
    },
    traffic: '6300',
  },
  'https://www.bamboohr.com/resources/hr-glossary/generation-x': {
    violations: {
      total: 15,
      critical: {
        count: 10,
        items: {
          'aria-allowed-attr': {
            count: 6,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="nav-section has-sub-menu" am-region="Our Platform" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Solutions" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Why BambooHR" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Resources" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="About" aria-expanded="false">',
              '<div class="toc-title" aria-selected="false">Table of Contents</div>',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 5,
        items: {
          'aria-prohibited-attr': {
            count: 1,
            description: 'Elements must only use permitted ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div aria-label="Drift Widget messenger icon" id="widgetIcon" class="chatWidget">',
            ],
            failureSummary: 'Fix all of the following:\n  aria-label attribute cannot be used on a div with no valid role attribute.',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-prohibited-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'color-contrast': {
            count: 3,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
        },
      },
    },
    traffic: '8400',
  },
  'https://www.bamboohr.com/resources/hr-glossary/147c': {
    violations: {
      total: 15,
      critical: {
        count: 10,
        items: {
          'aria-allowed-attr': {
            count: 6,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="nav-section has-sub-menu" am-region="Our Platform" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Solutions" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Why BambooHR" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Resources" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="About" aria-expanded="false">',
              '<div class="toc-title" aria-selected="false">Table of Contents</div>',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 5,
        items: {
          'aria-prohibited-attr': {
            count: 1,
            description: 'Elements must only use permitted ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div aria-label="Drift Widget messenger icon" id="widgetIcon" class="chatWidget">',
            ],
            failureSummary: 'Fix all of the following:\n  aria-label attribute cannot be used on a div with no valid role attribute.',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-prohibited-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'color-contrast': {
            count: 3,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
        },
      },
    },
    traffic: '8000',
  },
  'https://www.bamboohr.com/blog/internal-job-interview-questions': {
    violations: {
      total: 10,
      critical: {
        count: 7,
        items: {
          'aria-allowed-attr': {
            count: 3,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="nav-section has-sub-menu" am-region="Categories" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Our Platform" aria-expanded="false">',
              '<div class="toc-title" aria-selected="false">Table of Contents</div>',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 3,
        items: {
          'color-contrast': {
            count: 1,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/blog/">Blog</a>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.35 (foreground color: #599d15, background color: #ffffff, font size: 12.8pt (17px), font weight: normal). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-in-text-block': {
            count: 1,
            description: 'Links must be distinguishable without relying on color',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.linkedin.com/in/mattnesmith/" rel="noopener" target="_blank">LinkedIn</a>',
            ],
            failureSummary: 'Fix any of the following:\n  The link has insufficient color contrast of 2.34:1 with the surrounding text. (Minimum contrast is 3:1, link text: #2e7918, surrounding text: #38312f)\n  The link has no styling (such as underline) to distinguish it from the surrounding text',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-in-text-block?application=playwright',
            successCriteriaTags: [
              'wcag141',
            ],
          },
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
        },
      },
    },
    traffic: '7600',
  },
  'https://www.bamboohr.com/blog/stay-positive-at-work': {
    violations: {
      total: 10,
      critical: {
        count: 7,
        items: {
          'aria-allowed-attr': {
            count: 3,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="nav-section has-sub-menu" am-region="Categories" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Our Platform" aria-expanded="false">',
              '<div class="toc-title" aria-selected="false">Table of Contents</div>',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 3,
        items: {
          'color-contrast': {
            count: 1,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/blog/">Blog</a>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.35 (foreground color: #599d15, background color: #ffffff, font size: 12.8pt (17px), font weight: normal). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-in-text-block': {
            count: 1,
            description: 'Links must be distinguishable without relying on color',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.linkedin.com/in/mattnesmith/" rel="noopener" target="_blank">LinkedIn</a>',
            ],
            failureSummary: 'Fix any of the following:\n  The link has insufficient color contrast of 2.34:1 with the surrounding text. (Minimum contrast is 3:1, link text: #2e7918, surrounding text: #38312f)\n  The link has no styling (such as underline) to distinguish it from the surrounding text',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-in-text-block?application=playwright',
            successCriteriaTags: [
              'wcag141',
            ],
          },
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
        },
      },
    },
    traffic: '6000',
  },
  'https://www.bamboohr.com/blog/learn-management-style': {
    violations: {
      total: 10,
      critical: {
        count: 7,
        items: {
          'aria-allowed-attr': {
            count: 3,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="nav-section has-sub-menu" am-region="Categories" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Our Platform" aria-expanded="false">',
              '<div class="toc-title" aria-selected="false">Table of Contents</div>',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 3,
        items: {
          'color-contrast': {
            count: 1,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/blog/">Blog</a>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.35 (foreground color: #599d15, background color: #ffffff, font size: 12.8pt (17px), font weight: normal). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-in-text-block': {
            count: 1,
            description: 'Links must be distinguishable without relying on color',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.linkedin.com/in/erika-shaughnessy/" rel="noopener" target="_blank">LinkedIn</a>',
            ],
            failureSummary: 'Fix any of the following:\n  The link has insufficient color contrast of 2.34:1 with the surrounding text. (Minimum contrast is 3:1, link text: #2e7918, surrounding text: #38312f)\n  The link has no styling (such as underline) to distinguish it from the surrounding text',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-in-text-block?application=playwright',
            successCriteriaTags: [
              'wcag141',
            ],
          },
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
        },
      },
    },
    traffic: '7120',
  },
  'https://www.bamboohr.com/blog/the-best-questions-to-ask-in-performance-reviews': {
    violations: {
      total: 10,
      critical: {
        count: 7,
        items: {
          'aria-allowed-attr': {
            count: 3,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="nav-section has-sub-menu" am-region="Categories" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Our Platform" aria-expanded="false">',
              '<div class="toc-title" aria-selected="false">Table of Contents</div>',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 3,
        items: {
          'color-contrast': {
            count: 1,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/blog/">Blog</a>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.35 (foreground color: #599d15, background color: #ffffff, font size: 12.8pt (17px), font weight: normal). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-in-text-block': {
            count: 1,
            description: 'Links must be distinguishable without relying on color',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.linkedin.com/in/mattnesmith/" rel="noopener" target="_blank">LinkedIn</a>',
            ],
            failureSummary: 'Fix any of the following:\n  The link has insufficient color contrast of 2.34:1 with the surrounding text. (Minimum contrast is 3:1, link text: #2e7918, surrounding text: #38312f)\n  The link has no styling (such as underline) to distinguish it from the surrounding text',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-in-text-block?application=playwright',
            successCriteriaTags: [
              'wcag141',
            ],
          },
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
        },
      },
    },
    traffic: '9000',
  },
};

export const current = {
  overall: {
    violations: {
      total: 2013,
      critical: {
        count: 748,
        items: {
          'aria-allowed-attr': {
            count: 345,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/name-role-value.html',
            successCriteriaNumber: '412',
          },
          'aria-required-parent': {
            count: 388,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/info-and-relationships.html',
            successCriteriaNumber: '131',
          },
          'button-name': {
            count: 4,
            description: 'Buttons must have discernible text',
            level: 'A',
            understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/name-role-value.html',
            successCriteriaNumber: '412',
          },
          'select-name': {
            count: 3,
            description: 'Select element must have an accessible name',
            level: 'A',
            understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/name-role-value.html',
            successCriteriaNumber: '412',
          },
          'image-alt': {
            count: 8,
            description: 'Images must have alternative text',
            level: 'A',
            understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/non-text-content.html',
            successCriteriaNumber: '111',
          },
        },
      },
      serious: {
        count: 1265,
        items: {
          'color-contrast': {
            count: 970,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html',
            successCriteriaNumber: '143',
          },
          'link-name': {
            count: 8,
            description: 'Links must have discernible text',
            level: 'A',
            understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/link-purpose-in-context.html',
            successCriteriaNumber: '244',
          },
          list: {
            count: 275,
            description: '<ul> and <ol> must only directly contain <li>, <script> or <template> elements',
            level: 'A',
            understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/info-and-relationships.html',
            successCriteriaNumber: '131',
          },
          'target-size': {
            count: 3,
            description: 'All touch targets must be 24px large, or leave sufficient space',
            level: 'AA',
            understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html',
            successCriteriaNumber: '258',
          },
          'aria-prohibited-attr': {
            count: 1,
            description: 'Elements must only use permitted ARIA attributes',
            level: 'A',
            understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/name-role-value.html',
            successCriteriaNumber: '412',
          },
          'link-in-text-block': {
            count: 8,
            description: 'Links must be distinguishable without relying on color',
            level: 'A',
            understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html',
            successCriteriaNumber: '141',
          },
        },
      },
    },
    traffic: 0,
  },
  'https://www.bamboohr.com/pl-pages/easier-customer-testimonials': {
    violations: {
      total: 21,
      critical: {
        count: 9,
        items: {
          'aria-allowed-attr': {
            count: 5,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="accordion" aria-selected="true">',
              '<h2 id="track-hours-manage-benefits--run-payroll-in-one-place" class="tabs-title" aria-selected="true">Track Hours, Manage Benefits &amp; Run Payroll in One Place</h2>',
              '<h2 id="quickly-hire--onboard-the-best-talent" class="tabs-title" aria-selected="false">Quickly Hire &amp; Onboard the Best Talent</h2>',
              '<h2 id="make-strategic-data-driven-decisions" class="tabs-title" aria-selected="false">Make Strategic, Data-Driven Decisions</h2>',
              '<h2 id="create-a-thriving-work-environment" class="tabs-title" aria-selected="false">Create a Thriving Work Environment</h2>',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-selected="true"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 12,
        items: {
          'color-contrast': {
            count: 12,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<h1 id="see-how-bamboohr-makes-life-easier-for-these-hr-pros">See how BambooHR makes life easier for these HR pros.</h1>',
              '<label for="FirstName_909629" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_909629" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_909629" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<label for="Title_909629" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_909629" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_909629" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_909629" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count</label>',
              '<label for="Country_909629" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
        },
      },
    },
    traffic: '116200',
  },
  'https://www.bamboohr.com/pl-pages/bamboohr-software-basics': {
    violations: {
      total: 15,
      critical: {
        count: 4,
        items: {
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 11,
        items: {
          'color-contrast': {
            count: 11,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="FirstName_405943" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_405943" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_405943" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<label for="Title_405943" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_405943" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_405943" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_405943" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count</label>',
              '<label for="Country_405943" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
        },
      },
    },
    traffic: '218260',
  },
  'https://www.bamboohr.com/': {
    violations: {
      total: 25,
      critical: {
        count: 22,
        items: {
          'aria-allowed-attr': {
            count: 18,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="card" aria-expanded="false"><h5 id="product-announcement">Product Announcement</h5><p>Say hello to Employee Community!</p><p class="button-container"><a href="/hr-software/employee-community" title="Learn More" class="accent caret-link caret-link-theme-color">Learn More</a></p></div>',
              '<div class="card" aria-expanded="false">',
              '<div class="accordion" aria-selected="true">',
              '<h2 id="payroll-time--benefits" class="tabs-title" aria-selected="true">Payroll, Time &amp; Benefits</h2>',
              '<h2 id="hiring--onboarding" class="tabs-title" aria-selected="false">Hiring &amp; Onboarding</h2>',
              '<h2 id="hr-data--reporting" class="tabs-title" aria-selected="false">HR Data &amp; Reporting</h2>',
              '<h2 id="employee-experience--performance" class="tabs-title" aria-selected="false">Employee Experience &amp; Performance</h2>',
              '<div data-align="center" class="has-image card" aria-expanded="false">',
              '<div data-align="center" class="has-image card" aria-expanded="false">',
              '<div data-align="center" class="has-image card" aria-expanded="false">',
              '<div class="accordion" aria-selected="true">',
              '<h2 id="what-does-bamboohr-do" class="tabs-title" aria-selected="true">What does BambooHR do?</h2>',
              '<h2 id="does-bamboohr-do-payroll" class="tabs-title" aria-selected="false">Does BambooHR do payroll?</h2>',
              '<h2 id="how-much-does-bamboohr-cost" class="tabs-title" aria-selected="false">How much does BambooHR cost?</h2>',
              '<h2 id="how-many-countries-is-bamboohr-in" class="tabs-title" aria-selected="false">How many countries is BambooHR in?</h2>',
              '<h2 id="is-your-support-team-outsourced" class="tabs-title" aria-selected="false">Is your support team outsourced?</h2>',
              '<h2 id="is-bamboohr-a-peo" class="tabs-title" aria-selected="false">Is BambooHR a PEO?</h2>',
              "<h2 id=\"wheres-my-data-housed-how-secure-is-bamboohr\" class=\"tabs-title\" aria-selected=\"false\">Where's my data housed? How secure is BambooHR?</h2>",
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 3,
        items: {
          'color-contrast': {
            count: 3,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
        },
      },
    },
    traffic: '4597700',
  },
  'https://www.bamboohr.com/pl-pages/easier-hr-for-everyone': {
    violations: {
      total: 19,
      critical: {
        count: 7,
        items: {
          'aria-allowed-attr': {
            count: 3,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 12,
        items: {
          'color-contrast': {
            count: 12,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="FirstName_835933" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_835933" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_835933" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<label for="Title_835933" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_835933" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_835933" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_835933" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count</label>',
              '<label for="Country_835933" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
              '<u>easier platform for yourself</u>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
        },
      },
    },
    traffic: '385100',
  },
  'https://www.bamboohr.com/pl-pages/easier-make-a-difference': {
    violations: {
      total: 19,
      critical: {
        count: 7,
        items: {
          'aria-allowed-attr': {
            count: 3,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 12,
        items: {
          'color-contrast': {
            count: 12,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="FirstName_489147" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_489147" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_489147" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<label for="Title_489147" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_489147" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_489147" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_489147" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count</label>',
              '<label for="Country_489147" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
              '<u>Easily create a better workplace</u>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
        },
      },
    },
    traffic: '322500',
  },
  'https://www.bamboohr.com/pl-pages/hr-time-tracking': {
    violations: {
      total: 15,
      critical: {
        count: 4,
        items: {
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 11,
        items: {
          'color-contrast': {
            count: 11,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="FirstName_625266" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_625266" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_625266" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<label for="Title_625266" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_625266" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_625266" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_625266" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count</label>',
              '<label for="Country_625266" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
        },
      },
    },
    traffic: '112100',
  },
  'https://www.bamboohr.com/signup/': {
    violations: {
      total: 9,
      critical: {
        count: 4,
        items: {
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 5,
        items: {
          'color-contrast': {
            count: 5,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="Employees_Text__c" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count</label>',
              '<label for="Country" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
        },
      },
    },
    traffic: '108200',
  },
  'https://www.bamboohr.com/homepage-customer': {
    violations: {
      total: 17,
      critical: {
        count: 10,
        items: {
          'aria-allowed-attr': {
            count: 6,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="has-image card" aria-expanded="false">',
              '<div class="has-image card" aria-expanded="false">',
              '<div class="has-image card" aria-expanded="false">',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 7,
        items: {
          'link-name': {
            count: 5,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.facebook.com/bamboohr/" title="" rel="noopener" target="_blank">',
              '<a href="https://twitter.com/bamboohr/" title="" rel="noopener" target="_blank">',
              '<a href="https://www.instagram.com/bamboohr/" title="" rel="noopener" target="_blank">',
              '<a href="http://www.linkedin.com/company/bamboohr/" title="" rel="noopener" target="_blank">',
              '<a href="https://www.youtube.com/user/bamboohr/" title="" rel="noopener" target="_blank">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has an empty title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
          list: {
            count: 2,
            description: '<ul> and <ol> must only directly contain <li>, <script> or <template> elements',
            level: 'A',
            htmlWithIssues: [
              '<ul class="listing-cards-results date-simple">',
              '<ul class="listing-cards-results date-simple">',
            ],
            failureSummary: 'Fix all of the following:\n  List element has direct children that are not allowed: div',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/list?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
    },
    traffic: '85200',
  },
  'https://www.bamboohr.com/resources/ebooks/the-definitive-guide-to-onboarding': {
    violations: {
      total: 13,
      critical: {
        count: 7,
        items: {
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
          'button-name': {
            count: 3,
            description: 'Buttons must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<button class=""></button>',
              '<button class="selected"></button>',
              '<button></button>',
            ],
            failureSummary: "Fix any of the following:\n  Element does not have inner text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute\n  Element does not have an implicit (wrapped) <label>\n  Element does not have an explicit <label>\n  Element's default semantics were not overridden with role=\"none\" or role=\"presentation\"",
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/button-name?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
        },
      },
      serious: {
        count: 6,
        items: {
          'color-contrast': {
            count: 3,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'target-size': {
            count: 3,
            description: 'All touch targets must be 24px large, or leave sufficient space',
            level: 'AA',
            htmlWithIssues: [
              '<button class=""></button>',
              '<button class="selected"></button>',
              '<button></button>',
            ],
            failureSummary: 'Fix any of the following:\n  Target has insufficient size (8px by 8px, should be at least 24px by 24px)\n  Target has insufficient space to its closest neighbors. Safe clickable space has a diameter of 16px instead of at least 24px.',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/target-size?application=playwright',
            successCriteriaTags: [
              'wcag258',
            ],
          },
        },
      },
    },
    traffic: '92060',
  },
  'https://www.bamboohr.com/pl-pages/easier-upgrade-your-hr': {
    violations: {
      total: 19,
      critical: {
        count: 13,
        items: {
          'aria-allowed-attr': {
            count: 9,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div id="cabinet-peaks-medical-center" class="tabs-title" aria-selected="true">',
              '<div id="avidbots" class="tabs-title" aria-selected="false">',
              '<div id="cti" class="tabs-title" aria-selected="false">',
              '<div class="has-image card" aria-expanded="false">',
              '<div class="has-image card" aria-expanded="false">',
              '<div class="has-image card" aria-expanded="false">',
              '<div class="has-image card" aria-expanded="false">',
              '<div class="has-image card" aria-expanded="false">',
              '<div class="has-image card" aria-expanded="false">',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-selected="true"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 6,
        items: {
          'color-contrast': {
            count: 6,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<h1 id="upgrade-to-easier-hr">Upgrade to Easier HR</h1>',
              '<label for="Email_300732" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<div class="mktoHtmlText mktoHasWidth">My data will be handled according to the <a href="https://www.bamboohr.com/legal/privacy-policy" target="_blank">Privacy Notice</a>.</div>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
        },
      },
    },
    traffic: '112800',
  },
  'https://www.bamboohr.com/pl-pages/bamboohr-software': {
    violations: {
      total: 15,
      critical: {
        count: 4,
        items: {
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 11,
        items: {
          'color-contrast': {
            count: 11,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="FirstName_800755" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_800755" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_800755" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<label for="Title_800755" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_800755" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_800755" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_800755" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count</label>',
              '<label for="Country_800755" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
        },
      },
    },
    traffic: '84600',
  },
  'https://www.bamboohr.com/careers/application': {
    violations: {
      total: 18,
      critical: {
        count: 4,
        items: {
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 14,
        items: {
          'aria-prohibited-attr': {
            count: 1,
            description: 'Elements must only use permitted ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div aria-label="Drift Widget messenger icon" id="widgetIcon" class="chatWidget">',
            ],
            failureSummary: 'Fix all of the following:\n  aria-label attribute cannot be used on a div with no valid role attribute.',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-prohibited-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'color-contrast': {
            count: 13,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<h1 class="page-header font-primary">Current openings at BambooHR</h1>',
              '<h2 class="section-header section-header--large font-primary" data-testid="job-count-header">18 jobs</h2>',
              '<h3 class="section-header font-primary">Customer Service</h3>',
              '<h3 class="section-header font-primary">Marketing Ops and Analytics</h3>',
              '<h3 class="section-header font-primary">Product</h3>',
              '<h3 class="section-header font-primary">Product Design</h3>',
              '<h3 class="section-header font-primary">Sales Development-Flow</h3>',
              '<h3 class="section-header font-primary">Sales-EMEA</h3>',
              '<h3 class="section-header font-primary">Sales-Flow</h3>',
              '<h3 class="section-header font-primary">Sales Ops &amp; Enablement</h3>',
              '<h3 class="section-header font-primary">AI&amp;Labs</h3>',
              '<h3 class="section-header font-primary">Engineering</h3>',
              '<h3 class="section-header font-primary">IT-Product</h3>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 2.17 (foreground color: #73c41d, background color: #ffffff, font size: 30.0pt (40px), font weight: normal). Expected contrast ratio of 3:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
        },
      },
    },
    traffic: '78700',
  },
  'https://www.bamboohr.com/blog/employees-do-the-right-thing': {
    violations: {
      total: 9,
      critical: {
        count: 7,
        items: {
          'aria-allowed-attr': {
            count: 3,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="nav-section has-sub-menu" am-region="Categories" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Our Platform" aria-expanded="false">',
              '<div class="toc-title" aria-selected="false">Table of Contents</div>',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 2,
        items: {
          'color-contrast': {
            count: 1,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/blog/">Blog</a>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.35 (foreground color: #599d15, background color: #ffffff, font size: 12.8pt (17px), font weight: normal). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-in-text-block': {
            count: 1,
            description: 'Links must be distinguishable without relying on color',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.linkedin.com/in/mattnesmith/" rel="noopener" target="_blank">LinkedIn</a>',
            ],
            failureSummary: 'Fix any of the following:\n  The link has insufficient color contrast of 2.34:1 with the surrounding text. (Minimum contrast is 3:1, link text: #2e7918, surrounding text: #38312f)\n  The link has no styling (such as underline) to distinguish it from the surrounding text',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-in-text-block?application=playwright',
            successCriteriaTags: [
              'wcag141',
            ],
          },
        },
      },
    },
    traffic: '52000',
  },
  'https://www.bamboohr.com/webinars/': {
    violations: {
      total: 9,
      critical: {
        count: 4,
        items: {
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 5,
        items: {
          'color-contrast': {
            count: 3,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          list: {
            count: 2,
            description: '<ul> and <ol> must only directly contain <li>, <script> or <template> elements',
            level: 'A',
            htmlWithIssues: [
              '<ul class="listing-cards-results date">',
              '<ul class="listing-results">',
            ],
            failureSummary: 'Fix all of the following:\n  List element has direct children that are not allowed: div',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/list?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
    },
    traffic: '53700',
  },
  'https://www.bamboohr.com/pl-pages/bamboohr-overview': {
    violations: {
      total: 19,
      critical: {
        count: 12,
        items: {
          'aria-allowed-attr': {
            count: 8,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div id="hiring--onboarding" class="tabs-title" aria-selected="true">',
              '<div id="payroll-time--benefits" class="tabs-title" aria-selected="false">',
              '<div id="employee-experience--performance" class="tabs-title" aria-selected="false">',
              '<div id="hr-data--reporting" class="tabs-title" aria-selected="false">',
              '<div id="integration-marketplace" class="tabs-title" aria-selected="false">',
              '<div class="has-image card" aria-expanded="false">',
              '<div class="has-image card" aria-expanded="false">',
              '<div class="has-image card" aria-expanded="false">',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-selected="true"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 7,
        items: {
          'color-contrast': {
            count: 7,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<h1 id="making-hr-easier-for-you-and-your-team">Making HR Easier for you and your team</h1>',
              '<label for="Email_479953" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<div class="mktoHtmlText mktoHasWidth">My data will be handled according to the <a href="https://www.bamboohr.com/legal/privacy-policy" target="_blank">Privacy Notice</a>.</div>',
              '<strong>I love just being able to go to one place for everything</strong>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
        },
      },
    },
    traffic: '56400',
  },
  'https://www.bamboohr.com/unsubscribe/': {
    violations: {
      total: 8,
      critical: {
        count: 4,
        items: {
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 4,
        items: {
          'color-contrast': {
            count: 4,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="Email_816998" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Email Address</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
        },
      },
    },
    traffic: '44300',
  },
  'https://www.bamboohr.com/demo': {
    violations: {
      total: 12,
      critical: {
        count: 4,
        items: {
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 8,
        items: {
          'color-contrast': {
            count: 8,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<label for="FirstName_647562" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_647562" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_647562" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<label for="Title_647562" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_647562" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_647562" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_647562" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count</label>',
              '<label for="Country_647562" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.12 (foreground color: #95918f, background color: #ffffff, font size: 9.0pt (12px), font weight: normal). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
        },
      },
    },
    traffic: '44400',
  },
  'https://www.bamboohr.com/pl/onboarding-checklist': {
    violations: {
      total: 18,
      critical: {
        count: 7,
        items: {
          'aria-allowed-attr': {
            count: 3,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 11,
        items: {
          'color-contrast': {
            count: 11,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="FirstName_257437" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_257437" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_257437" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<label for="Title_257437" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_257437" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_257437" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_257437" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count </label>',
              '<label for="Country_257437" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
        },
      },
    },
    traffic: '45700',
  },
  'https://www.bamboohr.com/careers/': {
    violations: {
      total: 27,
      critical: {
        count: 24,
        items: {
          'aria-allowed-attr': {
            count: 17,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="accordion" aria-selected="true">',
              '<h2 id="our-mission" class="tabs-title" aria-selected="true">Our Mission</h2>',
              '<h2 id="our-vision" class="tabs-title" aria-selected="false">Our Vision</h2>',
              '<h2 id="our-values" class="tabs-title" aria-selected="false">Our Values</h2>',
              '<h2 id="our-history" class="tabs-title" aria-selected="false">Our History</h2>',
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="accordion" aria-selected="true">',
              '<h2 id="what-happens-after-i-apply" class="tabs-title" aria-selected="true">What happens after I apply?</h2>',
              '<h2 id="what-does-bamboohr-do" class="tabs-title" aria-selected="false">What does BambooHR do?</h2>',
              '<h2 id="how-do-you-decide-compensation" class="tabs-title" aria-selected="false">How do you decide compensation?</h2>',
              '<h2 id="is-there-a-dress-code" class="tabs-title" aria-selected="false">Is there a dress code?</h2>',
              '<div class="has-image card" aria-expanded="false">',
              '<div class="has-image card" aria-expanded="false">',
              '<div class="has-image card" aria-expanded="false">',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-selected="true"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
          'select-name': {
            count: 3,
            description: 'Select element must have an accessible name',
            level: 'A',
            htmlWithIssues: [
              '<select class="listing-filter-dropdown" id="listing-filter-dropdown-department" data-filter-key="department">',
              '<select class="listing-filter-dropdown" id="listing-filter-dropdown-state" data-filter-key="jobLocState">',
              '<select class="listing-filter-dropdown" id="listing-filter-dropdown-remote-in-office" data-filter-key="jobLocRemote">',
            ],
            failureSummary: "Fix any of the following:\n  Element does not have an implicit (wrapped) <label>\n  Element does not have an explicit <label>\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute\n  Element's default semantics were not overridden with role=\"none\" or role=\"presentation\"",
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/select-name?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
        },
      },
      serious: {
        count: 3,
        items: {
          list: {
            count: 3,
            description: '<ul> and <ol> must only directly contain <li>, <script> or <template> elements',
            level: 'A',
            htmlWithIssues: [
              '<ul class="listing-cards-results article">',
              '<ul class="listing-cards-results date">',
              '<ul class="listing-results">',
            ],
            failureSummary: 'Fix all of the following:\n  List element has direct children that are not allowed: div',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/list?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
    },
    traffic: '51800',
  },
  'https://www.bamboohr.com/resources/ebooks/definitive-guide-company-culture': {
    violations: {
      total: 6,
      critical: {
        count: 4,
        items: {
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 2,
        items: {
          'color-contrast': {
            count: 2,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
        },
      },
    },
    traffic: '51200',
  },
  'https://www.bamboohr.com/pl-pages/hr-software': {
    violations: {
      total: 15,
      critical: {
        count: 4,
        items: {
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 11,
        items: {
          'color-contrast': {
            count: 11,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="FirstName_324040" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_324040" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_324040" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<label for="Title_324040" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_324040" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_324040" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_324040" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count</label>',
              '<label for="Country_324040" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
        },
      },
    },
    traffic: '41060',
  },
  'https://www.bamboohr.com/pricing/': {
    violations: {
      total: 20,
      critical: {
        count: 9,
        items: {
          'aria-allowed-attr': {
            count: 5,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<h2 id="how-much-does-bamboohr-cost" class="tabs-title" aria-selected="true">How much does BambooHR cost?</h2>',
              '<h2 id="what-payment-methods-do-you-accept" class="tabs-title" aria-selected="false">What payment methods do you accept?</h2>',
              '<h2 id="do-you-offer-discounts" class="tabs-title" aria-selected="false">Do you offer discounts?</h2>',
              '<h2 id="does-bamboohr-integrate-with-other-software" class="tabs-title" aria-selected="false">Does BambooHR integrate with other software?</h2>',
              '<h2 id="how-difficult-is-it-to-switch-to-bamboohr-payroll" class="tabs-title" aria-selected="false">How difficult is it to switch to BambooHR Payroll?</h2>',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-selected="true"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 11,
        items: {
          'color-contrast': {
            count: 11,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="FirstName_311624" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_311624" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_311624" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<label for="Title_311624" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_311624" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_311624" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_311624" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count</label>',
              '<label for="Country_311624" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
        },
      },
    },
    traffic: '41100',
  },
  'https://www.bamboohr.com/blog/': {
    violations: {
      total: 19,
      critical: {
        count: 6,
        items: {
          'aria-allowed-attr': {
            count: 2,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="nav-section has-sub-menu" am-region="Categories" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Our Platform" aria-expanded="false">',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 13,
        items: {
          'color-contrast': {
            count: 13,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/blog/">Blog</a>',
              '<div class="article-feed-card-date">Apr 11, 2025</div>',
              '<div class="article-feed-card-date">Jan 30, 2025</div>',
              '<div class="article-feed-card-date">May 16, 2025</div>',
              '<div class="article-feed-card-date">May 13, 2025</div>',
              '<div class="article-feed-card-date">May 09, 2025</div>',
              '<div class="article-feed-card-date">Apr 28, 2025</div>',
              '<div class="article-feed-card-date">Apr 25, 2025</div>',
              '<div class="article-feed-card-date">Apr 17, 2025</div>',
              '<div class="article-feed-card-date">Apr 11, 2025</div>',
              '<div class="article-feed-card-date">Apr 11, 2025</div>',
              '<div class="article-feed-card-date">Apr 11, 2025</div>',
              '<div class="article-feed-card-date">Apr 11, 2025</div>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.35 (foreground color: #599d15, background color: #ffffff, font size: 12.8pt (17px), font weight: normal). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
        },
      },
    },
    traffic: '34000',
  },
  'https://www.bamboohr.com/pl-pages/onboarding': {
    violations: {
      total: 15,
      critical: {
        count: 4,
        items: {
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 11,
        items: {
          'color-contrast': {
            count: 11,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="FirstName_752798" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_752798" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_752798" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<label for="Title_752798" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_752798" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_752798" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_752798" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count</label>',
              '<label for="Country_752798" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
        },
      },
    },
    traffic: '35760',
  },
  'https://www.bamboohr.com/pl-pages/competitors/rippling': {
    violations: {
      total: 23,
      critical: {
        count: 12,
        items: {
          'aria-allowed-attr': {
            count: 8,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="accordion" aria-selected="true">',
              '<h2 id="payroll-time--benefits" class="tabs-title" aria-selected="true">Payroll, Time &amp; Benefits</h2>',
              '<h2 id="hiring--onboarding" class="tabs-title" aria-selected="false">Hiring &amp; Onboarding</h2>',
              '<h2 id="hr-data--reporting" class="tabs-title" aria-selected="false">HR Data &amp; Reporting</h2>',
              '<h2 id="employee-experience--performance" class="tabs-title" aria-selected="false">Employee Experience &amp; Performance</h2>',
              '<div data-align="center" class="has-image card" aria-expanded="false">',
              '<div data-align="center" class="has-image card" aria-expanded="false">',
              '<div data-align="center" class="has-image card" aria-expanded="false">',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-selected="true"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 11,
        items: {
          'color-contrast': {
            count: 11,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="FirstName_86035" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_86035" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_86035" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<label for="Title_86035" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_86035" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_86035" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_86035" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count</label>',
              '<label for="Country_86035" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
        },
      },
    },
    traffic: '39600',
  },
  'https://www.bamboohr.com/pl-pages/pricing': {
    violations: {
      total: 20,
      critical: {
        count: 9,
        items: {
          'aria-allowed-attr': {
            count: 5,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<h2 id="how-much-does-bamboohr-cost" class="tabs-title" aria-selected="true">How much does BambooHR cost?</h2>',
              '<h2 id="what-payment-methods-do-you-accept" class="tabs-title" aria-selected="false">What payment methods do you accept?</h2>',
              '<h2 id="do-you-offer-discounts" class="tabs-title" aria-selected="false">Do you offer discounts?</h2>',
              '<h2 id="does-bamboohr-integrate-with-other-software" class="tabs-title" aria-selected="false">Does BambooHR integrate with other software?</h2>',
              '<h2 id="how-difficult-is-it-to-switch-to-bamboohr-payroll" class="tabs-title" aria-selected="false">How difficult is it to switch to BambooHR Payroll?</h2>',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-selected="true"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 11,
        items: {
          'color-contrast': {
            count: 11,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Bundle &amp; Save! Get a 15% discount when you combine Payroll and Benefits Administration with the Core or Pro plan.*</span>',
              '<a class="caret-link" href="#add-on-solutions">Learn More</a>',
              '<label for="FirstName_530743" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_530743" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_530743" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<label for="Title_530743" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_530743" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_530743" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_530743" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count</label>',
              '<label for="Country_530743" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
        },
      },
    },
    traffic: '31400',
  },
  'https://www.bamboohr.com/legal/terms-of-service': {
    violations: {
      total: 5,
      critical: {
        count: 5,
        items: {
          'aria-allowed-attr': {
            count: 1,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="toc-title" aria-selected="false">Table of Contents</div>',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-selected="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 0,
        items: {},
      },
    },
    traffic: '31100',
  },
  'https://www.bamboohr.com/hr-software/mobile': {
    violations: {
      total: 19,
      critical: {
        count: 12,
        items: {
          'aria-allowed-attr': {
            count: 8,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div data-align="center" class="card" aria-expanded="false">',
              '<div data-align="center" class="card" aria-expanded="false">',
              '<div data-align="center" class="card" aria-expanded="false">',
              '<div class="accordion" aria-selected="true">',
              '<h2 id="can-i-download-the-bamboohr-mobile-app-for-free" class="tabs-title" aria-selected="true">Can I download the BambooHR Mobile app for free?</h2>',
              '<h2 id="how-do-i-download-and-log-in-to-the-bamboohr-mobile-app" class="tabs-title" aria-selected="false">How do I download and log in to the BambooHR Mobile app?</h2>',
              '<h2 id="can-i-clock-in-using-the-bamboohr-mobile-app" class="tabs-title" aria-selected="false">Can I clock in using the BambooHR Mobile app?</h2>',
              '<h2 id="can-i-submit-a-time-off-request-from-the-mobile-app" class="tabs-title" aria-selected="false">Can I submit a time-off request from the mobile app?</h2>',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 7,
        items: {
          'color-contrast': {
            count: 4,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<a href="https://www.bamboohr.com/integrations/" title="See All Integrations" class="button accent">See All Integrations</a>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-name': {
            count: 2,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://apps.apple.com/us/app/bamboohr/id587244049" title="" rel="noopener" target="_blank">',
              '<a href="https://play.google.com/store/search?q=bamboohr&amp;c=apps&amp;hl=en_US" title="" rel="noopener" target="_blank">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has an empty title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
          list: {
            count: 1,
            description: '<ul> and <ol> must only directly contain <li>, <script> or <template> elements',
            level: 'A',
            htmlWithIssues: [
              '<ul class="listing-cards-results media">',
            ],
            failureSummary: 'Fix all of the following:\n  List element has direct children that are not allowed: div',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/list?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
    },
    traffic: '30700',
  },
  'https://www.bamboohr.com/pl-pages/competitors/workday': {
    violations: {
      total: 23,
      critical: {
        count: 12,
        items: {
          'aria-allowed-attr': {
            count: 8,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="accordion" aria-selected="true">',
              '<h2 id="payroll-time--benefits" class="tabs-title" aria-selected="true">Payroll, Time &amp; Benefits</h2>',
              '<h2 id="hiring--onboarding" class="tabs-title" aria-selected="false">Hiring &amp; Onboarding</h2>',
              '<h2 id="hr-data--reporting" class="tabs-title" aria-selected="false">HR Data &amp; Reporting</h2>',
              '<h2 id="employee-experience--performance" class="tabs-title" aria-selected="false">Employee Experience &amp; Performance</h2>',
              '<div data-align="center" class="has-image card" aria-expanded="false">',
              '<div data-align="center" class="has-image card" aria-expanded="false">',
              '<div data-align="center" class="has-image card" aria-expanded="false">',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-selected="true"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 11,
        items: {
          'color-contrast': {
            count: 11,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="FirstName_32832" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_32832" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_32832" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<label for="Title_32832" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_32832" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_32832" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_32832" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count</label>',
              '<label for="Country_32832" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
        },
      },
    },
    traffic: '32400',
  },
  'https://www.bamboohr.com/o2': {
    violations: {
      total: 25,
      critical: {
        count: 22,
        items: {
          'aria-allowed-attr': {
            count: 18,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="card" aria-expanded="false"><h5 id="product-announcement">Product Announcement</h5><p>Say hello to Employee Community!</p><p class="button-container"><a href="/hr-software/employee-community" title="Learn More" class="accent caret-link caret-link-theme-color">Learn More</a></p></div>',
              '<div class="card" aria-expanded="false">',
              '<div class="accordion" aria-selected="true">',
              '<h2 id="payroll-time--benefits" class="tabs-title" aria-selected="true">Payroll, Time &amp; Benefits</h2>',
              '<h2 id="hiring--onboarding" class="tabs-title" aria-selected="false">Hiring &amp; Onboarding</h2>',
              '<h2 id="hr-data--reporting" class="tabs-title" aria-selected="false">HR Data &amp; Reporting</h2>',
              '<h2 id="employee-experience--performance" class="tabs-title" aria-selected="false">Employee Experience &amp; Performance</h2>',
              '<div data-align="center" class="has-image card" aria-expanded="false">',
              '<div data-align="center" class="has-image card" aria-expanded="false">',
              '<div data-align="center" class="has-image card" aria-expanded="false">',
              '<div class="accordion" aria-selected="true">',
              '<h2 id="what-does-bamboohr-do" class="tabs-title" aria-selected="true">What does BambooHR do?</h2>',
              '<h2 id="does-bamboohr-do-payroll" class="tabs-title" aria-selected="false">Does BambooHR do payroll?</h2>',
              '<h2 id="how-much-does-bamboohr-cost" class="tabs-title" aria-selected="false">How much does BambooHR cost?</h2>',
              '<h2 id="how-many-countries-is-bamboohr-in" class="tabs-title" aria-selected="false">How many countries is BambooHR in?</h2>',
              '<h2 id="is-your-support-team-outsourced" class="tabs-title" aria-selected="false">Is your support team outsourced?</h2>',
              '<h2 id="is-bamboohr-a-peo" class="tabs-title" aria-selected="false">Is BambooHR a PEO?</h2>',
              "<h2 id=\"wheres-my-data-housed-how-secure-is-bamboohr\" class=\"tabs-title\" aria-selected=\"false\">Where's my data housed? How secure is BambooHR?</h2>",
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 3,
        items: {
          'color-contrast': {
            count: 3,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
        },
      },
    },
    traffic: '32160',
  },
  'https://www.bamboohr.com/pl-pages/employee-time-tracking': {
    violations: {
      total: 15,
      critical: {
        count: 4,
        items: {
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 11,
        items: {
          'color-contrast': {
            count: 11,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="FirstName_932392" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_932392" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_932392" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<label for="Title_932392" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_932392" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_932392" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_932392" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count</label>',
              '<label for="Country_932392" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
        },
      },
    },
    traffic: '28100',
  },
  'https://www.bamboohr.com/pl/benefits-administration': {
    violations: {
      total: 15,
      critical: {
        count: 4,
        items: {
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 11,
        items: {
          'color-contrast': {
            count: 11,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="FirstName_158332" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_158332" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_158332" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<label for="Title_158332" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_158332" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_158332" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_158332" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count</label>',
              '<label for="Country_158332" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
        },
      },
    },
    traffic: '26900',
  },
  'https://www.bamboohr.com/legal/privacy-policy': {
    violations: {
      total: 5,
      critical: {
        count: 5,
        items: {
          'aria-allowed-attr': {
            count: 1,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="toc-title" aria-selected="false">Table of Contents</div>',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-selected="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 0,
        items: {},
      },
    },
    traffic: '24200',
  },
  'https://www.bamboohr.com/resources/hr-glossary/': {
    violations: {
      total: 7,
      critical: {
        count: 4,
        items: {
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 3,
        items: {
          'color-contrast': {
            count: 3,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
        },
      },
    },
    traffic: '28900',
  },
  'https://www.bamboohr.com/o1': {
    violations: {
      total: 25,
      critical: {
        count: 22,
        items: {
          'aria-allowed-attr': {
            count: 18,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="card" aria-expanded="false"><h5 id="product-announcement">Product Announcement</h5><p>Say hello to Employee Community!</p><p class="button-container"><a href="/hr-software/employee-community" title="Learn More" class="accent caret-link caret-link-theme-color">Learn More</a></p></div>',
              '<div class="card" aria-expanded="false">',
              '<div class="accordion" aria-selected="true">',
              '<h2 id="payroll-time--benefits" class="tabs-title" aria-selected="true">Payroll, Time &amp; Benefits</h2>',
              '<h2 id="hiring--onboarding" class="tabs-title" aria-selected="false">Hiring &amp; Onboarding</h2>',
              '<h2 id="hr-data--reporting" class="tabs-title" aria-selected="false">HR Data &amp; Reporting</h2>',
              '<h2 id="employee-experience--performance" class="tabs-title" aria-selected="false">Employee Experience &amp; Performance</h2>',
              '<div data-align="center" class="has-image card" aria-expanded="false">',
              '<div data-align="center" class="has-image card" aria-expanded="false">',
              '<div data-align="center" class="has-image card" aria-expanded="false">',
              '<div class="accordion" aria-selected="true">',
              '<h2 id="what-does-bamboohr-do" class="tabs-title" aria-selected="true">What does BambooHR do?</h2>',
              '<h2 id="does-bamboohr-do-payroll" class="tabs-title" aria-selected="false">Does BambooHR do payroll?</h2>',
              '<h2 id="how-much-does-bamboohr-cost" class="tabs-title" aria-selected="false">How much does BambooHR cost?</h2>',
              '<h2 id="how-many-countries-is-bamboohr-in" class="tabs-title" aria-selected="false">How many countries is BambooHR in?</h2>',
              '<h2 id="is-your-support-team-outsourced" class="tabs-title" aria-selected="false">Is your support team outsourced?</h2>',
              '<h2 id="is-bamboohr-a-peo" class="tabs-title" aria-selected="false">Is BambooHR a PEO?</h2>',
              "<h2 id=\"wheres-my-data-housed-how-secure-is-bamboohr\" class=\"tabs-title\" aria-selected=\"false\">Where's my data housed? How secure is BambooHR?</h2>",
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 3,
        items: {
          'color-contrast': {
            count: 3,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
        },
      },
    },
    traffic: '26300',
  },
  'https://www.bamboohr.com/integrations/listings/netsuite': {
    violations: {
      total: 13,
      critical: {
        count: 12,
        items: {
          'aria-allowed-attr': {
            count: 4,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="nav-section has-sub-menu" am-region="Categories" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Feature Comparisons" aria-expanded="false">',
              '<h2 id="overview" class="tabs-title" aria-selected="true">Overview</h2>',
              '<h2 id="integration" class="tabs-title" aria-selected="false">Integration</h2>',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
          'image-alt': {
            count: 4,
            description: 'Images must have alternative text',
            level: 'A',
            htmlWithIssues: [
              '<img src="/styles/integration-type.svg">',
              '<img src="/styles/data-flow-direction.svg">',
              '<img src="/styles/sync-trigger.svg">',
              '<img src="/styles/sync-frequency.svg">',
            ],
            failureSummary: "Fix any of the following:\n  Element does not have an alt attribute\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute\n  Element's default semantics were not overridden with role=\"none\" or role=\"presentation\"",
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/image-alt?application=playwright',
            successCriteriaTags: [
              'wcag111',
            ],
          },
        },
      },
      serious: {
        count: 1,
        items: {
          'color-contrast': {
            count: 1,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/integrations/">Marketplace</a>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.35 (foreground color: #599d15, background color: #ffffff, font size: 12.8pt (17px), font weight: normal). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
        },
      },
    },
    traffic: '23300',
  },
  'https://www.bamboohr.com/resources/ebooks/chatgpt-prompts-hr': {
    violations: {
      total: 15,
      critical: {
        count: 4,
        items: {
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 11,
        items: {
          'color-contrast': {
            count: 11,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="FirstName_155334" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_155334" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_155334" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<label for="Title_155334" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_155334" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_155334" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_155334" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count </label>',
              '<label for="Country_155334" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
        },
      },
    },
    traffic: '21900',
  },
  'https://www.bamboohr.com/integrations/': {
    violations: {
      total: 14,
      critical: {
        count: 6,
        items: {
          'aria-allowed-attr': {
            count: 2,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="nav-section has-sub-menu" am-region="Categories" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Feature Comparisons" aria-expanded="false">',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 8,
        items: {
          'color-contrast': {
            count: 7,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/integrations/">Marketplace</a>',
              '<a href="https://www.bamboohr.com/integrations/listing-category/payroll" title="Payroll" class="button accent">Payroll</a>',
              '<a href="https://www.bamboohr.com/integrations/listing-category/performance" title="Performance" class="button accent">Performance</a>',
              '<a href="https://www.bamboohr.com/integrations/listing-category/applicant-tracking-systems" title="Applicant Tracking Systems" class="button accent">Applicant Tracking Systems</a>',
              '<a href="https://www.bamboohr.com/integrations/listing-category/time-tracking-scheduling" title="Time Tracking &amp; Scheduling" class="button accent">Time Tracking &amp; Scheduling</a>',
              '<a href="https://www.bamboohr.com/integrations/listing-category/learning-training" title="Learning &amp; Training" class="button accent">Learning &amp; Training</a>',
              '<a href="https://www.bamboohr.com/integrations/listing-category/benefits-administration" title="Benefits Administration" class="button accent">Benefits Administration</a>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.35 (foreground color: #599d15, background color: #ffffff, font size: 12.8pt (17px), font weight: normal). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-name': {
            count: 1,
            description: 'Links must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/exp/benefits/bamboohr-benefits-administration?utm_campaign=BAMB-CM-BAC+jennifer+decker+marketplace+banner-2023EG&amp;utm_medium=expansion&amp;utm_source=marketplace-expansion&amp;utm_content=blank&amp;utm_term=blank" title="">',
            ],
            failureSummary: 'Fix all of the following:\n  Element is in tab order and does not have accessible text\n\nFix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has an empty title attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-name?application=playwright',
            successCriteriaTags: [
              'wcag244',
              'wcag412',
            ],
          },
        },
      },
    },
    traffic: '20300',
  },
  'https://www.bamboohr.com/pl-pages/ats': {
    violations: {
      total: 15,
      critical: {
        count: 4,
        items: {
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 11,
        items: {
          'color-contrast': {
            count: 11,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="FirstName_219635" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_219635" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_219635" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<label for="Title_219635" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_219635" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_219635" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_219635" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count</label>',
              '<label for="Country_219635" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
        },
      },
    },
    traffic: '22900',
  },
  'https://www.bamboohr.com/resources/': {
    violations: {
      total: 527,
      critical: {
        count: 4,
        items: {
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 523,
        items: {
          'color-contrast': {
            count: 263,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<a href="/resources/ebooks/definitive-guide-to-performance-management" class="resource-card-link">Free Download</a>',
              '<a href="/resources/guides/the-definitive-guide-to-onboarding" class="resource-card-link">Read the Guide</a>',
              '<a href="/resources/ebooks/how-to-switch-payroll-providers-in-7-simple-steps" class="resource-card-link">Free Download</a>',
              "<a href=\"/resources/guides/hris-buyers-guide\" class=\"resource-card-link\">Read the HRIS Buyer's Guide</a>",
              '<a href="/resources/guides/10-questions-about-ai" class="resource-card-link">Read the Guide</a>',
              '<a href="/resources/ebooks/behind-the-scenes-ui-2024" class="resource-card-link">Read the Guide</a>',
              "<a href=\"/resources/guides/year-in-review-2024\" class=\"resource-card-link\">Read BambooHR's 2024 Year in Review</a>",
              '<a href="/resources/ebooks/the-definitive-guide-to-onboarding" class="resource-card-link">Get The Full Guide</a>',
              '<a href="/resources/ebooks/5-sure-fire-ways-to-set-goals-that-get-results" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/career-progression-report" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/employee-engagement" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/evaluating-and-rewarding-employee-performance" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/employee-experience-report" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/6-things-your-employees-will-fail-without" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/employee-wellbeing-faq-for-employees" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/developing-benefits-to-help-employees-stay" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/4-things-you-need-in-a-killer-performance-management-tool" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/how-to-solve-your-top-offboarding-problems" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/connected-leadership-how-to-invest-in-your-management-teams" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/coaching-to-create-concrete-results" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/how-to-retain-and-motivate-your-best-employees" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/how-to-use-benefits-to-create-a-culture-of-health-and-well-being" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/productivity-reward-recognition" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/seat-at-the-table" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/9-best-practices-to-master-performance-review" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/9-things-recruiters-do-they-shouldnt" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/fair-transparent-and-modern-a-360-guide-to-employer-brand" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/how-to-make-employees-feel-valued-at-work" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/how-bamboohr-enables-vital-hr-communication" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/guide-to-buying-hris" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/navigating-4-most-crucial-compensation-conversations" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/getting-smart-about-compensation" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/how-you-can-shave-20-off-hr-admin-time" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/definitive-guide-to-creating-comp-plan" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/diy-hr" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/13tips-smbs-great-talent" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/2018-employee-engagement-checklist-calendar" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/how-remote-work-affect-the-culture-conversation" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/how-your-attitude-toward-compliance-shapes-company-culture" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/the-hr-tech-buyers-guide" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/improve-how-you-evaluate" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/reward-and-recognition" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/your-total-rewards-questions-answered" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/danger-spreadsheets" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/hr-for-small-business-what-you-need-to-know" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/employee-wellbeing-faq-for-admins" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/diversity-a-major-asset" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/pros-and-cons-of-unlimited-vacation" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/optimizing-compensation-for-shared-trust" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/the-new-hire-onboarding-checklist-everything-you-need-to-know" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/getting-real-about-employee-engagement-how-to-get-started" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/guide-company-values" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/everything-you-need-to-know-about-communicating-pay" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/why-employee-engagement-matters-to-your-business" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/your-talent-acquisition-ecosystem-managing-the-employee-lifecycle" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/understanding-how-to-influence-the-employee-journey" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/11-leadership-lessons-from-todays-top-people-managers" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/managing-employee-turnover" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/modern-onboarding-to-accelerate-new-hire-success" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/paid-paid-vacation" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/aca-compliance" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/kiss-hr-stoneage-goodbye" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/hr-spreadsheets-hold-you-captive" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/reward-recognition-retention" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/useful-performance-management-takeaways-from-sports" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/using-compensation-to-motivate-performance" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/hr-tech-quick-ref-guide" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/guide-to-onboarding" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/hr-data-can-be-a-killer" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/employee-time-tracking" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/employee-engagement-ask-analyze-act" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/making-performance-management-positive" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/talent-pulse" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/the-2022-essential-retention-guide" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/scaling-your-small-business" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/the-hr-journey-through-2021" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/hr-save-the-day" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/pre-employment-drug-tests-a-primer" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/onboardings-and-offboardings" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/overcoming-spreadsheet-hurdles" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/recruiting-at-speed-text-and-social-media-hiring-tips-for-the-modern-recruiter" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/the-state-of-payroll" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/the-employee-experience-journey" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/recognition-in-the-workplace-breakthrough-secrets-and-stats" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/rethinking-the-great-resignation" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/smart-onboarding" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/unlocking-employee-engagement-the-missing-metric-for-engagement" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/the-employee-1-on-1-checklist-5-steps-how-5-reasons-why" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/top-onboarding-advice" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/what-employees-want-from-performance-management-and-how-to-provide-it" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/where-hr-analytics-makes-a-difference" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/time-management-for-organizations-and-their-people" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/recruiting-a-diverse-workforce" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/definitive-guide-company-culture" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/what-strategic-hr-means-and-how-to-achieve-it" class="resource-card-link">Free Download</a>',
              '<a href="/resources/ebooks/20-exit-interview-questions" class="resource-card-link">Get the List</a>',
              '<a href="/resources/infographics/3-causes-of-employee-burnout-and-3-ways-to-prevent-it" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/healthcare" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/hybrid-work-expectations-vs-reality" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/state-of-workplace-distractions" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/what-your-executive-team-wants-from-hr-reports" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/2021-is-all-about-culture-and-employee-experience" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/human-resources-perceptions" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/how-reporting-elevates-hr" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/5-payroll-pain-points-solved-by-traxpayroll" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/bad-boss-index-2020" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/effective-performance-management-reviews" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/exit-interview-best-practices" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/what-matters-most-to-hr-teams-2" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/tips-time-off-requests" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/the-5-reasons-employees-are-leaving" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/perspectives-on-performance-management" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/the-dos-and-donts-of-a-hybrid-workplace" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/10-bamboohr-tips-for-better-faster-hiring" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/calculating-hr-the-real-value-of-hr-software" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/big-hr-small-hr-ideas" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/4-ways-the-bamboohr-ats-improves-your-hiring-process" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/decade-changed-the-workplace" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/employee-time-tracking" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/employee-satisfaction-today" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/employee-wellbeing-first-look" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/the-5-most-common-payroll-mistakes" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/strategic-hr" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/the-incredible-impact-of-effective-onboarding" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/workplace-dealbreakers" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/update-your-time-tracking-process" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/workplace-dress-codes" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/8-focus-areas-for-hr-best-practices" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/five-ways-bamboohr-elevates-your-performance-management" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/hours-worked-around-the-world" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/performance-management" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/reward-recognition" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/should-i-hire-this-candidate" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/5-ways-bamboohr-helps-you-overcome-top-hr-challenges-in-healthcare" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/current-company-culture-trends" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/how-bamboohr-meets-the-top-three-construction-industry-hr-challenges" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/measuring-enps" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/quick-guide-recruitment-process" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/hr-trends-2020" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/reward-and-recognition-what-really-motivates-employees" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/why-employee-engagement-matters-to-your-business" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/why-hr-is-so-important" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/what-are-hr-metrics" class="resource-card-link">Free Download</a>',
              '<a href="/resources/courses/improving-organizational-strategy-with-enps-feedback" class="resource-card-link">Watch Now</a>',
              '<a href="/resources/courses/how-to-measure-employee-satisfaction-with-enps" class="resource-card-link">Watch Now</a>',
              '<a href="/resources/courses/caring-for-the-whole-employee" class="resource-card-link">Watch Now</a>',
              '<a href="/resources/courses/rethink-recruiting" class="resource-card-link">Watch Now</a>',
              '<a href="/resources/courses/three-steps-to-more-influential-hr" class="resource-card-link">Watch Now</a>',
              '<a href="/resources/courses/the-business-of-employee-satisfaction" class="resource-card-link">Watch Now</a>',
              '<a href="/resources/courses/how-to-build-and-maintain-a-culture-of-performance" class="resource-card-link">Watch Now</a>',
              '<a href="/resources/whitepapers/getting-the-most-out-of-hcm-tech" class="resource-card-link">Free Download</a>',
              '<a href="/resources/whitepapers/what-recognized-employees-have-in-common" class="resource-card-link">Free Download</a>',
              '<a href="/resources/whitepapers/4-big-challenges-facing-hr-professionals-in-the-healthcare-industry" class="resource-card-link">Free Download</a>',
              '<a href="/resources/whitepapers/employee-absenteeism" class="resource-card-link">Free Download</a>',
              '<a href="/resources/whitepapers/ending-spreadsheet-chaos" class="resource-card-link">Free Download</a>',
              '<a href="/resources/whitepapers/5-reasons-to-use-ats" class="resource-card-link">Free Download</a>',
              '<a href="/resources/whitepapers/remote-employee-checklist" class="resource-card-link">Free Download</a>',
              '<a href="/resources/whitepapers/stop-using-spreadsheets" class="resource-card-link">Free Download</a>',
              '<a href="/resources/whitepapers/how-to-solve-your-top-onboarding-problems" class="resource-card-link">Free Download</a>',
              '<a href="/resources/whitepapers/communication-of-employee-benefits" class="resource-card-link">Free Download</a>',
              '<a href="/resources/whitepapers/culture-checklist" class="resource-card-link">Free Download</a>',
              '<a href="/resources/whitepapers/employee-development-checklist" class="resource-card-link">Free Download</a>',
              '<a href="/resources/whitepapers/5-essential-features-for-hr-software" class="resource-card-link">Free Download</a>',
              '<a href="/resources/whitepapers/compliance-checklist" class="resource-card-link">Free Download</a>',
              '<a href="/resources/whitepapers/how-to-write-a-job-description" class="resource-card-link">Free Download</a>',
              '<a href="/resources/whitepapers/insights-into-onboarding" class="resource-card-link">Free Download</a>',
              '<a href="/resources/whitepapers/resumes-dont-belong-in-email" class="resource-card-link">Free Download</a>',
              '<a href="/resources/whitepapers/challenges-in-healthcare" class="resource-card-link">Free Download</a>',
              '<a href="/resources/whitepapers/compensation-starter-kit" class="resource-card-link">Free Download</a>',
              '<a href="/resources/whitepapers/get-out-of-spreadsheets" class="resource-card-link">Free Download</a>',
              '<a href="/resources/whitepapers/streamlining-hr" class="resource-card-link">Free Download</a>',
              '<a href="/resources/infographics/employee-handbook-checklist" class="resource-card-link">Get the Checklist</a>',
              '<a href="/resources/ebooks/offboarding-checklist" class="resource-card-link">Get the Checklist</a>',
              '<a href="/resources/ebooks/new-teacher-onboarding-checklist" class="resource-card-link">Get the New Teacher Onboarding Checklist</a>',
              "<a href=\"/resources/ebooks/best-of-bamboohr-2024\" class=\"resource-card-link\">Get the BambooHR's 2024 Editor's Picks</a>",
              '<a href="/resources/ebooks/orientation-checklists-on-site-construction" class="resource-card-link">Get the On-Site Orientation Checklists</a>',
              '<a href="/resources/ebooks/onboarding-checklist-construction" class="resource-card-link">Get the Construction Onboarding Checklists</a>',
              '<a href="/resources/ebooks/hr-checklist-construction" class="resource-card-link">Get the Checklist</a>',
              '<a href="/resources/ebooks/peo-checklist" class="resource-card-link">Get the Checklist</a>',
              '<a href="/resources/videos/bamboohr-product-demo-payroll" class="resource-card-link">Watch Now</a>',
              '<a href="/resources/videos/bamboohr-product-demo-time-tracking" class="resource-card-link">Watch Now</a>',
              '<a href="/resources/videos/bamboohr-product-demo-core-system" class="resource-card-link">Watch Now</a>',
              '<a href="/resources/videos/bamboohr-product-demo-performance-management" class="resource-card-link">Watch Now</a>',
              '<a href="/resources/guides/definitive-guide-to-people-analytics" class="resource-card-link">Read the Guide</a>',
              '<a href="/resources/guides/how-to-hire-employees" class="resource-card-link">Free Download</a>',
              '<a href="/resources/guides/open-enrollment-communication-plan-templates" class="resource-card-link">Free Download</a>',
              '<a href="/resources/guides/definitive-guide-to-performance-management" class="resource-card-link">Free Download</a>',
              '<a href="/resources/guides/construction-employee-retention" class="resource-card-link">Free Download</a>',
              '<a href="/resources/guides/year-in-review-2023" class="resource-card-link">Read the Guide</a>',
              '<a href="/resources/guides/year-in-review-2023-c" class="resource-card-link">Read the Guide</a>',
              '<a href="/resources/guides/employee-happiness-index" class="resource-card-link">Read the Report</a>',
              '<a href="/resources/guides/workforce-insights-report-june" class="resource-card-link">Read the Report</a>',
              '<a href="/resources/ebooks/hr-higher-education" class="resource-card-link">Get the Guide</a>',
              '<a href="/resources/whitepapers/onboarding-survey-questions" class="resource-card-link">Download Now</a>',
              '<a href="/resources/ebooks/performance-scorecard" class="resource-card-link">Get the Template</a>',
              '<a href="/resources/ebooks/job-offer-letter-templates" class="resource-card-link">Get the Templates</a>',
              '<a href="/resources/guides/open-enrollment-survival-kit" class="resource-card-link">Get the Survival Kit</a>',
              '<a href="/resources/ebooks/best-of-ai" class="resource-card-link">Get the Learning Kit</a>',
              '<a href="/resources/ebooks/best-of-company-culture" class="resource-card-link">Get the Bundle</a>',
              '<a href="/resources/ebooks/best-of-performance-management" class="resource-card-link">Get the Bundle</a>',
              '<a href="/resources/ebooks/best-of-compensation" class="resource-card-link">Get the Bundle</a>',
              '<a href="/resources/ebooks/easier-culture-halloween" class="resource-card-link">Get the Bundle</a>',
              "<a href=\"/resources/ebooks/hr-software-shopping-bundle\" class=\"resource-card-link\">Get the HRIS Buyer's Kit</a>",
              '<a href="/resources/ebooks/tax-season-survival-kit" class="resource-card-link">Get the Kit</a>',
              '<a href="/resources/ebooks/small-business-bundle" class="resource-card-link">Get the Bundle</a>',
              '<a href="/resources/ebooks/panu-puikkonen" class="resource-card-link">Watch Now</a>',
              '<a href="/resources/ebooks/adam-bird-malin-freiman-moezzi" class="resource-card-link">Watch Now</a>',
              '<a href="/resources/ebooks/bridgett-mcgowen" class="resource-card-link">Watch Now</a>',
              '<a href="/resources/ebooks/jordan-greenstreet-megan-baker" class="resource-card-link">Watch Now</a>',
              '<a href="/resources/ebooks/nick-scholz" class="resource-card-link">Watch Now</a>',
              '<a href="/resources/ebooks/kenny-latimer" class="resource-card-link">Watch Now</a>',
              '<a href="/resources/ebooks/corey-ann-seldon" class="resource-card-link">Watch Now</a>',
              '<a href="/resources/data-at-work/data-stories/2023-data-privacy" class="resource-card-link">Read the Report</a>',
              '<a href="/resources/data-at-work/data-stories/2023-hiring-trends" class="resource-card-link">Read the Guide</a>',
              '<a href="/resources/data-at-work/data-stories/2024-return-to-office" class="resource-card-link">Read the Report</a>',
              '<a href="/resources/data-at-work/data-stories/2023-sick-guilt" class="resource-card-link">Read the Guide</a>',
              '<a href="/resources/data-at-work/data-stories/2023-human-resource-leadership" class="resource-card-link">Read the Guide</a>',
              '<a href="/resources/data-at-work/employee-happiness-index/q3-2023-employee-happiness-erodes" class="resource-card-link">Read the Report</a>',
              '<a href="/resources/data-at-work/employee-happiness-index/q2-2023-the-great-gloom" class="resource-card-link">Read the Report</a>',
              '<a href="/resources/data-at-work/employee-happiness-index/q4-2023-why-is-everyone-so-unhappy" class="resource-card-link">Read the Report</a>',
              '<a href="/resources/data-at-work/workforce-insights/mar-2024" class="resource-card-link">Read the Report</a>',
              '<a href="/resources/data-at-work/workforce-insights/apr-2024" class="resource-card-link">Read the Report</a>',
              '<a href="/resources/data-at-work/workforce-insights/jun-2024" class="resource-card-link">Read the Report</a>',
              '<a href="/resources/data-at-work/workforce-insights/may-2024" class="resource-card-link">Read the Report</a>',
              '<a href="/resources/data-at-work/data-stories/2023-onboarding-statistics" class="resource-card-link">Read the Report</a>',
              '<a href="/resources/data-at-work/employee-happiness-index/q2-2024-employee-happiness-plummets" class="resource-card-link">Read the Report</a>',
              '<a href="/resources/data-at-work/workforce-insights/feb-24" class="resource-card-link">Read the Report</a>',
              '<a href="/resources/data-at-work/employee-happiness-index/q1-2024" class="resource-card-link">Read the Report</a>',
              '<a href="/resources/data-at-work/workforce-insights/jul-2024" class="resource-card-link">Read the Report</a>',
              '<a href="/resources/data-at-work/workforce-insights/aug-2024" class="resource-card-link">Read the Report</a>',
              '<a href="/resources/data-at-work/data-stories/2024-compensation-trends" class="resource-card-link">Read the Report</a>',
              '<a href="/resources/data-at-work/workforce-insights/sep-2024" class="resource-card-link">Read the Report</a>',
              '<a href="/resources/data-at-work/employee-happiness-index/q3-2024-employee-happiness-rebounds" class="resource-card-link">Read the Report</a>',
              '<a href="/resources/data-at-work/data-stories/2025-compensation-trends" class="resource-card-link">Read the Report</a>',
              '<a href="/resources/data-at-work/workforce-insights/nov-2024" class="resource-card-link">Read the Report</a>',
              '<a href="/resources/data-at-work/workforce-insights/dec-2024" class="resource-card-link">Read the Report</a>',
              '<a href="/resources/data-at-work/employee-happiness-index/q4-2024-employee-happiness-survey" class="resource-card-link">Read the Report</a>',
              '<a href="/resources/data-at-work/employee-happiness-index/q4-2024-employee-satisfaction-survey" class="resource-card-link">Read the Report</a>',
              '<a href="/resources/data-at-work/workforce-insights/jan-2025" class="resource-card-link">Read the Report</a>',
              '<a href="/resources/data-at-work/workforce-insights/feb-2025" class="resource-card-link">Read the Report</a>',
              '<a href="/resources/data-at-work/workforce-insights/mar-2025" class="resource-card-link">Read the Report</a>',
              '<a href="/resources/data-at-work/workforce-insights/apr-2025" class="resource-card-link">Read the Report</a>',
              '<a href="/resources/data-at-work/data-stories/2025-eggshell-economy" class="resource-card-link">Read the Report</a>',
              '<a href="/resources/ebooks/definitive-guide-to-internships" class="resource-card-link">Get the Guide</a>',
              '<a href="/resources/ebooks/definitive-guide-to-employee-retention" class="resource-card-link">Get the Guide</a>',
              '<a href="/resources/ebooks/peo-guide" class="resource-card-link">Get the Complete Guide to PEOs</a>',
              '<a href="/resources/ebooks/onboarding-mistakes" class="resource-card-link">Get the Guide</a>',
              '<a href="/resources/ebooks/compensation-benchmarking-2025" class="resource-card-link">Get the Benchmarking Report</a>',
              '<a href="/resources/ebooks/ai-in-hiring" class="resource-card-link">Get the Guide</a>',
              '<a href="/resources/ebooks/how-to-measure-employee-engagement" class="resource-card-link">Get the Guide</a>',
              '<a href="/resources/ebooks/chatgpt-prompts-hr" class="resource-card-link">Get the Guide</a>',
              '<a href="/resources/ebooks/hr-challenges-construction" class="resource-card-link">Get the Guide</a>',
              '<a href="/resources/ebooks/creative-ways-find-top-talent" class="resource-card-link">Get the Guide</a>',
              '<a href="/resources/ebooks/customize-bamboohr-construction" class="resource-card-link">Get the Guide</a>',
              '<a href="/resources/ebooks/easy-to-switch" class="resource-card-link">Get the Guide</a>',
              '<a href="/resources/ebooks/hr-innovator-quiz" class="resource-card-link">Take the Quiz</a>',
              '<a href="/resources/ebooks/bad-boss-index" class="resource-card-link">Get the Report</a>',
              '<a href="/resources/ebooks/hr-trends-healthcare" class="resource-card-link">Get the Guide</a>',
              '<a href="/resources/ebooks/hr-stereotypes" class="resource-card-link">Get the Guide</a>',
              '<a href="/resources/ebooks/hr-burnout" class="resource-card-link">Get the Guide</a>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          list: {
            count: 260,
            description: '<ul> and <ol> must only directly contain <li>, <script> or <template> elements',
            level: 'A',
            htmlWithIssues: [
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
              '<ul>',
            ],
            failureSummary: 'Fix all of the following:\n  List element has direct children that are not allowed: div',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/list?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
    },
    traffic: '22600',
  },
  'https://www.bamboohr.com/pl-pages/pto-tracking': {
    violations: {
      total: 15,
      critical: {
        count: 4,
        items: {
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 11,
        items: {
          'color-contrast': {
            count: 11,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="FirstName_362208" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_362208" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_362208" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<label for="Title_362208" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_362208" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_362208" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_362208" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count</label>',
              '<label for="Country_362208" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
        },
      },
    },
    traffic: '17200',
  },
  'https://www.bamboohr.com/pl-pages/human-resources': {
    violations: {
      total: 15,
      critical: {
        count: 4,
        items: {
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 11,
        items: {
          'color-contrast': {
            count: 11,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="FirstName_273762" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_273762" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_273762" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<label for="Title_273762" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_273762" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_273762" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_273762" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count</label>',
              '<label for="Country_273762" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
        },
      },
    },
    traffic: '16700',
  },
  'https://www.bamboohr.com/booking/live-demo-success': {
    violations: {
      total: 4,
      critical: {
        count: 4,
        items: {
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 0,
        items: {},
      },
    },
    traffic: '16900',
  },
  'https://www.bamboohr.com/pl-pages/hrm': {
    violations: {
      total: 15,
      critical: {
        count: 4,
        items: {
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 11,
        items: {
          'color-contrast': {
            count: 11,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="FirstName_108616" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_108616" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_108616" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<label for="Title_108616" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_108616" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_108616" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_108616" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count</label>',
              '<label for="Country_108616" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
        },
      },
    },
    traffic: '16900',
  },
  'https://www.bamboohr.com/pl/onboarding-checklist-a2': {
    violations: {
      total: 14,
      critical: {
        count: 3,
        items: {
          'aria-allowed-attr': {
            count: 3,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
        },
      },
      serious: {
        count: 11,
        items: {
          'color-contrast': {
            count: 11,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="FirstName_151306" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_151306" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_151306" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<label for="Title_151306" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_151306" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_151306" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_151306" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count </label>',
              '<label for="Country_151306" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
        },
      },
    },
    traffic: '19660',
  },
  'https://www.bamboohr.com/unsubscribe/success': {
    violations: {
      total: 7,
      critical: {
        count: 4,
        items: {
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 3,
        items: {
          'color-contrast': {
            count: 3,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
        },
      },
    },
    traffic: '13300',
  },
  'https://www.bamboohr.com/pl-pages/performance-management': {
    violations: {
      total: 15,
      critical: {
        count: 4,
        items: {
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 11,
        items: {
          'color-contrast': {
            count: 11,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="FirstName_327465" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_327465" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_327465" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<label for="Title_327465" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_327465" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_327465" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_327465" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count</label>',
              '<label for="Country_327465" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
        },
      },
    },
    traffic: '13900',
  },
  'https://www.bamboohr.com/pl-pages/separation-letters-guide': {
    violations: {
      total: 18,
      critical: {
        count: 7,
        items: {
          'aria-allowed-attr': {
            count: 3,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 11,
        items: {
          'color-contrast': {
            count: 11,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="FirstName_504902" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_504902" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_504902" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<label for="Title_504902" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_504902" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_504902" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_504902" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count </label>',
              '<label for="Country_504902" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
        },
      },
    },
    traffic: '15100',
  },
  'https://www.bamboohr.com/resources/data-at-work/employee-happiness-index/q4-2024-employee-satisfaction-survey': {
    violations: {
      total: 11,
      critical: {
        count: 8,
        items: {
          'aria-allowed-attr': {
            count: 4,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="toc-title" aria-selected="false">Table of Contents</div>',
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-selected="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 3,
        items: {
          'color-contrast': {
            count: 3,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
        },
      },
    },
    traffic: '13100',
  },
  'https://www.bamboohr.com/pl-pages/competitors/hibob': {
    violations: {
      total: 28,
      critical: {
        count: 9,
        items: {
          'aria-allowed-attr': {
            count: 5,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 19,
        items: {
          'color-contrast': {
            count: 19,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="FirstName_348951" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_348951" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_348951" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<label for="Title_348951" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_348951" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_348951" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_348951" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count</label>',
              '<label for="Country_348951" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
              '<h5 id="hiring">Hiring</h5>',
              '<h5 id="all-in-one-platform">All-in-One Platform</h5>',
              '<h5 id="customer-support">Customer Support</h5>',
              '<h5 id="scaling">Scaling</h5>',
              '<h5 id="employee-experience">Employee Experience</h5>',
              '<strong>Performance Management:</strong>',
              '<strong>Employee Satisfaction:</strong>',
              '<strong>Employee Wellbeing:</strong>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
        },
      },
    },
    traffic: '14300',
  },
  'https://www.bamboohr.com/pl/payroll-software-c': {
    violations: {
      total: 15,
      critical: {
        count: 4,
        items: {
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 11,
        items: {
          'color-contrast': {
            count: 11,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="FirstName_858342" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_858342" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_858342" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<label for="Title_858342" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_858342" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_858342" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_858342" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count</label>',
              '<label for="Country_858342" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
        },
      },
    },
    traffic: '11900',
  },
  'https://www.bamboohr.com/integrations/request-information': {
    violations: {
      total: 7,
      critical: {
        count: 6,
        items: {
          'aria-allowed-attr': {
            count: 2,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="nav-section has-sub-menu" am-region="Categories" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Feature Comparisons" aria-expanded="false">',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 1,
        items: {
          'color-contrast': {
            count: 1,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/integrations/">Marketplace</a>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.35 (foreground color: #599d15, background color: #ffffff, font size: 12.8pt (17px), font weight: normal). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
        },
      },
    },
    traffic: '11900',
  },
  'https://www.bamboohr.com/pl/onboarding-checklist-a1': {
    violations: {
      total: 18,
      critical: {
        count: 7,
        items: {
          'aria-allowed-attr': {
            count: 3,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 11,
        items: {
          'color-contrast': {
            count: 11,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="FirstName_989038" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_989038" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_989038" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<label for="Title_989038" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_989038" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_989038" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_989038" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count </label>',
              '<label for="Country_989038" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
        },
      },
    },
    traffic: '12640',
  },
  'https://www.bamboohr.com/resources/ebooks/how-to-measure-employee-engagement': {
    violations: {
      total: 15,
      critical: {
        count: 4,
        items: {
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 11,
        items: {
          'color-contrast': {
            count: 11,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="FirstName_16980" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_16980" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_16980" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<label for="Title_16980" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_16980" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_16980" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_16980" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count </label>',
              '<label for="Country_16980" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
        },
      },
    },
    traffic: '12000',
  },
  'https://www.bamboohr.com/resources/ebooks/the-definitive-guide-to-onboarding-k1': {
    violations: {
      total: 15,
      critical: {
        count: 4,
        items: {
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 11,
        items: {
          'color-contrast': {
            count: 11,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="FirstName_82870" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_82870" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_82870" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<label for="Title_82870" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_82870" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_82870" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_82870" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count </label>',
              '<label for="Country_82870" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
        },
      },
    },
    traffic: '13100',
  },
  'https://www.bamboohr.com/pl-pages/employee-vacation-tracking': {
    violations: {
      total: 15,
      critical: {
        count: 4,
        items: {
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 11,
        items: {
          'color-contrast': {
            count: 11,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="FirstName_755373" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_755373" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_755373" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<label for="Title_755373" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_755373" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_755373" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_755373" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count</label>',
              '<label for="Country_755373" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
        },
      },
    },
    traffic: '11600',
  },
  'https://www.bamboohr.com/pl-pages/bamboohr-software-basics-b1': {
    violations: {
      total: 15,
      critical: {
        count: 4,
        items: {
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 11,
        items: {
          'color-contrast': {
            count: 11,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="FirstName_820473" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_820473" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_820473" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<label for="Title_820473" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_820473" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_820473" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_820473" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count</label>',
              '<label for="Country_820473" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
        },
      },
    },
    traffic: '11500',
  },
  'https://www.bamboohr.com/resources/hr-glossary/generation-y': {
    violations: {
      total: 8,
      critical: {
        count: 5,
        items: {
          'aria-allowed-attr': {
            count: 1,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="toc-title" aria-selected="false">Table of Contents</div>',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-selected="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 3,
        items: {
          'color-contrast': {
            count: 3,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
        },
      },
    },
    traffic: '11800',
  },
  'https://www.bamboohr.com/hr-software/payroll': {
    violations: {
      total: 19,
      critical: {
        count: 14,
        items: {
          'aria-allowed-attr': {
            count: 10,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div data-align="center" class="card" aria-expanded="false">',
              '<div data-align="center" class="card" aria-expanded="false">',
              '<div data-align="center" class="card" aria-expanded="false">',
              '<div data-align="center" class="card" aria-expanded="false">',
              '<div class="accordion" aria-selected="true">',
              '<h2 id="how-does-bamboohr-payroll-handle-benefits-and-deductions" class="tabs-title" aria-selected="true">How does BambooHR Payroll handle benefits and deductions?</h2>',
              '<h2 id="can-i-pay-1099-contractors-via-bamboohr" class="tabs-title" aria-selected="false">Can I pay 1099 contractors via BambooHR?</h2>',
              '<h2 id="how-do-my-employees-receive-their-pay-stubs" class="tabs-title" aria-selected="false">How do my employees receive their pay stubs?</h2>',
              '<h2 id="what-kind-of-payroll-reporting-capabilities-does-bamboohr-have" class="tabs-title" aria-selected="false">What kind of payroll reporting capabilities does BambooHR have?</h2>',
              '<h2 id="how-is-our-sensitive-data-kept-secure-and-private" class="tabs-title" aria-selected="false">How is our sensitive data kept secure and private?</h2>',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 5,
        items: {
          'color-contrast': {
            count: 4,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<a href="https://www.bamboohr.com/integrations/" title="See All Integrations" class="button accent">See All Integrations</a>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          list: {
            count: 1,
            description: '<ul> and <ol> must only directly contain <li>, <script> or <template> elements',
            level: 'A',
            htmlWithIssues: [
              '<ul class="listing-cards-results media">',
            ],
            failureSummary: 'Fix all of the following:\n  List element has direct children that are not allowed: div',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/list?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
    },
    traffic: '11800',
  },
  'https://www.bamboohr.com/compare-plans/activate/core': {
    violations: {
      total: 35,
      critical: {
        count: 29,
        items: {
          'aria-allowed-attr': {
            count: 25,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="accordion" aria-selected="true">',
              '<h2 id="ai-powered-assistance" class="tabs-title" aria-selected="true">AI-Powered Assistance</h2>',
              '<h2 id="improved-hiring-efficiency" class="tabs-title" aria-selected="false">Improved Hiring Efficiency</h2>',
              '<h2 id="stronger-employee-retention" class="tabs-title" aria-selected="false">Stronger Employee Retention</h2>',
              '<h2 id="new-customization-options" class="tabs-title" aria-selected="false">New Customization Options</h2>',
              '<h2 id="instant-ai-topic-summaries" class="tabs-title" aria-selected="false">Instant AI Topic Summaries</h2>',
              '<div class="accordion" aria-selected="true">',
              '<h2 id="why-are-you-retiring-the-essentials-and-advantage-plans" class="tabs-title" aria-selected="true">Why are you retiring the Essentials and Advantage plans?</h2>',
              '<h2 id="are-there-options-for-remaining-on-essentials-or-advantage" class="tabs-title" aria-selected="false">Are there options for remaining on Essentials or Advantage?</h2>',
              '<h2 id="when-will-this-change-take-effect" class="tabs-title" aria-selected="false">When will this change take effect?</h2>',
              '<h2 id="will-there-be-any-disruption-in-the-system-when-the-transition-is-made" class="tabs-title" aria-selected="false">Will there be any disruption in the system when the transition is made?</h2>',
              '<h2 id="can-i-upgrade-to-my-new-plan-early" class="tabs-title" aria-selected="false">Can I upgrade to my new plan early?</h2>',
              '<h2 id="how-will-this-migration-impact-me-or-my-account" class="tabs-title" aria-selected="false">How will this migration impact me or my account?</h2>',
              '<h2 id="what-resources-are-available-to-set-up-my-new-features" class="tabs-title" aria-selected="false">What resources are available to set up my new features?</h2>',
              '<h2 id="was-i-notified-of-this-change-when-and-how" class="tabs-title" aria-selected="false">Was I notified of this change? When and how?</h2>',
              '<h2 id="what-new-features-or-benefits-are-included-in-the-core-plan" class="tabs-title" aria-selected="false">What new features or benefits are included in the Core Plan?</h2>',
              '<h2 id="what-new-features-or-benefits-are-included-in-the-pro-plan" class="tabs-title" aria-selected="false">What new features or benefits are included in the Pro Plan?</h2>',
              '<h2 id="how-can-i-find-out-what-my-current-plan-and-price-are" class="tabs-title" aria-selected="false">How can I find out what my current plan and price are?</h2>',
              '<h2 id="how-does-this-affect-my-current-contract-with-bamboohr" class="tabs-title" aria-selected="false">How does this affect my current contract with BambooHR?</h2>',
              '<h2 id="how-will-this-impact-my-prepaid-account" class="tabs-title" aria-selected="false">How will this impact my prepaid account?</h2>',
              '<h2 id="how-will-this-impact-my-nonprofit-discount" class="tabs-title" aria-selected="false">How will this impact my nonprofit discount?</h2>',
              '<h2 id="how-will-this-impact-my-related-entities-parentchild-discount" class="tabs-title" aria-selected="false">How will this impact my related entities (parent/child) discount?</h2>',
              '<h2 id="can-you-give-me-more-details-about-the-bundle-discount" class="tabs-title" aria-selected="false">Can you give me more details about the bundle discount?</h2>',
              '<h2 id="where-can-i-learn-more-about-the-bamboohr-subscription-adjustment-and-pricing-policies" class="tabs-title" aria-selected="false">Where can I learn more about the BambooHR subscription adjustment and pricing policies?</h2>',
              '<h2 id="who-do-i-contact-if-i-have-additional-questions" class="tabs-title" aria-selected="false">Who do I contact if I have additional questions?</h2>',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-selected="true"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 6,
        items: {
          'color-contrast': {
            count: 6,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<strong>Core</strong>',
              '<p>Your New Plan</p>',
              '<a href="https://help.bamboohr.com/s/article/1177289#upgrading-to-the-core-package" title="Learn More" class="button accent" rel="noopener" target="_blank">Learn More</a>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
        },
      },
    },
    traffic: '11700',
  },
  'https://www.bamboohr.com/pl/payroll-checklist': {
    violations: {
      total: 18,
      critical: {
        count: 7,
        items: {
          'aria-allowed-attr': {
            count: 3,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 11,
        items: {
          'color-contrast': {
            count: 11,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="FirstName_659047" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_659047" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_659047" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<label for="Title_659047" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_659047" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_659047" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_659047" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count </label>',
              '<label for="Country_659047" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
        },
      },
    },
    traffic: '11300',
  },
  'https://www.bamboohr.com/product-updates/': {
    violations: {
      total: 5,
      critical: {
        count: 4,
        items: {
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 1,
        items: {
          list: {
            count: 1,
            description: '<ul> and <ol> must only directly contain <li>, <script> or <template> elements',
            level: 'A',
            htmlWithIssues: [
              '<ul class="listing-results">',
            ],
            failureSummary: 'Fix all of the following:\n  List element has direct children that are not allowed: div',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/list?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
    },
    traffic: '10800',
  },
  'https://www.bamboohr.com/blog/employee-perks-incentives-ideas': {
    violations: {
      total: 9,
      critical: {
        count: 7,
        items: {
          'aria-allowed-attr': {
            count: 3,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="nav-section has-sub-menu" am-region="Categories" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Our Platform" aria-expanded="false">',
              '<div class="toc-title" aria-selected="false">Table of Contents</div>',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 2,
        items: {
          'color-contrast': {
            count: 1,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/blog/">Blog</a>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.35 (foreground color: #599d15, background color: #ffffff, font size: 12.8pt (17px), font weight: normal). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-in-text-block': {
            count: 1,
            description: 'Links must be distinguishable without relying on color',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.linkedin.com/in/mattnesmith/" rel="noopener" target="_blank">LinkedIn</a>',
            ],
            failureSummary: 'Fix any of the following:\n  The link has insufficient color contrast of 2.34:1 with the surrounding text. (Minimum contrast is 3:1, link text: #2e7918, surrounding text: #38312f)\n  The link has no styling (such as underline) to distinguish it from the surrounding text',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-in-text-block?application=playwright',
            successCriteriaTags: [
              'wcag141',
            ],
          },
        },
      },
    },
    traffic: '10300',
  },
  'https://www.bamboohr.com/resources/hr-glossary/alternative-dispute-resolution-adr': {
    violations: {
      total: 8,
      critical: {
        count: 5,
        items: {
          'aria-allowed-attr': {
            count: 1,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="toc-title" aria-selected="false">Table of Contents</div>',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-selected="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 3,
        items: {
          'color-contrast': {
            count: 3,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
        },
      },
    },
    traffic: '10200',
  },
  'https://www.bamboohr.com/hr-software/hr-platform': {
    violations: {
      total: 29,
      critical: {
        count: 26,
        items: {
          'aria-allowed-attr': {
            count: 22,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div data-align="center" class="card card-link" aria-expanded="false">',
              '<div data-align="center" class="card card-link" aria-expanded="false">',
              '<div data-align="center" class="card card-link" aria-expanded="false">',
              '<div data-align="center" class="card card-link" aria-expanded="false">',
              '<div class="card card-link" aria-expanded="false"><h4 id="hr-data--reporting" class="title"><span>HR Data &amp; Reporting</span></h4></div>',
              '<div class="card card-link" aria-expanded="false"><h4 id="payroll" class="title"><span>Payroll</span></h4></div>',
              '<div class="card card-link" aria-expanded="false"><h4 id="benefits-administration" class="title"><span>Benefits Administration</span></h4></div>',
              '<div class="card card-link" aria-expanded="false"><h4 id="time--attendance" class="title"><span>Time &amp; Attendance</span></h4></div>',
              '<div class="card card-link" aria-expanded="false"><h4 id="applicant-tracking" class="title"><span>Applicant Tracking</span></h4></div>',
              '<div class="card card-link" aria-expanded="false"><h4 id="onboarding" class="title"><span>Onboarding</span></h4></div>',
              '<div class="card card-link" aria-expanded="false"><h4 id="performance-management" class="title"><span>Performance Management</span></h4></div>',
              '<div class="card card-link" aria-expanded="false"><h4 id="employee-experience" class="title"><span>Employee Experience</span></h4></div>',
              '<div class="accordion" aria-selected="true">',
              '<h2 id="what-makes-bamboohr-different-from-other-hr-platforms" class="tabs-title" aria-selected="true">What makes BambooHR different from other HR platforms?</h2>',
              '<h2 id="is-bamboohr-customizable-for-my-specific-business-needs" class="tabs-title" aria-selected="false">Is BambooHR customizable for my specific business needs?</h2>',
              '<h2 id="what-kind-of-support-does-bamboohr-offer-to-help-with-setup-and-onboarding" class="tabs-title" aria-selected="false">What kind of support does BambooHR offer to help with setup and onboarding?</h2>',
              '<h2 id="how-is-our-sensitive-data-kept-secure-and-private" class="tabs-title" aria-selected="false">How is our sensitive data kept secure and private?</h2>',
              '<h2 id="can-i-access-bamboohr-on-mobile-devices" class="tabs-title" aria-selected="false">Can I access BambooHR on mobile devices?</h2>',
              '<h2 id="is-bamboohr-suitable-for-companies-of-all-sizes" class="tabs-title" aria-selected="false">Is BambooHR suitable for companies of all sizes?</h2>',
              '<h2 id="what-kind-of-reporting-capabilities-does-bamboohr-provide" class="tabs-title" aria-selected="false">What kind of reporting capabilities does BambooHR provide?</h2>',
              '<h2 id="how-does-bamboohr-help-with-compliance-and-data-tracking" class="tabs-title" aria-selected="false">How does BambooHR help with compliance and data tracking?</h2>',
              '<h2 id="can-i-try-bamboohr-before-committing-to-a-subscription" class="tabs-title" aria-selected="false">Can I try BambooHR before committing to a subscription?</h2>',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 3,
        items: {
          'color-contrast': {
            count: 3,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
        },
      },
    },
    traffic: '9900',
  },
  'https://www.bamboohr.com/integrations/listings/slack': {
    violations: {
      total: 13,
      critical: {
        count: 12,
        items: {
          'aria-allowed-attr': {
            count: 4,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="nav-section has-sub-menu" am-region="Categories" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Feature Comparisons" aria-expanded="false">',
              '<h2 id="overview" class="tabs-title" aria-selected="true">Overview</h2>',
              '<h2 id="integration" class="tabs-title" aria-selected="false">Integration</h2>',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
          'image-alt': {
            count: 4,
            description: 'Images must have alternative text',
            level: 'A',
            htmlWithIssues: [
              '<img src="/styles/integration-type.svg">',
              '<img src="/styles/data-flow-direction.svg">',
              '<img src="/styles/sync-trigger.svg">',
              '<img src="/styles/sync-frequency.svg">',
            ],
            failureSummary: "Fix any of the following:\n  Element does not have an alt attribute\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute\n  Element's default semantics were not overridden with role=\"none\" or role=\"presentation\"",
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/image-alt?application=playwright',
            successCriteriaTags: [
              'wcag111',
            ],
          },
        },
      },
      serious: {
        count: 1,
        items: {
          'color-contrast': {
            count: 1,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/integrations/">Marketplace</a>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.35 (foreground color: #599d15, background color: #ffffff, font size: 12.8pt (17px), font weight: normal). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
        },
      },
    },
    traffic: '9200',
  },
  'https://www.bamboohr.com/about-bamboohr/contact/': {
    violations: {
      total: 31,
      critical: {
        count: 17,
        items: {
          'aria-allowed-attr': {
            count: 13,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="card" aria-expanded="false">',
              '<div class="demo-card has-image card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="accordion" aria-selected="true">',
              '<h2 id="what-does-bamboohr-do" class="tabs-title" aria-selected="true">What does BambooHR do?</h2>',
              '<h2 id="does-bamboohr-do-payroll" class="tabs-title" aria-selected="false">Does BambooHR do payroll?</h2>',
              '<h2 id="how-much-does-bamboohr-cost" class="tabs-title" aria-selected="false">How much does BambooHR cost?</h2>',
              '<h2 id="how-many-countries-is-bamboohr-in" class="tabs-title" aria-selected="false">How many countries is BambooHR in?</h2>',
              '<h2 id="is-your-support-team-outsourced" class="tabs-title" aria-selected="false">Is your support team outsourced?</h2>',
              '<h2 id="is-bamboohr-a-peo" class="tabs-title" aria-selected="false">Is BambooHR a PEO?</h2>',
              "<h2 id=\"wheres-my-data-housed-how-secure-is-bamboohr\" class=\"tabs-title\" aria-selected=\"false\">Where's my data housed? How secure is BambooHR?</h2>",
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 14,
        items: {
          'color-contrast': {
            count: 14,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="FirstName_510694" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_510694" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_510694" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<strong>Company Name</strong>',
              '<label for="Phone_510694" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_510694" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count</label>',
              '<label for="Country_510694" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country:</label>',
              '<strong>Are you a BambooHR Customer?</strong>',
              '<strong>Subject</strong>',
              '<strong>Message</strong>',
              '<span>I authorize BambooHR to keep me informed about its products, services and events through emails and phone calls. My data will be handled according to the</span>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
        },
      },
    },
    traffic: '9800',
  },
  'https://www.bamboohr.com/pl-pages/employee-software': {
    violations: {
      total: 15,
      critical: {
        count: 4,
        items: {
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 11,
        items: {
          'color-contrast': {
            count: 11,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="FirstName_688048" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_688048" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_688048" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<label for="Title_688048" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_688048" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_688048" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_688048" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count</label>',
              '<label for="Country_688048" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
        },
      },
    },
    traffic: '9700',
  },
  'https://www.bamboohr.com/customers/': {
    violations: {
      total: 8,
      critical: {
        count: 4,
        items: {
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 4,
        items: {
          'color-contrast': {
            count: 3,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          list: {
            count: 1,
            description: '<ul> and <ol> must only directly contain <li>, <script> or <template> elements',
            level: 'A',
            htmlWithIssues: [
              '<ul class="listing-cards-results article">',
            ],
            failureSummary: 'Fix all of the following:\n  List element has direct children that are not allowed: div',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/list?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
    },
    traffic: '9600',
  },
  'https://www.bamboohr.com/hr-software/employee-database-software': {
    violations: {
      total: 16,
      critical: {
        count: 11,
        items: {
          'aria-allowed-attr': {
            count: 7,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div data-align="center" class="card" aria-expanded="false">',
              '<div data-align="center" class="card" aria-expanded="false">',
              '<div data-align="center" class="card" aria-expanded="false">',
              '<div class="accordion" aria-selected="true">',
              '<h2 id="what-is-an-employee-self-service-portal" class="tabs-title" aria-selected="true">What is an employee self-service portal?</h2>',
              '<h2 id="how-does-ess-boost-employee-empowerment" class="tabs-title" aria-selected="false">How does ESS boost employee empowerment?</h2>',
              '<h2 id="why-is-ess-valuable-for-hr-pros" class="tabs-title" aria-selected="false">Why is ESS valuable for HR pros?</h2>',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 5,
        items: {
          'color-contrast': {
            count: 4,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<a href="https://www.bamboohr.com/integrations/" title="See All Integrations" class="button accent">See All Integrations</a>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          list: {
            count: 1,
            description: '<ul> and <ol> must only directly contain <li>, <script> or <template> elements',
            level: 'A',
            htmlWithIssues: [
              '<ul class="listing-cards-results media">',
            ],
            failureSummary: 'Fix all of the following:\n  List element has direct children that are not allowed: div',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/list?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
    },
    traffic: '9500',
  },
  'https://www.bamboohr.com/pl-pages/hr-toolkit': {
    violations: {
      total: 18,
      critical: {
        count: 7,
        items: {
          'aria-allowed-attr': {
            count: 3,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 11,
        items: {
          'color-contrast': {
            count: 11,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="FirstName_753654" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_753654" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_753654" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<label for="Title_753654" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_753654" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_753654" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_753654" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count </label>',
              '<label for="Country_753654" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
        },
      },
    },
    traffic: '9100',
  },
  'https://www.bamboohr.com/hr-software/employee-self-onboarding': {
    violations: {
      total: 13,
      critical: {
        count: 8,
        items: {
          'aria-allowed-attr': {
            count: 8,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div data-align="center" class="card" aria-expanded="false">',
              '<div data-align="center" class="card" aria-expanded="false">',
              '<div data-align="center" class="card" aria-expanded="false">',
              '<div data-align="center" class="card" aria-expanded="false">',
              '<div class="accordion" aria-selected="true">',
              '<h2 id="why-is-onboarding-important" class="tabs-title" aria-selected="true">Why is onboarding important?</h2>',
              '<h2 id="how-does-self-onboarding-work" class="tabs-title" aria-selected="false">How does self-onboarding work?</h2>',
              '<h2 id="is-onboarding-software-necessary-for-my-company" class="tabs-title" aria-selected="false">Is onboarding software necessary for my company?</h2>',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
        },
      },
      serious: {
        count: 5,
        items: {
          'color-contrast': {
            count: 4,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<a href="https://www.bamboohr.com/integrations/" title="See All 150+ Integrations" class="button accent">See All 150+ Integrations</a>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          list: {
            count: 1,
            description: '<ul> and <ol> must only directly contain <li>, <script> or <template> elements',
            level: 'A',
            htmlWithIssues: [
              '<ul class="listing-cards-results media">',
            ],
            failureSummary: 'Fix all of the following:\n  List element has direct children that are not allowed: div',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/list?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
    },
    traffic: '9000',
  },
  'https://www.bamboohr.com/hr-software/applicant-tracking': {
    violations: {
      total: 12,
      critical: {
        count: 7,
        items: {
          'aria-allowed-attr': {
            count: 7,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div data-align="center" class="card" aria-expanded="false">',
              '<div data-align="center" class="card" aria-expanded="false">',
              '<div data-align="center" class="card" aria-expanded="false">',
              '<div data-align="center" class="card" aria-expanded="false">',
              '<div class="accordion" aria-selected="true">',
              '<h2 id="can-i-hire-using-the-bamboohr-mobile-app" class="tabs-title" aria-selected="true">Can I hire using the BambooHR® Mobile app?</h2>',
              '<h2 id="what-happens-when-someone-accepts-my-offer-letter" class="tabs-title" aria-selected="false">What happens when someone accepts my offer letter?</h2>',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
        },
      },
      serious: {
        count: 5,
        items: {
          'color-contrast': {
            count: 4,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<a href="https://www.bamboohr.com/integrations/" title="See All 150+ Integrations" class="button accent">See All 150+ Integrations</a>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          list: {
            count: 1,
            description: '<ul> and <ol> must only directly contain <li>, <script> or <template> elements',
            level: 'A',
            htmlWithIssues: [
              '<ul class="listing-cards-results media">',
            ],
            failureSummary: 'Fix all of the following:\n  List element has direct children that are not allowed: div',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/list?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
    },
    traffic: '9100',
  },
  'https://www.bamboohr.com/resources/hr-glossary/qualifying-life-event': {
    violations: {
      total: 9,
      critical: {
        count: 6,
        items: {
          'aria-allowed-attr': {
            count: 2,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="toc-title" aria-selected="false">Table of Contents</div>',
              '<div class="toc-title" aria-selected="false">Table of Contents</div>',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-selected="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 3,
        items: {
          'color-contrast': {
            count: 3,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
        },
      },
    },
    traffic: '9200',
  },
  'https://www.bamboohr.com/blog/furloughs-vs-layoffs': {
    violations: {
      total: 9,
      critical: {
        count: 7,
        items: {
          'aria-allowed-attr': {
            count: 3,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="nav-section has-sub-menu" am-region="Categories" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Our Platform" aria-expanded="false">',
              '<div class="toc-title" aria-selected="false">Table of Contents</div>',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 2,
        items: {
          'color-contrast': {
            count: 1,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/blog/">Blog</a>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.35 (foreground color: #599d15, background color: #ffffff, font size: 12.8pt (17px), font weight: normal). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-in-text-block': {
            count: 1,
            description: 'Links must be distinguishable without relying on color',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.linkedin.com/in/mattnesmith/" rel="noopener" target="_blank">LinkedIn</a>',
            ],
            failureSummary: 'Fix any of the following:\n  The link has insufficient color contrast of 2.34:1 with the surrounding text. (Minimum contrast is 3:1, link text: #2e7918, surrounding text: #38312f)\n  The link has no styling (such as underline) to distinguish it from the surrounding text',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-in-text-block?application=playwright',
            successCriteriaTags: [
              'wcag141',
            ],
          },
        },
      },
    },
    traffic: '9200',
  },
  'https://www.bamboohr.com/pl-pages/competitors/gusto': {
    violations: {
      total: 15,
      critical: {
        count: 4,
        items: {
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 11,
        items: {
          'color-contrast': {
            count: 11,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="FirstName_772717" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_772717" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_772717" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<label for="Title_772717" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_772717" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_772717" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_772717" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count</label>',
              '<label for="Country_772717" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
        },
      },
    },
    traffic: '8400',
  },
  'https://www.bamboohr.com/legal/': {
    violations: {
      total: 17,
      critical: {
        count: 17,
        items: {
          'aria-allowed-attr': {
            count: 13,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 0,
        items: {},
      },
    },
    traffic: '8300',
  },
  'https://www.bamboohr.com/pl-pages/competitors/isolved': {
    violations: {
      total: 28,
      critical: {
        count: 9,
        items: {
          'aria-allowed-attr': {
            count: 5,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 19,
        items: {
          'color-contrast': {
            count: 19,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="FirstName_806358" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_806358" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_806358" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<label for="Title_806358" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_806358" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_806358" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_806358" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count</label>',
              '<label for="Country_806358" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
              '<h5 id="hiring">Hiring</h5>',
              '<h5 id="all-in-one-platform">All-in-One Platform</h5>',
              '<h5 id="customer-support">Customer Support</h5>',
              '<h5 id="scaling">Scaling</h5>',
              '<h5 id="employee-experience">Employee Experience</h5>',
              '<strong>Performance Management:</strong>',
              '<strong>Employee Satisfaction:</strong>',
              '<strong>Employee Wellbeing:</strong>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
        },
      },
    },
    traffic: '8200',
  },
  'https://www.bamboohr.com/resources/hr-glossary/generation-x': {
    violations: {
      total: 8,
      critical: {
        count: 5,
        items: {
          'aria-allowed-attr': {
            count: 1,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="toc-title" aria-selected="false">Table of Contents</div>',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-selected="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 3,
        items: {
          'color-contrast': {
            count: 3,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
        },
      },
    },
    traffic: '8400',
  },
  'https://www.bamboohr.com/blog/the-best-questions-to-ask-in-performance-reviews': {
    violations: {
      total: 9,
      critical: {
        count: 7,
        items: {
          'aria-allowed-attr': {
            count: 3,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="nav-section has-sub-menu" am-region="Categories" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Our Platform" aria-expanded="false">',
              '<div class="toc-title" aria-selected="false">Table of Contents</div>',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 2,
        items: {
          'color-contrast': {
            count: 1,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/blog/">Blog</a>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.35 (foreground color: #599d15, background color: #ffffff, font size: 12.8pt (17px), font weight: normal). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-in-text-block': {
            count: 1,
            description: 'Links must be distinguishable without relying on color',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.linkedin.com/in/mattnesmith/" rel="noopener" target="_blank">LinkedIn</a>',
            ],
            failureSummary: 'Fix any of the following:\n  The link has insufficient color contrast of 2.34:1 with the surrounding text. (Minimum contrast is 3:1, link text: #2e7918, surrounding text: #38312f)\n  The link has no styling (such as underline) to distinguish it from the surrounding text',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-in-text-block?application=playwright',
            successCriteriaTags: [
              'wcag141',
            ],
          },
        },
      },
    },
    traffic: '9000',
  },
  'https://www.bamboohr.com/pl-pages/timesheets': {
    violations: {
      total: 15,
      critical: {
        count: 4,
        items: {
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 11,
        items: {
          'color-contrast': {
            count: 11,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="FirstName_320203" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_320203" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_320203" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<label for="Title_320203" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_320203" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_320203" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_320203" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count</label>',
              '<label for="Country_320203" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
        },
      },
    },
    traffic: '8000',
  },
  'https://www.bamboohr.com/why-bamboohr/': {
    violations: {
      total: 7,
      critical: {
        count: 4,
        items: {
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 3,
        items: {
          'color-contrast': {
            count: 3,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
        },
      },
    },
    traffic: '7500',
  },
  'https://www.bamboohr.com/pl-pages/applicant-tracking-system': {
    violations: {
      total: 15,
      critical: {
        count: 4,
        items: {
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 11,
        items: {
          'color-contrast': {
            count: 11,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="FirstName_186560" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_186560" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_186560" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<label for="Title_186560" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_186560" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_186560" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_186560" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count</label>',
              '<label for="Country_186560" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
        },
      },
    },
    traffic: '8040',
  },
  'https://www.bamboohr.com/resources/hr-glossary/147c': {
    violations: {
      total: 8,
      critical: {
        count: 5,
        items: {
          'aria-allowed-attr': {
            count: 1,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="toc-title" aria-selected="false">Table of Contents</div>',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-selected="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 3,
        items: {
          'color-contrast': {
            count: 3,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
        },
      },
    },
    traffic: '8000',
  },
  'https://www.bamboohr.com/blog/internal-job-interview-questions': {
    violations: {
      total: 9,
      critical: {
        count: 7,
        items: {
          'aria-allowed-attr': {
            count: 3,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="nav-section has-sub-menu" am-region="Categories" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Our Platform" aria-expanded="false">',
              '<div class="toc-title" aria-selected="false">Table of Contents</div>',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 2,
        items: {
          'color-contrast': {
            count: 1,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/blog/">Blog</a>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.35 (foreground color: #599d15, background color: #ffffff, font size: 12.8pt (17px), font weight: normal). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-in-text-block': {
            count: 1,
            description: 'Links must be distinguishable without relying on color',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.linkedin.com/in/mattnesmith/" rel="noopener" target="_blank">LinkedIn</a>',
            ],
            failureSummary: 'Fix any of the following:\n  The link has insufficient color contrast of 2.34:1 with the surrounding text. (Minimum contrast is 3:1, link text: #2e7918, surrounding text: #38312f)\n  The link has no styling (such as underline) to distinguish it from the surrounding text',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-in-text-block?application=playwright',
            successCriteriaTags: [
              'wcag141',
            ],
          },
        },
      },
    },
    traffic: '7600',
  },
  'https://www.bamboohr.com/pl/interview-scorecard-template': {
    violations: {
      total: 15,
      critical: {
        count: 4,
        items: {
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 11,
        items: {
          'color-contrast': {
            count: 11,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="FirstName_237738" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_237738" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_237738" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<label for="Title_237738" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_237738" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_237738" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_237738" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count </label>',
              '<label for="Country_237738" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
        },
      },
    },
    traffic: '6800',
  },
  'https://www.bamboohr.com/pl-pages/recruitment': {
    violations: {
      total: 15,
      critical: {
        count: 4,
        items: {
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 11,
        items: {
          'color-contrast': {
            count: 11,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="FirstName_341045" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_341045" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_341045" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<label for="Title_341045" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_341045" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_341045" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_341045" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count</label>',
              '<label for="Country_341045" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
        },
      },
    },
    traffic: '7500',
  },
  'https://www.bamboohr.com/pl-pages/intl-en/hr-software': {
    violations: {
      total: 15,
      critical: {
        count: 4,
        items: {
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 11,
        items: {
          'color-contrast': {
            count: 11,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="FirstName_486607" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_486607" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_486607" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<label for="Title_486607" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_486607" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_486607" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_486607" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count</label>',
              '<label for="Country_486607" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
        },
      },
    },
    traffic: '7000',
  },
  'https://www.bamboohr.com/resources/ebooks/job-offer-letter-templates': {
    violations: {
      total: 15,
      critical: {
        count: 4,
        items: {
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 11,
        items: {
          'color-contrast': {
            count: 11,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="FirstName_444094" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_444094" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_444094" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<label for="Title_444094" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_444094" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_444094" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_444094" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count </label>',
              '<label for="Country_444094" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
        },
      },
    },
    traffic: '7500',
  },
  'https://www.bamboohr.com/blog/learn-management-style': {
    violations: {
      total: 10,
      critical: {
        count: 8,
        items: {
          'aria-allowed-attr': {
            count: 3,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="nav-section has-sub-menu" am-region="Categories" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Our Platform" aria-expanded="false">',
              '<div class="toc-title" aria-selected="false">Table of Contents</div>',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
          'button-name': {
            count: 1,
            description: 'Buttons must have discernible text',
            level: 'A',
            htmlWithIssues: [
              '<button class="prev"><svg width="36" height="36" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M20.25 7.5L30.75 18L20.25 28.5M5.25 18L30 18" stroke="black" stroke-width="3"></path></svg></button>',
            ],
            failureSummary: "Fix any of the following:\n  Element does not have inner text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute\n  Element does not have an implicit (wrapped) <label>\n  Element does not have an explicit <label>\n  Element's default semantics were not overridden with role=\"none\" or role=\"presentation\"",
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/button-name?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
        },
      },
      serious: {
        count: 2,
        items: {
          'color-contrast': {
            count: 1,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/blog/">Blog</a>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.35 (foreground color: #599d15, background color: #ffffff, font size: 12.8pt (17px), font weight: normal). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-in-text-block': {
            count: 1,
            description: 'Links must be distinguishable without relying on color',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.linkedin.com/in/erika-shaughnessy/" rel="noopener" target="_blank">LinkedIn</a>',
            ],
            failureSummary: 'Fix any of the following:\n  The link has insufficient color contrast of 2.34:1 with the surrounding text. (Minimum contrast is 3:1, link text: #2e7918, surrounding text: #38312f)\n  The link has no styling (such as underline) to distinguish it from the surrounding text',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-in-text-block?application=playwright',
            successCriteriaTags: [
              'wcag141',
            ],
          },
        },
      },
    },
    traffic: '7120',
  },
  'https://www.bamboohr.com/pl-pages/competitors/goco': {
    violations: {
      total: 15,
      critical: {
        count: 4,
        items: {
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 11,
        items: {
          'color-contrast': {
            count: 11,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="FirstName_585023" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_585023" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_585023" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<label for="Title_585023" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_585023" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_585023" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_585023" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count</label>',
              '<label for="Country_585023" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
        },
      },
    },
    traffic: '6600',
  },
  'https://www.bamboohr.com/pl-pages/employee-database': {
    violations: {
      total: 15,
      critical: {
        count: 4,
        items: {
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 11,
        items: {
          'color-contrast': {
            count: 11,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="FirstName_626447" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_626447" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_626447" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<label for="Title_626447" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_626447" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_626447" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_626447" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count</label>',
              '<label for="Country_626447" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
        },
      },
    },
    traffic: '6300',
  },
  'https://www.bamboohr.com/hr-software/payroll-software': {
    violations: {
      total: 19,
      critical: {
        count: 14,
        items: {
          'aria-allowed-attr': {
            count: 10,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div data-align="center" class="card" aria-expanded="false">',
              '<div data-align="center" class="card" aria-expanded="false">',
              '<div data-align="center" class="card" aria-expanded="false">',
              '<div data-align="center" class="card" aria-expanded="false">',
              '<div class="accordion" aria-selected="true">',
              '<h2 id="how-does-bamboohr-payroll-handle-benefits-and-deductions" class="tabs-title" aria-selected="true">How does BambooHR Payroll handle benefits and deductions?</h2>',
              '<h2 id="can-i-pay-1099-contractors-via-bamboohr" class="tabs-title" aria-selected="false">Can I pay 1099 contractors via BambooHR?</h2>',
              '<h2 id="how-do-my-employees-receive-their-pay-stubs" class="tabs-title" aria-selected="false">How do my employees receive their pay stubs?</h2>',
              '<h2 id="what-kind-of-payroll-reporting-capabilities-does-bamboohr-have" class="tabs-title" aria-selected="false">What kind of payroll reporting capabilities does BambooHR have?</h2>',
              '<h2 id="how-is-our-sensitive-data-kept-secure-and-private" class="tabs-title" aria-selected="false">How is our sensitive data kept secure and private?</h2>',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 5,
        items: {
          'color-contrast': {
            count: 4,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<a href="https://www.bamboohr.com/integrations/" title="See All Integrations" class="button accent">See All Integrations</a>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          list: {
            count: 1,
            description: '<ul> and <ol> must only directly contain <li>, <script> or <template> elements',
            level: 'A',
            htmlWithIssues: [
              '<ul class="listing-cards-results media">',
            ],
            failureSummary: 'Fix all of the following:\n  List element has direct children that are not allowed: div',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/list?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
    },
    traffic: '6600',
  },
  'https://www.bamboohr.com/pl-pages/human-resource-management': {
    violations: {
      total: 15,
      critical: {
        count: 4,
        items: {
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 11,
        items: {
          'color-contrast': {
            count: 11,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="FirstName_280085" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_280085" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_280085" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<label for="Title_280085" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_280085" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_280085" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_280085" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count</label>',
              '<label for="Country_280085" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
        },
      },
    },
    traffic: '6300',
  },
  'https://www.bamboohr.com/resources/guides/the-definitive-guide-to-onboarding': {
    violations: {
      total: 20,
      critical: {
        count: 17,
        items: {
          'aria-allowed-attr': {
            count: 13,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="nav-section has-sub-menu" am-region="Our Platform" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Solutions" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Why BambooHR" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Resources" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="About" aria-expanded="false">',
              '<div class="toc-title" aria-selected="false">Table of Contents</div>',
              '<div class="accordion" aria-selected="true">',
              '<h2 id="who-should-be-involved-in-employee-onboarding" class="tabs-title" aria-selected="true">Who should be involved in employee onboarding?</h2>',
              '<h2 id="can-you-start-onboarding-before-the-employees-first-day" class="tabs-title" aria-selected="false">Can you start onboarding before the employee’s first day?</h2>',
              '<h2 id="how-do-you-develop-an-onboarding-process-for-the-first-time" class="tabs-title" aria-selected="false">How do you develop an onboarding process for the first time?</h2>',
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
              '<div class="card" aria-expanded="false">',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 3,
        items: {
          'color-contrast': {
            count: 3,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
        },
      },
    },
    traffic: '6700',
  },
  'https://www.bamboohr.com/pl-pages/intl-en/onboarding': {
    violations: {
      total: 15,
      critical: {
        count: 4,
        items: {
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 11,
        items: {
          'color-contrast': {
            count: 11,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="FirstName_622777" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_622777" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_622777" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<label for="Title_622777" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_622777" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_622777" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_622777" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count</label>',
              '<label for="Country_622777" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
        },
      },
    },
    traffic: '6200',
  },
  'https://www.bamboohr.com/pl-pages/employee-time-clock': {
    violations: {
      total: 15,
      critical: {
        count: 4,
        items: {
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 11,
        items: {
          'color-contrast': {
            count: 11,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="FirstName_714134" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_714134" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_714134" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<label for="Title_714134" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_714134" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_714134" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_714134" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count</label>',
              '<label for="Country_714134" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
        },
      },
    },
    traffic: '6000',
  },
  'https://www.bamboohr.com/pl-pages/human-resources-software': {
    violations: {
      total: 15,
      critical: {
        count: 4,
        items: {
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 11,
        items: {
          'color-contrast': {
            count: 11,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<strong>Spring Promotion: 50% off payroll implementation!</strong>',
              '<span class="eyelash-main-text">Limited Time</span>',
              '<a class="caret-link" href="#" role="button">Details</a>',
              '<label for="FirstName_341548" id="LblFirstName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>First Name</label>',
              '<label for="LastName_341548" id="LblLastName" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Last Name</label>',
              '<label for="Email_341548" id="LblEmail" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Work Email</label>',
              '<label for="Title_341548" id="LblTitle" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Job Title</label>',
              '<label for="Company_341548" id="LblCompany" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Company Name</label>',
              '<label for="Phone_341548" id="LblPhone" class="mktoLabel mktoHasWidth"><div class="mktoAsterix">*</div>Phone Number</label>',
              '<label for="Employees_Text__c_341548" id="LblEmployees_Text__c" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Employee Count</label>',
              '<label for="Country_341548" id="LblCountry" class="mktoLabel mktoHasWidth active"><div class="mktoAsterix">*</div>Country</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.97 (foreground color: #ffffff, background color: #1d9336, font size: 13.5pt (18px), font weight: bold). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
        },
      },
    },
    traffic: '6200',
  },
  'https://www.bamboohr.com/blog/tips-increasing-workplace-efficiency': {
    violations: {
      total: 9,
      critical: {
        count: 7,
        items: {
          'aria-allowed-attr': {
            count: 3,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="nav-section has-sub-menu" am-region="Categories" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Our Platform" aria-expanded="false">',
              '<div class="toc-title" aria-selected="false">Table of Contents</div>',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 2,
        items: {
          'color-contrast': {
            count: 1,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/blog/">Blog</a>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.35 (foreground color: #599d15, background color: #ffffff, font size: 12.8pt (17px), font weight: normal). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-in-text-block': {
            count: 1,
            description: 'Links must be distinguishable without relying on color',
            level: 'A',
            htmlWithIssues: [
              '<a href="http://www.linkedin.com/in/briankimanderson" rel="noopener" target="_blank">LinkedIn</a>',
            ],
            failureSummary: 'Fix any of the following:\n  The link has insufficient color contrast of 2.34:1 with the surrounding text. (Minimum contrast is 3:1, link text: #2e7918, surrounding text: #38312f)\n  The link has no styling (such as underline) to distinguish it from the surrounding text',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-in-text-block?application=playwright',
            successCriteriaTags: [
              'wcag141',
            ],
          },
        },
      },
    },
    traffic: '6300',
  },
  'https://www.bamboohr.com/blog/stay-positive-at-work': {
    violations: {
      total: 9,
      critical: {
        count: 7,
        items: {
          'aria-allowed-attr': {
            count: 3,
            description: 'Elements must only use supported ARIA attributes',
            level: 'A',
            htmlWithIssues: [
              '<div class="nav-section has-sub-menu" am-region="Categories" aria-expanded="false">',
              '<div class="nav-section has-sub-menu" am-region="Our Platform" aria-expanded="false">',
              '<div class="toc-title" aria-selected="false">Table of Contents</div>',
            ],
            failureSummary: 'Fix all of the following:\n  ARIA attribute is not allowed: aria-expanded="false"',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-allowed-attr?application=playwright',
            successCriteriaTags: [
              'wcag412',
            ],
          },
          'aria-required-parent': {
            count: 4,
            description: 'Certain ARIA roles must be contained by particular parents',
            level: 'A',
            htmlWithIssues: [
              '<label role="option" id="noLblFunctionalCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblFunctionalCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
              '<label role="option" id="noLblAdvertisingCookies" class="trustarc-optout-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">NO</label>',
              '<label role="option" id="yesLblAdvertisingCookies" class="trustarc-optin-btn choicebutton" tabindex="0" aria-disabled="false" aria-selected="false">YES</label>',
            ],
            failureSummary: 'Fix any of the following:\n  Required ARIA parents role not present: group, listbox',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/aria-required-parent?application=playwright',
            successCriteriaTags: [
              'wcag131',
            ],
          },
        },
      },
      serious: {
        count: 2,
        items: {
          'color-contrast': {
            count: 1,
            description: 'Elements must meet minimum color contrast ratio thresholds',
            level: 'AA',
            htmlWithIssues: [
              '<a href="https://www.bamboohr.com/blog/">Blog</a>',
            ],
            failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 3.35 (foreground color: #599d15, background color: #ffffff, font size: 12.8pt (17px), font weight: normal). Expected contrast ratio of 4.5:1',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=playwright',
            successCriteriaTags: [
              'wcag143',
            ],
          },
          'link-in-text-block': {
            count: 1,
            description: 'Links must be distinguishable without relying on color',
            level: 'A',
            htmlWithIssues: [
              '<a href="https://www.linkedin.com/in/mattnesmith/" rel="noopener" target="_blank">LinkedIn</a>',
            ],
            failureSummary: 'Fix any of the following:\n  The link has insufficient color contrast of 2.34:1 with the surrounding text. (Minimum contrast is 3:1, link text: #2e7918, surrounding text: #38312f)\n  The link has no styling (such as underline) to distinguish it from the surrounding text',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/link-in-text-block?application=playwright',
            successCriteriaTags: [
              'wcag141',
            ],
          },
        },
      },
    },
    traffic: '6000',
  },
};
