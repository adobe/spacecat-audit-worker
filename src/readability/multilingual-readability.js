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
 * Advanced multilingual readability calculation utilities
 * Uses proper hyphenation patterns and Unicode-aware text processing
 * Supports English, German, Spanish, Italian, French, and Dutch
 */

import { syllable as syllableEn } from 'syllable';

export const SUPPORTED_LANGUAGES = {
  eng: 'english',
  deu: 'german',
  spa: 'spanish',
  ita: 'italian',
  fra: 'french',
  nld: 'dutch',
};

const NAME_TO_LOCALE = {
  english: 'en',
  german: 'de',
  spanish: 'es',
  italian: 'it',
  french: 'fr',
  dutch: 'nl',
};

const clamp = (x) => Math.max(0, Math.min(100, x));

// --- Hyphenation loader (lazy) ---
/** Cache of async hyphenate functions per language name */
const hyphenatorCache = new Map();
/** Returns a function hyphenate(word) -> string[] */
async function getHyphenator(language /* 'german' etc. */) {
  const key = language.toLowerCase();
  if (hyphenatorCache.has(key)) return hyphenatorCache.get(key);

  // Load only what you need; all MIT (package "hyphen")
  let mod;
  switch (key) {
    case 'german':
      mod = await import('hyphen/de/index.js');
      break;
    case 'spanish':
      mod = await import('hyphen/es/index.js');
      break;
    case 'italian':
      mod = await import('hyphen/it/index.js');
      break;
    case 'french':
      mod = await import('hyphen/fr/index.js');
      break;
    case 'dutch':
      mod = await import('hyphen/nl/index.js');
      break;
    // english hyphenation is not used for syllables (we use syllableEn)
    default:
      mod = null;
  }
  // Handle CommonJS default export
  const hyphenate = mod?.default?.hyphenate || null;
  hyphenatorCache.set(key, hyphenate);
  return hyphenate;
}

// --- Tokenization (streaming, locale-aware) ---
function* iterateWords(text, locale) {
  const s = typeof Intl?.Segmenter === 'function'
    ? new Intl.Segmenter(locale, { granularity: 'word' }).segment(text)
    : null;

  if (s) {
    for (const seg of s) {
      const w = seg.segment;
      // keep inner apostrophes/dashes; drop other punctuation
      const cleaned = w.normalize('NFKC').replace(/[^\p{L}\p{M}\p{N}''-]/gu, '');
      if (cleaned && /[\p{L}\p{N}]/u.test(cleaned)) yield cleaned;
    }
  } else {
    // conservative fallback
    for (const w of text.split(/\s+/)) {
      const cleaned = w.normalize('NFKC').replace(/[^\p{L}\p{M}\p{N}''-]/gu, '');
      if (cleaned && /[\p{L}\p{N}]/u.test(cleaned)) yield cleaned;
    }
  }
}

function countSentences(text, locale) {
  if (typeof Intl?.Segmenter === 'function') {
    const seg = new Intl.Segmenter(locale, { granularity: 'sentence' }).segment(text);
    let n = 0;
    for (const it of seg) {
      if (/[\p{L}\p{N}]/u.test(it.segment)) n += 1;
    }
    return Math.max(n, 1);
  }
  // Conservative fallback; avoid aggressive abbreviation stripping
  const matches = text.match(/(?<!\b[A-Z])[.!?]+(?=\s|$)/g) || [];
  return Math.max(matches.length, 1);
}

// --- Syllable counting (adapter) ---
/** cheap memo for per-run caching */
function makeWordCache(limit = 2000) {
  const m = new Map();
  return {
    get(k) { return m.get(k); },
    set(k, v) {
      if (m.size >= limit) { // cheap FIFO-ish eviction
        const first = m.keys().next().value;
        m.delete(first);
      }
      m.set(k, v);
    },
  };
}

const defaultComplexThreshold = 3;

/**
 * Count syllables for a single word in a given language.
 * EN uses "syllable"; others use hyphenation splits as proxy.
 */
async function countSyllablesWord(word, language) {
  const lang = language.toLowerCase();
  if (lang === 'english') {
    return Math.max(1, syllableEn(word));
  }
  const hyphenate = await getHyphenator(lang);
  if (!hyphenate) {
    // generic Unicode vowel group fallback
    const m = word.toLowerCase().match(/[aeiouyà-ɏ]+/giu);
    return Math.max(1, m ? m.length : 1);
  }
  // Preserve inner apostrophes/dashes, remove other junk
  const cleaned = word.replace(/[^\p{L}\p{M}''-]/gu, '');
  const parts = hyphenate(cleaned);
  return Math.max(1, parts?.length || 1);
}

// --- Public API ---
export function isSupportedLanguage(codeOrName = '') {
  if (!codeOrName || typeof codeOrName !== 'string') {
    return false;
  }
  const v = codeOrName.toLowerCase();
  return Object.keys(SUPPORTED_LANGUAGES).includes(v)
         || Object.values(SUPPORTED_LANGUAGES).includes(v);
}

export function getLanguageName(francCode) {
  return SUPPORTED_LANGUAGES[francCode] || 'unknown';
}

/**
 * Analyze text and return metrics + score.
 * Options:
 * - complexThreshold: number of syllables to qualify as complex (default 3)
 */
export async function analyzeReadability(text, language, opts = {}) {
  const lang = (language || 'english').toLowerCase();
  const locale = NAME_TO_LOCALE[lang] || 'en';
  const complexThreshold = opts.complexThreshold ?? defaultComplexThreshold;

  if (!text?.trim()) {
    return {
      sentences: 0, words: 0, syllables: 0, complexWords: 0, score: 100,
    };
  }

  const sentenceCount = countSentences(text, locale);

  const cache = makeWordCache();
  let wordCount = 0;
  let syllableCount = 0;
  let complexWords = 0;

  for (const w of iterateWords(text, locale)) {
    wordCount += 1;
    const key = `${lang}:${w}`;
    let s = cache.get(key);
    if (s == null) {
      // eslint-disable-next-line no-await-in-loop
      s = await countSyllablesWord(w, lang);
      cache.set(key, s);
    }
    syllableCount += s;
    if (s >= complexThreshold) complexWords += 1;
  }

  const wordsPerSentence = wordCount > 0 ? wordCount / sentenceCount : 0;
  const syllablesPerWord = wordCount > 0 ? syllableCount / wordCount : 0;
  const syllablesPer100Words = syllablesPerWord * 100;

  let score;
  switch (lang) {
    case 'german':
      score = 180 - wordsPerSentence - 58.5 * syllablesPerWord;
      break;
    case 'spanish':
      score = 206.84 - 1.02 * wordsPerSentence - 0.60 * syllablesPer100Words;
      break;
    case 'italian':
      score = 217 - 1.3 * wordsPerSentence - 0.6 * syllablesPer100Words;
      break;
    case 'french':
      score = 207 - 1.015 * wordsPerSentence - 73.6 * syllablesPerWord;
      break;
    case 'dutch':
      score = 206.84 - 0.77 * syllablesPer100Words - 0.93 * wordsPerSentence;
      break;
    case 'english':
    default:
      score = 206.835 - 1.015 * wordsPerSentence - 84.6 * syllablesPerWord;
  }

  return {
    sentences: sentenceCount,
    words: wordCount,
    syllables: syllableCount,
    complexWords,
    score: clamp(score),
  };
}

/** Backwards compatibility with your previous naming */
export async function calculateReadabilityScore(text, language) {
  const r = await analyzeReadability(text, language);
  return r.score;
}

/** Kept for compatibility */
export function getTargetScore() {
  return 30;
}
