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
 * Multilingual readability calculation utilities
 * Supports English, German, Spanish, Italian, French, and Dutch
 */

// Language codes mapping for franc library
export const SUPPORTED_LANGUAGES = {
  eng: 'english',
  deu: 'german',
  spa: 'spanish',
  ita: 'italian',
  fra: 'french',
  nld: 'dutch',
};

/**
 * Count syllables in English text
 */
function countSyllablesEnglish(word) {
  let processedWord = word.toLowerCase().replace(/[^a-z]/g, '');

  if (processedWord.length <= 3) {
    return 1;
  }

  // Specific exceptions for English
  if (processedWord === 'every') {
    return 2;
  }
  if (processedWord === 'somewhere') {
    return 2;
  }
  if (processedWord === 'through') {
    return 1;
  }

  // Handle common suffixes
  processedWord = processedWord.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '');
  processedWord = processedWord.replace(/^y/, '');

  // Count vowel groups as syllables
  const matches = processedWord.match(/[aeiouy]{1,2}/g);
  let count = matches ? matches.length : 0;

  // Common corrections
  if (/[^aeiou]le$/.test(processedWord)) {
    count += 1; // Handle 'ble', 'cle', etc.
  }
  if (/[aeiou]ing$/.test(processedWord)) {
    count += 1; // Handle 'ing'
  }

  return count > 0 ? count : 1;
}

/**
 * Count syllables in German text
 */
function countSyllablesGerman(word) {
  const processedWord = word.toLowerCase().replace(/[^a-zäöüß]/g, '');

  if (processedWord.length <= 3) {
    return 1;
  }

  // German vowels including umlauts
  const vowels = 'aeiouäöü';
  let count = 0;
  let previousWasVowel = false;

  for (let i = 0; i < processedWord.length; i += 1) {
    const isVowel = vowels.includes(processedWord[i]);
    if (isVowel && !previousWasVowel) {
      count += 1;
    }
    previousWasVowel = isVowel;
  }

  // German-specific rules
  if (processedWord.endsWith('e') && count > 1) {
    count -= 1; // Silent 'e' at end
  }
  if (processedWord.includes('ie')) {
    count -= 1; // 'ie' is one syllable
  }

  return count > 0 ? count : 1;
}

/**
 * Count syllables in Spanish text
 */
function countSyllablesSpanish(word) {
  const processedWord = word.toLowerCase().replace(/[^a-záéíóúñü]/g, '');

  if (processedWord.length <= 3) {
    return 1;
  }

  // Spanish vowels including accented ones
  const vowels = 'aeiouáéíóúü';
  let count = 0;
  let previousWasVowel = false;

  for (let i = 0; i < processedWord.length; i += 1) {
    const isVowel = vowels.includes(processedWord[i]);
    if (isVowel && !previousWasVowel) {
      count += 1;
    }
    previousWasVowel = isVowel;
  }

  // Spanish diphthongs and triphthongs adjustments
  const diphthongs = ['ai', 'au', 'ei', 'eu', 'oi', 'ou', 'ia', 'ie', 'io', 'iu', 'ua', 'ue', 'ui', 'uo'];
  diphthongs.forEach((diphthong) => {
    const matches = (processedWord.match(new RegExp(diphthong, 'g')) || []).length;
    count -= matches; // Each diphthong reduces syllable count by 1
  });

  return count > 0 ? count : 1;
}

/**
 * Count syllables in Italian text
 */
function countSyllablesItalian(word) {
  const processedWord = word.toLowerCase().replace(/[^a-zàèéìíîòóù]/g, '');

  if (processedWord.length <= 3) {
    return 1;
  }

  // Italian vowels including accented ones
  const vowels = 'aeiouàèéìíîòóù';
  let count = 0;
  let previousWasVowel = false;

  for (let i = 0; i < processedWord.length; i += 1) {
    const isVowel = vowels.includes(processedWord[i]);
    if (isVowel && !previousWasVowel) {
      count += 1;
    }
    previousWasVowel = isVowel;
  }

  // Italian-specific adjustments for common vowel combinations
  const combinations = ['ia', 'ie', 'io', 'iu', 'ua', 'ue', 'ui', 'uo'];
  combinations.forEach((combo) => {
    const matches = (processedWord.match(new RegExp(combo, 'g')) || []).length;
    count -= matches; // Reduce count for vowel combinations
  });

  return count > 0 ? count : 1;
}

/**
 * Count syllables in French text
 */
function countSyllablesFrench(word) {
  const processedWord = word.toLowerCase().replace(/[^a-zàâäéèêëïîôöùûüÿç]/g, '');

  if (processedWord.length <= 3) {
    return 1;
  }

  // French vowels including accented ones
  const vowels = 'aeiouyàâäéèêëïîôöùûüÿ';
  let count = 0;
  let previousWasVowel = false;

  for (let i = 0; i < processedWord.length; i += 1) {
    const isVowel = vowels.includes(processedWord[i]);
    if (isVowel && !previousWasVowel) {
      count += 1;
    }
    previousWasVowel = isVowel;
  }

  // French-specific rules
  if (processedWord.endsWith('e') && count > 1) {
    count -= 1; // Silent 'e' at end
  }
  if (processedWord.endsWith('es') && count > 1) {
    count -= 1; // Silent 'es' at end
  }

  // Common French vowel combinations that form one syllable
  const combinations = ['ai', 'au', 'eau', 'ei', 'eu', 'ou', 'oi'];
  combinations.forEach((combo) => {
    const matches = (processedWord.match(new RegExp(combo, 'g')) || []).length;
    count -= matches;
  });

  return count > 0 ? count : 1;
}

/**
 * Count syllables in Dutch text
 */
function countSyllablesDutch(word) {
  const processedWord = word.toLowerCase().replace(/[^a-zàáâäèéêëìíîïòóôöùúûü]/g, '');

  if (processedWord.length <= 3) {
    return 1;
  }

  // Dutch vowels including accented ones
  const vowels = 'aeiouàáâäèéêëìíîïòóôöùúûü';
  let count = 0;
  let previousWasVowel = false;

  for (let i = 0; i < processedWord.length; i += 1) {
    const isVowel = vowels.includes(processedWord[i]);
    if (isVowel && !previousWasVowel) {
      count += 1;
    }
    previousWasVowel = isVowel;
  }

  // Dutch-specific rules
  if (processedWord.endsWith('e') && count > 1) {
    count -= 1; // Silent 'e' at end
  }

  // Dutch diphthongs
  const diphthongs = ['ai', 'au', 'ei', 'eu', 'ie', 'oe', 'ou', 'ui'];
  diphthongs.forEach((diphthong) => {
    const matches = (processedWord.match(new RegExp(diphthong, 'g')) || []).length;
    count -= matches;
  });

  return count > 0 ? count : 1;
}

/**
 * Count syllables based on language
 */
function countSyllables(word, language) {
  switch (language.toLowerCase()) {
    case 'german':
      return countSyllablesGerman(word);
    case 'spanish':
      return countSyllablesSpanish(word);
    case 'italian':
      return countSyllablesItalian(word);
    case 'french':
      return countSyllablesFrench(word);
    case 'dutch':
      return countSyllablesDutch(word);
    case 'english':
    default:
      return countSyllablesEnglish(word);
  }
}

/**
 * Count sentences in text - works across languages
 */
function countSentences(text, language) {
  // Remove common abbreviations to avoid false positives
  let processedText = text;

  // Language-specific abbreviation patterns
  switch (language.toLowerCase()) {
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

  // Count sentence terminators
  const matches = processedText.match(/[.!?]+["\s)]*(\s|$)/g) || [];
  return Math.max(matches.length, 1); // Ensure at least 1 sentence
}

/**
 * Process text and extract metrics
 */
function processText(text, language) {
  // Count sentences
  const sentenceCount = countSentences(text, language);

  // Count words - split by whitespace and filter valid words
  const words = text.split(/\s+/).filter((w) => w.match(/[\w\u00C0-\u017F\u0100-\u024F]/));
  const wordCount = words.length;

  // Count syllables
  let syllableCount = 0;
  let complexWords = 0; // Words with 3+ syllables

  words.forEach((word) => {
    const syllables = countSyllables(word, language);
    syllableCount += syllables;
    if (syllables >= 3) {
      complexWords += 1;
    }
  });

  return {
    sentences: sentenceCount,
    words: wordCount,
    syllables: syllableCount,
    complexWords,
  };
}

/**
 * Calculate language-specific Flesch reading ease score
 * Note: For English text, use the text-readability library instead as it has
 * better exception handling and English-specific rules
 */
export function calculateReadabilityScore(text, language) {
  if (!text || text.trim().length === 0) {
    return 100; // Default to easiest score for empty text
  }

  // For English, the text-readability library should be used instead
  // This function is optimized for non-English languages

  const metrics = processText(text, language);

  if (metrics.words === 0 || metrics.sentences === 0) {
    return 100; // Default to easiest score if insufficient content
  }

  const wordsPerSentence = metrics.words / metrics.sentences;
  const syllablesPerWord = metrics.syllables / metrics.words;
  const syllablesPer100Words = syllablesPerWord * 100;

  let score;

  // Calculate score using language-specific formulas
  switch (language.toLowerCase()) {
    case 'german':
      // German: 180 - (words/sentences) - 58.5 * (syllables/words)
      score = 180 - wordsPerSentence - 58.5 * syllablesPerWord;
      break;
    case 'spanish':
      // Spanish: 206.84 - 1.02 * (words/sentences) - 0.60 * (syllables per 100 words)
      score = 206.84 - 1.02 * wordsPerSentence - 0.60 * syllablesPer100Words;
      break;
    case 'italian':
      // Italian: 217 - 1.3 * (words/sentences) - 0.6 * (syllables per 100 words)
      score = 217 - 1.3 * wordsPerSentence - 0.6 * syllablesPer100Words;
      break;
    case 'french':
      // French: 207 - 1.015 * (words/sentences) - 73.6 * (syllables/words)
      score = 207 - 1.015 * wordsPerSentence - 73.6 * syllablesPerWord;
      break;
    case 'dutch':
      // Dutch: 206.84 - 0.77 * (syllables per 100 words) - 0.93 * (words/sentences)
      score = 206.84 - 0.77 * syllablesPer100Words - 0.93 * wordsPerSentence;
      break;
    case 'english':
    default:
      // English: 206.835 - 1.015 * (words/sentences) - 84.6 * (syllables/words)
      score = 206.835 - 1.015 * wordsPerSentence - 84.6 * syllablesPerWord;
      break;
  }

  // Ensure score is within 0-100 range
  return Math.max(0, Math.min(100, score));
}

/**
 * Get the target readability score for a language
 * Note: This function is deprecated. Use a consistent target score across all languages
 * since the language-specific formulas already account for differences.
 */
export function getTargetScore() {
  // Deprecated: Use consistent target across languages
  // The language-specific formulas already account for baseline differences
  return 30;
}

/**
 * Check if a language is supported by this module
 */
export function isSupportedLanguage(languageCode) {
  return Object.keys(SUPPORTED_LANGUAGES).includes(languageCode)
         || Object.values(SUPPORTED_LANGUAGES).includes(languageCode.toLowerCase());
}

/**
 * Convert franc language code to readable language name
 */
export function getLanguageName(francCode) {
  return SUPPORTED_LANGUAGES[francCode] || 'unknown';
}
