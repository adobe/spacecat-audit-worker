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

const systemContentBase = 'You are tasked with identifying a suitable alternative URL for a broken backlink. '
  + 'You are an expert SEO consultant. Your goal is to suggest a new URL from the same website that closely matches the original intent of the broken link. '
  + 'Focus on finding a URL that semantically aligns with the keywords in the broken link. '
  + 'Important: Redirecting users to a related category page or the main page is preferable to redirecting them to a page that is not a direct alternative. '
  + 'Avoid selecting URLs that are unrelated to the original content. IMPORTANT: THE SUGGESTED URL MUST BE FROM THE PROVIDED LIST.';

const jsonFormatContent = 'You have to provide the output in the following Format, where suggestedUrls is the top 3 suggestions. '
  + 'The confidence_score should be a number between 1-100 that reflects the percentage of how likely this url matches the broken url: '
  + 'IT SHOULD BE VALID JSON. RETURN JUST THE JSON OBJECT AND NO OTHER FORMATTING! '
  + '{ "broken_url": "string", "suggested_urls": ["string"], "ai_rationale": "string", "confidence_score": number }';

export const brokenBacklinksPrompt = (alternativeURLs, brokenUrl) => JSON.stringify({
  messages: [
    {
      role: 'system',
      content: systemContentBase,
    },
    {
      role: 'system',
      content: jsonFormatContent,
    },
    {
      role: 'system',
      content: `Retrieved Information: **List of alternative URLs**: ${alternativeURLs}`,
    },
    {
      role: 'user',
      content: `What is your proposal for the following broken URL. I ONLY WANT RESULTS FROM THE PROVIDED ALTERNATIVE URLs LIST: ${brokenUrl}`,
    },
  ],
});

export const backlinksSuggestionPrompt = (brokenUrl, suggestedUrls, headerLinks) => JSON.stringify({
  messages: [
    {
      role: 'system',
      content: `${systemContentBase} The provided list consists of suggestions from previous requests. `
        + 'You are supposed to take the best 3 suggestions from the list.',
    },
    {
      role: 'system',
      content: jsonFormatContent,
    },
    {
      role: 'system',
      content: `**List of suggested URLs**: ${JSON.stringify(suggestedUrls)}`,
    },
    {
      role: 'system',
      content: `**List of URLs from the menu, navigation and footer or breadcrumbs**: 'header_links': ${JSON.stringify(headerLinks)}`,
    },
    {
      role: 'user',
      content: `What is your proposal for the following broken URL. I ONLY WANT RESULTS FROM THE PROVIDED ALTERNATIVE URLs LIST: ${brokenUrl}`,
    },
  ],
});
