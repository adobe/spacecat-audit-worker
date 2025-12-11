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
 * Non-DM Format Verifier
 * Uploads non-Dynamic Media images to Scene7 Snapshot API to generate
 * AEM preview URLs for format comparison.
 *
 * Flow:
 * 1. Download non-DM image
 * 2. Upload to Scene7 Snapshot API (/api/upload-to-aem)
 * 3. Fetch AEM asset info (/api/fetch-aem-assets)
 * 4. Generate preview URL (/api/generate-asset-preview-url)
 * 5. Compare formats using preview URL with format parameters
 */

import { Blob } from 'buffer';

// Scene7 Snapshot API configuration
const SCENE7_SNAPSHOT_BASE = 'https://snapshot.scene7.com';
const SCENE7_API = {
  UPLOAD: `${SCENE7_SNAPSHOT_BASE}/api/upload-to-aem`,
  FETCH_ASSETS: `${SCENE7_SNAPSHOT_BASE}/api/fetch-aem-assets`,
  GENERATE_PREVIEW: `${SCENE7_SNAPSHOT_BASE}/api/generate-asset-preview-url`,
};

// Supported formats for comparison
const PREVIEW_FORMATS = ['avif', 'webp', 'jpeg', 'png'];

// Timeouts
const DOWNLOAD_TIMEOUT = 30000; // 30 seconds for downloading image
const API_TIMEOUT = 60000; // 60 seconds for API calls
const PREVIEW_POLL_TIMEOUT = 120000; // 2 minutes for preview generation
const PREVIEW_POLL_INTERVAL = 5000; // Check every 5 seconds

// Common headers for Scene7 API
const SCENE7_HEADERS = {
  accept: 'application/json, text/plain, */*',
  'accept-language': 'en-GB,en-US;q=0.9,en;q=0.8',
  origin: SCENE7_SNAPSHOT_BASE,
  referer: `${SCENE7_SNAPSHOT_BASE}/`,
  'user-agent': 'SpaceCat-ImageOptimization/1.0',
};

/**
 * Downloads an image from a URL and returns it as a Buffer.
 *
 * @param {string} imageUrl - The image URL to download
 * @param {Object} log - Logger object
 * @returns {Promise<Object>} Object with buffer, contentType, and filename
 */
async function downloadImage(imageUrl, log) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT);

  try {
    log.debug(`[non-dm-verifier] Downloading image: ${imageUrl}`);

    const response = await fetch(imageUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'SpaceCat-ImageOptimization/1.0',
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get('content-type') || 'image/jpeg';

    // Extract filename from URL
    const urlObj = new URL(imageUrl);
    let filename = urlObj.pathname.split('/').pop() || 'image';

    // Add extension if missing
    if (!filename.includes('.')) {
      const ext = contentType.split('/')[1] || 'jpg';
      filename = `${filename}.${ext}`;
    }

    log.debug(`[non-dm-verifier] Downloaded ${buffer.length} bytes, type: ${contentType}`);

    return {
      buffer,
      contentType,
      filename,
      size: buffer.length,
    };
  } catch (error) {
    clearTimeout(timeoutId);
    log.error(`[non-dm-verifier] Download failed for ${imageUrl}: ${error.message}`);
    throw error;
  }
}

/**
 * Uploads an image to Scene7 Snapshot API.
 *
 * @param {Buffer} imageBuffer - The image buffer
 * @param {string} filename - The filename
 * @param {string} contentType - The content type
 * @param {Object} log - Logger object
 * @returns {Promise<Object>} Upload result with assetPath and targetFile
 */
async function uploadToScene7(imageBuffer, filename, contentType, log) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT);

  try {
    log.debug(`[non-dm-verifier] Uploading to Scene7: ${filename} (${imageBuffer.length} bytes)`);

    // Create form data with the image
    const formData = new FormData();
    const blob = new Blob([imageBuffer], { type: contentType });
    formData.append('image', blob, filename);

    const response = await fetch(SCENE7_API.UPLOAD, {
      method: 'POST',
      headers: SCENE7_HEADERS,
      body: formData,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Upload failed: HTTP ${response.status} - ${errorText}`);
    }

    const result = await response.json();

    if (!result.success) {
      throw new Error(`Upload failed: ${result.message || 'Unknown error'}`);
    }

    log.debug(`[non-dm-verifier] Upload successful: ${JSON.stringify(result.results)}`);

    return {
      success: true,
      assetPath: result.results?.targetFile,
      targetFolder: result.results?.targetFolder,
      fileName: result.results?.fileName || result.file?.sanitizeFilename,
      mimeType: result.results?.mimeType,
    };
  } catch (error) {
    clearTimeout(timeoutId);
    log.error(`[non-dm-verifier] Upload failed: ${error.message}`);
    throw error;
  }
}

/**
 * Fetches AEM asset information.
 *
 * @param {string} assetPath - The asset path from upload
 * @param {string} filename - The filename of the asset
 * @param {Object} log - Logger object
 * @returns {Promise<Object>} Asset info with assetId and URN
 */
async function fetchAemAssets(assetPath, filename, log) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT);

  try {
    log.debug(`[non-dm-verifier] Fetching AEM assets for: ${assetPath}`);

    const url = `${SCENE7_API.FETCH_ASSETS}?path=${encodeURIComponent(assetPath)}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: SCENE7_HEADERS,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Fetch assets failed: HTTP ${response.status} - ${errorText}`);
    }

    const result = await response.json();

    log.debug(`[non-dm-verifier] AEM assets response: ${JSON.stringify(result)}`);

    // The response structure is:
    // { success: true, assets: { filename: { 'jcr:uuid': '...', ... } } }
    // We need to extract the UUID from the nested structure
    let uuid = null;
    if (result.assets) {
      // Try to find the asset by filename
      const assetInfo = result.assets[filename];
      if (assetInfo && assetInfo['jcr:uuid']) {
        uuid = assetInfo['jcr:uuid'];
      }
    }

    if (!uuid) {
      throw new Error(`Could not find UUID for asset: ${filename}`);
    }

    log.debug(`[non-dm-verifier] Found UUID: ${uuid} for asset: ${filename}`);

    return {
      success: true,
      uuid,
      assetId: result.assetId,
      urn: result.urn,
      deliveryUrl: result.deliveryUrl,
      ...result,
    };
  } catch (error) {
    clearTimeout(timeoutId);
    log.error(`[non-dm-verifier] Fetch assets failed: ${error.message}`);
    throw error;
  }
}

/**
 * Generates a preview URL for the uploaded asset.
 *
 * @param {string} assetPath - The asset path
 * @param {Object} assetInfo - Asset info from fetchAemAssets
 * @param {string} filename - The filename of the asset
 * @param {Object} log - Logger object
 * @returns {Promise<Object>} Preview URL info with URL, token, and expiry
 */
async function generatePreviewUrl(assetPath, assetInfo, filename, log) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT);

  try {
    log.debug(`[non-dm-verifier] Generating preview URL for: ${assetPath}, filename: ${filename}`);

    const response = await fetch(SCENE7_API.GENERATE_PREVIEW, {
      method: 'POST',
      headers: {
        ...SCENE7_HEADERS,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        uuid: assetInfo.uuid,
        filename,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Generate preview failed: HTTP ${response.status} - ${errorText}`);
    }

    const result = await response.json();

    log.debug(`[non-dm-verifier] Preview URL response: ${JSON.stringify(result)}`);

    // Extract from nested asset structure
    const asset = result.asset || {};
    const previewUrl = asset.deliveryUrl || result.previewUrl || result.url;

    if (!previewUrl) {
      throw new Error('No preview URL in response');
    }

    return {
      success: true,
      previewUrl,
      token: asset.token || result.token,
      expiryTime: asset.expiry || result.expiryTime,
      assetId: asset.assetId,
      ...result,
    };
  } catch (error) {
    clearTimeout(timeoutId);
    log.error(`[non-dm-verifier] Generate preview failed: ${error.message}`);
    throw error;
  }
}

/**
 * Waits for the preview URL to become available (polls until ready).
 *
 * @param {string} previewUrl - The preview URL to check
 * @param {Object} log - Logger object
 * @returns {Promise<boolean>} True if available
 */
async function waitForPreviewReady(previewUrl, log) {
  const startTime = Date.now();

  log.debug(`[non-dm-verifier] Waiting for preview to be ready: ${previewUrl}`);

  while (Date.now() - startTime < PREVIEW_POLL_TIMEOUT) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const response = await fetch(previewUrl, {
        method: 'HEAD',
        headers: {
          'User-Agent': 'SpaceCat-ImageOptimization/1.0',
        },
      });

      if (response.ok) {
        log.debug(`[non-dm-verifier] Preview ready after ${Date.now() - startTime}ms`);
        return true;
      }

      log.debug(`[non-dm-verifier] Preview not ready yet (${response.status}), waiting...`);
    } catch (error) {
      log.debug(`[non-dm-verifier] Preview check failed: ${error.message}, retrying...`);
    }

    // Wait before next poll
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => {
      setTimeout(resolve, PREVIEW_POLL_INTERVAL);
    });
  }

  log.warn(`[non-dm-verifier] Preview timed out after ${PREVIEW_POLL_TIMEOUT}ms`);
  return false;
}

/**
 * Gets the file size of an image at a URL using HEAD request.
 *
 * @param {string} url - The URL to check
 * @param {Object} log - Logger object
 * @returns {Promise<Object>} Result with size and headers
 */
async function getImageSize(url) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

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
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Constructs a format-specific URL for AEM delivery.
 * AEM delivery URLs require:
 * 1. Changing the file extension in the path (e.g., /as/image.png → /as/image.avif)
 * 2. Adding &auto-format=false to disable automatic format negotiation
 *
 * @param {string} previewUrl - The base preview URL
 * @param {string} format - The target format (avif, webp, jpeg, png)
 * @returns {string} The format-specific URL
 */
function constructAemFormatUrl(previewUrl, format) {
  const url = new URL(previewUrl);

  // Change the file extension in the pathname
  // Example: /adobe/assets/.../as/image.png → /adobe/assets/.../as/image.avif
  const { pathname } = url;
  const lastDotIndex = pathname.lastIndexOf('.');

  if (lastDotIndex !== -1) {
    // Map format to proper extension
    const extensionMap = {
      avif: 'avif',
      webp: 'webp',
      jpeg: 'jpg',
      png: 'png',
    };
    const newExtension = extensionMap[format] || format;
    url.pathname = `${pathname.substring(0, lastDotIndex)}.${newExtension}`;
  }

  // Add auto-format=false to disable automatic format conversion
  url.searchParams.set('auto-format', 'false');

  return url.toString();
}

/**
 * Compares different formats using the AEM preview URL.
 *
 * @param {string} previewUrl - The base preview URL
 * @param {Object} log - Logger object
 * @returns {Promise<Object>} Format comparison results
 */
async function compareFormats(previewUrl, log) {
  const results = {
    formats: {},
    smallestFormat: null,
    largestFormat: null,
  };

  let smallestSize = Infinity;
  let largestSize = 0;

  log.debug('[non-dm-verifier] Comparing formats for preview URL');

  // Test each format by changing the file extension and adding auto-format=false
  const formatPromises = PREVIEW_FORMATS.map(async (format) => {
    const formatUrl = constructAemFormatUrl(previewUrl, format);
    log.debug(`[non-dm-verifier] Testing format ${format}: ${formatUrl}`);

    const result = await getImageSize(formatUrl);

    return {
      format,
      url: formatUrl,
      ...result,
    };
  });

  const formatResults = await Promise.all(formatPromises);

  // Process results
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

  return results;
}

/**
 * Verifies a non-DM image by uploading to Scene7 and comparing formats.
 *
 * @param {string} imageUrl - The non-DM image URL
 * @param {Object} log - Logger object
 * @returns {Promise<Object>} Verification results with recommendations
 */
export async function verifyNonDmFormat(imageUrl, log) {
  const result = {
    originalUrl: imageUrl,
    success: false,
    previewUrl: null,
    previewExpiry: null,
    formats: {},
    smallestFormat: null,
    recommendations: [],
    error: null,
  };

  try {
    // Step 1: Download the image
    log.info(`[non-dm-verifier] Step 1: Downloading image from ${imageUrl}`);
    const imageData = await downloadImage(imageUrl, log);
    result.originalSize = imageData.size;
    result.originalContentType = imageData.contentType;

    // Step 2: Upload to Scene7
    log.info('[non-dm-verifier] Step 2: Uploading to Scene7 Snapshot');
    const uploadResult = await uploadToScene7(
      imageData.buffer,
      imageData.filename,
      imageData.contentType,
      log,
    );
    result.assetPath = uploadResult.assetPath;

    // Step 3: Fetch AEM asset info
    log.info('[non-dm-verifier] Step 3: Fetching AEM asset info');
    const assetInfo = await fetchAemAssets(
      uploadResult.assetPath,
      uploadResult.fileName || imageData.filename,
      log,
    );
    result.uuid = assetInfo.uuid;
    result.assetId = assetInfo.assetId;
    result.urn = assetInfo.urn;

    // Step 4: Generate preview URL
    log.info('[non-dm-verifier] Step 4: Generating preview URL');
    const previewInfo = await generatePreviewUrl(
      uploadResult.assetPath,
      assetInfo,
      uploadResult.fileName || imageData.filename,
      log,
    );
    result.previewUrl = previewInfo.previewUrl;
    result.previewExpiry = previewInfo.expiryTime;
    result.previewToken = previewInfo.token;

    // Step 5: Wait for preview to be ready
    log.info('[non-dm-verifier] Step 5: Waiting for preview to be ready');
    const isReady = await waitForPreviewReady(previewInfo.previewUrl, log);

    if (!isReady) {
      result.error = 'Preview URL timed out - image may still be processing';
      result.success = false;
      return result;
    }

    // Step 6: Compare formats
    log.info('[non-dm-verifier] Step 6: Comparing formats');
    const formatComparison = await compareFormats(previewInfo.previewUrl, log);
    result.formats = formatComparison.formats;
    result.smallestFormat = formatComparison.smallestFormat;
    result.largestFormat = formatComparison.largestFormat;

    // Generate recommendations
    if (result.smallestFormat && result.originalSize) {
      const smallestSize = result.formats[result.smallestFormat]?.size;

      if (smallestSize && smallestSize < result.originalSize) {
        const savingsBytes = result.originalSize - smallestSize;
        const savingsPercent = Math.round((savingsBytes / result.originalSize) * 100);

        if (savingsPercent > 10) {
          result.recommendations.push({
            type: 'format-optimization-verified',
            currentFormat: result.originalContentType?.split('/')[1] || 'unknown',
            recommendedFormat: result.smallestFormat,
            currentSize: result.originalSize,
            recommendedSize: smallestSize,
            savingsBytes,
            savingsPercent,
            previewUrl: result.formats[result.smallestFormat].url,
            message: `Convert to ${result.smallestFormat.toUpperCase()} to save ${savingsPercent}% (${Math.round(savingsBytes / 1024)} KB)`,
          });
        }
      }
    }

    result.success = true;
    log.info(`[non-dm-verifier] Verification complete for ${imageUrl}`);

    return result;
  } catch (error) {
    result.error = error.message;
    result.success = false;
    log.error(`[non-dm-verifier] Verification failed for ${imageUrl}: ${error.message}`);
    return result;
  }
}

/**
 * Batch verifies multiple non-DM images.
 *
 * @param {Array<Object>} images - Array of image objects with src property
 * @param {Object} log - Logger object
 * @param {Object} options - Options
 * @param {number} options.concurrency - Max concurrent verifications (default: 2)
 * @param {number} options.maxImages - Max images to verify (default: 10)
 * @returns {Promise<Array>} Array of verification results
 */
export async function batchVerifyNonDmFormats(images, log, options = {}) {
  const {
    concurrency = 2, // Lower concurrency due to longer processing time
  } = options;

  // Filter to non-DM images only
  const nonDmImages = images.filter((img) => !img.isDynamicMedia);

  if (nonDmImages.length === 0) {
    log.info('[non-dm-verifier] No non-DM images to verify');
    return [];
  }

  const imagesToVerify = nonDmImages;

  log.info(`[non-dm-verifier] Verifying ${imagesToVerify.length} non-DM images`);

  const results = [];

  // Process in batches
  for (let i = 0; i < imagesToVerify.length; i += concurrency) {
    const batch = imagesToVerify.slice(i, i + concurrency);

    log.info(`[non-dm-verifier] Processing batch ${Math.floor(i / concurrency) + 1}/${Math.ceil(imagesToVerify.length / concurrency)}`);

    // eslint-disable-next-line no-await-in-loop
    const batchResults = await Promise.all(
      batch.map(async (img) => {
        const verification = await verifyNonDmFormat(img.src, log);
        return {
          ...verification,
          pageUrl: img.pageUrl,
          xpath: img.xpath,
          alt: img.alt,
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight,
        };
      }),
    );

    results.push(...batchResults);

    // Delay between batches
    if (i + concurrency < imagesToVerify.length) {
      log.debug('[non-dm-verifier] Waiting before next batch...');
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => {
        setTimeout(resolve, 1000);
      });
    }
  }

  // Summary
  const successful = results.filter((r) => r.success);
  const withRecommendations = successful.filter((r) => r.recommendations.length > 0);
  const totalSavings = withRecommendations.reduce((sum, r) => {
    const rec = r.recommendations[0];
    return sum + (rec?.savingsBytes || 0);
  }, 0);

  log.info('[non-dm-verifier] Batch verification complete:');
  log.info(`  - Images processed: ${results.length}`);
  log.info(`  - Successful: ${successful.length}`);
  log.info(`  - With recommendations: ${withRecommendations.length}`);
  log.info(`  - Total potential savings: ${Math.round(totalSavings / 1024)} KB`);

  return results;
}

/**
 * Creates a summary of non-DM verification results.
 *
 * @param {Array} verificationResults - Results from batchVerifyNonDmFormats
 * @returns {Object} Summary statistics
 */
export function createNonDmVerificationSummary(verificationResults) {
  const summary = {
    totalImagesProcessed: verificationResults.length,
    successfulVerifications: 0,
    failedVerifications: 0,
    imagesWithRecommendations: 0,
    totalPotentialSavingsBytes: 0,
    totalPotentialSavingsKB: 0,
    formatRecommendations: {
      avif: 0,
      webp: 0,
      jpeg: 0,
      png: 0,
    },
    errors: [],
    topSavingsOpportunities: [],
  };

  verificationResults.forEach((result) => {
    if (result.success) {
      summary.successfulVerifications += 1;

      if (result.recommendations.length > 0) {
        summary.imagesWithRecommendations += 1;
        const rec = result.recommendations[0];
        summary.totalPotentialSavingsBytes += rec.savingsBytes || 0;

        if (rec.recommendedFormat) {
          summary.formatRecommendations[rec.recommendedFormat] += 1;
        }

        // Track top opportunities
        if (rec.savingsBytes > 10000) {
          summary.topSavingsOpportunities.push({
            originalUrl: result.originalUrl,
            previewUrl: rec.previewUrl,
            pageUrl: result.pageUrl,
            savingsBytes: rec.savingsBytes,
            savingsPercent: rec.savingsPercent,
            recommendedFormat: rec.recommendedFormat,
            message: rec.message,
          });
        }
      }
    } else {
      summary.failedVerifications += 1;
      if (result.error) {
        summary.errors.push({
          url: result.originalUrl,
          error: result.error,
        });
      }
    }
  });

  // Sort and limit top opportunities
  summary.topSavingsOpportunities.sort((a, b) => b.savingsBytes - a.savingsBytes);
  summary.topSavingsOpportunities = summary.topSavingsOpportunities.slice(0, 10);

  summary.totalPotentialSavingsKB = Math.round(summary.totalPotentialSavingsBytes / 1024);

  return summary;
}
