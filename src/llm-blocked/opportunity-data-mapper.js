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
export function createOpportunityData({ fullRobots, numProcessedUrls }) {
  return {
    origin: 'AUTOMATION',
    title: 'Robots.txt disallowing AI crawlers from accessing your site',
    description: 'Several URLs are disallowed from being accessed by LLM user agents.',
    guidance: {
      steps: [
        'Check each listed line number of robots.txt whether the URLs blocked by the statement are intentionally blocked.',
        'If the URLs are not intentionally blocked, update the line of robots txt',
        'If the URLs are intentionally blocked, ignore the suggestion.',
      ],
    },
    tags: ['llm', 'isElmo'],
    data: {
      fullRobots,
      numProcessedUrls,
    },
  };
}
