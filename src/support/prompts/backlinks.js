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

// TODO: adjust for language
const systemContentBase = 'You are tasked with identifying a suitable alternative URL for a broken backlink. '
  + 'You are an expert SEO consultant. Your goal is to suggest new URLs from the provided list that closely match the original intent of the broken link. '
  + 'You must strictly adhere to the provided list of alternative URLs. '
  + 'Under no circumstances should you suggest URLs not present in the provided list. '
  + 'If no suitable URLs are found in the list, suggest the root URL instead. '
  + 'If fewer than 3 suitable URLs are available, return only the appropriate number (1 or 2).';

const jsonFormatContent = 'Your response must be valid JSON with the following structure: '
  + '{ "broken_url": "string", "suggested_urls": ["string"], "ai_rationale": "string", "confidence_score": number }. '
  + 'IMPORTANT: RETURN ONLY THE JSON OBJECT. DO NOT ADD ANY EXPLANATION, TEXT, OR FORMATTING OUTSIDE OF THE JSON OBJECT.'
  + 'Ensure that all suggested URLs are present in the provided list.';

const userRequest = (brokenUrl) => (`For the broken URL ${brokenUrl}, suggest up to 3 alternative URLs strictly from the provided list. `
  + 'If no suitable match exists, return an empty array for "suggested_urls". '
  + 'If only 1 or 2 suitable URLs exist, return only those.');

export const brokenBacklinksPrompt = (alternativeURLs, brokenUrl) => (
  `${systemContentBase} ${jsonFormatContent}. `
  + `List of alternative URLs: ${JSON.stringify(alternativeURLs)} ${userRequest(brokenUrl)}`
);

export const backlinksSuggestionPrompt = (brokenUrl, suggestedUrls, headerLinks) => (
  `${systemContentBase} The provided list consists of suggestions from previous requests. `
  + `You are supposed to take up to 3 suggestions from the list. ${jsonFormatContent}. `
  + `List of suggested URLs: ${JSON.stringify(suggestedUrls)}. `
  + `List of URLs from the menu, navigation and footer or breadcrumbs: 'header_links': ${JSON.stringify(headerLinks)}. ${userRequest(brokenUrl)}`
);
