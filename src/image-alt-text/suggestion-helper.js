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

import { FirefallClient } from '@adobe/spacecat-shared-gpt-client';

// export default function generateSuggestions(auditUrl, auditData, context) {
export default async function generateSuggestions(auditUrl, auditData, context) {
  const { log } = context;
  // const { Opportunity } = dataAccess;
  // const { detectedTags } = auditData.auditResult;

  const firefallClient = FirefallClient.createFrom(context);
  const firefallOptions = {
    imageUrls: [
      'https://www.bamboohr.com/careers/media_1d86828fba22e2f00d256418e0fe1765b8f2f0178.png',
      'https://bamboohr.com/media_1f7ff06e46b621f94843bc685ad4f820e5b6901d4.jpeg?width=750&format=jpeg&optimize=medium',
      'https://bamboohr.com/media_11e551e23b855eff228f2eff3c420a8940596803d.png?width=750&format=png&optimize=medium',
    ],
    // responseFormat: 'json_object',
  };
  const prompt = 'Using these alt text best practices, create a description for each image in a way that is helpful for the user. Please format the json to have a objects with key, the url of the image, and value the description. Alt Text Best Practices: Keep it short, usually 1-2 sentences. Dont overthink it. Consider key elements of why you chose this image, instead of describing every little detail. No need to say image of or picture of. But, do say if its a logo, illustration, painting, or cartoon. Dont duplicate text thats adjacent in the document or website. End the alt text sentence with a period.';

  log.info('About to call Firefall for alt-text suggestion generation');

  try {
    const response = await firefallClient.fetchChatCompletion(prompt, firefallOptions);
    log.info('Firefall response for alt-text suggestions', response);
  } catch (err) {
    log.error('Error calling Firefall for alt-text suggestion generation', err);
  }
}
