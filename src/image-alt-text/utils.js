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
 * Determines if an image should be shown as a suggestion for alt text improvement.
 *
 * In an ideal world, we would only show non-decorative images as suggestions.
 * However, since EDS authoring adds images with an empty alt,
 * we need to still show them as suggestions.
 * Since some other customers will have images marked as decorative in other ways
 * like using aria-hidden="true", role=presentation, etc.
 * We need to show them as suggestions if they have an empty alt,
 * and not show them as suggestions if they are decorative in any other way.
 *
 * @param {HTMLImageElement} image - The image element to check
 * @returns {boolean} True if the image should be shown as a suggestion
 */
export const shouldShowImageAsSuggestion = (image) => {
  const isHiddenForScreenReader = image.getAttribute('aria-hidden') === 'true';
  const hasRolePresentation = image.getAttribute('role') === 'presentation';
  return !isHiddenForScreenReader && !hasRolePresentation && !image.getAttribute('alt');
};

/**
 * Checks if an image has an empty alt attribute.
 *
 * @param {HTMLImageElement} img - The image element to check
 * @returns {boolean} True if the image has an alt attribute with an empty value
 */
export const hasEmptyAltAttribute = (img) => {
  const hasAltAttribute = img.hasAttribute('alt');
  const isAltEmpty = hasAltAttribute && !img.getAttribute('alt');
  return isAltEmpty;
};

/**
 * Determines if an image is decorative.
 *
 * For decorative images, an image MUST have the alt attribute WITH a falsy value.
 * Not having it at all is not the same, the image is not considered decorative.
 *
 * @param {HTMLImageElement} img - The image element to check
 * @returns {boolean} True if the image is decorative
 */
export const isImageDecorative = (img) => {
  const isHiddenForScreenReader = img.getAttribute('aria-hidden') === 'true';
  const hasRolePresentation = img.getAttribute('role') === 'presentation';
  return isHiddenForScreenReader || hasRolePresentation || hasEmptyAltAttribute(img);
};
