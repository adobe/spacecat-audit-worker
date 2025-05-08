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
import { shouldExcludeForm } from '../../../src/forms-opportunities/utils.js';

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
});
