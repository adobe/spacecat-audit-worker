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

// Image optimization metrics - AVIF typically provides 50% compression improvement
export const AVIF_COMPRESSION_RATIO = 0.5;

// WebP typically provides 30% compression improvement over JPEG/PNG
export const WEBP_COMPRESSION_RATIO = 0.7;

// RUM data interval for traffic analysis
export const RUM_INTERVAL = 30; // days

// Adobe Dynamic Media URL patterns for detection
export const DYNAMIC_MEDIA_PATTERNS = [
  /\.scene7\.com/i,
  /images\.adobe\.com/i,
  /\/is\/image\//i,
  /\/is\/content\//i,
];

// Supported image formats
export const IMAGE_FORMATS = {
  AVIF: 'avif',
  WEBP: 'webp',
  JPEG: 'jpeg',
  PNG: 'png',
  GIF: 'gif',
};

// Message type for analyzer/Mystique integration
export const IMAGE_OPTIMIZATION_GUIDANCE_TYPE = 'guidance:image-optimization';
export const IMAGE_OPTIMIZATION_OBSERVATION = 'Images not optimized for AVIF format';

// Batch size for processing page URLs
export const ANALYZER_BATCH_SIZE = 10;
