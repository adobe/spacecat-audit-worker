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

/**
 * Audit Summary Formatter
 *
 * Renders an audit's findings into the four-section remediation summary
 * documented in CLAUDE.md (Audit Summary Output Convention). Used by
 * downstream surfaces that present findings to humans (Slack alerts,
 * Jira ticket bodies, PR descriptions, audit-export PDFs).
 */

const formatList = (items) => items.map((item) => `- ${item}`).join('\n');

const formatSteps = (steps) => steps.map((step, idx) => `${idx + 1}. ${step}`).join('\n');

/**
 * @param {object} input
 * @param {string} input.serves - target audience for the remediation
 * @param {string[]} input.ingredients - data sources, prerequisites, configuration
 * @param {string[]} input.method - numbered remediation steps
 * @param {string} [input.time] - estimated best-case remediation time
 * @returns {string} markdown-formatted summary
 * @throws {TypeError} when required fields are missing or have the wrong shape
 */
export function formatAuditSummary({
  serves, ingredients, method, time,
} = {}) {
  if (typeof serves !== 'string' || serves.length === 0) {
    throw new TypeError('formatAuditSummary: `serves` must be a non-empty string');
  }
  if (!Array.isArray(ingredients) || ingredients.length === 0) {
    throw new TypeError('formatAuditSummary: `ingredients` must be a non-empty array');
  }
  if (!Array.isArray(method) || method.length === 0) {
    throw new TypeError('formatAuditSummary: `method` must be a non-empty array');
  }

  const sections = [
    '## Serves',
    serves,
    '',
    '## Ingredients',
    formatList(ingredients),
    '',
    '## Method',
    formatSteps(method),
  ];

  if (typeof time === 'string' && time.length > 0) {
    sections.push('', '## Time', time);
  }

  return sections.join('\n');
}

/**
 * Adapter that maps a finding-shaped object onto formatAuditSummary's
 * input. Audit handlers can pass their internal finding objects in
 * directly without restructuring.
 *
 * @param {object} finding
 * @param {string} finding.audience
 * @param {string[]} finding.dataSources
 * @param {string[]} finding.steps
 * @param {string} [finding.estimate]
 * @returns {string} markdown-formatted summary
 */
export function formatFinding(finding) {
  if (finding === null || typeof finding !== 'object') {
    throw new TypeError('formatFinding: `finding` must be an object');
  }
  const {
    audience, dataSources, steps, estimate,
  } = finding;
  return formatAuditSummary({
    serves: audience,
    ingredients: dataSources,
    method: steps,
    time: estimate,
  });
}
