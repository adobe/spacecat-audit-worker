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
  getSuccessCriteriaDetails,
  getUrlsDataForAccessibilityAudit,
  shouldExcludeForm,
  calculateProjectedConversionValue,
  sendMessageToFormsQualityAgent,
  sendMessageToMystiqueForGuidance,
  getFormTitle,
} from '../../../src/forms-opportunities/utils.js';
import { FORM_OPPORTUNITY_TYPES } from '../../../src/forms-opportunities/constants.js';

describe('isSearchForm', () => {
  it('should return true for search form type', () => {
    const scrapedFormData = { formType: 'search' };
    expect(shouldExcludeForm(scrapedFormData)).to.be.true;
  });

  it('should return true for form containing zero input field', () => {
    const scrapedFormData = {
      id: '',
      name: 'abbv-send-email',
      formType: null,
      classList: 'abbv-send-email-form',
      visibleATF: true,
      fieldCount: 5,
      visibleFieldCount: 0,
      formFields: [{
        label: 'abbv-button-plain more-info abbv-icon-info i-a', classList: 'abbv-button-plain more-info abbv-icon-info i-a', tagName: 'button', type: '', inputmode: '',
      }, {
        label: 'johndoe@email.com', classList: 'abbv-toEmail', tagName: '', type: 'text', inputmode: '',
      }, {
        label: 'abbv-button-primary    abbv-cancel-email', classList: 'abbv-button-primary    abbv-cancel-email', tagName: 'button', type: '', inputmode: '',
      }, {
        label: 'Send email', classList: 'abbv-button-primary    abbv-submit-email', tagName: 'button', type: '', inputmode: '',
      }, {
        label: 'g-recaptcha-response', classList: 'g-recaptcha-response', tagName: 'textarea', type: '', inputmode: '',
      }],
      visibleInViewPortFieldCount: 0,
    };
    expect(shouldExcludeForm(scrapedFormData)).to.be.true;
  });

  it('should return true for form containing only numeric input field', () => {
    const scrapedFormData = {
      id: '',
      name: 'doctorSearch',
      formType: 'search123',
      classList: '',
      visibleATF: true,
      fieldCount: 4,
      visibleFieldCount: 3,
      formFields: [{
        label: 'ZIP Code:', classList: 'zipCode', tagName: 'input', type: 'text', inputmode: 'numeric',
      }, {
        label: '', classList: '', tagName: 'select', type: '', inputmode: '',
      }, {
        label: 'By checking this box you have acknowledged that you have read and agree with the Terms and Conditions.', classList: '', tagName: 'button', type: 'checkbox', inputmode: '',
      }, {
        label: 'Search', classList: 'abbv-button-primary submit_dr-location', tagName: 'button', type: 'submit', inputmode: '',
      }],
      visibleInViewPortFieldCount: 3,
    };
    expect(shouldExcludeForm(scrapedFormData)).to.be.true;
  });

  it('should return true for login form type', () => {
    const scrapedFormData = { formType: 'login' };
    expect(shouldExcludeForm(scrapedFormData)).to.be.true;
  });

  it('should return true for form with unsubscribe class', () => {
    const scrapedFormData = { classList: ['unsubscribe'] };
    expect(shouldExcludeForm(scrapedFormData)).to.be.true;
  });

  it('should return false for form with field count greater than zero', () => {
    const scrapedFormData = { fieldCount: 2 };
    expect(shouldExcludeForm(scrapedFormData)).to.be.false;
  });

  it('should return true for form with field count greater than zero', () => {
    const scrapedFormData = { fieldCount: 0 };
    expect(shouldExcludeForm(scrapedFormData)).to.be.true;
  });

  it('should return false for non-search form', () => {
    const scrapedFormData = {
      formType: 'contact', classList: ['subscribe'], action: 'https://example.com/contact.html', fieldsLabels: ['Name', 'Email'],
    };
    expect(shouldExcludeForm(scrapedFormData)).to.be.false;
  });

  it('should return true if form does not have any buttons', () => {
    const scrapedFormData = {
      id: '',
      name: 'abbv-send-email',
      formType: null,
      classList: 'abbv-send-email-form',
      visibleATF: true,
      fieldCount: 2,
      visibleFieldCount: 0,
      formFields: [{
        label: 'johndoe@email.com', classList: 'abbv-toEmail', tagName: 'input', type: 'text', inputmode: '',
      }, {
        label: 'g-recaptcha-response', classList: 'g-recaptcha-response', tagName: 'textarea', type: '', inputmode: '',
      }],
      visibleInViewPortFieldCount: 0,
    };
    expect(shouldExcludeForm(scrapedFormData)).to.be.true;
  });

  it('should return true if form has a single button only', () => {
    const scrapedFormData = {
      id: '',
      name: 'abbv-send-email',
      formType: null,
      classList: 'abbv-send-email-form',
      visibleATF: true,
      fieldCount: 1,
      visibleFieldCount: 0,
      formFields: [{
        label: 'johndoe@email.com', classList: 'abbv-toEmail', tagName: 'button', type: 'text', inputmode: '',
      }],
      visibleInViewPortFieldCount: 0,
    };
    expect(shouldExcludeForm(scrapedFormData)).to.be.true;
  });
});

describe('getUrlsDataForAccessibilityAudit', () => {
  const context = { log: { debug: () => {} } };
  const formVitals = [
    {
      url: 'https://www.business.adobe.com/newsletter',
      pageview: { desktop: 100, mobile: 100 },
    },
    {
      url: 'https://www.business.adobe.com/search',
      pageview: { desktop: 200, mobile: 200 },
    },
    {
      url: 'https://www.business.adobe.com/subscribe',
      pageview: { desktop: 300, mobile: 300 },
    },
  ];
  it('should return urls for accessibility audit', () => {
    const scrapedData = {
      formData: [
        {
          finalUrl: 'https://www.business.adobe.com/newsletter',
          scrapeResult: [{ formSource: '#container-1 form.newsletter' }],
        },
        {
          finalUrl: 'https://www.business.adobe.com/search',
          scrapeResult: [{ formSource: '#container-1 form.search' }],
        },
      ],
    };
    const urlsData = getUrlsDataForAccessibilityAudit(scrapedData, formVitals, context);
    expect(urlsData).to.deep.equal([
      {
        url: 'https://www.business.adobe.com/newsletter',
        formSources: ['#container-1 form.newsletter'],
      },
    ]);
  });

  it('should return empty', () => {
    const scrapedData = {
      formData: [
        {
          finalUrl: 'https://www.business.adobe.com/newsletter',
        },
      ],
    };
    const urlsData = getUrlsDataForAccessibilityAudit(scrapedData, formVitals, context);
    expect(urlsData).to.deep.equal([]);
  });

  it('should return unique form sources', () => {
    const scrapedData = {
      formData: [
        {
          finalUrl: 'https://www.business.adobe.com/newsletter',
          scrapeResult: [
            {
              classList: 'cmp-mortgage-options',
              formSource: '#container-1 form#newsletter',
            },
          ],
        },
        {
          finalUrl: 'https://www.business.adobe.com/subscribe',
          scrapeResult: [{ formSource: '#container-1 form#newsletter' }],
        },
      ],
    };
    const urlsData = getUrlsDataForAccessibilityAudit(scrapedData, formVitals, context);
    expect(urlsData).to.deep.equal([
      {
        url: 'https://www.business.adobe.com/subscribe',
        formSources: ['#container-1 form#newsletter'],
      },
    ]);
  });

  it('should return formSource as id/classList if no element found in scraper', () => {
    const scrapedData = {
      formData: [{
        finalUrl: 'https://www.business.adobe.com/a',
        scrapeResult: [{
          id: 'test-id',
          classList: 'test-class',
        }, {
          id: '',
          classList: 'test-class-2 test-class-3',
        }],
      }, {
        finalUrl: 'https://www.business.adobe.com/c',
        scrapeResult: [{
          id: 'test-id',
          classList: 'test-class',
        }],
      }, {
        finalUrl: 'https://www.business.adobe.com/b',
        scrapeResult: [{
          id: '',
          classList: '',
        }],
      }],
    };
    const urlsData = getUrlsDataForAccessibilityAudit(scrapedData, formVitals, context);
    expect(urlsData).to.deep.equal([
      {
        url: 'https://www.business.adobe.com/a',
        formSources: ['form#test-id', 'form.test-class-2.test-class-3'],
      }, {
        url: 'https://www.business.adobe.com/b',
        formSources: ['form'],
      },
    ]);
  });
});

describe('getSuccessCriteriaDetails', () => {
  it('should return success criteria details', () => {
    const successCriteriaDetails = getSuccessCriteriaDetails('1.1.1 Non-text Content');
    expect(successCriteriaDetails).to.deep.equal({
      name: 'Non-text Content',
      criteriaNumber: '1.1.1',
      understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/non-text-content.html',
    });
  });

  it('should return success criteria details', () => {
    const successCriteriaDetails = getSuccessCriteriaDetails('wcag111');
    expect(successCriteriaDetails).to.deep.equal({
      name: 'Non-text Content',
      criteriaNumber: '1.1.1',
      understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/non-text-content.html',
    });
  });

  it('should throw error for invalid criteria', () => {
    expect(() => getSuccessCriteriaDetails('invalid')).to.throw('Invalid criteria format: invalid');
  });
});

describe('calculateProjectedConversionValue', () => {
  let context;
  let calculateCPCValueStub;
  const sandbox = sinon.createSandbox();

  beforeEach(() => {
    context = {
      env: {
        AHREFS_API_BASE_URL: 'https://ahrefs.com',
        AHREFS_API_KEY: 'ahrefs-api',
        S3_SCRAPER_BUCKET_NAME: 'test-bucket',
        S3_IMPORTER_BUCKET_NAME: 'test-import-bucket',
      },
      s3Client: {
        send: sandbox.stub(),
      },
      log: {
        info: () => {},
        error: () => {},
        debug: () => {},
      },
    };
    calculateCPCValueStub = sinon.stub().resolves(2.69);
    context.calculateCPCValue = calculateCPCValueStub;
  });

  it('should calculate projected conversion value with valid inputs', async () => {
    const siteId = 'test-site-id';
    const opportunityData = {
      pageViews: 1000,
      metrics: [
        {
          type: 'conversionRate',
          device: '*',
          value: {
            page: 0.05,
          },
        },
      ],
    };

    const result = await calculateProjectedConversionValue(context, siteId, opportunityData);
    expect(result.projectedConversionValue).to.equal(12960.42);
  });
});

describe('sendMessageToFormsQualityAgent', () => {
  let context;
  let sqsStub;
  const sandbox = sinon.createSandbox();

  beforeEach(() => {
    context = {
      log: {
        info: sandbox.stub(),
        error: sandbox.stub(),
        debug: sandbox.stub(),
      },
      sqs: {
        sendMessage: sandbox.stub().resolves(),
      },
      site: {
        getBaseURL: sandbox.stub().returns('https://example.com'),
        getDeliveryType: sandbox.stub().returns('aem_cs'),
      },
      env: {
        QUEUE_SPACECAT_TO_MYSTIQUE: 'test-queue',
      },
    };
    sqsStub = context.sqs.sendMessage;
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should send message with site base URL when site is available', async () => {
    const opportunity = { siteId: 'site-123', opportunityId: 'oppty-456' };
    const formsList = [{ form: 'https://example.com/form1', formSource: 'source1' }];

    await sendMessageToFormsQualityAgent(context, opportunity, formsList);

    expect(sqsStub.calledOnce).to.be.true;
    const message = sqsStub.firstCall.args[1];
    expect(message.data.url).to.equal('https://example.com');
    expect(message.deliveryType).to.equal('aem_cs');
  });

  it('should send message with form URL when site is not available', async () => {
    delete context.site;
    const opportunity = { siteId: 'site-123', opportunityId: 'oppty-456' };
    const formsList = [{ form: 'https://example.com/form1', formSource: 'source1' }];

    await sendMessageToFormsQualityAgent(context, opportunity, formsList);

    expect(sqsStub.calledOnce).to.be.true;
    const message = sqsStub.firstCall.args[1];
    expect(message.data.url).to.equal('https://example.com/form1');
    expect(message.deliveryType).to.equal('aem_cs');
  });
});

describe('sendMessageToMystiqueForGuidance', () => {
  let context;
  let sqsStub;
  const sandbox = sinon.createSandbox();

  beforeEach(() => {
    context = {
      log: {
        info: sandbox.stub(),
        error: sandbox.stub(),
        debug: sandbox.stub(),
      },
      sqs: {
        sendMessage: sandbox.stub().resolves(),
      },
      site: {
        getDeliveryType: sandbox.stub().returns('aem_cs'),
      },
      env: {
        QUEUE_SPACECAT_TO_MYSTIQUE: 'test-queue',
      },
    };
    sqsStub = context.sqs.sendMessage;
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should send message with normalized type and correct data structure for form-accessibility', async () => {
    const opportunity = {
      type: 'form-accessibility',
      siteId: 'site-123',
      auditId: 'audit-456',
      data: {
        accessibility: [{ form: 'https://example.com/form1' }],
        trackedFormKPIValue: 0.75,
        metrics: [],
        formNavigation: {
          source: 'source1',
          text: 'Click here',
        },
        formsource: 'source1',
        formDetails: { detail: 'detail1' },
        pageViews: 100,
        formViews: 50,
      },
    };

    await sendMessageToMystiqueForGuidance(context, opportunity);

    expect(sqsStub.calledOnce).to.be.true;
    const message = sqsStub.firstCall.args[1];
    expect(message.type).to.equal('guidance:forms-a11y');
    expect(message.data.url).to.equal('https://example.com/form1');
    expect(message.data.cr).to.equal(0.75);
    expect(message.data.form_source).to.equal('source1');
    expect(message.data.form_details).to.deep.equal([{ detail: 'detail1' }]);
  });

  it('should send message with original type when not form-accessibility', async () => {
    const opportunity = {
      type: 'other-type',
      siteId: 'site-123',
      auditId: 'audit-456',
      data: {
        form: 'https://example.com/form2',
        trackedFormKPIValue: 0.85,
        metrics: [],
        formNavigation: {
          source: 'source2',
          text: 'Submit',
        },
        formsource: 'source2',
        formDetails: { detail: 'detail2' },
        pageViews: 200,
        formViews: 150,
      },
    };

    await sendMessageToMystiqueForGuidance(context, opportunity);

    expect(sqsStub.calledOnce).to.be.true;
    const message = sqsStub.firstCall.args[1];
    expect(message.type).to.equal('guidance:other-type');
    expect(message.data.url).to.equal('https://example.com/form2');
    expect(message.data.cr).to.equal(0.85);
    expect(message.data.form_source).to.equal('source2');
    expect(message.data.form_details).to.deep.equal([{ detail: 'detail2' }]);
  });

  it('should handle empty formDetails gracefully', async () => {
    const opportunity = {
      type: 'form-accessibility',
      siteId: 'site-123',
      auditId: 'audit-456',
      data: {
        accessibility: [{ form: 'https://example.com/form1' }],
        trackedFormKPIValue: 0.75,
        metrics: [],
        formNavigation: {
          source: 'source1',
          text: 'Click here',
        },
        formsource: 'source1',
        pageViews: 100,
        formViews: 50,
      },
    };

    await sendMessageToMystiqueForGuidance(context, opportunity);

    expect(sqsStub.calledOnce).to.be.true;
    const message = sqsStub.firstCall.args[1];
    expect(message.data.form_details).to.deep.equal([]);
  });

  it('should send message with default deliveryType when site is not available', async () => {
    delete context.site;
    const opportunity = {
      type: 'form-accessibility',
      siteId: 'site-123',
      auditId: 'audit-456',
      data: {
        accessibility: [{ form: 'https://example.com/form1' }],
        trackedFormKPIValue: 0.75,
        metrics: [],
        formNavigation: {
          source: 'source1',
          text: 'Click here',
        },
        formsource: 'source1',
        formDetails: { detail: 'detail1' },
        pageViews: 100,
        formViews: 50,
      },
    };

    await sendMessageToMystiqueForGuidance(context, opportunity);

    expect(sqsStub.calledOnce).to.be.true;
    const message = sqsStub.firstCall.args[1];
    expect(message.deliveryType).to.equal('aem_cs');
  });

  it('should handle missing formNavigation gracefully', async () => {
    const opportunity = {
      type: 'form-accessibility',
      siteId: 'site-123',
      auditId: 'audit-456',
      data: {
        accessibility: [{ form: 'https://example.com/form1' }],
        trackedFormKPIValue: 0.75,
        metrics: [],
        formsource: 'source1',
        formDetails: { detail: 'detail1' },
        pageViews: 100,
        formViews: 50,
      },
    };

    await sendMessageToMystiqueForGuidance(context, opportunity);

    expect(sqsStub.calledOnce).to.be.true;
    const message = sqsStub.firstCall.args[1];
    expect(message.data.form_navigation).to.deep.equal({
      url: '',
      source: '',
      cta_clicks: 0,
      page_views: 0,
    });
  });

  it('should handle formDetails as an array', async () => {
    const opportunity = {
      type: 'form-accessibility',
      siteId: 'site-123',
      auditId: 'audit-456',
      data: {
        accessibility: [{ form: 'https://example.com/form1' }],
        trackedFormKPIValue: 0.75,
        metrics: [],
        formNavigation: {
          source: 'source1',
          text: 'Click here',
        },
        formsource: 'source1',
        formDetails: [{ detail: 'detail1' }, { detail: 'detail2' }],
        pageViews: 100,
        formViews: 50,
      },
    };

    await sendMessageToMystiqueForGuidance(context, opportunity);

    expect(sqsStub.calledOnce).to.be.true;
    const message = sqsStub.firstCall.args[1];
    expect(message.data.form_details).to.deep.equal([{ detail: 'detail1' }, { detail: 'detail2' }]);
  });

  it('should handle missing accessibility data gracefully', async () => {
    const opportunity = {
      type: 'form-accessibility',
      siteId: 'site-123',
      auditId: 'audit-456',
      data: {
        trackedFormKPIValue: 0.75,
        metrics: [],
        formNavigation: {
          source: 'source1',
          text: 'Click here',
        },
        formsource: 'source1',
        formDetails: { detail: 'detail1' },
        pageViews: 100,
        formViews: 50,
      },
    };

    await sendMessageToMystiqueForGuidance(context, opportunity);

    expect(sqsStub.calledOnce).to.be.true;
    const message = sqsStub.firstCall.args[1];
    expect(message.data.url).to.equal('');
  });

  it('should handle empty accessibility array', async () => {
    const opportunity = {
      type: 'form-accessibility',
      siteId: 'site-123',
      auditId: 'audit-456',
      data: {
        accessibility: [],
        trackedFormKPIValue: 0.75,
        metrics: [],
        formNavigation: {
          source: 'source1',
          text: 'Click here',
        },
        formsource: 'source1',
        formDetails: { detail: 'detail1' },
        pageViews: 100,
        formViews: 50,
      },
    };

    await sendMessageToMystiqueForGuidance(context, opportunity);

    expect(sqsStub.calledOnce).to.be.true;
    const message = sqsStub.firstCall.args[1];
    expect(message.data.url).to.equal('');
  });
});

describe('getFormTitle', () => {
  it('should return an empty string if formDetails is null', () => {
    const result = getFormTitle(null, { getType: () => FORM_OPPORTUNITY_TYPES.LOW_CONVERSION });
    expect(result).to.equal('Form has low conversions');
  });

  it('should return an empty string if formDetails is not an object', () => {
    const result = getFormTitle('not-an-object', { getType: () => FORM_OPPORTUNITY_TYPES.LOW_CONVERSION });
    expect(result).to.equal('Form has low conversions');
  });

  it('should return the form type with suffix for LOW_CONVERSION', () => {
    const result = getFormTitle({ form_type: 'Contact Form' }, { getType: () => FORM_OPPORTUNITY_TYPES.LOW_CONVERSION });
    expect(result).to.equal('Contact Form has low conversions');
  });

  it('should return the form type with suffix for LOW_NAVIGATION', () => {
    const result = getFormTitle({ form_type: 'Contact Form' }, { getType: () => FORM_OPPORTUNITY_TYPES.LOW_NAVIGATION });
    expect(result).to.equal('Contact Form has low views');
  });

  it('should return the form type with suffix for LOW_VIEWS', () => {
    const result = getFormTitle({ form_type: 'Contact Form' }, { getType: () => FORM_OPPORTUNITY_TYPES.LOW_VIEWS });
    expect(result).to.equal('Contact Form has low views');
  });

  it('should return the form type without suffix for FORM_A11Y', () => {
    const result = getFormTitle({ form_type: 'Contact Form' }, { getType: () => FORM_OPPORTUNITY_TYPES.FORM_A11Y });
    expect(result).to.equal('Contact Form');
  });

  it('should return the default form type in case form type is not available', () => {
    const result = getFormTitle({ form_type: '' }, { getType: () => FORM_OPPORTUNITY_TYPES.LOW_CONVERSION });
    expect(result).to.equal('Form has low conversions');
  });

  it('should return the default form type in case form type is not from the mentioned list', () => {
    const result = getFormTitle({ form_type: 'Other (abc Form)' }, { getType: () => FORM_OPPORTUNITY_TYPES.LOW_CONVERSION });
    expect(result).to.equal('Form has low conversions');
  });

  it('should return the default form type in case form type is NA', () => {
    const result = getFormTitle({ form_type: 'NA' }, { getType: () => FORM_OPPORTUNITY_TYPES.LOW_CONVERSION });
    expect(result).to.equal('Form has low conversions');
  });

  it('should return the default form type in case form type does not exist', () => {
    const result = getFormTitle({}, { getType: () => FORM_OPPORTUNITY_TYPES.LOW_CONVERSION });
    expect(result).to.equal('Form has low conversions');
  });
});

describe('sendCodeFixMessagesToImporter', () => {
  let sandbox;
  let context;
  let mockOpportunity;
  let mockSuggestion1;
  let mockSuggestion2;
  let mockSuggestion3;
  let mockSite;
  let isAuditEnabledForSiteStub;
  let sendCodeFixMessagesToImporter;
  let utilsModule;

  before(async () => {
    // Load the mocked module once before all tests
    const esmock = await import('esmock');
    isAuditEnabledForSiteStub = sinon.stub().resolves(true);
    utilsModule = await esmock.default('../../../src/forms-opportunities/utils.js', {
      '../../../src/common/audit-utils.js': {
        isAuditEnabledForSite: isAuditEnabledForSiteStub,
      },
    });
    sendCodeFixMessagesToImporter = utilsModule.sendCodeFixMessagesToImporter;
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    
    // Reset the stub for each test
    isAuditEnabledForSiteStub.reset();
    isAuditEnabledForSiteStub.resolves(true);

    // Create mock suggestions
    mockSuggestion1 = {
      getId: sandbox.stub().returns('suggestion-123'),
      getData: sandbox.stub().returns({
        url: 'https://example.com/form1',
        source: 'form',
        issues: [{ type: 'color-contrast' }],
      }),
    };

    mockSuggestion2 = {
      getId: sandbox.stub().returns('suggestion-456'),
      getData: sandbox.stub().returns({
        url: 'https://example.com/form1',
        source: 'form',
        issues: [{ type: 'color-contrast' }],
      }),
    };

    mockSuggestion3 = {
      getId: sandbox.stub().returns('suggestion-789'),
      getData: sandbox.stub().returns({
        url: 'https://example.com/form2',
        source: 'form2',
        issues: [{ type: 'select-name' }],
      }),
    };

    // Create mock opportunity
    mockOpportunity = {
      getId: sandbox.stub().returns('opportunity-123'),
      getSiteId: sandbox.stub().returns('site-123'),
      getType: sandbox.stub().returns('form-accessibility'),
      getSuggestions: sandbox.stub().resolves([mockSuggestion1, mockSuggestion2, mockSuggestion3]),
    };

    // Create mock site
    mockSite = {
      getBaseURL: sandbox.stub().returns('https://example.com'),
    };

    // Create context with stubs
    context = {
      log: {
        info: sandbox.spy(),
        debug: sandbox.spy(),
        warn: sandbox.spy(),
        error: sandbox.spy(),
      },
      sqs: {
        sendMessage: sandbox.stub().resolves(),
      },
      env: {
        IMPORT_WORKER_QUEUE_URL: 'test-import-worker-queue-url',
        QUEUE_SPACECAT_TO_MYSTIQUE: 'test-mystique-queue',
      },
      site: mockSite,
    };
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('Auto-fix disabled', () => {
    it('should skip code-fix generation when auto-fix is disabled', async () => {
      isAuditEnabledForSiteStub.resolves(false);

      await sendCodeFixMessagesToImporter(mockOpportunity, 'audit-123', context);

      expect(isAuditEnabledForSiteStub).to.have.been.calledWith('form-accessibility-auto-fix', mockSite, context);
      expect(context.log.info).to.have.been.calledWith(
        '[Form Opportunity] [Site Id: site-123] form-accessibility-auto-fix is disabled for site, skipping code-fix generation',
      );
      expect(context.sqs.sendMessage).not.to.have.been.called;
    });
  });

  describe('No suggestions', () => {
    it('should skip code-fix generation when no suggestions exist', async () => {
      mockOpportunity.getSuggestions.resolves([]);

      await sendCodeFixMessagesToImporter(mockOpportunity, 'audit-123', context);

      expect(context.log.info).to.have.been.calledWith(
        '[Form Opportunity] [Site Id: site-123] No suggestions found for code-fix generation',
      );
      expect(context.sqs.sendMessage).not.to.have.been.called;
    });

    it('should skip code-fix generation when suggestions is null', async () => {
      mockOpportunity.getSuggestions.resolves(null);

      await sendCodeFixMessagesToImporter(mockOpportunity, 'audit-123', context);

      expect(context.log.info).to.have.been.calledWith(
        '[Form Opportunity] [Site Id: site-123] No suggestions found for code-fix generation',
      );
      expect(context.sqs.sendMessage).not.to.have.been.called;
    });
  });

  describe('Successful message sending', () => {
    it('should group suggestions by URL, source, and issueType and send messages', async () => {
      await sendCodeFixMessagesToImporter(mockOpportunity, 'audit-123', context);

      expect(context.log.info).to.have.been.calledWith(
        '[Form Opportunity] [Site Id: site-123] Grouped suggestions into 2 groups for code-fix generation',
      );

      // Should send 2 messages (2 groups)
      expect(context.sqs.sendMessage).to.have.been.calledTwice;

      // Verify first message (color-contrast group)
      const firstCall = context.sqs.sendMessage.firstCall;
      expect(firstCall.args[0]).to.equal('test-import-worker-queue-url');
      const firstMessage = firstCall.args[1];
      expect(firstMessage.type).to.equal('code');
      expect(firstMessage.siteId).to.equal('site-123');
      expect(firstMessage.forward.queue).to.equal('test-mystique-queue');
      expect(firstMessage.forward.type).to.equal('codefix:accessibility');
      expect(firstMessage.forward.siteId).to.equal('site-123');
      expect(firstMessage.forward.auditId).to.equal('audit-123');
      expect(firstMessage.forward.url).to.equal('https://example.com');
      expect(firstMessage.forward.data.opportunityId).to.equal('opportunity-123');
      expect(firstMessage.forward.data.suggestionIds).to.have.lengthOf(2);
      expect(firstMessage.forward.data.suggestionIds).to.include('suggestion-123');
      expect(firstMessage.forward.data.suggestionIds).to.include('suggestion-456');

      // Verify second message (select-name group)
      const secondCall = context.sqs.sendMessage.secondCall;
      expect(secondCall.args[0]).to.equal('test-import-worker-queue-url');
      const secondMessage = secondCall.args[1];
      expect(secondMessage.forward.data.suggestionIds).to.have.lengthOf(1);
      expect(secondMessage.forward.data.suggestionIds).to.include('suggestion-789');

      expect(context.log.info).to.have.been.calledWith(
        '[Form Opportunity] [Site Id: site-123] Completed sending 2 code-fix messages to importer',
      );
    });

    it('should handle suggestion with default source when source is undefined', async () => {
      const mockSuggestionNoSource = {
        getId: sandbox.stub().returns('suggestion-no-source'),
        getData: sandbox.stub().returns({
          url: 'https://example.com/form3',
          // No source property
          issues: [{ type: 'label-missing' }],
        }),
      };

      mockOpportunity.getSuggestions.resolves([mockSuggestionNoSource]);

      await sendCodeFixMessagesToImporter(mockOpportunity, 'audit-123', context);

      expect(context.sqs.sendMessage).to.have.been.calledOnce;
      expect(context.log.info).to.have.been.calledWith(
        sinon.match(/Sent code-fix message to importer for URL: https:\/\/example\.com\/form3, source: default/),
      );
    });

    it('should skip suggestions without issues', async () => {
      const mockSuggestionNoIssues = {
        getId: sandbox.stub().returns('suggestion-no-issues'),
        getData: sandbox.stub().returns({
          url: 'https://example.com/form4',
          source: 'form',
          issues: [],
        }),
      };

      mockOpportunity.getSuggestions.resolves([mockSuggestionNoIssues]);

      await sendCodeFixMessagesToImporter(mockOpportunity, 'audit-123', context);

      expect(context.sqs.sendMessage).not.to.have.been.called;
      expect(context.log.info).to.have.been.calledWith(
        '[Form Opportunity] [Site Id: site-123] Grouped suggestions into 0 groups for code-fix generation',
      );
    });

    it('should skip suggestions without issues property', async () => {
      const mockSuggestionNoIssuesProperty = {
        getId: sandbox.stub().returns('suggestion-no-issues-property'),
        getData: sandbox.stub().returns({
          url: 'https://example.com/form5',
          source: 'form',
          // No issues property
        }),
      };

      mockOpportunity.getSuggestions.resolves([mockSuggestionNoIssuesProperty]);

      await sendCodeFixMessagesToImporter(mockOpportunity, 'audit-123', context);

      expect(context.sqs.sendMessage).not.to.have.been.called;
    });

    it('should log individual message sending for each group', async () => {
      await sendCodeFixMessagesToImporter(mockOpportunity, 'audit-123', context);

      expect(context.log.info).to.have.been.calledWith(
        sinon.match(/Sent code-fix message to importer for URL: https:\/\/example\.com\/form1, source: form, issueType: color-contrast, suggestions: 2/),
      );

      expect(context.log.info).to.have.been.calledWith(
        sinon.match(/Sent code-fix message to importer for URL: https:\/\/example\.com\/form2, source: form2, issueType: select-name, suggestions: 1/),
      );
    });
  });

  describe('Failed message sending', () => {
    it('should handle individual message sending failures gracefully', async () => {
      const sendError = new Error('SQS send failed');
      context.sqs.sendMessage
        .onFirstCall().rejects(sendError)
        .onSecondCall().resolves();

      await sendCodeFixMessagesToImporter(mockOpportunity, 'audit-123', context);

      expect(context.sqs.sendMessage).to.have.been.calledTwice;
      expect(context.log.error).to.have.been.calledWith(
        sinon.match(/Failed to send code-fix message for URL: https:\/\/example\.com\/form1, error: SQS send failed/),
      );

      // Should still complete and log completion
      expect(context.log.info).to.have.been.calledWith(
        '[Form Opportunity] [Site Id: site-123] Completed sending 2 code-fix messages to importer',
      );
    });

    it('should handle all message sending failures', async () => {
      const sendError = new Error('SQS connection failed');
      context.sqs.sendMessage.rejects(sendError);

      await sendCodeFixMessagesToImporter(mockOpportunity, 'audit-123', context);

      expect(context.sqs.sendMessage).to.have.been.calledTwice;
      expect(context.log.error).to.have.been.calledTwice;
      expect(context.log.error).to.have.been.calledWith(
        sinon.match(/Failed to send code-fix message for URL.*error: SQS connection failed/),
      );
    });
  });

  describe('Error handling', () => {
    it('should handle errors in isAuditEnabledForSite check', async () => {
      const error = new Error('Configuration check failed');
      isAuditEnabledForSiteStub.rejects(error);

      await sendCodeFixMessagesToImporter(mockOpportunity, 'audit-123', context);

      expect(context.log.error).to.have.been.calledWith(
        '[Form Opportunity] [Site Id: site-123] Error in sendCodeFixMessagesToImporter: Configuration check failed',
      );
      expect(context.sqs.sendMessage).not.to.have.been.called;
    });

    it('should handle errors in getSuggestions', async () => {
      const error = new Error('Database error');
      mockOpportunity.getSuggestions.rejects(error);

      await sendCodeFixMessagesToImporter(mockOpportunity, 'audit-123', context);

      expect(context.log.error).to.have.been.calledWith(
        '[Form Opportunity] [Site Id: site-123] Error in sendCodeFixMessagesToImporter: Database error',
      );
      expect(context.sqs.sendMessage).not.to.have.been.called;
    });

    it('should handle errors during grouping suggestions', async () => {
      // Make getData throw an error
      mockSuggestion1.getData.throws(new Error('getData failed'));

      await sendCodeFixMessagesToImporter(mockOpportunity, 'audit-123', context);

      expect(context.log.error).to.have.been.calledWith(
        '[Form Opportunity] [Site Id: site-123] Error in sendCodeFixMessagesToImporter: getData failed',
      );
      expect(context.sqs.sendMessage).not.to.have.been.called;
    });
  });

  describe('Complex grouping scenarios', () => {
    it('should group multiple suggestions with same URL, source, and issueType', async () => {
      const mockSuggestion4 = {
        getId: sandbox.stub().returns('suggestion-999'),
        getData: sandbox.stub().returns({
          url: 'https://example.com/form1',
          source: 'form',
          issues: [{ type: 'color-contrast' }],
        }),
      };

      mockOpportunity.getSuggestions.resolves([
        mockSuggestion1,
        mockSuggestion2,
        mockSuggestion4,
      ]);

      await sendCodeFixMessagesToImporter(mockOpportunity, 'audit-123', context);

      expect(context.log.info).to.have.been.calledWith(
        '[Form Opportunity] [Site Id: site-123] Grouped suggestions into 1 groups for code-fix generation',
      );

      expect(context.sqs.sendMessage).to.have.been.calledOnce;
      const message = context.sqs.sendMessage.firstCall.args[1];
      expect(message.forward.data.suggestionIds).to.have.lengthOf(3);
      expect(message.forward.data.suggestionIds).to.include('suggestion-123');
      expect(message.forward.data.suggestionIds).to.include('suggestion-456');
      expect(message.forward.data.suggestionIds).to.include('suggestion-999');
    });

    it('should create separate groups for different URLs', async () => {
      const mockSuggestionDifferentUrl = {
        getId: sandbox.stub().returns('suggestion-url-diff'),
        getData: sandbox.stub().returns({
          url: 'https://example.com/different-url',
          source: 'form',
          issues: [{ type: 'color-contrast' }],
        }),
      };

      mockOpportunity.getSuggestions.resolves([
        mockSuggestion1,
        mockSuggestionDifferentUrl,
      ]);

      await sendCodeFixMessagesToImporter(mockOpportunity, 'audit-123', context);

      expect(context.log.info).to.have.been.calledWith(
        '[Form Opportunity] [Site Id: site-123] Grouped suggestions into 2 groups for code-fix generation',
      );
      expect(context.sqs.sendMessage).to.have.been.calledTwice;
    });

    it('should create separate groups for different sources', async () => {
      const mockSuggestionDifferentSource = {
        getId: sandbox.stub().returns('suggestion-source-diff'),
        getData: sandbox.stub().returns({
          url: 'https://example.com/form1',
          source: 'different-source',
          issues: [{ type: 'color-contrast' }],
        }),
      };

      mockOpportunity.getSuggestions.resolves([
        mockSuggestion1,
        mockSuggestionDifferentSource,
      ]);

      await sendCodeFixMessagesToImporter(mockOpportunity, 'audit-123', context);

      expect(context.log.info).to.have.been.calledWith(
        '[Form Opportunity] [Site Id: site-123] Grouped suggestions into 2 groups for code-fix generation',
      );
      expect(context.sqs.sendMessage).to.have.been.calledTwice;
    });

    it('should create separate groups for different issue types', async () => {
      const mockSuggestionDifferentIssue = {
        getId: sandbox.stub().returns('suggestion-issue-diff'),
        getData: sandbox.stub().returns({
          url: 'https://example.com/form1',
          source: 'form',
          issues: [{ type: 'button-name' }],
        }),
      };

      mockOpportunity.getSuggestions.resolves([
        mockSuggestion1,
        mockSuggestionDifferentIssue,
      ]);

      await sendCodeFixMessagesToImporter(mockOpportunity, 'audit-123', context);

      expect(context.log.info).to.have.been.calledWith(
        '[Form Opportunity] [Site Id: site-123] Grouped suggestions into 2 groups for code-fix generation',
      );
      expect(context.sqs.sendMessage).to.have.been.calledTwice;
    });
  });
});
