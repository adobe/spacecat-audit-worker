/*
 * Copyright 2026 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import {
  classifyTopic,
  classifyPageType,
  hasClassificationRules,
  createClassifier,
} from '../../src/common/agentic-url-classification.js';
import {
  buildTopicExtractionSQL,
  generatePageTypeClassification,
} from '../../src/cdn-logs-report/utils/query-builder.js';

use(sinonChai);

describe('agentic-url-classification', () => {
  describe('classifyTopic', () => {
    it('returns the first matching named pattern, in order', () => {
      const patterns = [
        { name: 'Acrobat', regex: '/acrobat' },
        { name: 'Photoshop', regex: '/photoshop' },
      ];
      expect(classifyTopic('/acrobat/free', patterns)).to.equal('Acrobat');
      expect(classifyTopic('/photoshop/learn', patterns)).to.equal('Photoshop');
    });

    it('honours a leading (?i) inline flag as case-insensitive', () => {
      const patterns = [{ name: 'Acrobat', regex: '(?i)/acrobat' }];
      expect(classifyTopic('/ACROBAT/free', patterns)).to.equal('Acrobat');
    });

    it('falls back to extract patterns (capture group 1) when no named match', () => {
      const patterns = [{ regex: '/products/([^/]+)' }];
      expect(classifyTopic('/products/lightroom', patterns)).to.equal('lightroom');
    });

    it('prefers a named match over an extract pattern', () => {
      const patterns = [
        { name: 'Acrobat', regex: '/acrobat' },
        { regex: '/([^/]+)' },
      ];
      expect(classifyTopic('/acrobat/x', patterns)).to.equal('Acrobat');
    });

    it("returns 'Other' when no pattern matches", () => {
      const patterns = [{ name: 'Acrobat', regex: '/acrobat' }, { regex: '/products/([^/]+)' }];
      expect(classifyTopic('/blog', patterns)).to.equal('Other');
    });

    it("returns 'Other' when extract match has an empty capture group", () => {
      const patterns = [{ regex: '/page(\\d*)' }];
      expect(classifyTopic('/page', patterns)).to.equal('Other');
    });

    it('skips named patterns whose regex fails to compile', () => {
      const patterns = [{ name: 'Bad', regex: '(' }, { name: 'Acrobat', regex: '/acrobat' }];
      expect(classifyTopic('/acrobat', patterns)).to.equal('Acrobat');
    });

    it('skips extract patterns whose regex fails to compile', () => {
      const patterns = [{ regex: '(' }];
      expect(classifyTopic('/anything', patterns)).to.equal('Other');
    });

    it("defaults to 'Other' with no patterns", () => {
      expect(classifyTopic('/x')).to.equal('Other');
    });
  });

  describe('classifyPageType', () => {
    it('returns the first matching named pattern', () => {
      const patterns = [
        { name: 'Product', regex: '/products/' },
        { name: 'Blog', regex: '/blog/' },
      ];
      expect(classifyPageType('/blog/post-1', patterns)).to.equal('Blog');
    });

    it('honours a leading (?i) inline flag', () => {
      const patterns = [{ name: 'Blog', regex: '(?i)/blog/' }];
      expect(classifyPageType('/BLOG/x', patterns)).to.equal('Blog');
    });

    it('skips patterns whose regex fails to compile', () => {
      const patterns = [{ name: 'Bad', regex: '(' }, { name: 'Blog', regex: '/blog/' }];
      expect(classifyPageType('/blog/x', patterns)).to.equal('Blog');
    });

    it("returns 'Other' when no pattern matches", () => {
      expect(classifyPageType('/x', [{ name: 'Blog', regex: '/blog/' }])).to.equal('Other');
    });

    it("defaults to 'Other' with no patterns", () => {
      expect(classifyPageType('/x')).to.equal('Other');
    });

    // KNOWN DIVERGENCE from the SQL twin (see classifyPageType doc). For an
    // explicitly empty name ('') both JS and SQL emit '' — they agree. For a
    // missing (undefined) or null name they DIVERGE: SQL interpolates
    // sqlEscape(undefined)/sqlEscape(null) → the literal tokens 'undefined'/
    // 'null', whereas JS returns '' via `name ?? ''`. The JS behavior is
    // deliberate (the literal tokens are a bug, not a label worth matching), so
    // the mechanical SQL-twin parity block below uses non-empty page names to
    // avoid asserting against this intentional divergence.
    it("returns '' (agrees with SQL) when a matching page rule has an explicitly empty name", () => {
      expect(classifyPageType('/x', [{ name: '', regex: '/x' }])).to.equal('');
    });

    it("returns '' (DIVERGES from SQL 'undefined') when a matching page rule has a missing name", () => {
      expect(classifyPageType('/x', [{ regex: '/x' }])).to.equal('');
    });

    it("returns '' (DIVERGES from SQL 'null') when a matching page rule has a null name", () => {
      expect(classifyPageType('/x', [{ name: null, regex: '/x' }])).to.equal('');
    });
  });

  describe('hasClassificationRules', () => {
    it('returns false for null', () => {
      expect(hasClassificationRules(null)).to.equal(false);
    });

    it('returns false for an error result', () => {
      expect(hasClassificationRules({ error: true, source: 'postgres' })).to.equal(false);
    });

    it('returns false when both pattern lists are empty', () => {
      expect(hasClassificationRules({ topicPatterns: [], pagePatterns: [] })).to.equal(false);
    });

    it('returns true when topic patterns are present', () => {
      expect(hasClassificationRules({ topicPatterns: [{ regex: '/x' }], pagePatterns: [] }))
        .to.equal(true);
    });

    it('returns true when page patterns are present', () => {
      expect(hasClassificationRules({ topicPatterns: [], pagePatterns: [{ regex: '/x' }] }))
        .to.equal(true);
    });
  });

  // I10: edge inputs for toRegExp guards, exercised via the public API.
  describe('regex compile guards (I10)', () => {
    it('drops a null regex source instead of matching literal text', () => {
      // `new RegExp(null)` would compile to /null/ and match 'null' — must drop.
      expect(classifyTopic('null', [{ name: 'X', regex: null }])).to.equal('Other');
    });

    it('drops an undefined regex source instead of matching literal "undefined"', () => {
      expect(classifyTopic('undefined', [{ name: 'X', regex: undefined }])).to.equal('Other');
    });

    it('drops a non-string (number) regex source', () => {
      expect(classifyTopic('123', [{ name: 'X', regex: 123 }])).to.equal('Other');
    });

    it('compiles an empty-string regex (matches everything) for a named topic', () => {
      // Empty source is a valid regex that matches any input.
      expect(classifyTopic('/anything', [{ name: 'Empty', regex: '' }])).to.equal('Empty');
    });
  });

  // I3: ReDoS magnitude guards.
  describe('ReDoS guards (I3)', () => {
    it('caps the input length before matching (oversized URL)', () => {
      // End-anchored pattern: it matches the FULL string but NOT the capped
      // 2048-char prefix (whose tail '/blog' is sliced off). So the cap is what
      // produces 'Other' — removing the cap would match and flip to 'Blog'.
      const longPath = `${'a'.repeat(3000)}/blog`;
      expect(/\/blog$/.test(longPath)).to.equal(true); // full string matches
      expect(classifyPageType(longPath, [{ name: 'Blog', regex: '/blog$' }]))
        .to.equal('Other');
    });

    it('still matches within the capped prefix', () => {
      const longPath = `/blog/${'a'.repeat(3000)}`;
      expect(classifyPageType(longPath, [{ name: 'Blog', regex: '^/blog' }]))
        .to.equal('Blog');
    });

    it('rejects a pattern source exceeding the max length', () => {
      // Pattern len 1002 (> MAX_PATTERN_LENGTH 1000). The input SATISFIES the
      // pattern, so if the length rejection were removed the rule would compile,
      // match, and label 'Huge' — the rejection is what yields 'Other'.
      const huge = `/${'a'.repeat(1001)}`;
      const input = `/${'a'.repeat(1001)}`;
      expect(huge.length).to.equal(1002);
      expect(classifyTopic(input, [{ name: 'Huge', regex: huge }])).to.equal('Other');
    });

    it('rejects a nested unbounded quantifier (catastrophic shape)', () => {
      expect(classifyTopic('aaaa', [{ name: 'Evil', regex: '(a+)+' }])).to.equal('Other');
    });

    // Exponential blow-up is input-length-INDEPENDENT, so the input cap does NOT
    // bound it — these shapes must be rejected at compile time by the heuristic.
    it('rejects a single-char alternation overlap (a|a)+', () => {
      expect(classifyTopic('aaaa', [{ name: 'Evil', regex: '(a|a)+' }])).to.equal('Other');
    });

    it('rejects a multi-char alternation overlap (a|aa)+', () => {
      expect(classifyTopic('aaaa', [{ name: 'Evil', regex: '(a|aa)+' }])).to.equal('Other');
    });

    it('rejects a doubly-nested group (([a-z])+)+', () => {
      expect(classifyTopic('abcd', [{ name: 'Evil', regex: '(([a-z])+)+' }])).to.equal('Other');
    });

    // Form (b): the inner group CONTAINS the unbounded quantifier (`+`/`*` before
    // the inner `)`) rather than wrapping it. Distinct from `(([a-z])+)+` above;
    // `((a+))+` hangs V8 on a ~30-char input, so it must be screened at compile.
    it('rejects a doubly-nested inner-quantifier group ((a+))+', () => {
      expect(classifyTopic('aaaa', [{ name: 'Evil', regex: '((a+))+' }])).to.equal('Other');
    });

    it('rejects a doubly-nested inner-quantifier class (([a-z]+))+', () => {
      expect(classifyTopic('abcd', [{ name: 'Evil', regex: '(([a-z]+))+' }])).to.equal('Other');
    });

    it('rejects a doubly-nested inner-star group ((a*))*', () => {
      expect(classifyTopic('aaaa', [{ name: 'Evil', regex: '((a*))*' }])).to.equal('Other');
    });

    it('rejects a bounded repeat of a greedy group (.*a){20}', () => {
      // The compiled regex DOES match this input (>=20 'a'), so removing the
      // guard would flip the label to 'Evil' — the guard is what yields 'Other'.
      expect(classifyTopic('a'.repeat(20), [{ name: 'Evil', regex: '(.*a){20}' }]))
        .to.equal('Other');
    });

    // A bounded-range {m,n} group repeated by an outer +/*/{ is exponential and
    // input-length-INDEPENDENT (a ~30-char input already hangs V8), so the input
    // cap cannot bound it — these must be rejected at compile time. The compiled
    // regex WOULD match the input below, so guard-removal flips the label.
    it('rejects a bounded-range group repeated by + (a{1,3})+', () => {
      expect(classifyTopic('aaaa', [{ name: 'Evil', regex: '(a{1,3})+' }])).to.equal('Other');
    });

    it('rejects a bounded-range group repeated by * (a{1,2})*', () => {
      expect(classifyTopic('aaaa', [{ name: 'Evil', regex: '(a{1,2})*' }])).to.equal('Other');
    });

    it('rejects a bounded-range class repeated by + ([a-z]{1,2})+', () => {
      expect(classifyTopic('abcd', [{ name: 'Evil', regex: '([a-z]{1,2})+' }])).to.equal('Other');
    });

    it('rejects a bounded-range \\w class repeated by + (\\w{1,2})+', () => {
      expect(classifyTopic('abcd', [{ name: 'Evil', regex: '(\\w{1,2})+' }])).to.equal('Other');
    });

    it('does NOT reject a standalone bounded range ([a-z]{2,4})', () => {
      // No outer repeat → linear → must compile and match normally.
      expect(classifyTopic('/product/ab', [{ regex: '/product/([a-z]{2,4})' }])).to.equal('ab');
    });

    it('does NOT reject a single bounded capture group', () => {
      expect(classifyTopic('/products/x', [{ regex: '/products/([^/]+)' }])).to.equal('x');
    });

    it('does NOT count safe bounded-range / single-group patterns as ReDoS rejections', () => {
      // Pins the over-broad-screen boundary: these safe shapes must COMPILE
      // (zero failures → no warn), proving the heuristic did not fire on them.
      // Without this, the "does NOT reject" tests above only prove a match, not
      // that the heuristic abstained.
      const log = { warn: sinon.spy() };
      createClassifier({
        topicPatterns: [
          { name: 'Range', regex: '/product/([a-z]{2,4})' },
          { name: 'Group', regex: '/products/([^/]+)' },
        ],
      }, { log });
      expect(log.warn).to.not.have.been.called;
    });
  });

  // I2: parity with the SQL twin in query-builder.js.
  describe('SQL twin parity (I2)', () => {
    it('named topic CASE: first matching rule wins in order', () => {
      // Mirrors buildTopicExtractionSQL named-only CASE ... ELSE 'Other'.
      const patterns = [
        { name: 'First', regex: '/shared' },
        { name: 'Second', regex: '/shared' },
      ];
      expect(classifyTopic('/shared/x', patterns)).to.equal('First');
    });

    it('unnamed topic extract: COALESCE first non-empty group-1 wins', () => {
      // Mirrors COALESCE(NULLIF(REGEXP_EXTRACT(...,1),''), ..., 'Other').
      const patterns = [
        { regex: '/empty(x*)' },
        { regex: '/cat/([^/]+)' },
      ];
      expect(classifyTopic('/empty/cat/shoes', patterns)).to.equal('shoes');
    });

    it('combined topic: named CASE evaluated before extract COALESCE', () => {
      const patterns = [
        { name: 'Named', regex: '/named' },
        { regex: '/([^/]+)' },
      ];
      expect(classifyTopic('/named/y', patterns)).to.equal('Named');
      expect(classifyTopic('/other/y', patterns)).to.equal('other');
    });

    it("empty-name ('') topic rule routes to extract (group 1), not a named CASE arm", () => {
      // !pattern.name is falsy for '' → treated as an unnamed extract rule,
      // mirroring buildTopicExtractionSQL which emits a named CASE arm only for
      // a truthy name. Group-1 capture supplies the label; a named-CASE misroute
      // would instead yield the empty name.
      expect(classifyTopic('/cat/shoes', [{ name: '', regex: '/cat/([^/]+)' }])).to.equal('shoes');
    });

    it("topic falls back to 'Other' (mirrors ELSE/COALESCE tail)", () => {
      expect(classifyTopic('/none', [{ name: 'X', regex: '/zzz' }, { regex: '/yyy/([^/]+)' }]))
        .to.equal('Other');
    });

    it("page type falls back to 'Other' (mirrors CASE ELSE 'Other')", () => {
      expect(classifyPageType('/none', [{ name: 'Blog', regex: '/blog' }])).to.equal('Other');
    });

    // M7: alternation branch with no capture → group 1 undefined → COALESCE skips it.
    it('M7: extract pattern whose matched branch has no capture skips to next', () => {
      const patterns = [
        { regex: '(?:/skip)|/take/([^/]+)' },
        { regex: '/fallback/([^/]+)' },
      ];
      // First pattern matches the '/skip' branch (group 1 undefined) on this URL...
      expect(classifyTopic('/skip/fallback/here', patterns)).to.equal('here');
    });

    it('M7: extract pattern uses the captured branch when it matches', () => {
      const patterns = [{ regex: '(?:/skip)|/take/([^/]+)' }];
      expect(classifyTopic('/take/value', patterns)).to.equal('value');
    });
  });

  // I2 (mechanical): rather than hand-mirroring individual SQL shapes, parse the
  // ACTUAL strings emitted by buildTopicExtractionSQL / generatePageTypeClassification
  // and interpret them with the same matching semantics the JS classifier uses,
  // then assert the two agree over a probe set. This fails loudly if a SQL edit
  // drifts from the JS twin (arm order, named-vs-extract split, COALESCE/CASE form,
  // or the 'Other' tail).
  describe('SQL twin parity — mechanical (I2)', () => {
    // SQL single-quote un-escape: sqlEscape doubles `'`; reverse it.
    const sqlUnescape = (s) => s.replace(/''/g, "'");

    // Interpret generated topic SQL: named WHEN arms first (CASE), then extract
    // REGEXP_EXTRACT group-1 (COALESCE), then 'Other'. Mirrors applyTopic.
    const interpretTopicSql = (sql, url) => {
      const named = [...sql.matchAll(/WHEN REGEXP_LIKE\(url, '((?:[^']|'')*)'\) THEN '((?:[^']|'')*)'/g)]
        .map((m) => ({ re: new RegExp(sqlUnescape(m[1])), name: sqlUnescape(m[2]) }));
      for (const { re, name } of named) {
        if (re.test(url)) {
          return name;
        }
      }
      const extracts = [...sql.matchAll(/REGEXP_EXTRACT\(url, '((?:[^']|'')*)', 1\)/g)]
        .map((m) => new RegExp(sqlUnescape(m[1])));
      for (const re of extracts) {
        const match = re.exec(url);
        if (match && match[1]) {
          return match[1];
        }
      }
      return 'Other';
    };

    // Interpret generated page-type SQL: first matching WHEN arm wins, else 'Other'.
    // Mirrors applyPageType. Fixture uses non-empty names to avoid the documented
    // empty/missing-name KNOWN DIVERGENCE.
    const interpretPageSql = (sql, url) => {
      const arms = [...sql.matchAll(/WHEN REGEXP_LIKE\(url, '((?:[^']|'')*)'\) THEN '((?:[^']|'')*)'/g)]
        .map((m) => ({ re: new RegExp(sqlUnescape(m[1])), name: sqlUnescape(m[2]) }));
      for (const { re, name } of arms) {
        if (re.test(url)) {
          return name;
        }
      }
      return 'Other';
    };

    // Fixture: NO sort_order (JS sorts by it, SQL builder emits array order — so
    // equal array order keeps both aligned). Dialect-agnostic regexes only.
    // NOTE: a leading `(?i)` inline flag is EXCLUDED here by necessity, not
    // oversight — the SQL interpreter compiles the raw rule source with
    // `new RegExp`, and V8 throws on `(?i)` (an invalid group), so it cannot
    // cross-check the one construct where the JS classifier and Trino RE2J
    // genuinely diverge. `(?i)` handling is covered JS-side in isolation by the
    // "honours a leading (?i) inline flag" cases above.
    const rules = {
      topicPatterns: [
        { name: 'Acrobat', regex: '/acrobat' },
        { name: 'Photoshop', regex: '/photoshop' },
        { regex: '/products/([^/]+)' },
      ],
      pagePatterns: [
        { name: 'Product', regex: '/products/' },
        { name: 'Blog', regex: '/blog/' },
      ],
    };
    const probes = [
      '/acrobat/free',
      '/photoshop/x',
      '/products/lightroom',
      '/products/',
      '/blog',
      '/blog/post',
      '/about',
    ];

    it('topic: JS classifyTopic agrees with interpreted buildTopicExtractionSQL on every probe', () => {
      const sql = buildTopicExtractionSQL(rules);
      for (const url of probes) {
        expect(classifyTopic(url, rules.topicPatterns), `topic mismatch for ${url}`)
          .to.equal(interpretTopicSql(sql, url));
      }
    });

    it('page: JS classifyPageType agrees with interpreted generatePageTypeClassification on every probe', () => {
      const sql = generatePageTypeClassification(rules);
      for (const url of probes) {
        expect(classifyPageType(url, rules.pagePatterns), `page mismatch for ${url}`)
          .to.equal(interpretPageSql(sql, url));
      }
    });

    it('empty rule set: both builders fall back to Other-only, agreeing with JS', () => {
      const topicSql = buildTopicExtractionSQL(null);
      const pageSql = generatePageTypeClassification(null);
      // The SQL-side 'Other' assertion is otherwise vacuous (the interpreter
      // returns 'Other' for ANY input given an Other-only CASE), so first assert
      // the generated SQL really IS Other-only: no WHEN arms and no
      // REGEXP_EXTRACT — i.e. there is nothing for a probe to match against.
      expect(topicSql).to.not.match(/WHEN REGEXP_LIKE/);
      expect(topicSql).to.not.match(/REGEXP_EXTRACT/);
      expect(pageSql).to.not.match(/WHEN REGEXP_LIKE/);
      for (const url of probes) {
        expect(interpretTopicSql(topicSql, url)).to.equal('Other');
        expect(classifyTopic(url, [])).to.equal('Other');
        expect(interpretPageSql(pageSql, url)).to.equal('Other');
        expect(classifyPageType(url, [])).to.equal('Other');
      }
    });
  });

  // M2: sort_order ordering.
  describe('sort_order honoured (M2)', () => {
    it('applies named topic rules in sort_order ascending, not array order', () => {
      const patterns = [
        { name: 'Second', regex: '/shared', sort_order: 2 },
        { name: 'First', regex: '/shared', sort_order: 1 },
      ];
      expect(classifyTopic('/shared/x', patterns)).to.equal('First');
    });

    it('falls back to array order when sort_order is absent (stable)', () => {
      const patterns = [
        { name: 'First', regex: '/shared' },
        { name: 'Second', regex: '/shared' },
      ];
      expect(classifyTopic('/shared/x', patterns)).to.equal('First');
    });

    it('falls back to array order when sort_order is non-integer', () => {
      const patterns = [
        { name: 'First', regex: '/shared', sort_order: 'x' },
        { name: 'Second', regex: '/shared', sort_order: null },
      ];
      expect(classifyTopic('/shared/x', patterns)).to.equal('First');
    });

    it('breaks ties on equal sort_order by stable array order', () => {
      const patterns = [
        { name: 'First', regex: '/shared', sort_order: 1 },
        { name: 'Second', regex: '/shared', sort_order: 1 },
      ];
      expect(classifyTopic('/shared/x', patterns)).to.equal('First');
    });

    it('orders page rules by sort_order ascending', () => {
      const patterns = [
        { name: 'B', regex: '/p', sort_order: 5 },
        { name: 'A', regex: '/p', sort_order: 1 },
      ];
      expect(classifyPageType('/p/x', patterns)).to.equal('A');
    });
  });

  describe('createClassifier (M1)', () => {
    it('returns null when no rules are present', () => {
      expect(createClassifier(null)).to.equal(null);
      expect(createClassifier({ topicPatterns: [], pagePatterns: [] })).to.equal(null);
      expect(createClassifier({ error: true })).to.equal(null);
    });

    it('classifies topic and category from a compiled rule set', () => {
      const classifier = createClassifier({
        topicPatterns: [{ name: 'Acrobat', regex: '/acrobat' }],
        pagePatterns: [{ name: 'Product', regex: '/acrobat' }],
      });
      expect(classifier.classify('/acrobat/free'))
        .to.deep.equal({ topic: 'Acrobat', category: 'Product' });
    });

    it('reuses the compiled patterns across multiple classify calls', () => {
      const classifier = createClassifier({
        topicPatterns: [{ name: 'A', regex: '/a' }, { regex: '/x/([^/]+)' }],
      });
      expect(classifier.classify('/a/1')).to.deep.equal({ topic: 'A', category: 'Other' });
      expect(classifier.classify('/x/y')).to.deep.equal({ topic: 'y', category: 'Other' });
      expect(classifier.classify('/none')).to.deep.equal({ topic: 'Other', category: 'Other' });
    });

    it('caps the input length on classify', () => {
      const classifier = createClassifier({
        topicPatterns: [{ name: 'Tail', regex: 'a{2500}' }],
      });
      expect(classifier.classify('a'.repeat(3000)).topic).to.equal('Other');
    });

    it('emits ONE aggregated log.warn for dropped patterns at construction', () => {
      const log = { warn: sinon.spy() };
      createClassifier({
        topicPatterns: [{ name: 'Bad', regex: '(' }],
        pagePatterns: [{ name: 'AlsoBad', regex: '[' }, { name: 'Good', regex: '/g' }],
      }, { log });
      expect(log.warn).to.have.been.calledOnce;
      expect(log.warn.firstCall.args[0]).to.match(
        /agentic-url-classification: 2 rule pattern\(s\) skipped/,
      );
    });

    it('does not warn when no patterns are dropped', () => {
      const log = { warn: sinon.spy() };
      createClassifier({ topicPatterns: [{ name: 'Good', regex: '/g' }] }, { log });
      expect(log.warn).to.not.have.been.called;
    });

    it('counts null / undefined / non-string regex sources as dropped patterns', () => {
      // toRegExp rejects non-string sources (typeof !== 'string') → each must
      // increment the failure tally, not be silently ignored. Pins that the
      // aggregated warn reflects all three drops.
      const log = { warn: sinon.spy() };
      createClassifier({
        topicPatterns: [
          { name: 'NullSrc', regex: null },
          { name: 'UndefSrc', regex: undefined },
          { name: 'NumSrc', regex: 123 },
        ],
      }, { log });
      expect(log.warn).to.have.been.calledOnce;
      expect(log.warn.firstCall.args[0]).to.match(
        /agentic-url-classification: 3 rule pattern\(s\) skipped/,
      );
    });

    it('does not throw when patterns are dropped without a log', () => {
      const classifier = createClassifier({ topicPatterns: [{ name: 'Bad', regex: '(' }, { name: 'G', regex: '/g' }] });
      expect(classifier.classify('/g')).to.deep.equal({ topic: 'G', category: 'Other' });
    });

    it('does not throw when patterns are dropped and log has no warn fn', () => {
      // log present but log.warn undefined → the `log?.warn` guard must hold
      // (log truthy, .warn falsy). Distinct branch from the no-log case above.
      const classifier = createClassifier(
        { topicPatterns: [{ name: 'Bad', regex: '(' }, { name: 'G', regex: '/g' }] },
        { log: {} },
      );
      expect(classifier.classify('/g')).to.deep.equal({ topic: 'G', category: 'Other' });
    });

    // M6: asymmetric rule sets.
    it('M6: topic-only rule set (no page patterns) → category always Other', () => {
      const classifier = createClassifier({ topicPatterns: [{ name: 'T', regex: '/t' }] });
      expect(classifier.classify('/t/x')).to.deep.equal({ topic: 'T', category: 'Other' });
    });

    it('M6: page-only rule set (no topic patterns) → topic always Other', () => {
      const classifier = createClassifier({ pagePatterns: [{ name: 'P', regex: '/p' }] });
      expect(classifier.classify('/p/x')).to.deep.equal({ topic: 'Other', category: 'P' });
    });
  });
});
