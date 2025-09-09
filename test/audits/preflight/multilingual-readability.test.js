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
import {
  calculateReadabilityScore,
  getTargetScore,
  isSupportedLanguage,
  getLanguageName,
  SUPPORTED_LANGUAGES,
} from '../../../src/readability/multilingual-readability.js';

describe('Multilingual Readability Module', () => {
  describe('SUPPORTED_LANGUAGES', () => {
    it('should contain all expected language mappings', () => {
      expect(SUPPORTED_LANGUAGES).to.deep.equal({
        eng: 'english',
        deu: 'german',
        spa: 'spanish',
        ita: 'italian',
        fra: 'french',
        nld: 'dutch',
      });
    });
  });

  describe('isSupportedLanguage', () => {
    it('should return true for supported language codes', () => {
      expect(isSupportedLanguage('eng')).to.be.true;
      expect(isSupportedLanguage('deu')).to.be.true;
      expect(isSupportedLanguage('spa')).to.be.true;
      expect(isSupportedLanguage('ita')).to.be.true;
      expect(isSupportedLanguage('fra')).to.be.true;
      expect(isSupportedLanguage('nld')).to.be.true;
    });

    it('should return true for supported language names', () => {
      expect(isSupportedLanguage('english')).to.be.true;
      expect(isSupportedLanguage('german')).to.be.true;
      expect(isSupportedLanguage('spanish')).to.be.true;
      expect(isSupportedLanguage('italian')).to.be.true;
      expect(isSupportedLanguage('french')).to.be.true;
      expect(isSupportedLanguage('dutch')).to.be.true;
    });

    it('should return false for unsupported languages', () => {
      expect(isSupportedLanguage('cmn')).to.be.false; // Chinese
      expect(isSupportedLanguage('jpn')).to.be.false; // Japanese
      expect(isSupportedLanguage('rus')).to.be.false; // Russian
      expect(isSupportedLanguage('chinese')).to.be.false;
      expect(isSupportedLanguage('unknown')).to.be.false;
      expect(isSupportedLanguage('')).to.be.false;
    });
  });

  describe('getLanguageName', () => {
    it('should return correct language names for supported codes', () => {
      expect(getLanguageName('eng')).to.equal('english');
      expect(getLanguageName('deu')).to.equal('german');
      expect(getLanguageName('spa')).to.equal('spanish');
      expect(getLanguageName('ita')).to.equal('italian');
      expect(getLanguageName('fra')).to.equal('french');
      expect(getLanguageName('nld')).to.equal('dutch');
    });

    it('should return "unknown" for unsupported codes', () => {
      expect(getLanguageName('cmn')).to.equal('unknown');
      expect(getLanguageName('jpn')).to.equal('unknown');
      expect(getLanguageName('xyz')).to.equal('unknown');
      expect(getLanguageName('')).to.equal('unknown');
      expect(getLanguageName(undefined)).to.equal('unknown');
    });
  });

  describe('getTargetScore', () => {
    it('should return 30 as the deprecated target score', () => {
      expect(getTargetScore()).to.equal(30);
      expect(getTargetScore('english')).to.equal(30);
      expect(getTargetScore('german')).to.equal(30);
    });
  });

  describe('calculateReadabilityScore', () => {
    describe('Edge cases', () => {
      it('should return 100 for empty text', () => {
        expect(calculateReadabilityScore('', 'english')).to.equal(100);
        expect(calculateReadabilityScore('   ', 'german')).to.equal(100);
        expect(calculateReadabilityScore(null, 'spanish')).to.equal(100);
        expect(calculateReadabilityScore(undefined, 'french')).to.equal(100);
      });

      it('should return 100 for text with no valid content', () => {
        expect(calculateReadabilityScore('!!!', 'english')).to.equal(100);
        expect(calculateReadabilityScore('123', 'german')).to.equal(100);
        expect(calculateReadabilityScore('???', 'spanish')).to.equal(100);
      });

      it('should handle very short text', () => {
        const score = calculateReadabilityScore('Hi there.', 'english');
        expect(score).to.be.a('number');
        expect(score).to.be.at.least(0);
        expect(score).to.be.at.most(100);
      });
    });

    describe('English language processing', () => {
      it('should calculate scores for simple English text', () => {
        const simpleText = 'The cat sits on the mat. It is a nice day.';
        const score = calculateReadabilityScore(simpleText, 'english');
        expect(score).to.be.a('number');
        expect(score).to.be.greaterThan(50); // Simple text should have good readability
      });

      it('should calculate scores for complex English text', () => {
        const complexText = 'The extraordinarily sophisticated methodology utilizes multifaceted approaches to comprehensive understanding of intricate phenomena.';
        const score = calculateReadabilityScore(complexText, 'english');
        expect(score).to.be.a('number');
        expect(score).to.be.lessThan(50); // Complex text should have poor readability
      });

      it('should handle English text with special characters', () => {
        const textWithSpecials = 'Hello! How are you? I\'m fine, thanks.';
        const score = calculateReadabilityScore(textWithSpecials, 'english');
        expect(score).to.be.a('number');
        expect(score).to.be.at.least(0);
        expect(score).to.be.at.most(100);
      });
    });

    describe('German language processing', () => {
      it('should calculate scores for simple German text', () => {
        const simpleGerman = 'Der Hund läuft im Park. Es ist ein schöner Tag.';
        const score = calculateReadabilityScore(simpleGerman, 'german');
        expect(score).to.be.a('number');
        expect(score).to.be.at.least(0);
        expect(score).to.be.at.most(100);
      });

      it('should calculate scores for complex German text', () => {
        const complexGerman = 'Die außergewöhnlich komplizierte Methodologie verwendet vielschichtige Ansätze zur umfassenden Verständigung komplexer Phänomene.';
        const score = calculateReadabilityScore(complexGerman, 'german');
        expect(score).to.be.a('number');
        expect(score).to.be.at.least(0);
        expect(score).to.be.at.most(100);
      });

      it('should handle German umlauts and special characters', () => {
        const germanWithUmlauts = 'Größe, Wärme, Hände, hören, Füße und Mädchen sind deutsche Wörter.';
        const score = calculateReadabilityScore(germanWithUmlauts, 'german');
        expect(score).to.be.a('number');
        expect(score).to.be.at.least(0);
        expect(score).to.be.at.most(100);
      });

      it('should handle German compound words', () => {
        const germanCompounds = 'Donaudampfschifffahrtskapitän und Kraftfahrzeugversicherung sind lange Wörter.';
        const score = calculateReadabilityScore(germanCompounds, 'german');
        expect(score).to.be.a('number');
        expect(score).to.be.lessThan(70); // Long words should reduce readability
      });
    });

    describe('Spanish language processing', () => {
      it('should calculate scores for simple Spanish text', () => {
        const simpleSpanish = 'El gato está en la casa. Es un día muy bonito.';
        const score = calculateReadabilityScore(simpleSpanish, 'spanish');
        expect(score).to.be.a('number');
        expect(score).to.be.at.least(0);
        expect(score).to.be.at.most(100);
      });

      it('should calculate scores for complex Spanish text', () => {
        const complexSpanish = 'La extraordinariamente sofisticada metodología utiliza enfoques multifacéticos para la comprensión integral de fenómenos intrincados.';
        const score = calculateReadabilityScore(complexSpanish, 'spanish');
        expect(score).to.be.a('number');
        expect(score).to.be.at.least(0);
        expect(score).to.be.at.most(100);
      });

      it('should handle Spanish accents and special characters', () => {
        const spanishWithAccents = 'Años, niños, música, corazón, José y María son palabras españolas.';
        const score = calculateReadabilityScore(spanishWithAccents, 'spanish');
        expect(score).to.be.a('number');
        expect(score).to.be.at.least(0);
        expect(score).to.be.at.most(100);
      });

      it('should handle Spanish diphthongs', () => {
        const spanishDiphthongs = 'Aire, auto, reino, Europa, oigo, causa, piano, tiene, radio, cuatro.';
        const score = calculateReadabilityScore(spanishDiphthongs, 'spanish');
        expect(score).to.be.a('number');
        expect(score).to.be.at.least(0);
        expect(score).to.be.at.most(100);
      });
    });

    describe('Italian language processing', () => {
      it('should calculate scores for simple Italian text', () => {
        const simpleItalian = 'Il gatto è sulla sedia. È una bella giornata.';
        const score = calculateReadabilityScore(simpleItalian, 'italian');
        expect(score).to.be.a('number');
        expect(score).to.be.at.least(0);
        expect(score).to.be.at.most(100);
      });

      it('should calculate scores for complex Italian text', () => {
        const complexItalian = 'La straordinariamente sofisticata metodologia utilizza approcci multisfaccettati per la comprensione integrale di fenomeni intricati.';
        const score = calculateReadabilityScore(complexItalian, 'italian');
        expect(score).to.be.a('number');
        expect(score).to.be.at.least(0);
        expect(score).to.be.at.most(100);
      });

      it('should handle Italian accents and vowel combinations', () => {
        const italianWithAccents = 'Perché, città, più, già, così, università sono parole italiane.';
        const score = calculateReadabilityScore(italianWithAccents, 'italian');
        expect(score).to.be.a('number');
        expect(score).to.be.at.least(0);
        expect(score).to.be.at.most(100);
      });
    });

    describe('French language processing', () => {
      it('should calculate scores for simple French text', () => {
        const simpleFrench = 'Le chat est sur la table. C\'est une belle journée.';
        const score = calculateReadabilityScore(simpleFrench, 'french');
        expect(score).to.be.a('number');
        expect(score).to.be.at.least(0);
        expect(score).to.be.at.most(100);
      });

      it('should calculate scores for complex French text', () => {
        const complexFrench = 'La méthodologie extraordinairement sophistiquée utilise des approches multiformes pour la compréhension intégrale de phénomènes complexes.';
        const score = calculateReadabilityScore(complexFrench, 'french');
        expect(score).to.be.a('number');
        expect(score).to.be.at.least(0);
        expect(score).to.be.at.most(100);
      });

      it('should handle French accents and special characters', () => {
        const frenchWithAccents = 'Français, café, élève, hôtel, naïf, Noël, ça, œuvre sont des mots français.';
        const score = calculateReadabilityScore(frenchWithAccents, 'french');
        expect(score).to.be.a('number');
        expect(score).to.be.at.least(0);
        expect(score).to.be.at.most(100);
      });

      it('should handle French vowel combinations', () => {
        const frenchVowels = 'Eau, air, aussi, euro, oui, oiseau sont des mots avec des voyelles.';
        const score = calculateReadabilityScore(frenchVowels, 'french');
        expect(score).to.be.a('number');
        expect(score).to.be.at.least(0);
        expect(score).to.be.at.most(100);
      });

      it('should handle French silent endings', () => {
        const frenchSilent = 'Grande, rouge, parle, mange, danse, pense, reste, simple.';
        const score = calculateReadabilityScore(frenchSilent, 'french');
        expect(score).to.be.a('number');
        expect(score).to.be.at.least(0);
        expect(score).to.be.at.most(100);
      });
    });

    describe('Dutch language processing', () => {
      it('should calculate scores for simple Dutch text', () => {
        const simpleDutch = 'De kat zit op de stoel. Het is een mooie dag.';
        const score = calculateReadabilityScore(simpleDutch, 'dutch');
        expect(score).to.be.a('number');
        expect(score).to.be.at.least(0);
        expect(score).to.be.at.most(100);
      });

      it('should calculate scores for complex Dutch text', () => {
        const complexDutch = 'De buitengewoon gecompliceerde methodologie gebruikt veelzijdige benaderingen voor uitgebreid begrip van ingewikkelde verschijnselen.';
        const score = calculateReadabilityScore(complexDutch, 'dutch');
        expect(score).to.be.a('number');
        expect(score).to.be.at.least(0);
        expect(score).to.be.at.most(100);
      });

      it('should handle Dutch diphthongs and special characters', () => {
        const dutchDiphthongs = 'Ei, au, ui, ou, ie, oe zijn Nederlandse diftongklank.';
        const score = calculateReadabilityScore(dutchDiphthongs, 'dutch');
        expect(score).to.be.a('number');
        expect(score).to.be.at.least(0);
        expect(score).to.be.at.most(100);
      });

      it('should handle Dutch compound words', () => {
        const dutchCompounds = 'Schaatsenrijder, boterhamworst, gezondheidszorg zijn samengestelde woorden.';
        const score = calculateReadabilityScore(dutchCompounds, 'dutch');
        expect(score).to.be.a('number');
        expect(score).to.be.at.least(0);
        expect(score).to.be.at.most(100);
      });
    });

    describe('Language formula differences', () => {
      it('should use different formulas for different languages', () => {
        const text = 'This is a test sentence with multiple words for comparison.';

        const englishScore = calculateReadabilityScore(text, 'english');
        const germanScore = calculateReadabilityScore(text, 'german');
        const spanishScore = calculateReadabilityScore(text, 'spanish');
        const italianScore = calculateReadabilityScore(text, 'italian');
        const frenchScore = calculateReadabilityScore(text, 'french');
        const dutchScore = calculateReadabilityScore(text, 'dutch');

        // Scores should be different due to different formulas
        const scores = [
          englishScore, germanScore, spanishScore,
          italianScore, frenchScore, dutchScore,
        ];
        const uniqueScores = [...new Set(scores)];

        // At least some scores should be different
        expect(uniqueScores.length).to.be.greaterThan(1);
      });

      it('should handle case-insensitive language names', () => {
        const text = 'Test sentence for case sensitivity.';

        const lowerScore = calculateReadabilityScore(text, 'english');
        const upperScore = calculateReadabilityScore(text, 'ENGLISH');
        const mixedScore = calculateReadabilityScore(text, 'English');

        expect(lowerScore).to.equal(upperScore);
        expect(lowerScore).to.equal(mixedScore);
      });
    });

    describe('Sentence counting edge cases', () => {
      it('should handle abbreviations correctly', () => {
        const englishAbbrev = 'Dr. Smith went to the U.S.A. yesterday. He met Mr. Jones.';
        const score = calculateReadabilityScore(englishAbbrev, 'english');
        expect(score).to.be.a('number');
        expect(score).to.be.at.least(0);
        expect(score).to.be.at.most(100);
      });

      it('should handle multiple sentence terminators', () => {
        const multiTerminators = 'What?!! Really??? Yes!!! That\'s amazing!!!';
        const score = calculateReadabilityScore(multiTerminators, 'english');
        expect(score).to.be.a('number');
        expect(score).to.be.at.least(0);
        expect(score).to.be.at.most(100);
      });

      it('should handle text without clear sentence boundaries', () => {
        const noSentences = 'hello world test example sample text';
        const score = calculateReadabilityScore(noSentences, 'english');
        expect(score).to.be.a('number');
        expect(score).to.be.at.least(0);
        expect(score).to.be.at.most(100);
      });

      it('should handle language-specific abbreviations - German', () => {
        const germanAbbrev = 'Dr. Müller ging bzw. fuhr z.B. nach Berlin u.a. wegen der Arbeit.';
        const score = calculateReadabilityScore(germanAbbrev, 'german');
        expect(score).to.be.a('number');
        expect(score).to.be.at.least(0);
        expect(score).to.be.at.most(100);
      });

      it('should handle language-specific abbreviations - Spanish', () => {
        const spanishAbbrev = 'Sr. García fue p.ej. a Madrid. Dra. López también.';
        const score = calculateReadabilityScore(spanishAbbrev, 'spanish');
        expect(score).to.be.a('number');
        expect(score).to.be.at.least(0);
        expect(score).to.be.at.most(100);
      });

      it('should handle language-specific abbreviations - Italian', () => {
        const italianAbbrev = 'Sig. Rossi e Sig.ra Bianchi andarono dal Dott. Prof. Verdi ecc.';
        const score = calculateReadabilityScore(italianAbbrev, 'italian');
        expect(score).to.be.a('number');
        expect(score).to.be.at.least(0);
        expect(score).to.be.at.most(100);
      });

      it('should handle language-specific abbreviations - French', () => {
        const frenchAbbrev = 'M. Dupont et Mme Martin virent le Dr. Martin p.ex. hier soir etc.';
        const score = calculateReadabilityScore(frenchAbbrev, 'french');
        expect(score).to.be.a('number');
        expect(score).to.be.at.least(0);
        expect(score).to.be.at.most(100);
      });

      it('should handle language-specific abbreviations - Dutch', () => {
        const dutchAbbrev = 'Mr. van der Berg en Mw. de Vries spraken bijv. met Dr. Jansen etc.';
        const score = calculateReadabilityScore(dutchAbbrev, 'dutch');
        expect(score).to.be.a('number');
        expect(score).to.be.at.least(0);
        expect(score).to.be.at.most(100);
      });
    });

    describe('Word counting edge cases', () => {
      it('should handle text with numbers and special characters', () => {
        const mixedText = 'There are 123 cats, 456 dogs, and $789 in the account!';
        const score = calculateReadabilityScore(mixedText, 'english');
        expect(score).to.be.a('number');
        expect(score).to.be.at.least(0);
        expect(score).to.be.at.most(100);
      });

      it('should handle text with excessive whitespace', () => {
        const spacedText = 'This    has     lots   of      spaces    between     words.';
        const score = calculateReadabilityScore(spacedText, 'english');
        expect(score).to.be.a('number');
        expect(score).to.be.at.least(0);
        expect(score).to.be.at.most(100);
      });

      it('should handle text with Unicode characters', () => {
        const unicodeText = 'This text has émojis 😀 and spéciàl characters ñ ü ç.';
        const score = calculateReadabilityScore(unicodeText, 'english');
        expect(score).to.be.a('number');
        expect(score).to.be.at.least(0);
        expect(score).to.be.at.most(100);
      });
    });

    describe('Score boundary validation', () => {
      it('should always return scores between 0 and 100', () => {
        const texts = [
          'Simple text.',
          'Very very very very very very very very very very complex multisyllabic extraordinarily complicated sentence structure.',
          'A.',
          'The quick brown fox jumps over the lazy dog.',
          'Supercalifragilisticexpialidocious is an extraordinarily long word.',
        ];

        const languages = ['english', 'german', 'spanish', 'italian', 'french', 'dutch'];

        texts.forEach((text) => {
          languages.forEach((language) => {
            const score = calculateReadabilityScore(text, language);
            expect(score).to.be.at.least(0, `Score for "${text}" in ${language} should be >= 0`);
            expect(score).to.be.at.most(100, `Score for "${text}" in ${language} should be <= 100`);
          });
        });
      });
    });

    describe('Complex syllable patterns', () => {
      it('should handle English words with complex syllable patterns', () => {
        const complexEnglish = 'Beautiful, wonderful, terrible, comfortable, reasonable, fashionable, responsible.';
        const score = calculateReadabilityScore(complexEnglish, 'english');
        expect(score).to.be.a('number');
        expect(score).to.be.at.least(0);
        expect(score).to.be.at.most(100);
      });

      it('should handle German words with ie combinations', () => {
        const germanIE = 'Sie liegen hier und spielen mit sieben Tieren.';
        const score = calculateReadabilityScore(germanIE, 'german');
        expect(score).to.be.a('number');
        expect(score).to.be.at.least(0);
        expect(score).to.be.at.most(100);
      });
    });

    describe('English syllable counting edge cases', () => {
      it('should handle specific English word exceptions - every', () => {
        const textWithEvery = 'Every day brings new opportunities. Every person deserves respect. Every moment matters.';
        const score = calculateReadabilityScore(textWithEvery, 'english');
        expect(score).to.be.a('number');
        expect(score).to.be.at.least(0);
        expect(score).to.be.at.most(100);
      });

      it('should handle specific English word exceptions - somewhere', () => {
        const textWithSomewhere = 'I will go somewhere nice today. Somewhere special awaits.';
        const score = calculateReadabilityScore(textWithSomewhere, 'english');
        expect(score).to.be.a('number');
        expect(score).to.be.at.least(0);
        expect(score).to.be.at.most(100);
      });

      it('should handle specific English word exceptions - through', () => {
        const textWithThrough = 'We walked through the park. Going through difficulties makes you stronger.';
        const score = calculateReadabilityScore(textWithThrough, 'english');
        expect(score).to.be.a('number');
        expect(score).to.be.at.least(0);
        expect(score).to.be.at.most(100);
      });

      it('should handle English words ending with -ing pattern with vowel before', () => {
        const textWithIng = 'Seeing, being, agreeing, freeing are all gerunds with vowel before ing.';
        const score = calculateReadabilityScore(textWithIng, 'english');
        expect(score).to.be.a('number');
        expect(score).to.be.at.least(0);
        expect(score).to.be.at.most(100);
      });

      it('should handle English words with consonant + le pattern', () => {
        const textWithLe = 'Simple, table, middle, struggle, bubble, trouble are words ending in consonant-le.';
        const score = calculateReadabilityScore(textWithLe, 'english');
        expect(score).to.be.a('number');
        expect(score).to.be.at.least(0);
        expect(score).to.be.at.most(100);
      });
    });

    describe('Language-specific syllable edge cases', () => {
      it('should handle German words with silent e at end', () => {
        const germanSilentE = 'Diese große Reise ist eine wahre Freude für alle deutsche Besucher.';
        const score = calculateReadabilityScore(germanSilentE, 'german');
        expect(score).to.be.a('number');
        expect(score).to.be.at.least(0);
        expect(score).to.be.at.most(100);
      });

      it('should handle German words with ie combinations', () => {
        const germanIeWords = 'Sie lieben diese verschiedenen Tiere wie Bienen und Fliegen.';
        const score = calculateReadabilityScore(germanIeWords, 'german');
        expect(score).to.be.a('number');
        expect(score).to.be.at.least(0);
        expect(score).to.be.at.most(100);
      });

      it('should handle French words with silent e and es endings', () => {
        const frenchSilentEndings = 'Elle mange des pommes rouges et belles avec ses amies françaises.';
        const score = calculateReadabilityScore(frenchSilentEndings, 'french');
        expect(score).to.be.a('number');
        expect(score).to.be.at.least(0);
        expect(score).to.be.at.most(100);
      });

      it('should handle Dutch words with silent e endings', () => {
        const dutchSilentE = 'Deze grote rijke dame woonde in een mooie moderne hoge witte tore.';
        const score = calculateReadabilityScore(dutchSilentE, 'dutch');
        expect(score).to.be.a('number');
        expect(score).to.be.at.least(0);
        expect(score).to.be.at.most(100);
      });

      it('should handle very short words (3 characters or less)', () => {
        const shortWords = 'I am so to go we do it up me at in on by';
        const score = calculateReadabilityScore(shortWords, 'english');
        expect(score).to.be.a('number');
        expect(score).to.be.at.least(0);
        expect(score).to.be.at.most(100);
      });

      it('should handle words with no vowels after processing', () => {
        const oddWords = 'Hmm, psst, shh, tsk, pfft, brr, grr, zzz.';
        const score = calculateReadabilityScore(oddWords, 'english');
        expect(score).to.be.a('number');
        expect(score).to.be.at.least(0);
        expect(score).to.be.at.most(100);
      });

      it('should handle capitalized words and mixed case', () => {
        const mixedCase = 'HELLO World ThIs Is A TeSt Of MiXeD cAsE wOrDs.';
        const score = calculateReadabilityScore(mixedCase, 'english');
        expect(score).to.be.a('number');
        expect(score).to.be.at.least(0);
        expect(score).to.be.at.most(100);
      });

      it('should handle English text with all exception words combined', () => {
        const allExceptions = 'Every person will go somewhere, walking through the park. Every day brings somewhere new through different paths.';
        const score = calculateReadabilityScore(allExceptions, 'english');
        expect(score).to.be.a('number');
        expect(score).to.be.at.least(0);
        expect(score).to.be.at.most(100);
      });
    });
  });

  describe('Integration tests', () => {
    it('should handle real-world multilingual content', () => {
      const realWorldTexts = {
        english: 'The global economy continues to evolve rapidly, presenting both opportunities and challenges for businesses worldwide. Companies must adapt their strategies to remain competitive in this dynamic environment.',
        german: 'Die globale Wirtschaft entwickelt sich weiterhin schnell und bietet sowohl Chancen als auch Herausforderungen für Unternehmen weltweit. Unternehmen müssen ihre Strategien anpassen, um in diesem dynamischen Umfeld wettbewerbsfähig zu bleiben.',
        spanish: 'La economía global continúa evolucionando rápidamente, presentando tanto oportunidades como desafíos para las empresas en todo el mundo. Las empresas deben adaptar sus estrategias para seguir siendo competitivas en este entorno dinámico.',
        italian: 'L\'economia globale continua ad evolversi rapidamente, presentando sia opportunità che sfide per le aziende in tutto il mondo. Le aziende devono adattare le loro strategie per rimanere competitive in questo ambiente dinamico.',
        french: 'L\'économie mondiale continue d\'évoluer rapidement, présentant à la fois des opportunités et des défis pour les entreprises du monde entier. Les entreprises doivent adapter leurs stratégies pour rester compétitives dans cet environnement dynamique.',
        dutch: 'De wereldeconomie blijft zich snel ontwikkelen en biedt zowel kansen als uitdagingen voor bedrijven wereldwijd. Bedrijven moeten hun strategieën aanpassen om concurrerend te blijven in deze dynamische omgeving.',
      };

      Object.entries(realWorldTexts).forEach(([language, text]) => {
        const score = calculateReadabilityScore(text, language);
        expect(score).to.be.a('number');
        expect(score).to.be.at.least(0);
        expect(score).to.be.at.most(100);
        expect(score).to.be.lessThan(80); // Complex business text should have lower readability
      });
    });

    it('should demonstrate consistent behavior across similar complexity texts', () => {
      const simpleTexts = {
        english: 'The cat sits on the mat. It is warm today.',
        german: 'Die Katze sitzt auf der Matte. Es ist warm heute.',
        spanish: 'El gato se sienta en la alfombra. Hace calor hoy.',
        italian: 'Il gatto si siede sul tappeto. Oggi fa caldo.',
        french: 'Le chat est assis sur le tapis. Il fait chaud aujourd\'hui.',
        dutch: 'De kat zit op de mat. Het is warm vandaag.',
      };

      const scores = Object.entries(simpleTexts).map(([language, text]) => ({
        language,
        score: calculateReadabilityScore(text, language),
      }));

      // All simple texts should have relatively high readability scores
      scores.forEach(({ language, score }) => {
        expect(score).to.be.greaterThan(40, `Simple ${language} text should have good readability`);
      });
    });
  });
});
