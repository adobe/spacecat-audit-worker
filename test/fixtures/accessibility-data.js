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

// Sample accessibility audit data for testing
export const sampleAccessibilityData = {
  violations: [
    {
      id: 'color-contrast',
      impact: 'serious',
      description: 'Elements must have sufficient color contrast',
      help: 'Ensure all elements have sufficient contrast ratio',
      helpUrl: 'https://dequeuniversity.com/rules/axe/4.4/color-contrast?application=axeAPI',
      nodes: [
        {
          target: ['#header h1'],
          html: '<h1 id="main-title">Welcome</h1>',
          failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 2.55 (foreground color: #666666, background color: #ffffff, font size: 24.0pt (32px), font weight: normal). Expected contrast ratio of 3:1',
        },
        {
          target: ['.nav-link'],
          html: '<a class="nav-link" href="/about">About</a>',
          failureSummary: 'Fix any of the following:\n  Element has insufficient color contrast of 2.12 (foreground color: #999999, background color: #ffffff, font size: 12.0pt (16px), font weight: normal). Expected contrast ratio of 4.5:1',
        },
      ],
    },
    {
      id: 'image-alt',
      impact: 'critical',
      description: 'Images must have alternative text',
      help: 'All img elements must have an alt attribute',
      helpUrl: 'https://dequeuniversity.com/rules/axe/4.4/image-alt?application=axeAPI',
      nodes: [
        {
          target: ['img[src="hero.jpg"]'],
          html: '<img src="hero.jpg" width="800" height="400">',
          failureSummary: 'Fix any of the following:\n  Element does not have an alt attribute\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute\n  Element\'s default semantics were not overridden with role="none" or role="presentation"',
        },
      ],
    },
    {
      id: 'heading-order',
      impact: 'moderate',
      description: 'Heading levels should only increase by one',
      help: 'Ensure headings are in a logical order',
      helpUrl: 'https://dequeuniversity.com/rules/axe/4.4/heading-order?application=axeAPI',
      nodes: [
        {
          target: ['h4'],
          html: '<h4>Section Title</h4>',
          failureSummary: 'Fix any of the following:\n  Heading order invalid',
        },
      ],
    },
    {
      id: 'link-name',
      impact: 'serious',
      description: 'Links must have discernible text',
      help: 'All links must have accessible text',
      helpUrl: 'https://dequeuniversity.com/rules/axe/4.4/link-name?application=axeAPI',
      nodes: [
        {
          target: ['a[href="contact.html"]'],
          html: '<a href="contact.html"><img src="contact-icon.png"></a>',
          failureSummary: 'Fix any of the following:\n  Element does not have text that is visible to screen readers\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute',
        },
      ],
    },
  ],
  passes: [
    {
      id: 'document-title',
      impact: null,
      description: 'Documents must have <title> element to aid in navigation',
      help: 'Document must have a title element',
      helpUrl: 'https://dequeuniversity.com/rules/axe/4.4/document-title?application=axeAPI',
      nodes: [
        {
          target: ['title'],
          html: '<title>Home Page - Example Site</title>',
        },
      ],
    },
  ],
  incomplete: [],
  inapplicable: [
    {
      id: 'accesskeys',
      impact: null,
      description: 'accesskey attribute value must be unique',
      help: 'accesskey attribute value should be unique',
      helpUrl: 'https://dequeuniversity.com/rules/axe/4.4/accesskeys?application=axeAPI',
      nodes: [],
    },
  ],
  url: 'https://example.com/',
  timestamp: '2024-01-15T10:30:00.000Z',
};

export const sampleAccessibilityDataWithoutViolations = {
  violations: [],
  passes: [
    {
      id: 'document-title',
      impact: null,
      description: 'Documents must have <title> element to aid in navigation',
      help: 'Document must have a title element',
      helpUrl: 'https://dequeuniversity.com/rules/axe/4.4/document-title?application=axeAPI',
      nodes: [
        {
          target: ['title'],
          html: '<title>Accessible Page - Example Site</title>',
        },
      ],
    },
    {
      id: 'color-contrast',
      impact: null,
      description: 'Elements must have sufficient color contrast',
      help: 'Ensure all elements have sufficient contrast ratio',
      helpUrl: 'https://dequeuniversity.com/rules/axe/4.4/color-contrast?application=axeAPI',
      nodes: [
        {
          target: ['h1'],
          html: '<h1>Accessible Heading</h1>',
        },
      ],
    },
  ],
  incomplete: [],
  inapplicable: [],
  url: 'https://example.com/accessible-page',
  timestamp: '2024-01-15T10:30:00.000Z',
};

export const sampleAggregatedAccessibilityData = {
  overall: {
    violations: {
      total: 7,
      critical: {
        count: 1,
        items: {
          'image-alt': {
            count: 1,
            description: 'Images must have alternative text',
            help: 'All img elements must have an alt attribute',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.4/image-alt?application=axeAPI',
            impact: 'critical',
            nodes: [
              {
                target: ['img[src="hero.jpg"]'],
                html: '<img src="hero.jpg" width="800" height="400">',
                url: 'https://example.com/',
              },
            ],
          },
        },
      },
      serious: {
        count: 5,
        items: {
          'color-contrast': {
            count: 2,
            description: 'Elements must have sufficient color contrast',
            help: 'Ensure all elements have sufficient contrast ratio',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.4/color-contrast?application=axeAPI',
            impact: 'serious',
            nodes: [
              {
                target: ['#header h1'],
                html: '<h1 id="main-title">Welcome</h1>',
                url: 'https://example.com/',
              },
              {
                target: ['.nav-link'],
                html: '<a class="nav-link" href="/about">About</a>',
                url: 'https://example.com/',
              },
            ],
          },
          'link-name': {
            count: 3,
            description: 'Links must have discernible text',
            help: 'All links must have accessible text',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.4/link-name?application=axeAPI',
            impact: 'serious',
            nodes: [
              {
                target: ['a[href="contact.html"]'],
                html: '<a href="contact.html"><img src="contact-icon.png"></a>',
                url: 'https://example.com/',
              },
              {
                target: ['a[href="services.html"]'],
                html: '<a href="services.html"></a>',
                url: 'https://example.com/about',
              },
              {
                target: ['a[href="portfolio.html"]'],
                html: '<a href="portfolio.html"><span></span></a>',
                url: 'https://example.com/services',
              },
            ],
          },
        },
      },
      moderate: {
        count: 1,
        items: {
          'heading-order': {
            count: 1,
            description: 'Heading levels should only increase by one',
            help: 'Ensure headings are in a logical order',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.4/heading-order?application=axeAPI',
            impact: 'moderate',
            nodes: [
              {
                target: ['h4'],
                html: '<h4>Section Title</h4>',
                url: 'https://example.com/',
              },
            ],
          },
        },
      },
      minor: {
        count: 0,
        items: {},
      },
    },
  },
  'https://example.com/': {
    violations: {
      total: 4,
      critical: { count: 1 },
      serious: { count: 2 },
      moderate: { count: 1 },
      minor: { count: 0 },
    },
    passes: 15,
    incomplete: 0,
    inapplicable: 42,
  },
  'https://example.com/about': {
    violations: {
      total: 1,
      critical: { count: 0 },
      serious: { count: 1 },
      moderate: { count: 0 },
      minor: { count: 0 },
    },
    passes: 18,
    incomplete: 0,
    inapplicable: 40,
  },
  'https://example.com/services': {
    violations: {
      total: 2,
      critical: { count: 0 },
      serious: { count: 2 },
      moderate: { count: 0 },
      minor: { count: 0 },
    },
    passes: 16,
    incomplete: 1,
    inapplicable: 38,
  },
};

export const sampleSitemapData = {
  paths: [
    { url: 'https://example.com/' },
    { url: 'https://example.com/about' },
    { url: 'https://example.com/services' },
    { url: 'https://example.com/portfolio' },
    { url: 'https://example.com/contact' },
    { url: 'https://example.com/blog' },
    { url: 'https://example.com/blog/post-1' },
    { url: 'https://example.com/blog/post-2' },
    { url: 'https://example.com/products' },
    { url: 'https://example.com/products/product-1' },
  ],
};

export const largeSitemapData = {
  paths: Array.from({ length: 50 }, (_, i) => ({
    url: `https://example.com/page${i + 1}`,
  })),
};

export const sampleFinalResultFiles = {
  current: sampleAggregatedAccessibilityData,
  lastWeek: {
    overall: {
      violations: {
        total: 5,
        critical: { count: 1 },
        serious: { count: 3 },
        moderate: { count: 1 },
        minor: { count: 0 },
      },
    },
    'https://example.com/': {
      violations: {
        total: 3,
        critical: { count: 1 },
        serious: { count: 1 },
        moderate: { count: 1 },
        minor: { count: 0 },
      },
      passes: 15,
      incomplete: 0,
      inapplicable: 42,
    },
    'https://example.com/about': {
      violations: {
        total: 2,
        critical: { count: 0 },
        serious: { count: 2 },
        moderate: { count: 0 },
        minor: { count: 0 },
      },
      passes: 18,
      incomplete: 0,
      inapplicable: 40,
    },
  },
};

export const sampleMalformedAccessibilityData = {
  // Missing violations array
  someProperty: 'value',
  anotherProperty: {
    nested: 'data',
  },
  url: 'https://example.com/malformed',
  timestamp: '2024-01-15T10:30:00.000Z',
};

export const sampleEmptyAccessibilityData = {
  violations: [],
  passes: [],
  incomplete: [],
  inapplicable: [],
  url: 'https://example.com/empty',
  timestamp: '2024-01-15T10:30:00.000Z',
};
