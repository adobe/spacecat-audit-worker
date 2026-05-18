#!/usr/bin/env node
/* eslint-disable no-console */
/*
 * Probe a list of URLs directly through url-signals.js — bypasses sitemap
 * sampling so we can target specific URLs we want to inspect.
 *
 * Usage: node scripts/probe-direct.js <url> [<url> ...]
 */
import { collectUrlSignals } from '../src/cdn-logs-report/patterns/url-signals.js';

const urls = process.argv.slice(2);
if (!urls.length) {
  console.error('usage: node scripts/probe-direct.js <url> [<url> ...]');
  process.exit(1);
}

const log = {
  info: (...a) => console.log('•', ...a),
  warn: (...a) => console.warn('!', ...a),
  debug: (...a) => console.log('  ·', ...a),
  error: (...a) => console.error('✗', ...a),
};

const records = urls.map((u) => ({ url: u, path: new URL(u).pathname }));
const site = { getId: () => 'probe' };
const ctx = { log, s3Client: null, env: {} };

const { records: out } = await collectUrlSignals(records, { site, context: ctx });
out.forEach((r) => {
  console.log(`──── ${r.url}`);
  if (!r.signal) {
    console.log('   FAILED');
    return;
  }
  console.log(`   title:       ${r.signal.title || '(none)'}`);
  console.log(`   h1:          ${r.signal.h1 || '(none)'}`);
  console.log(`   breadcrumb:  ${r.signal.breadcrumb.length ? r.signal.breadcrumb.join(' > ') : '(none)'}`);
  console.log(`   schemaTypes: ${r.signal.schemaTypes.length ? r.signal.schemaTypes.join(', ') : '(none)'}`);
});
