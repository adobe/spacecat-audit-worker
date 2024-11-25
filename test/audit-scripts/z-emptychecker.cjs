/* eslint-disable */
const axios = require('axios');
const cheerio = require('cheerio');

// List of URLs to check
const h1Urls = [
  'https://www.24petwatch.com/ca/blog/what-does-it-mean-when-a-cat-purrs',
  'https://www.24petwatch.com/ca/blog/why-do-cats-purr',
  'https://www.24petwatch.com/ca/lost-pet-protection/report-lost-found-pet',
  'https://www.24petwatch.com/lost-pet-protection/lps-quote-v3',
  'https://www.24petwatch.com/lost-pet-protection/pet-tags',
  'https://www.24petwatch.com/lost-pet-protection/report-lost-found-pet'
];

const descriptionUrls = [
  'https://www.bamboohr.com/blog/benefits-of-internal-recruiting',
  'https://www.bamboohr.com/blog/employee-stock-options',
  'https://www.bamboohr.com/blog/key-hr-metrics',
  'https://www.bamboohr.com/blog/the-ultimate-new-hire-onboarding-checklist',
  'https://www.bamboohr.com/blog/top-bad-leadership-behaviors-how-to-avoid',
  'https://www.bamboohr.com/demo',
  'https://www.bamboohr.com/resources/hr-glossary/147c',
  'https://www.bamboohr.com/resources/hr-glossary/annualized-salary',
  'https://www.bamboohr.com/resources/hr-glossary/applicant-tracking-system-ats',
  'https://www.bamboohr.com/resources/hr-glossary/at-will-employment',
  'https://www.bamboohr.com/resources/hr-glossary/business-partnership',
  'https://www.bamboohr.com/resources/hr-glossary/conditions-of-employment',
  'https://www.bamboohr.com/resources/hr-glossary/contingency-recruiting',
  'https://www.bamboohr.com/resources/hr-glossary/employee-orientation',
  'https://www.bamboohr.com/resources/hr-glossary/employment-status',
  'https://www.bamboohr.com/resources/hr-glossary/form-w-3',
  'https://www.bamboohr.com/resources/hr-glossary/full-time-hours',
  'https://www.bamboohr.com/resources/hr-glossary/hsa-reimbursement',
  'https://www.bamboohr.com/resources/hr-glossary/onboarding',
  'https://www.bamboohr.com/resources/hr-glossary/operating-budget',
  'https://www.bamboohr.com/resources/hr-glossary/retro-pay',
  'https://www.bamboohr.com/resources/hr-glossary/sdi-tax',
  'https://www.bamboohr.com/resources/hr-glossary/secondary-insurance',
  'https://www.bamboohr.com/resources/hr-glossary/social-security-wages',
  'https://www.bamboohr.com/resources/hr-glossary/sourcing',
  'https://www.bamboohr.com/resources/hr-glossary/summary-dismissal'
];

const titleUrls = [
  'https://www.bamboohr.com/hr-quotes',
  'https://www.bamboohr.com/resources/hr-glossary/147c',
  'https://www.bamboohr.com/resources/hr-glossary/360-survey',
  'https://www.bamboohr.com/resources/hr-glossary/adaptive-device',
  'https://www.bamboohr.com/resources/hr-glossary/adverse-impact',
  'https://www.bamboohr.com/resources/hr-glossary/after-tax-deduction',
  'https://www.bamboohr.com/resources/hr-glossary/annualized-salary',
  'https://www.bamboohr.com/resources/hr-glossary/at-will-employment',
  'https://www.bamboohr.com/resources/hr-glossary/attrition',
  'https://www.bamboohr.com/resources/hr-glossary/baby-boomers',
  'https://www.bamboohr.com/resources/hr-glossary/back-pay',
  'https://www.bamboohr.com/resources/hr-glossary/basic-salary-meaning',
  'https://www.bamboohr.com/resources/hr-glossary/biweekly-pay',
  'https://www.bamboohr.com/resources/hr-glossary/business-partnership',
  'https://www.bamboohr.com/resources/hr-glossary/career-path',
  'https://www.bamboohr.com/resources/hr-glossary/casdi',
  'https://www.bamboohr.com/resources/hr-glossary/compa-ratio',
  'https://www.bamboohr.com/resources/hr-glossary/compensatory-time-off',
  'https://www.bamboohr.com/resources/hr-glossary/contingent-worker',
  'https://www.bamboohr.com/resources/hr-glossary/cp-575-letter',
  'https://www.bamboohr.com/resources/hr-glossary/direct-reports',
  'https://www.bamboohr.com/resources/hr-glossary/disciplinary-action',
  'https://www.bamboohr.com/resources/hr-glossary/disregarded-entity',
  'https://www.bamboohr.com/resources/hr-glossary/diversity',
  'https://www.bamboohr.com/resources/hr-glossary/employee-benefits-administration',
  'https://www.bamboohr.com/resources/hr-glossary/employee-evaluation',
  'https://www.bamboohr.com/resources/hr-glossary/employee-management',
  'https://www.bamboohr.com/resources/hr-glossary/employee-orientation',
  'https://www.bamboohr.com/resources/hr-glossary/employee-relations',
  'https://www.bamboohr.com/resources/hr-glossary/employee-satisfaction',
  'https://www.bamboohr.com/resources/hr-glossary/employee-turnover',
  'https://www.bamboohr.com/resources/hr-glossary/employer-payroll-taxes',
  'https://www.bamboohr.com/resources/hr-glossary/employment-contract',
  'https://www.bamboohr.com/resources/hr-glossary/employment-status',
  'https://www.bamboohr.com/resources/hr-glossary/exit-interview',
  'https://www.bamboohr.com/resources/hr-glossary/federal-holidays',
  'https://www.bamboohr.com/resources/hr-glossary/federal-id-number',
  'https://www.bamboohr.com/resources/hr-glossary/federal-income-tax',
  'https://www.bamboohr.com/resources/hr-glossary/federal-mileage-rate',
  'https://www.bamboohr.com/resources/hr-glossary/floating-holiday',
  'https://www.bamboohr.com/resources/hr-glossary/form-1120-s',
  'https://www.bamboohr.com/resources/hr-glossary/generation-z',
  'https://www.bamboohr.com/resources/hr-glossary/gross-income',
  'https://www.bamboohr.com/resources/hr-glossary/health-maintenance-organization-hmo',
  'https://www.bamboohr.com/resources/hr-glossary/hourly-employee',
  'https://www.bamboohr.com/resources/hr-glossary/hourly-to-salary',
  'https://www.bamboohr.com/resources/hr-glossary/hr-business-partner',
  'https://www.bamboohr.com/resources/hr-glossary/job-classification',
  'https://www.bamboohr.com/resources/hr-glossary/labor-force',
  'https://www.bamboohr.com/resources/hr-glossary/millennials',
  'https://www.bamboohr.com/resources/hr-glossary/nepotism',
  'https://www.bamboohr.com/resources/hr-glossary/net-pay',
  'https://www.bamboohr.com/resources/hr-glossary/onboarding',
  'https://www.bamboohr.com/resources/hr-glossary/paid-holidays',
  'https://www.bamboohr.com/resources/hr-glossary/parental-leave',
  'https://www.bamboohr.com/resources/hr-glossary/partial-pay',
  'https://www.bamboohr.com/resources/hr-glossary/performance-review',
  'https://www.bamboohr.com/resources/hr-glossary/pre-tax-deduction',
  'https://www.bamboohr.com/resources/hr-glossary/professional-employer-organization-peo',
  'https://www.bamboohr.com/resources/hr-glossary/retention-strategy',
  'https://www.bamboohr.com/resources/hr-glossary/seasonal-employment',
  'https://www.bamboohr.com/resources/hr-glossary/stay-interviews',
  'https://www.bamboohr.com/resources/hr-glossary/termination-letter',
  'https://www.bamboohr.com/resources/hr-glossary/wages'
];

// Function to fetch HTML and check for missing H1
async function checkMissingH1(url) {
  try {
    const response = await axios.get(url);
    const html = response.data;
    const $ = cheerio.load(html);

    // Check if <h1> exists
    const h1 = $('h1');
    if (h1.length === 0) {
      console.log(`Missing H1 on: ${url}`);
    } else {
      console.log(`H1 found on: ${url}`);
    }
  } catch (error) {
    console.error(`Error fetching ${url}: ${error.message}`);
  }
}

// Iterate over the list of URLs and check for missing H1
async function checkUrls() {
  for (const url of h1Urls) {
    await checkMissingH1(url);
  }
}

async function checkMissingOrEmptyDescription(urls) {
  const results = [];

  for (const url of urls) {
    try {
      const response = await axios.get(url);
      const html = response.data;
      const $ = cheerio.load(html);

      // Check for the description meta tag
      const description = $('meta[name="description"]').attr('content') || '';

      if (description.trim() === '') {
        results.push({ url, missingOrEmpty: true });
      } else {
        results.push({ url, missingOrEmpty: false });
      }
    } catch (error) {
      console.error(`Error fetching ${url}:`, error.message);
      results.push({ url, error: error.message });
    }
  }

  return results;
}

async function checkMissingOrEmptyTitle(urls) {
  const results = [];

  for (const url of urls) {
    try {
      const response = await axios.get(url);
      const html = response.data;
      const $ = cheerio.load(html);

      // Check for the title tag
      const title = $('title').text() || '';

      if (title.trim() === '') {
        results.push({ url, missingOrEmpty: true });
      } else {
        results.push({ url, missingOrEmpty: false });
      }
    } catch (error) {
      console.error(`Error fetching ${url}:`, error.message);
      results.push({ url, error: error.message });
    }
  }

  return results;
}

// checkUrls();
checkMissingOrEmptyDescription(descriptionUrls).then(results => {
  console.log(results);
});
// checkMissingOrEmptyTitle(titleUrls).then(results => {
//   console.log(results);
// });

