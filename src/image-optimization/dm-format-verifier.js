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
 * Tests a DM image URL with all supported formats and returns size comparison.
 *
 * @param {string} imageUrl - The Dynamic Media image URL
 * @param {Object} log - Logger object
 * @returns {Promise<Object>} Format comparison results
 */
export async function verifyDmFormats(imageUrl, log) {
  const baseUrl = getBaseDmUrl(imageUrl);
  const results = {
    originalUrl: imageUrl,
    baseUrl,
    formats: {},
    smallestFormat: null,
    largestFormat: null,
    currentFormat: null,
    recommendations: [],
  };

  // Detect current format from URL
  const currentFormatMatch = imageUrl.match(/[?&]fmt=([a-z]+)/i)
    || imageUrl.match(/\.([a-z]+)(?:\?|$)/i);
  if (currentFormatMatch) {
    results.currentFormat = currentFormatMatch[1].toLowerCase();
  }

  // Test each format
  const formatPromises = DM_FORMATS.map(async (format) => {
    const formatUrl = constructFormatUrl(baseUrl, format);
    const result = await getImageSize(formatUrl, log);

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

  // Generate recommendations - always recommend smallest format
  if (results.smallestFormat && results.currentFormat) {
    const currentSize = results.formats[results.currentFormat]?.size;
    const optimalSize = results.formats[results.smallestFormat]?.size;

    if (currentSize && optimalSize && results.smallestFormat !== results.currentFormat) {
      const savingsBytes = currentSize - optimalSize;
      const savingsPercent = Math.round((savingsBytes / currentSize) * 100);

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
    }
  }

  // If no current format detected, recommend the smallest available
  if (!results.currentFormat && results.smallestFormat) {
    const smallestResult = results.formats[results.smallestFormat];
    results.recommendations.push({
      type: 'format-optimization',
      recommendedFormat: results.smallestFormat,
      recommendedSize: smallestResult.size,
      recommendedUrl: smallestResult.url,
      message: `Use ${results.smallestFormat.toUpperCase()} format for optimal size (${smallestResult.sizeKB} KB)`,
    });
  }

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
