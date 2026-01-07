#!/usr/bin/env node
/*
 * Flexible SEO Validator Test - Reads URLs from JSON file
 * 
 * Usage (from project root):
 *   node test/dev/validate-urls.mjs <input-file> [output-file]
 *   node test/dev/validate-urls.mjs ~/Desktop/urls.json
 *   node test/dev/validate-urls.mjs ~/Desktop/urls.json results.json
 *   node test/dev/validate-urls.mjs ~/Desktop/urls.json ~/Desktop/results.json
 * 
 * Usage (from test/dev directory):
 *   node validate-urls.mjs ~/Desktop/urls.json
 *   node validate-urls.mjs ~/Desktop/urls.json results.json
 * 
 * JSON Format:
 *   [
 *     {
 *       "url": "https://example.com",
 *       "topKeyword": "example keyword",
 *       "traffic": 100
 *     },
 *     ...
 *   ]
 * 
 * Optional fields: siteTopPageId, position, intent, etc.
 * 
 * If output-file is not specified, results are saved to:
 *   validation-results-{timestamp}.json
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve, basename } from 'path';
import robotsParser from 'robots-parser';

// ============================================================================
// ROBOTS.TXT CACHING
// ============================================================================

const ROBOTS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const robotsTxtCache = new Map();

// ============================================================================
// VALIDATION FUNCTIONS
// ============================================================================

async function fetchUrl(url) {
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      redirect: 'manual',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SpaceCat-Indexability-Check/1.0)'
      }
    });
    return response;
  } catch (error) {
    try {
      const response = await fetch(url, {
        redirect: 'manual',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; SpaceCat-Indexability-Check/1.0)'
        }
      });
      return response;
    } catch (getError) {
      throw error;
    }
  }
}

async function checkHttpStatus(url) {
  try {
    const response = await fetch(url, { redirect: 'follow' });
    const is4xxOr5xx = response.status >= 400;
    return {
      passed: !is4xxOr5xx,
      statusCode: response.status,
      blocker: is4xxOr5xx ? 'http-error' : null
    };
  } catch (error) {
    return {
      passed: false,
      statusCode: 0,
      blocker: 'http-error',
      error: error.message
    };
  }
}

async function checkRedirects(url) {
  try {
    let redirectCount = 0;
    let currentUrl = url;
    const maxRedirects = 10;
    const chain = [url];
    
    while (redirectCount < maxRedirects) {
      const response = await fetchUrl(currentUrl);
      
      if (response.status >= 300 && response.status < 400) {
        redirectCount++;
        const location = response.headers.get('location');
        if (!location) break;
        
        currentUrl = new URL(location, currentUrl).href;
        chain.push(currentUrl);
      } else {
        break;
      }
    }
    
    return {
      passed: redirectCount === 0,
      redirectCount,
      redirectChain: chain.length > 1 ? chain.join(' -> ') : null,
      finalUrl: chain[chain.length - 1],
      blocker: redirectCount > 0 ? 'redirect-chain' : null
    };
  } catch (error) {
    return {
      passed: true,
      redirectCount: 0,
      blocker: null,
      error: error.message
    };
  }
}

async function checkCanonical(url) {
  try {
    const response = await fetch(url, { redirect: 'follow' });
    if (!response.ok) {
      return { passed: true, blocker: null };
    }
    
    const html = await response.text();
    const canonicalMatch = html.match(/<link\s+rel=["']canonical["']\s+href=["']([^"']+)["']/i);
    
    if (!canonicalMatch) {
      return { passed: true, canonicalUrl: null, isSelfReferencing: true, blocker: null };
    }
    
    const canonicalUrl = new URL(canonicalMatch[1], url).href;
    const normalizedUrl = url.replace(/\/$/, '');
    const normalizedCanonical = canonicalUrl.replace(/\/$/, '');
    const isSelfReferencing = normalizedUrl === normalizedCanonical;
    
    return {
      passed: isSelfReferencing,
      canonicalUrl,
      isSelfReferencing,
      blocker: !isSelfReferencing ? 'canonical-mismatch' : null
    };
  } catch (error) {
    return {
      passed: true,
      canonicalUrl: null,
      isSelfReferencing: true,
      blocker: null,
      error: error.message
    };
  }
}

async function checkNoindex(url) {
  try {
    const response = await fetch(url, { redirect: 'follow' });
    
    const robotsHeader = response.headers.get('x-robots-tag') || '';
    const hasNoindexHeader = robotsHeader.toLowerCase().includes('noindex') || 
                             robotsHeader.toLowerCase().includes('none');
    
    let hasNoindexMeta = false;
    if (response.ok) {
      const html = await response.text();
      const metaMatch = html.match(/<meta\s+name=["']robots["']\s+content=["']([^"']+)["']/i);
      if (metaMatch) {
        const content = metaMatch[1].toLowerCase();
        hasNoindexMeta = content.includes('noindex') || content.includes('none');
      }
    }
    
    const hasNoindex = hasNoindexHeader || hasNoindexMeta;
    return {
      passed: !hasNoindex,
      hasNoindexHeader,
      hasNoindexMeta,
      blocker: hasNoindex ? 'noindex' : null
    };
  } catch (error) {
    return {
      passed: true,
      blocker: null,
      error: error.message
    };
  }
}

// Check robots.txt
async function checkRobotsTxt(url) {
  try {
    const urlObj = new URL(url);
    const domain = `${urlObj.protocol}//${urlObj.host}`;
    const robotsUrl = `${domain}/robots.txt`;
    
    // Check cache first
    const cached = robotsTxtCache.get(domain);
    if (cached && Date.now() - cached.timestamp < ROBOTS_CACHE_TTL) {
      const { robots } = cached;
      const isAllowedForGooglebot = robots.isAllowed(url, 'Googlebot');
      const isAllowedGenerally = robots.isAllowed(url);
      
      return {
        passed: isAllowedForGooglebot && isAllowedGenerally,
        blocker: (!isAllowedForGooglebot || !isAllowedGenerally) ? 'robots-txt-blocked' : null,
        googlebot: isAllowedForGooglebot,
        general: isAllowedGenerally,
        cached: true
      };
    }
    
    // Fetch and parse robots.txt
    const response = await fetch(robotsUrl);
    const robotsTxtContent = await response.text();
    const robots = robotsParser(robotsUrl, robotsTxtContent);
    
    // Cache the parsed robots.txt
    robotsTxtCache.set(domain, { robots, timestamp: Date.now() });
    
    const isAllowedForGooglebot = robots.isAllowed(url, 'Googlebot');
    const isAllowedGenerally = robots.isAllowed(url);
    
    return {
      passed: isAllowedForGooglebot && isAllowedGenerally,
      blocker: (!isAllowedForGooglebot || !isAllowedGenerally) ? 'robots-txt-blocked' : null,
      googlebot: isAllowedForGooglebot,
      general: isAllowedGenerally,
      cached: false
    };
  } catch (error) {
    // Don't block on robots.txt fetch errors (file might not exist)
    return {
      passed: true,
      blocker: null,
      error: error.message
    };
  }
}

async function validateUrl(urlData, index, total) {
  const { url, topKeyword, primaryKeyword, traffic, trafficValue } = urlData;
  const keyword = topKeyword || primaryKeyword || 'N/A';
  const trafficCount = traffic || trafficValue || 0;
  
  console.log(`\n[${index + 1}/${total}] 🔍 ${url}`);
  
  const [httpStatus, redirects, canonical, noindex, robotsTxt] = await Promise.all([
    checkHttpStatus(url),
    checkRedirects(url),
    checkCanonical(url),
    checkNoindex(url),
    checkRobotsTxt(url)
  ]);
  
  const checks = { httpStatus, redirects, canonical, noindex, robotsTxt };
  const allPassed = Object.values(checks).every(c => c.passed);
  const blockers = Object.values(checks)
    .filter(c => !c.passed && c.blocker)
    .map(c => c.blocker);
  
  const statusIcon = allPassed ? '✅' : '❌';
  console.log(`        ${statusIcon} ${allPassed ? 'CLEAN' : 'BLOCKED: ' + blockers.join(', ')}`);
  
  return {
    url,
    primaryKeyword: keyword,
    trafficValue: trafficCount,
    indexable: allPassed,
    checks,
    blockers
  };
}

// ============================================================================
// MAIN TEST RUNNER
// ============================================================================

async function runTest() {
  // Get file path from command line
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.error('❌ Error: Please provide a JSON file path');
    console.error('\nUsage (from project root):');
    console.error('  node test/dev/validate-urls.mjs <input-file> [output-file]');
    console.error('\nExamples:');
    console.error('  node test/dev/validate-urls.mjs ~/Desktop/urls.json');
    console.error('  node test/dev/validate-urls.mjs ~/Desktop/urls.json results.json');
    console.error('  node test/dev/validate-urls.mjs ~/Desktop/urls.json ~/Desktop/results.json');
    console.error('\nJSON Format:');
    console.error('  [');
    console.error('    {');
    console.error('      "url": "https://example.com",');
    console.error('      "topKeyword": "example keyword",  // or "primaryKeyword"');
    console.error('      "traffic": 100                    // or "trafficValue"');
    console.error('    }');
    console.error('  ]');
    console.error('\nOutput:');
    console.error('  If output file is not specified, results saved to:');
    console.error('    validation-results-{timestamp}.json');
    process.exit(1);
  }
  
  const inputFilePath = resolve(args[0].replace(/^~/, process.env.HOME));
  const outputFilePath = args[1] 
    ? resolve(args[1].replace(/^~/, process.env.HOME))
    : `validation-results-${Date.now()}.json`;
  
  const filePath = inputFilePath;
  
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║          SEO Indexability Validator - File Test               ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');
  
  // Read JSON file
  let data;
  try {
    console.log(`📂 Reading: ${basename(filePath)}`);
    console.log(`   Path: ${filePath}\n`);
    const fileContent = readFileSync(filePath, 'utf-8');
    data = JSON.parse(fileContent);
  } catch (error) {
    console.error(`❌ Error reading file: ${error.message}`);
    process.exit(1);
  }
  
  // Validate data format
  if (!Array.isArray(data)) {
    console.error('❌ Error: JSON file must contain an array of URL objects');
    process.exit(1);
  }
  
  if (data.length === 0) {
    console.error('❌ Error: JSON file is empty');
    process.exit(1);
  }
  
  // Validate required fields
  const invalidUrls = data.filter(item => !item.url);
  if (invalidUrls.length > 0) {
    console.error(`❌ Error: ${invalidUrls.length} items missing "url" field`);
    process.exit(1);
  }
  
  console.log(`📊 Found ${data.length} URLs to validate\n`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Starting validation...');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  // Run validation
  const results = [];
  for (let i = 0; i < data.length; i++) {
    const result = await validateUrl(data[i], i, data.length);
    results.push(result);
  }
  
  // Summary
  const cleanUrls = results.filter(r => r.indexable);
  const blockedUrls = results.filter(r => !r.indexable);
  
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║                     VALIDATION RESULTS                         ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');
  
  console.log(`Total URLs:    ${results.length}`);
  console.log(`✅ Clean:      ${cleanUrls.length} (${Math.round(cleanUrls.length / results.length * 100)}%)`);
  console.log(`❌ Blocked:    ${blockedUrls.length} (${Math.round(blockedUrls.length / results.length * 100)}%)\n`);
  
  if (blockedUrls.length > 0) {
    // Blocker summary
    const blockerSummary = blockedUrls.reduce((acc, url) => {
      url.blockers.forEach(blocker => {
        acc[blocker] = (acc[blocker] || 0) + 1;
      });
      return acc;
    }, {});
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 BLOCKER SUMMARY');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    Object.entries(blockerSummary)
      .sort((a, b) => b[1] - a[1])
      .forEach(([blocker, count]) => {
        const percent = Math.round(count / blockedUrls.length * 100);
        console.log(`  ${blocker.padEnd(25)} ${count.toString().padStart(3)} URLs (${percent}%)`);
      });
    console.log('');
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('❌ BLOCKED URLs (First 10)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    blockedUrls.slice(0, 10).forEach((item, index) => {
      console.log(`${index + 1}. ${item.url}`);
      console.log(`   Keyword: ${item.primaryKeyword}`);
      console.log(`   Traffic: ${item.trafficValue}`);
      console.log(`   Blockers: ${item.blockers.join(', ')}`);
      
      Object.entries(item.checks).forEach(([checkName, result]) => {
        if (!result.passed) {
          console.log(`   ❌ ${checkName}:`);
          if (checkName === 'httpStatus') {
            console.log(`      Status Code: ${result.statusCode}`);
          }
          if (checkName === 'redirects' && result.redirectCount > 0) {
            console.log(`      Redirect Count: ${result.redirectCount}`);
            if (result.redirectChain) {
              console.log(`      Chain: ${result.redirectChain}`);
            }
          }
          if (checkName === 'canonical' && result.canonicalUrl) {
            console.log(`      Points to: ${result.canonicalUrl}`);
          }
          if (checkName === 'noindex') {
            if (result.hasNoindexHeader) console.log(`      Has X-Robots-Tag: noindex`);
            if (result.hasNoindexMeta) console.log(`      Has <meta robots noindex>`);
          }
          if (checkName === 'robotsTxt') {
            console.log(`      Googlebot: ${result.googlebot ? 'Allowed' : 'BLOCKED'}`);
            console.log(`      General crawlers: ${result.general ? 'Allowed' : 'BLOCKED'}`);
          }
        }
      });
      console.log('');
    });
    
    if (blockedUrls.length > 10) {
      console.log(`   ... and ${blockedUrls.length - 10} more blocked URLs\n`);
    }
  }
  
  // Save results to JSON file
  const outputData = {
    metadata: {
      inputFile: basename(filePath),
      timestamp: new Date().toISOString(),
      totalUrls: results.length,
      cleanUrls: cleanUrls.length,
      blockedUrls: blockedUrls.length,
      blockerSummary: blockedUrls.length > 0 ? blockedUrls.reduce((acc, url) => {
        url.blockers.forEach(blocker => {
          acc[blocker] = (acc[blocker] || 0) + 1;
        });
        return acc;
      }, {}) : {}
    },
    cleanUrls,
    blockedUrls
  };
  
  try {
    writeFileSync(outputFilePath, JSON.stringify(outputData, null, 2), 'utf-8');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ Validation complete!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`📄 Results saved to: ${basename(outputFilePath)}`);
    console.log(`   Full path: ${outputFilePath}\n`);
  } catch (error) {
    console.error(`\n❌ Error saving results to file: ${error.message}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ Validation complete! (Results not saved)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  }
}

// Run the test
runTest().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});

