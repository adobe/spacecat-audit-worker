import { expect } from 'chai';
import { getSitePathPattern, isUrlUnderSiteBase } from '../../../src/prerender/utils/subpath-utils.js';

describe('Prerender subpath-utils', () => {
  describe('getSitePathPattern', () => {
    it('returns /* for root domain', () => {
      expect(getSitePathPattern('https://nba.com')).to.equal('/*');
    });

    it('returns /* for www root domain', () => {
      expect(getSitePathPattern('https://www.nba.com')).to.equal('/*');
    });

    it('returns /kings/* for subpath site', () => {
      expect(getSitePathPattern('https://nba.com/kings')).to.equal('/kings/*');
    });

    it('returns /a/b/* for nested subpath', () => {
      expect(getSitePathPattern('https://nba.com/a/b')).to.equal('/a/b/*');
    });

    it('returns /* when URL is unparseable', () => {
      expect(getSitePathPattern('not-a-url')).to.equal('/*');
    });

    it('returns /* when URL throws (e.g. null input)', () => {
      expect(getSitePathPattern(null)).to.equal('/*');
    });
  });

  describe('isUrlUnderSiteBase', () => {
    it('returns true when url is under subpath base', () => {
      expect(isUrlUnderSiteBase('https://nba.com/kings/players.html', 'https://nba.com/kings')).to.be.true;
    });

    it('returns false when url is outside subpath base', () => {
      expect(isUrlUnderSiteBase('https://nba.com/lakers/players.html', 'https://nba.com/kings')).to.be.false;
    });

    it('returns true for all urls when base is root domain', () => {
      expect(isUrlUnderSiteBase('https://nba.com/anything.html', 'https://nba.com')).to.be.true;
    });

    it('returns false when url is unparseable', () => {
      expect(isUrlUnderSiteBase('not-a-url', 'https://nba.com/kings')).to.be.false;
    });

    it('returns true when url matches base exactly (no trailing slash)', () => {
      expect(isUrlUnderSiteBase('https://nba.com/kings', 'https://nba.com/kings')).to.be.true;
    });

    it('accepts base url without protocol prefix', () => {
      expect(isUrlUnderSiteBase('https://nba.com/kings/players.html', 'nba.com/kings')).to.be.true;
    });

    it('returns false when url hostname differs from base hostname', () => {
      expect(isUrlUnderSiteBase('https://sub.nba.com/kings/players.html', 'https://nba.com/kings')).to.be.false;
    });

    it('returns false when url is from a different domain sharing the same path prefix', () => {
      expect(isUrlUnderSiteBase('https://other.com/kings/players.html', 'https://nba.com/kings')).to.be.false;
    });

    it('returns true for www-variant url when base is root domain (hostname check skipped for root)', () => {
      expect(isUrlUnderSiteBase('https://www.nba.com/page.html', 'https://nba.com')).to.be.true;
    });
  });
});
