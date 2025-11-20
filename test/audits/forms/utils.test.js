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
  applyOpportunityFilters,
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
  it('should return user-friendly title for LOW_CONVERSION', () => {
    const result = getFormTitle(null, { getType: () => FORM_OPPORTUNITY_TYPES.LOW_CONVERSION });
    expect(result).to.equal('Turn more visitors into leads and customers — optimizations for form conversion rate are ready');
  });

  it('should return user-friendly title for LOW_CONVERSION regardless of form details', () => {
    const result = getFormTitle('not-an-object', { getType: () => FORM_OPPORTUNITY_TYPES.LOW_CONVERSION });
    expect(result).to.equal('Turn more visitors into leads and customers — optimizations for form conversion rate are ready');
  });

  it('should return user-friendly title for LOW_CONVERSION with form type', () => {
    const result = getFormTitle({ form_type: 'Contact Form' }, { getType: () => FORM_OPPORTUNITY_TYPES.LOW_CONVERSION });
    expect(result).to.equal('Turn more visitors into leads and customers — optimizations for form conversion rate are ready');
  });

  it('should return user-friendly title for LOW_NAVIGATION', () => {
    const result = getFormTitle({ form_type: 'Contact Form' }, { getType: () => FORM_OPPORTUNITY_TYPES.LOW_NAVIGATION });
    expect(result).to.equal('Visitors aren\'t scrolling or navigating to your form — placement and visibility optimizations ready for review');
  });

  it('should return user-friendly title for LOW_VIEWS', () => {
    const result = getFormTitle({ form_type: 'Contact Form' }, { getType: () => FORM_OPPORTUNITY_TYPES.LOW_VIEWS });
    expect(result).to.equal('Your form isn\'t getting enough views — optimizations to drive visibility prepared');
  });

  it('should return user-friendly title for FORM_A11Y', () => {
    const result = getFormTitle({ form_type: 'Contact Form' }, { getType: () => FORM_OPPORTUNITY_TYPES.FORM_A11Y });
    expect(result).to.equal('Forms missing key accessibility attributes — enhancements prepared to support all users');
  });

  it('should return user-friendly title regardless of form type availability', () => {
    const result = getFormTitle({ form_type: '' }, { getType: () => FORM_OPPORTUNITY_TYPES.LOW_CONVERSION });
    expect(result).to.equal('Turn more visitors into leads and customers — optimizations for form conversion rate are ready');
  });

  it('should return user-friendly title regardless of form type format', () => {
    const result = getFormTitle({ form_type: 'Other (abc Form)' }, { getType: () => FORM_OPPORTUNITY_TYPES.LOW_CONVERSION });
    expect(result).to.equal('Turn more visitors into leads and customers — optimizations for form conversion rate are ready');
  });

  it('should return user-friendly title when form type is NA', () => {
    const result = getFormTitle({ form_type: 'NA' }, { getType: () => FORM_OPPORTUNITY_TYPES.LOW_CONVERSION });
    expect(result).to.equal('Turn more visitors into leads and customers — optimizations for form conversion rate are ready');
  });

  it('should return user-friendly title when form type does not exist', () => {
    const result = getFormTitle({}, { getType: () => FORM_OPPORTUNITY_TYPES.LOW_CONVERSION });
    expect(result).to.equal('Turn more visitors into leads and customers — optimizations for form conversion rate are ready');
  });
});

describe('applyOpportunityFilters', () => {
  let logStub;

  beforeEach(() => {
    logStub = {
      debug: sinon.stub(),
      info: sinon.stub(),
      error: sinon.stub(),
    };
  });

  afterEach(() => {
    sinon.restore();
  });

  it('should filter out INVALIDATED opportunity matching form and formsource', () => {
    const filteredOpportunities = [
      {
        form: 'https://example.com/contact',
        formsource: '.contact-form',
        pageviews: 1000,
      },
      {
        form: 'https://example.com/newsletter',
        formsource: '.newsletter-form',
        pageviews: 2000,
      },
      {
        form: 'https://example.com/signup',
        formsource: '.signup-form',
        pageviews: 1500,
      },
    ];

    const existingOpportunities = [
      {
        getType: () => FORM_OPPORTUNITY_TYPES.LOW_CONVERSION,
        getData: () => ({
          form: 'https://example.com/contact',
          formsource: '.contact-form',
        }),
        getStatus: () => 'IGNORED',
      },
    ];

    const result = applyOpportunityFilters(
      filteredOpportunities,
      existingOpportunities,
      FORM_OPPORTUNITY_TYPES.LOW_CONVERSION,
      logStub,
      2,
    );

    // Should filter out the INVALIDATED opportunity and return top 2 by pageviews
    expect(result).to.have.lengthOf(2);
    expect(result[0].form).to.equal('https://example.com/newsletter');
    expect(result[1].form).to.equal('https://example.com/signup');
    expect(logStub.debug).to.have.been.calledWith(
      'Filtering out opportunity for form https://example.com/contact due to IGNORED status',
    );
  });

  it('should match opportunity by form and formsource when filtering INVALIDATED', () => {
    const filteredOpportunities = [
      {
        form: 'https://example.com/form1',
        formsource: 'source1',
        pageviews: 1000,
      },
      {
        form: 'https://example.com/form1',
        formsource: 'source2',
        pageviews: 1500,
      },
      {
        form: 'https://example.com/form2',
        formsource: 'source1',
        pageviews: 2000,
      },
    ];

    // INVALIDATED opportunity matches form1 + source1 only
    const existingOpportunities = [
      {
        getType: () => FORM_OPPORTUNITY_TYPES.LOW_CONVERSION,
        getData: () => ({
          form: 'https://example.com/form1',
          formsource: 'source1',
        }),
        getStatus: () => 'IGNORED',
      },
    ];

    const result = applyOpportunityFilters(
      filteredOpportunities,
      existingOpportunities,
      FORM_OPPORTUNITY_TYPES.LOW_CONVERSION,
      logStub,
      2,
    );

    // Should filter out form1+source1, but keep form1+source2 and form2+source1
    expect(result).to.have.lengthOf(2);
    expect(result[0].form).to.equal('https://example.com/form2');
    expect(result[0].formsource).to.equal('source1');
    expect(result[1].form).to.equal('https://example.com/form1');
    expect(result[1].formsource).to.equal('source2');
    expect(logStub.debug).to.have.been.calledOnce;
  });

  it('should not filter opportunity if formsource does not match', () => {
    const filteredOpportunities = [
      {
        form: 'https://example.com/contact',
        formsource: '.contact-form-v2',
        pageviews: 1000,
      },
      {
        form: 'https://example.com/newsletter',
        formsource: '.newsletter-form',
        pageviews: 2000,
      },
    ];

    // INVALIDATED opportunity has same form but different formsource
    const existingOpportunities = [
      {
        getType: () => FORM_OPPORTUNITY_TYPES.LOW_CONVERSION,
        getData: () => ({
          form: 'https://example.com/contact',
          formsource: '.contact-form-v1',
        }),
        getStatus: () => 'IGNORED',
      },
    ];

    const result = applyOpportunityFilters(
      filteredOpportunities,
      existingOpportunities,
      FORM_OPPORTUNITY_TYPES.LOW_CONVERSION,
      logStub,
      2,
    );

    // Should NOT filter out because formsource doesn't match
    expect(result).to.have.lengthOf(2);
    expect(result[0].form).to.equal('https://example.com/newsletter');
    expect(result[1].form).to.equal('https://example.com/contact');
    expect(logStub.debug).to.not.have.been.called;
  });

  it('should return all opportunities when count is less than or equal to maxLimit', () => {
    const filteredOpportunities = [
      {
        form: 'https://example.com/form1',
        formsource: 'source1',
        pageviews: 1000,
      },
      {
        form: 'https://example.com/form2',
        formsource: 'source2',
        pageviews: 1500,
      },
    ];

    const existingOpportunities = [];

    const result = applyOpportunityFilters(
      filteredOpportunities,
      existingOpportunities,
      FORM_OPPORTUNITY_TYPES.LOW_CONVERSION,
      logStub,
      2,
    );

    // Should return all opportunities sorted by pageviews without any filtering
    expect(result).to.have.lengthOf(2);
    expect(result[0].pageviews).to.equal(1500);
    expect(result[1].pageviews).to.equal(1000);
  });

  it('should deduplicate by formsource and keep highest pageviews', () => {
    const filteredOpportunities = [
      {
        form: 'https://example.com/form1',
        formsource: 'shared-source',
        pageviews: 1000,
      },
      {
        form: 'https://example.com/form2',
        formsource: 'shared-source',
        pageviews: 2000,
      },
      {
        form: 'https://example.com/form3',
        formsource: 'unique-source',
        pageviews: 1500,
      },
      {
        form: 'https://example.com/form4',
        formsource: 'another-source',
        pageviews: 1800,
      },
    ];

    const existingOpportunities = [];

    const result = applyOpportunityFilters(
      filteredOpportunities,
      existingOpportunities,
      FORM_OPPORTUNITY_TYPES.LOW_CONVERSION,
      logStub,
      2,
    );

    // Should deduplicate by formsource, keeping form2 (highest pageviews for shared-source)
    // Then limit to top 2 by pageviews
    expect(result).to.have.lengthOf(2);
    expect(result[0].form).to.equal('https://example.com/form2'); // 2000 pageviews
    expect(result[1].form).to.equal('https://example.com/form4'); // 1800 pageviews
  });
});
