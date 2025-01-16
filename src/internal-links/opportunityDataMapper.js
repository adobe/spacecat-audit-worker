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

export class opportunityData {
  constructor() {
    this.runbook = 'https  =//adobe.sharepoint.com/sites/aemsites-engineering/Shared%20Documents/3%20-%20Experience%20Success/SpaceCat/Runbooks/Experience_Success_Studio_Broken_Internal_Links_Runbook.docx?web=1';
    this.origin = 'AUTOMATION';
    this.title = 'Broken internal links found';
    this.description = 'We\'ve detected broken internal links on your website. Broken links can negatively impact user experience and SEO. Please review and fix these links to ensure smooth navigation and accessibility.';
    this.guidance = {
      steps: [
        'Update each broken internal link to valid URLs.',
        'Test the implemented changes manually to ensure they are working as expected.',
        'Monitor internal links for 404 errors in RUM tool over time to ensure they are functioning correctly.',
      ],
    };
    this.tags = [
      'Traffic acquisition',
      'Engagement',
    ];
  }
}
