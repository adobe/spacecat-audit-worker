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

export const TOPIC_PATTERNS = {
  'bulk.com': [{
    regex: '/products/([^/]+)/',
  }],
  'adobe.com': [
    {
      name: 'Creative Cloud Suite',
      regex: '^(?:\\/[a-z]{2}(?:_[a-z]{2,3})?)?\\/creativecloud(?:\\/(?:all-apps|photography|design|video|3d-ar|business|desktop-app))?(?:\\.html)?\\/?$',
    },
    {
      name: 'Individual Creative Applications',
      regex: '^(?:\\/[a-z]{2}(?:_[a-z]{2,3})?)?\\/products\\/(?:photoshop|illustrator|premiere|aftereffects|indesign|photoshop-lightroom|audition|animate|dreamweaver|bridge|media-encoder|character-animator|premiere-rush|fresco|photoshop-express|photoshop-elements|premiere-elements|elements-family)(?:\\.html)?\\/?$',
    },
    {
      name: 'Acrobat PDF Solutions',
      regex: '^(?:\\/[a-z]{2}(?:_[a-z]{2,3})?)?\\/(?:acrobat|products\\/acrobat-pro-cc)(?:\\/(?:acrobat-pro|pdf-reader|complete-pdf-solution|mobile\\/(?:scanner-app|acrobat-reader)))?(?:\\.html)?\\/?$',
    },
    {
      name: 'AI and Generative Tools',
      regex: '^(?:\\/[a-z]{2}(?:_[a-z]{2,3})?)?\\/(?:products\\/firefly|ai\\/overview|sensei\\/generative-ai|products\\/firefly\\/features\\/[a-z0-9\\-]+|acrobat\\/generative-ai-pdf)(?:\\.html)?\\/?$',
    },
    {
      name: 'Express Creative Tools',
      regex: '^(?:\\/[a-z]{2}(?:_[a-z]{2,3})?)?\\/express(?:\\/(?:feature\\/[a-z0-9\\-\\/]+|create(?:\\/[a-z0-9\\-\\/]+)?|templates(?:\\/[a-z0-9\\-\\/]+)?|pricing|business|nonprofits|login|entitled|spotlight\\/[a-z0-9\\-]+))?\\/?$',
    },
    {
      name: 'Enterprise Products',
      regex: '^(?:\\/[a-z]{2}(?:_[a-z]{2,3})?)?\\/products\\/(?:adobeconnect|captivate|robohelp|framemaker|technicalcommunicationsuite|coldfusion-(?:family|standard|builder|enterprise)|postscript|pdfprintengine|adobe-embedded-print-engine|industrialprint|type)(?:\\.html)?\\/?$',
    },
    {
      name: '3D and AR Solutions',
      regex: '^(?:\\/[a-z]{2}(?:_[a-z]{2,3})?)?\\/(?:products\\/(?:substance3d|aero)|creativecloud\\/3d-(?:ar|augmented-reality))(?:\\/[a-z0-9\\-\\/]+)?(?:\\.html)?\\/?$',
    },
    {
      name: 'Acrobat Online Tools',
      regex: '^(?:\\/[a-z]{2}(?:_[a-z]{2,3})?)?\\/acrobat\\/online(?:\\/[a-z0-9\\-]+)?(?:\\.html)?\\/?$',
    },
    {
      name: 'Product Specific Features',
      regex: '^(?:\\/[a-z]{2}(?:_[a-z]{2,3})?)?\\/products\\/(?:photoshop|illustrator|premiere|indesign|acrobat)\\/(?:ai|generative-fill|remove-background|features|online|transparent-background|image-upscaler|ai-photo-editor|logo-design-software|vectorize-image|typography-font-design|edit-audio|page-layouts|modify-pdfs)(?:\\.html)?\\/?$',
    },
  ],
};
