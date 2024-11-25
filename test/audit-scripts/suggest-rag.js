/*
 * Copyright 2024 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */
/* eslint-disable */

import {JSDOM} from "jsdom";
import fs from 'fs';
import path from 'path';
import { parse, stringify } from 'csv';
import { FirefallClient } from '@adobe/spacecat-shared-gpt-client';
import { Parser } from 'json2csv';
import {getDescriptionCsv, getH1Csv, getOneRow, getTitleCsv} from "./csv-reader.js";

const brandName = 'bulk';
const ffClient = FirefallClient.createFrom({
  env: {
    'FIREFALL_API_ENDPOINT': 'https://firefall-stage.adobe.io',
    'FIREFALL_IMS_ORG': 'spacecat-firefall-dev',
    'FIREFALL_API_KEY': 'D729BFC2-8D8A-418A-92B4-624E1E8D6F07',
    'FIREFALL_API_CAPABILITY_NAME':'gpt_4_turbo_completions_capability',
    'IMS_CLIENT_ID': 'spacecat-firefall-dev',
    'IMS_CLIENT_SECRET': 's8e-zrHCq1fRAS3xxbi9s23zPnXY25cmf0AF',
    "IMS_GRANT_TYPE": "authorization_code",
    "IMS_CLIENT_CODE": "eyJhbGciOiJSUzI1NiIsIng1dSI6Imltc19uYTEtc3RnMS1rZXktcGFjLTEuY2VyIiwia2lkIjoiaW1zX25hMS1zdGcxLWtleS1wYWMtMSIsIml0dCI6InBhYyJ9.eyJpZCI6InNwYWNlY2F0LWZpcmVmYWxsLWRldl9zdGciLCJ0eXBlIjoiYXV0aG9yaXphdGlvbl9jb2RlIiwiY2xpZW50X2lkIjoic3BhY2VjYXQtZmlyZWZhbGwtZGV2IiwidXNlcl9pZCI6InNwYWNlY2F0LWZpcmVmYWxsLWRldkBBZG9iZVNlcnZpY2UiLCJhcyI6Imltcy1uYTEtc3RnMSIsIm90byI6ZmFsc2UsImNyZWF0ZWRfYXQiOiIxNzA3MjEwOTYyOTg3Iiwic2NvcGUiOiJzeXN0ZW0ifQ.PUUVTXY8_a2iPrkmHuc4H5RSeYmX1Bgf6Qfw0QTSlpBoNc2Qnyh86jVUoKmJa7bbVt6VPXz0PjNL5TCz-m7IEWMB7lWbNuxOcO7TFkeNdJA6KYf6rnDyfFB8HmssYpJTa79zV5Px0lXLcQ-x_5MUe_BudIpQxBD482j7Jklg-3ec8TbO34BXSixmLEFLTqz1akVmmxoPYrsGkbK9huFtlRJJnzTZKRapsTC3e0sjqYcGkOhSUIarW7DUFxNThA1JpeJSkm9NixZb3V4kuhm84mLyE2DpG1hqZPG3FqquiPbh0D0egFAExIRugTgs0OE8ULkvl_IJn-AnrPrsLcciSA",
    IMS_HOST: "ims-na1-stg1.adobelogin.com"
  }
});
async function generateRetrievedInfo(brandName) {
  const prompt = `
Task:
Generate the retrieved information section in the specified format for an AI prompt focused on optimizing title, description, and H1 tags to enhance the SEO performance of webpages.  
    
System Context:
- You are an expert SEO consultant at ${brandName}
- Your objective is to create the retrieved info section of an AI prompt focused on optimising tags of ${brandName} webpages to improve seo performance
- Include a note if there are specific formats used in the title tags, such as '${brandName} - ' at the beginning or '| ${brandName}' at the end.

Output format sample:
- **Website**: Lovesac.com, specializing in modular furniture offering high-quality bean bag chairs (sacs), modular sectionals (sactionals), and accessories.
- **Brand Tone of Voice**: Innovative, relaxed, and customer-focused.
- **Brand focus**:
  - Customization and Personalization
  - Sustainability
  - Comfort and Quality
  - Modularity and Versatility
  - Community and Experience
- Brand keeps "Lovesac - " in the start of the title tags

Given Information:
- Few existing Title Tags:
"${allTags.title.join('\n')}"
- Few existing description tags:
"${allTags.description.join('\n')}"
- Few existing h1 tags:
"${allTags.h1.join('\n')}"
  `;
  console.log(prompt);
  const aiResponse = await ffClient.fetch(prompt);
  console.log(aiResponse);
}
// const allTags = run();
// const retrievedInfoSection = generateRetrievedInfo(brandName);

function extractTags(aiResponse) {
  console.log(`\nAI raw response: ${aiResponse}\n`);
  const lines = aiResponse.split('\n');
  const tags = {
    title: '',
    description: '',
    h1: ''
  };
  const jsonStringObject = JSON.parse(aiResponse.match(/```json\n([\s\S]*?)\n```/)[1]);
  tags.title = jsonStringObject.title;
  tags.description = jsonStringObject.description;
  tags.h1 = jsonStringObject.h1;
  tags.titleRationale = jsonStringObject.titleRationale;
  tags.descriptionRationale = jsonStringObject.descriptionRationale;
  tags.h1Rationale = jsonStringObject.h1Rationale;
  if (!tags.title && !tags.description && !tags.h1) {
    throw new Error('invalid ai response');
  }
  return tags;
}

const allAiResponses = {};
const processCSV = (csvString, tagName, brandName) => {
  const records = parse(csvString, { columns: true, skip_empty_lines: true });
  console.log(`Processing ${tagName} issues:`);
  const jsonData = [];
  records.forEach(async (record) => {
    const {'Page URL': url, Issue, Details} = record;
    record['Page URL'] = record['Page URL'].replace(/\/$/, '');
    if (allAiResponses[url] && allAiResponses[url][tagName.toLowerCase()]) {
      record['AI Suggestion'] = allAiResponses[url][tagName.toLowerCase()];
      record['AI Rationale'] = allAiResponses[url][`${tagName.toLowerCase()}Rationale`];
      jsonData.push(record);
      console.log(`Found - Url: ${url}\n AI response: ${JSON.stringify(allAiResponses[url])}\n`);
      return;
    }
    const jsonPath = url.replace('https://www.bulk.com/', '').split('/');
    const filePath = path.join(`/Users/dipratap/Documents/reports/s3/${brandName}`, ...jsonPath, 'scrape.json');

    try {
      const jsonContent = fs.readFileSync(filePath, 'utf8');
      const scrapedData = JSON.parse(jsonContent);
      let { h1, title, description } = scrapedData.scrapeResult.tags;
      h1 = h1.length > 0 ? h1[0] : h1;
      const dom = new JSDOM(scrapedData.scrapeResult.rawBody);
      const main = dom.window.document.querySelector('main') ? dom.window.document.querySelector('main').textContent
        : dom.window.document.querySelector('body').textContent;

      const prompt = `Task:
Optimise the Title, Description and H1 tag of a webpage for improved SEO performance. 

System Context:
- You are an expert SEO consultant at ${brandName}.
- Your task is to optimize website Title, description and H1 tags for better search engine performance while maintaining the brand's tone and messaging.
- Focus on applying SEO best practices in your suggestion.

Critical Requirements:
- Ensure that the H1 tag is catchy to attract users interest
- Ensure that you take into consideration the current page url, title, description and h1 tags.
- Avoid keyword stuffing. Ensure the content sounds natural and feels authentically human-written. 
- Don't use robotic keywords like explore, discover, learn, understand during start of description tags.
- While generating AI rationale, don't mention:
  - Character limit and generated tag being concise
  - Brand name inclusion in title tags.

Output Format in JSON (don't output anything else):
{
  "title": "Optimized title"
  "description": "Optimized description"
  "h1": "Optimized H1"
  "titleRationale": "concise rationale",
  "descriptionRationale": "concise rationale",
  "h1Rationale": "concise rationale"
}

Given Information:
- **Website**: Bulk.com, a leading provider of sports nutrition products including supplements, vitamins, minerals, and health foods. 
- **Brand Tone of Voice**: Authoritative, educational, and motivational. 
- **Brand focus**: 
  - High-quality sports nutrition 
  - Scientifically-backed ingredients 
  - Affordability and value 
  - Product variety and innovation 
  - Fitness community and lifestyle 
- Bulk.com uses "| Bulk™ UK" at the end of the title tags for consistency and brand recognition. 
- Page Details:
  - Current Title Tag: ${title}
  - Current Description Tag: ${description}
  - Current H1 Tag: ${h1}
  - Page url: "${url}"
  - Html body: ${main}
`;

      console.log(prompt);
      const aiResponse = extractTags(await ffClient.fetch(prompt));

      allAiResponses[url] = aiResponse;
      record['AI Suggestion'] = aiResponse[tagName.toLowerCase()];
      record['AI Rationale'] = aiResponse[`${tagName.toLowerCase()}Rationale`];
      jsonData.push(record);
      console.log(`\nUrl: ${scrapedData.finalUrl}\nTags Content: ${JSON.stringify(scrapedData.scrapeResult.tags)}\nAI response: ${JSON.stringify(aiResponse)}\n`);
    } catch (error) {
      console.log(`Error processing ${tagName} - ${url} ${error.message}`);
    }
  }).then(() => {
    const fields = [
      { label: 'SEO Impact', value: 'SEO Impact' },
      { label: 'Issue', value: 'Issue' },
      { label: 'Details', value: 'Details' },
      { label: 'Tag Content', value: 'Tag Content' },
      { label: 'Page URL', value: 'Page URL' },
      { label: 'SEO Recommendation', value: 'SEO Recommendation' },
      { label: 'AI Suggestion', value: 'AI Suggestion' },
      { label: 'AI Rationale', value: 'AI Rationale' },
    ];
    const json2csvParser = new Parser({ fields });
    const csv = json2csvParser.parse(jsonData);
    fs.writeFileSync(`./output/${tagName}-with-suggestions.csv`, csv);
  });
};

processCSV(getOneRow(brandName, 'h1', 29), 'H1', brandName);
// processCSV(getTitleCsv(brandName), 'Title', brandName);
// processCSV(getDescriptionCsv(brandName), 'Description', brandName);
// processCSV(getH1Csv(brandName), 'H1', brandName);
