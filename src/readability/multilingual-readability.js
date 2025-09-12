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

// Hyphenation language codes
const LOCALE_MAP = Object.freeze({
  german: 'de',
  spanish: 'es',
  italian: 'it',
  french: 'fr',
  dutch: 'nl',
  // english intentionally omitted (use syllableEn elsewhere)
});

const NAME_TO_LOCALE = Object.freeze({
  english: 'en',
  ...LOCALE_MAP, // { german:'de', spanish:'es', italian:'it', french:'fr', dutch:'nl' }
});

// Track which languages have already logged fallback warnings to avoid spam
const fallbackLoggedLanguages = new Set();

// Flesch(-like) coefficients per language
// score = A - wps*WPS - spw*SPW (standardized to syllables per word)
const COEFFS = Object.freeze({
  german: { A: 180, wps: 1.0, spw: 58.5 },
  spanish: { A: 206.84, wps: 1.02, spw: 60 },
  italian: { A: 217, wps: 1.3, spw: 60 },
  french: { A: 207, wps: 1.015, spw: 73.6 },
  dutch: { A: 206.84, wps: 0.93, spw: 77 },
  english: { A: 206.835, wps: 1.015, spw: 84.6 },
});

// Optional: in-flight promise cache to dedupe concurrent analyze() calls
const syllablePromiseCache = new Map(); // key -> Promise<number>

const clamp = (x) => Math.max(0, Math.min(100, x));

// --- Hyphenation loader (lazy) ---
// cache promises to dedupe concurrent calls
const hyphenatorCache = new Map(); // Map<string, Promise<Function|null>>

export async function getHyphenator(language) {
  const key = String(language).toLowerCase();
  const cached = hyphenatorCache.get(key);
  if (cached) return cached;

  const loader = (async () => {
    const locale = LOCALE_MAP[key];
    if (!locale) {
      // eslint-disable-next-line no-console
      console.info(`[readability-suggest multilingual] 🔤 No hyphenation patterns available for language: ${language}`);
      return null;
    }

    // eslint-disable-next-line no-console
    console.info(`[readability-suggest multilingual] 📚 Loading hyphenation patterns for ${language} (locale: ${locale})`);
    try {
      const mod = await import(`hyphen/${locale}/index.js`);
      const hyphenate = mod?.default?.hyphenate;
      if (hyphenate) {
        // eslint-disable-next-line no-console
        console.info(`[readability-suggest multilingual] ✅ Successfully loaded hyphenation patterns for ${language}`);
      }
      return hyphenate;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`[readability-suggest multilingual] ❌ Failed to load hyphenation patterns for ${language}:`, error.message);
      return null;
    }
  })();

  hyphenatorCache.set(key, loader);
  return loader;
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
    const syllableCount = Math.max(1, m ? m.length : 1);
    // Only log fallback once per session to avoid spam
    if (!fallbackLoggedLanguages.has(language)) {
      // eslint-disable-next-line no-console
      console.warn(`[readability-suggest multilingual] 🔄 Using vowel-based fallback for ${language} syllable counting (hyphenation unavailable)`);
      fallbackLoggedLanguages.add(language);
    }

    return syllableCount;
  }
  // Preserve inner apostrophes/dashes, remove other junk
  const cleaned = word.replace(/[^\p{L}\p{M}''-]/gu, '');
  const hyphenatedString = await hyphenate(cleaned);
  // Split by soft hyphen character (U+00AD) to get syllable parts
  const syllableParts = hyphenatedString ? hyphenatedString.split('\u00AD') : [word];
  const syllableCount = Math.max(1, syllableParts.length);

  return syllableCount;
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
  const lang = String(language || 'english').toLowerCase();
  const locale = NAME_TO_LOCALE[lang] || 'en';
  const complexThreshold = opts.complexThreshold ?? defaultComplexThreshold;
  const coeff = COEFFS[lang] || COEFFS.english;

  if (!text?.trim()) {
    return {
      sentences: 0, words: 0, syllables: 0, complexWords: 0, score: 100,
    };
  }

  // Language-specific abbreviation preprocessing to improve sentence/word counting accuracy
  let processedText = text;
  switch (lang) {
    case 'german':
      processedText = text.replace(/Dr\.|Prof\.|Herr|Frau|bzw\.|z\.B\.|u\.a\.|etc\./gi, '');
      break;
    case 'spanish':
      processedText = text.replace(/Sr\.|Sra\.|Dr\.|Dra\.|etc\.|p\.ej\./gi, '');
      break;
    case 'italian':
      processedText = text.replace(/Sig\.|Sig\.ra|Dr\.|Dott\.|Prof\.|ecc\./gi, '');
      break;
    case 'french':
      processedText = text.replace(/M\.|Mme|Dr\.|Prof\.|etc\.|p\.ex\./gi, '');
      break;
    case 'dutch':
      processedText = text.replace(/Mr\.|Mw\.|Dr\.|Prof\.|etc\.|bijv\./gi, '');
      break;
    case 'english':
    default:
      processedText = text.replace(/Mr\.|Mrs\.|Dr\.|Ph\.D\.|etc\.|i\.e\.|e\.g\./gi, '');
      break;
  }

  const sentenceCount = Math.max(1, countSentences(processedText, locale)); // guard against 0
  const cache = makeWordCache();

  // 1) Tokenize once; build frequency map of normalized word keys
  let wordCount = 0;
  const entries = new Map(); // key -> { word, count }
  const allWords = []; // Collect for debugging
  for (const w of iterateWords(processedText, locale)) {
    wordCount += 1;
    allWords.push(w);
    const key = `${lang}:${w}`;
    const e = entries.get(key);
    if (e) e.count += 1;
    else entries.set(key, { word: w, count: 1 });
  }

  // 2) Resolve syllables per unique word, using cache and deduped promises
  const toResolve = [];
  for (const [key, { word }] of entries) {
    if (cache.get(key) == null) {
      let p = syllablePromiseCache.get(key);
      if (!p) {
        p = countSyllablesWord(word, lang).then((n) => {
          cache.set(key, n);
          syllablePromiseCache.delete(key); // keep cache small
          return n;
        });
        syllablePromiseCache.set(key, p);
      }
      toResolve.push(p);
    }
  }
  if (toResolve.length) await Promise.all(toResolve);

  // 3) Aggregate syllables/complex words using frequencies
  let syllableCount = 0;
  let complexWords = 0;
  const syllableBreakdown = []; // For debugging
  // CRITICAL FIX: Check for corrupted cache entries and recalculate if needed
  const toRecalculate = [];
  for (const [key, { word }] of entries) {
    const s = cache.get(key);
    // If cache returns undefined/null or 0 for a non-empty word, need to recalculate
    if (s === undefined || s === null || (s === 0 && word.length > 0)) {
      toRecalculate.push(countSyllablesWord(word, lang).then((n) => {
        cache.set(key, n);
        return n;
      }).catch((error) => {
        // eslint-disable-next-line no-console
        console.warn(`[readability-suggest multilingual] ⚠️ Syllable calculation failed for "${word}":`, error.message);
        const fallback = word.length <= 3 ? 1 : Math.ceil(word.length / 2); // Emergency fallback
        cache.set(key, fallback);
        return fallback;
      }));
    }
  }
  if (toRecalculate.length) await Promise.all(toRecalculate);

  for (const [key, { word, count }] of entries) {
    const s = cache.get(key) ?? 0;
    syllableCount += s * count;
    if (s >= complexThreshold) complexWords += count;

    // Collect syllable breakdown for debugging
    if (s > 3 && wordCount > 60) {
      syllableBreakdown.push(`${word}:${s}×${count}`);
    }
  }

  // Debug syllable breakdown for significant texts
  if (wordCount > 60 && syllableBreakdown.length > 0) {
    // eslint-disable-next-line no-console
    console.info(`[readability-suggest multilingual] 🔢 High-syllable words (>3): [${syllableBreakdown.slice(0, 8).join(', ')}]`);
  }

  // 4) Compute metrics once
  const wordsPerSentence = wordCount / sentenceCount;
  const syllablesPerWord = wordCount ? (syllableCount / wordCount) : 0;

  // 5) Unified scoring using standardized coefficients
  const score = coeff.A - coeff.wps * wordsPerSentence - coeff.spw * syllablesPerWord;

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
