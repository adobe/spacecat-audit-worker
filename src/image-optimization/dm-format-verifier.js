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
 * DM Format Verifier
 * Tests Dynamic Media images with different format parameters to find optimal format.
 * Uses HEAD requests to compare file sizes without downloading full images.
 */

// Supported formats for comparison (in order of preference)
const DM_FORMATS = ['avif', 'webp', 'jpeg', 'png'];

// Timeout for HEAD requests (ms)
const REQUEST_TIMEOUT = 10000;

// Browser-like Accept header for detecting Smart Imaging
const BROWSER_ACCEPT_HEADER = 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8';

/**
 * Extracts the base DM URL without format parameters.
 * Handles both Scene7 and AEM Assets Delivery API patterns.
 *
 * @param {string} imageUrl - The image URL
 * @returns {string} Base URL without fmt parameter
 */
function getBaseDmUrl(imageUrl) {
  try {
    const url = new URL(imageUrl);

    // Remove existing fmt parameter
    url.searchParams.delete('fmt');

    // Remove other format-related parameters that might interfere
    url.searchParams.delete('format');

    return url.toString();
  } catch (e) {
    return imageUrl;
  }
}

/**
 * Format parameter mapping for different DM URL patterns.
 *
 * /is/image/ (Scene7 Image Serving) → fmt parameter
 * /adobe/assets/ (AEM Assets Delivery API) → format parameter + preferwebp/preferavif
 * /dynamicmedia → format parameter
 */
const DM_FORMAT_PARAMS = {
  // Scene7 Image Serving uses 'fmt'
  '/is/image/': {
    param: 'fmt',
    values: {
      avif: 'avif', webp: 'webp', jpeg: 'jpeg', png: 'png',
    },
  },
  // AEM Assets Delivery API uses 'format' and prefer flags
  '/adobe/assets/': {
    param: 'format',
    values: {
      avif: 'avif', webp: 'webp', jpeg: 'jpeg', png: 'png',
    },
    // Additional flags for AEM Assets Delivery
    preferFlags: {
      avif: 'preferavif',
      webp: 'preferwebp',
    },
  },
  // Dynamic Media delivery uses 'format'
  '/dynamicmedia': {
    param: 'format',
    values: {
      avif: 'avif', webp: 'webp', jpeg: 'jpeg', png: 'png',
    },
  },
};

/**
 * Constructs a DM URL with specific format parameter.
 * Uses different parameters based on the URL pattern:
 * - /is/image/ → ?fmt=webp
 * - /adobe/assets/ → ?format=webp or ?preferwebp=true
 * - /dynamicmedia → ?format=webp
 *
 * @param {string} baseUrl - The base DM URL
 * @param {string} format - The format to request (avif, webp, jpeg, png)
 * @returns {string} URL with format parameter
 */
function constructFormatUrl(baseUrl, format) {
  try {
    const url = new URL(baseUrl);

    // Find matching DM pattern
    let config = null;
    let matchedPattern = null;

    Object.keys(DM_FORMAT_PARAMS).forEach((pattern) => {
      if (url.pathname.includes(pattern) || url.href.includes(pattern)) {
        config = DM_FORMAT_PARAMS[pattern];
        matchedPattern = pattern;
      }
    });

    // Default to Scene7 fmt parameter if no pattern matched
    if (!config) {
      config = DM_FORMAT_PARAMS['/is/image/'];
      matchedPattern = 'default';
    }

    // Set the format parameter
    const paramValue = config.values[format] || format;
    url.searchParams.set(config.param, paramValue);

    // For AEM Assets Delivery API, also set prefer flags for better browser support
    if (matchedPattern === '/adobe/assets/' && config.preferFlags && config.preferFlags[format]) {
      url.searchParams.set(config.preferFlags[format], 'true');
    }

    return url.toString();
  } catch (e) {
    // Fallback: append as query param (Scene7 style)
    const separator = baseUrl.includes('?') ? '&' : '?';
    return `${baseUrl}${separator}fmt=${format}`;
  }
}

/**
 * Makes a HEAD request to get the Content-Length of an image.
 *
 * @param {string} url - The URL to check
 * @param {Object} log - Logger object
 * @returns {Promise<Object>} Result with size and headers
 */
async function getImageSize(url, log) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const response = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      headers: {
        'User-Agent': 'SpaceCat-ImageOptimization/1.0',
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return {
        success: false,
        status: response.status,
        error: `HTTP ${response.status}`,
      };
    }

    const contentLength = response.headers.get('content-length');
    const contentType = response.headers.get('content-type');

    return {
      success: true,
      size: contentLength ? parseInt(contentLength, 10) : null,
      contentType,
      status: response.status,
    };
  } catch (error) {
    clearTimeout(timeoutId);
    log.debug(`[dm-format-verifier] HEAD request failed for ${url}: ${error.message}`);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Detects if Smart Imaging is enabled on a Dynamic Media server.
 * Smart Imaging automatically serves optimized formats (WebP/AVIF) based on browser Accept headers,
 * regardless of the fmt parameter in the URL.
 *
 * Detection method:
 * 1. Request the image with ?fmt=jpeg (explicit JPEG format)
 * 2. Include browser-like Accept header that supports WebP/AVIF
 * 3. If the server returns a different format than JPEG, Smart Imaging is active
 *
 * @param {string} baseUrl - The base DM URL without format parameters
 * @param {Object} log - Logger object
 * @returns {Promise<Object>} Smart Imaging detection result
 */
async function detectSmartImaging(baseUrl, log) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  // Request JPEG format explicitly
  const jpegUrl = constructFormatUrl(baseUrl, 'jpeg');

  try {
    const response = await fetch(jpegUrl, {
      method: 'HEAD',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        Accept: BROWSER_ACCEPT_HEADER,
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return {
        detected: false,
        error: `HTTP ${response.status}`,
      };
    }

    const contentType = response.headers.get('content-type') || '';
    const contentLength = response.headers.get('content-length');

    // Parse the actual format from Content-Type
    const actualFormatMatch = contentType.match(/image\/([a-z0-9]+)/i);
    const actualFormat = actualFormatMatch ? actualFormatMatch[1].toLowerCase() : null;

    // Smart Imaging is active if we requested JPEG but got a different format
    // This indicates the server is doing automatic format negotiation based on Accept headers
    const isSmartImagingActive = actualFormat && actualFormat !== 'jpeg';

    log.info(`[dm-format-verifier] 🔍 Smart Imaging detection: requested=jpeg, received=${actualFormat}, active=${isSmartImagingActive}`);

    return {
      detected: isSmartImagingActive,
      requestedFormat: 'jpeg',
      actualFormat,
      actualSize: contentLength ? parseInt(contentLength, 10) : null,
      contentType,
    };
  } catch (error) {
    clearTimeout(timeoutId);
    log.debug(`[dm-format-verifier] Smart Imaging detection failed: ${error.message}`);
    return {
      detected: false,
      error: error.message,
    };
  }
}

/**
 * Tests a DM image URL with all supported formats and returns size comparison.
 *
 * @param {string} imageUrl - The Dynamic Media image URL
 * @param {Object} log - Logger object
 * @returns {Promise<Object>} Format comparison results
 */
export async function verifyDmFormats(imageUrl, log) {
  log.info(`[dm-format-verifier] 🔍 Starting format verification for: ${imageUrl}`);

  const baseUrl = getBaseDmUrl(imageUrl);
  const results = {
    originalUrl: imageUrl,
    baseUrl,
    formats: {},
    smallestFormat: null,
    largestFormat: null,
    currentFormat: null,
    recommendations: [],
    smartImaging: null,
  };

  // Check for Smart Imaging first
  const smartImagingResult = await detectSmartImaging(baseUrl, log);
  results.smartImaging = smartImagingResult;

  if (smartImagingResult.detected) {
    log.info(`[dm-format-verifier] ✅ Smart Imaging is ACTIVE - browsers already receive ${smartImagingResult.actualFormat.toUpperCase()} (${Math.round(smartImagingResult.actualSize / 1024)} KB)`);
    log.info('[dm-format-verifier] ⚪ Skipping format optimization recommendations - Smart Imaging handles this automatically');

    // Still collect format data for reference, but don't generate recommendations
    results.smartImagingActive = true;
    results.browserFormat = smartImagingResult.actualFormat;
    results.browserSize = smartImagingResult.actualSize;
  }

  // Detect current format from URL parameters or file extension
  const currentFormatMatch = imageUrl.match(/[?&]fmt=([a-z]+)/i)
    || imageUrl.match(/\.([a-z]+)(?:\?|$)/i);
  if (currentFormatMatch) {
    results.currentFormat = currentFormatMatch[1].toLowerCase();
  }

  // If format not detected from URL, try HEAD request to get Content-Type
  if (!results.currentFormat) {
    log.info('[dm-format-verifier] Format not in URL, detecting via HEAD request...');
    const baseResult = await getImageSize(baseUrl, log);
    if (baseResult.success && baseResult.contentType) {
      // Parse format from content-type (e.g., "image/webp" → "webp", "image/jpeg" → "jpeg")
      const contentTypeMatch = baseResult.contentType.match(/image\/([a-z0-9]+)/i);
      if (contentTypeMatch) {
        results.currentFormat = contentTypeMatch[1].toLowerCase();
        // Store the base URL size as reference for the current format
        results.baseUrlSize = baseResult.size;
        log.info(`[dm-format-verifier] Format detected from Content-Type: ${results.currentFormat}`);
      }
    }
  }

  log.info(`[dm-format-verifier] Current format detected: ${results.currentFormat || 'UNKNOWN'}`);
  log.info(`[dm-format-verifier] Base URL: ${baseUrl}`);
  log.info(`[dm-format-verifier] Testing formats: ${DM_FORMATS.join(', ')}`);

  // Test each format
  const formatPromises = DM_FORMATS.map(async (format) => {
    const formatUrl = constructFormatUrl(baseUrl, format);
    log.debug(`[dm-format-verifier] Testing ${format}: ${formatUrl}`);
    const result = await getImageSize(formatUrl, log);

    if (result.success) {
      log.info(`[dm-format-verifier] ✅ ${format}: ${result.size} bytes (${Math.round(result.size / 1024)} KB)`);
    } else {
      log.warn(`[dm-format-verifier] ❌ ${format}: FAILED - ${result.error || 'Unknown error'}`);
    }

    return {
      format,
      url: formatUrl,
      ...result,
    };
  });

  const formatResults = await Promise.all(formatPromises);

  // Process results
  let smallestSize = Infinity;
  let largestSize = 0;

  formatResults.forEach((result) => {
    results.formats[result.format] = {
      url: result.url,
      size: result.size,
      sizeKB: result.size ? Math.round(result.size / 1024) : null,
      success: result.success,
      contentType: result.contentType,
      error: result.error,
    };

    if (result.success && result.size) {
      if (result.size < smallestSize) {
        smallestSize = result.size;
        results.smallestFormat = result.format;
      }
      if (result.size > largestSize) {
        largestSize = result.size;
        results.largestFormat = result.format;
      }
    }
  });

  // Generate recommendations - only if savings > 10% AND Smart Imaging is not active
  log.info(`[dm-format-verifier] 📊 Analysis: smallestFormat=${results.smallestFormat}, currentFormat=${results.currentFormat}, smartImaging=${results.smartImagingActive || false}`);

  // Skip recommendations if Smart Imaging is active - browsers already get optimized format
  if (results.smartImagingActive) {
    log.info('[dm-format-verifier] 🏁 Verification complete: 0 recommendations (Smart Imaging active)');
    return results;
  }

  if (results.smallestFormat && results.currentFormat) {
    const currentSize = results.formats[results.currentFormat]?.size;
    const optimalSize = results.formats[results.smallestFormat]?.size;

    log.info(`[dm-format-verifier] Comparing: current=${currentSize} bytes, optimal=${optimalSize} bytes`);

    if (currentSize && optimalSize && results.smallestFormat !== results.currentFormat) {
      const savingsBytes = currentSize - optimalSize;
      const savingsPercent = Math.round((savingsBytes / currentSize) * 100);

      log.info(`[dm-format-verifier] Potential savings: ${savingsPercent}% (${Math.round(savingsBytes / 1024)} KB)`);

      // Only recommend if savings are significant (>10%)
      if (savingsPercent > 10) {
        log.info(`[dm-format-verifier] ✅ Creating recommendation (savings ${savingsPercent}% > 10% threshold)`);
        results.recommendations.push({
          type: 'format-optimization',
          currentFormat: results.currentFormat,
          recommendedFormat: results.smallestFormat,
          currentSize,
          recommendedSize: optimalSize,
          savingsBytes,
          savingsPercent,
          recommendedUrl: results.formats[results.smallestFormat].url,
          message: `Switch from ${results.currentFormat.toUpperCase()} to ${results.smallestFormat.toUpperCase()} to save ${savingsPercent}% (${Math.round(savingsBytes / 1024)} KB)`,
        });
      } else {
        log.info(`[dm-format-verifier] ⚪ No recommendation: savings ${savingsPercent}% < 10% threshold`);
      }
    } else if (results.smallestFormat === results.currentFormat) {
      log.info('[dm-format-verifier] ⚪ No recommendation: already using optimal format');
    } else {
      log.warn('[dm-format-verifier] ⚠️ No recommendation: missing size data');
    }
  }

  // If no current format detected, recommend the smallest available
  // Calculate savings using the largest format as baseline if current format unknown
  if (!results.currentFormat && results.smallestFormat) {
    log.info(`[dm-format-verifier] ℹ️ No current format detected, recommending smallest: ${results.smallestFormat}`);
    const smallestResult = results.formats[results.smallestFormat];

    // Use base URL size (from HEAD request) or largest format as baseline for savings calculation
    const baselineSize = results.baseUrlSize || largestSize;
    const savingsBytes = baselineSize && smallestResult.size
      ? baselineSize - smallestResult.size : 0;
    const savingsPercent = baselineSize ? Math.round((savingsBytes / baselineSize) * 100) : 0;

    // Only recommend if there are actual savings
    if (savingsPercent > 10) {
      results.recommendations.push({
        type: 'format-optimization',
        currentFormat: 'unknown',
        recommendedFormat: results.smallestFormat,
        currentSize: baselineSize,
        recommendedSize: smallestResult.size,
        savingsBytes,
        savingsPercent,
        recommendedUrl: smallestResult.url,
        message: `Use ${results.smallestFormat.toUpperCase()} format for optimal size (${smallestResult.sizeKB} KB), saving ${savingsPercent}% (${Math.round(savingsBytes / 1024)} KB)`,
      });
    } else {
      log.info(`[dm-format-verifier] ⚪ No recommendation: savings ${savingsPercent}% < 10% threshold`);
    }
  }

  log.info(`[dm-format-verifier] 🏁 Verification complete: ${results.recommendations.length} recommendations`);
  return results;
}

/**
 * Batch verifies multiple DM image URLs for format optimization.
 *
 * @param {Array<Object>} images - Array of image objects with src property
 * @param {Object} log - Logger object
 * @param {Object} options - Options for verification
 * @param {number} options.concurrency - Max concurrent requests (default: 5)
 * @param {boolean} options.dmOnly - Only verify DM images (default: true)
 * @returns {Promise<Array>} Array of verification results
 */
export async function batchVerifyDmFormats(images, log, options = {}) {
  const {
    concurrency = 5,
    dmOnly = true,
  } = options;

  // Filter to DM images only if specified
  const imagesToVerify = dmOnly
    ? images.filter((img) => img.isDynamicMedia)
    : images;

  if (imagesToVerify.length === 0) {
    log.info('[dm-format-verifier] No DM images to verify');
    return [];
  }

  log.info(`[dm-format-verifier] Verifying ${imagesToVerify.length} DM images for format optimization`);

  const results = [];

  // Process in batches for concurrency control
  for (let i = 0; i < imagesToVerify.length; i += concurrency) {
    const batch = imagesToVerify.slice(i, i + concurrency);

    // eslint-disable-next-line no-await-in-loop
    const batchResults = await Promise.all(
      batch.map(async (img) => {
        const verification = await verifyDmFormats(img.src, log);
        return {
          ...verification,
          pageUrl: img.pageUrl,
          xpath: img.xpath,
          alt: img.alt,
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight,
          renderedWidth: img.renderedWidth,
          renderedHeight: img.renderedHeight,
        };
      }),
    );

    results.push(...batchResults);

    // Small delay between batches to avoid rate limiting
    if (i + concurrency < imagesToVerify.length) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => {
        setTimeout(resolve, 100);
      });
    }
  }

  // Summary logging
  const withRecommendations = results.filter((r) => r.recommendations.length > 0);
  const totalSavings = withRecommendations.reduce((sum, r) => {
    const rec = r.recommendations[0];
    return sum + (rec?.savingsBytes || 0);
  }, 0);

  log.info('[dm-format-verifier] Verification complete:');
  log.info(`  - Images verified: ${results.length}`);
  log.info(`  - Images with optimization opportunities: ${withRecommendations.length}`);
  log.info(`  - Total potential savings: ${Math.round(totalSavings / 1024)} KB`);

  return results;
}

/**
 * Creates a summary of format comparison results.
 *
 * @param {Array} verificationResults - Results from batchVerifyDmFormats
 * @returns {Object} Summary statistics
 */
export function createVerificationSummary(verificationResults) {
  const summary = {
    totalImagesVerified: verificationResults.length,
    imagesWithRecommendations: 0,
    imagesWithSmartImaging: 0,
    totalPotentialSavingsBytes: 0,
    formatDistribution: {
      avif: { available: 0, recommended: 0 },
      webp: { available: 0, recommended: 0 },
      jpeg: { available: 0, recommended: 0 },
      png: { available: 0, recommended: 0 },
    },
    topSavingsOpportunities: [],
  };

  verificationResults.forEach((result) => {
    // Count Smart Imaging instances
    if (result.smartImagingActive) {
      summary.imagesWithSmartImaging += 1;
    }
    // Count format availability
    Object.keys(result.formats).forEach((format) => {
      if (result.formats[format].success) {
        summary.formatDistribution[format].available += 1;
      }
    });

    // Count recommendations
    if (result.recommendations.length > 0) {
      summary.imagesWithRecommendations += 1;
      const rec = result.recommendations[0];
      summary.totalPotentialSavingsBytes += rec.savingsBytes || 0;

      if (rec.recommendedFormat) {
        summary.formatDistribution[rec.recommendedFormat].recommended += 1;
      }

      // Track top savings opportunities
      if (rec.savingsBytes > 50000) { // More than 50KB savings
        summary.topSavingsOpportunities.push({
          url: result.originalUrl,
          pageUrl: result.pageUrl,
          savingsBytes: rec.savingsBytes,
          savingsPercent: rec.savingsPercent,
          recommendation: rec.message,
        });
      }
    }
  });

  // Sort top opportunities by savings
  summary.topSavingsOpportunities.sort((a, b) => b.savingsBytes - a.savingsBytes);
  summary.topSavingsOpportunities = summary.topSavingsOpportunities.slice(0, 10);

  summary.totalPotentialSavingsKB = Math.round(summary.totalPotentialSavingsBytes / 1024);
  summary.totalPotentialSavingsMB = (summary.totalPotentialSavingsBytes / 1024 / 1024).toFixed(2);

  return summary;
}
