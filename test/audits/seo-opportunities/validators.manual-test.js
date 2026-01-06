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
 * Manual test script for SEO indexability validators
 * Run with: node test/audits/seo-opportunities/validators.manual-test.js
 */

import { validateUrls } from '../../../src/seo-indexability-check/validators.js';

// Mock context
const context = {
  log: {
    info: (msg) => console.log(`[INFO] ${msg}`),
    warn: (msg) => console.warn(`[WARN] ${msg}`),
    error: (msg) => console.error(`[ERROR] ${msg}`),
    debug: (msg) => console.log(`[DEBUG] ${msg}`),
  },
};

// Test URLs
const testUrls = [
  {
    url: 'https://www.adobe.com/',
    primaryKeyword: 'adobe',
    position: 5,
    trafficValue: 100,
    intent: 'commercial',
  },
  {
    url: 'https://www.adobe.com/products/photoshop.html',
    primaryKeyword: 'photoshop',
    position: 8,
    trafficValue: 200,
    intent: 'commercial',
  },
  {
    url: 'https://httpstat.us/404',
    primaryKeyword: 'test 404',
    position: 10,
    trafficValue: 50,
    intent: 'test',
  },
];

console.log('🧪 Testing SEO Indexability Validators\n');
console.log(`Testing ${testUrls.length} URLs...\n`);

try {
  const results = await validateUrls(testUrls, context);

  console.log('\n📊 VALIDATION RESULTS:\n');
  console.log('='.repeat(80));

  const cleanUrls = results.filter((r) => r.indexable);
  const blockedUrls = results.filter((r) => !r.indexable);

  console.log(`\n✅ CLEAN URLs: ${cleanUrls.length}/${results.length}`);
  cleanUrls.forEach((result, index) => {
    console.log(`\n${index + 1}. ${result.url}`);
    console.log(`   Keyword: ${result.primaryKeyword} (Position: ${result.position})`);
    console.log('   Checks:');
    console.log(`     - HTTP Status: ${result.checks.httpStatus.passed ? '✓' : '✗'} (${result.checks.httpStatus.statusCode})`);
    console.log(`     - Redirects: ${result.checks.redirects.passed ? '✓' : '✗'} (${result.checks.redirects.redirectCount} redirects)`);
    console.log(`     - Canonical: ${result.checks.canonical.passed ? '✓' : '✗'}`);
    console.log(`     - Noindex: ${result.checks.noindex.passed ? '✓' : '✗'}`);
    console.log(`     - robots.txt: ${result.checks.robotsTxt.passed ? '✓' : '✗'}`);
  });

  if (blockedUrls.length > 0) {
    console.log(`\n\n❌ BLOCKED URLs: ${blockedUrls.length}/${results.length}`);
    blockedUrls.forEach((result, index) => {
      console.log(`\n${index + 1}. ${result.url}`);
      console.log(`   Keyword: ${result.primaryKeyword} (Position: ${result.position})`);
      console.log(`   Blockers: ${result.blockers.join(', ')}`);
      console.log('   Checks:');
      console.log(`     - HTTP Status: ${result.checks.httpStatus.passed ? '✓' : '✗'} (${result.checks.httpStatus.statusCode || 'N/A'})`);
      console.log(`     - Redirects: ${result.checks.redirects.passed ? '✓' : '✗'} (${result.checks.redirects.redirectCount} redirects)`);
      console.log(`     - Canonical: ${result.checks.canonical.passed ? '✓' : '✗'}`);
      console.log(`     - Noindex: ${result.checks.noindex.passed ? '✓' : '✗'}`);
      console.log(`     - robots.txt: ${result.checks.robotsTxt.passed ? '✓' : '✗'}`);
    });
  }

  console.log(`\n${'='.repeat(80)}`);
  console.log('\n📈 SUMMARY:');
  console.log(`   Total URLs: ${results.length}`);
  console.log(`   Clean: ${cleanUrls.length}`);
  console.log(`   Blocked: ${blockedUrls.length}`);
  console.log(`   Success Rate: ${((cleanUrls.length / results.length) * 100).toFixed(1)}%`);

  console.log('\n✅ Test completed successfully!\n');
} catch (error) {
  console.error('\n❌ Test failed:', error.message);
  console.error(error.stack);
  process.exit(1);
}
