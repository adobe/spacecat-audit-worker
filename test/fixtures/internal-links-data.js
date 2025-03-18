/*
 * Copyright 2023 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

export const internalLinksData = [
  {
    traffic_domain: 1800,
    url_to: 'https://www.petplace.com/a01',
    url_from: 'https://www.petplace.com/a02nf',
    priority: 'high',
  },
  {
    traffic_domain: 1200,
    url_to: 'https://www.petplace.com/ax02',
    url_from: 'https://www.petplace.com/ax02nf',
    priority: 'medium',
  },
  {
    traffic_domain: 200,
    url_to: 'https://www.petplace.com/a01',
    url_from: 'https://www.petplace.com/a01nf',
    priority: 'low',
  },
];

export const expectedOpportunity = {
  siteId: 'site-id-1',
  auditId: 'audit-id-1',
  runbook: 'https://adobe.sharepoint.com/sites/aemsites-engineering/Shared%20Documents/3%20-%20Experience%20Success/SpaceCat/Runbooks/Experience_Success_Studio_Broken_Internal_Links_Runbook.docx?web=1',
  type: 'broken-internal-links',
  origin: 'AUTOMATION',
  title: 'Broken internal links are impairing user experience and SEO crawlability',
  description: 'We\'ve detected broken internal links on your website. Broken links can negatively impact user experience and SEO. Please review and fix these links to ensure smooth navigation and accessibility.',
  guidance: {
    steps: [
      'Update each broken internal link to valid URLs.',
      'Test the implemented changes manually to ensure they are working as expected.',
      'Monitor internal links for 404 errors in RUM tool over time to ensure they are functioning correctly.',
    ],
  },
  tags: [
    'Traffic acquisition',
    'Engagement',
  ],
  data: { projectedTrafficLost: 32, projectedTrafficValue: 32 },
};

export const expectedSuggestions = [
  {
    type: 'CONTENT_UPDATE',
    rank: 100,
    data: {
      trafficDomain: 1800,
      urlTo: 'https://www.petplace.com/a01',
      urlFrom: 'https://www.petplace.com/a02nf',
      priority: 'high',
    },
  },
  {
    type: 'CONTENT_UPDATE',
    rank: 100,
    data: {
      trafficDomain: 1200,
      urlTo: 'https://www.petplace.com/ax02-changed',
      urlFrom: 'https://www.petplace.com/ax02nf',
      priority: 'medium',
    },
  },
  {
    type: 'CONTENT_UPDATE',
    rank: 100,
    data: {
      trafficDomain: 200,
      urlTo: 'https://www.petplace.com/a01',
      urlFrom: 'https://www.petplace.com/a01nf',
      priority: 'low',
    },
  },
];

export const auditData = {
  siteId: '5a377a31-b6c3-411c-8b00-62d7e1b116ac',
  isLive: true,
  auditedAt: '2025-01-30T19:15:26.643Z',
  auditType: 'broken-internal-links',
  auditResult: {
    brokenInternalLinks: [
      {
        trafficDomain: 100,
        urlTo: 'https://www.petplace.com/article/dogs/pet-behavior-training/dog-behavior-training/training-your-dog/how-to-stop-poor-dog-behavior',
        urlFrom: 'https://www.petplace.com/article/dogs/pet-behavior-training/dog-behavior-training/training-your-dog/tips-on-how-to-stop-your-dog-from-barking-at-strangers1',
        priority: 'high',
        urlsSuggested: [
          'https://www.petplace.com/article/dogs/pet-behavior-training/dog-behavior-training/dog-behavior-problems/why-is-my-dog-not-drinking-water',
          'https://www.petplace.com/article/dogs/pet-behavior-training/sexual-behavior-in-dogs',
          'https://www.petplace.com/article/dogs/pet-behavior-training/why-do-dogs-smell-crotches-and-butts',
        ],
        aiRationale: 'The suggested URLs are selected based on their relevance to dog behavior and training, closely aligning with the context of the broken URL which focuses on addressing poor dog behavior through training.',
      },
      {
        trafficDomain: 100,
        urlTo: 'https://www.petplace.com/article/dogs/pet-behavior-training/dog-behavior-training/training-your-dog/how-to-stop-poor-dog-behavior',
        urlFrom: 'https://www.petplace.com/article/dogs/pet-behavior-training/dog-behavior-training/training-your-dog/tips-on-how-to-stop-your-dog-from-barking-at-strangers2',
        priority: 'high',
        urlsSuggested: [
          'https://www.petplace.com/article/dogs/pet-behavior-training/dog-behavior-training/dog-behavior-problems/why-is-my-dog-not-drinking-water',
          'https://www.petplace.com/article/dogs/pet-behavior-training/sexual-behavior-in-dogs',
          'https://www.petplace.com/article/dogs/pet-behavior-training/why-do-dogs-smell-crotches-and-butts',
        ],
        aiRationale: 'The suggested URLs are selected based on their relevance to dog behavior and training, closely aligning with the context of the broken URL which focuses on addressing poor dog behavior through training.',
      },
      {
        trafficDomain: 100,
        urlTo: 'https://www.petplace.com/article/dogs/pet-behavior-training/dog-behavior-training/training-your-dog/how-to-stop-poor-dog-behavior',
        urlFrom: 'https://www.petplace.com/article/dogs/pet-behavior-training/dog-behavior-training/training-your-dog/tips-on-how-to-stop-your-dog-from-barking-at-strangers3',
        priority: 'high',
        urlsSuggested: [
          'https://www.petplace.com/article/dogs/pet-behavior-training/dog-behavior-training/dog-behavior-problems/why-is-my-dog-not-drinking-water',
          'https://www.petplace.com/article/dogs/pet-behavior-training/sexual-behavior-in-dogs',
          'https://www.petplace.com/article/dogs/pet-behavior-training/why-do-dogs-smell-crotches-and-butts',
        ],
        aiRationale: 'The suggested URLs are selected based on their relevance to dog behavior and training, closely aligning with the context of the broken URL which focuses on addressing poor dog behavior through training.',
      },
      {
        trafficDomain: 100,
        urlTo: 'https://www.petplace.com/article/dogs/pet-behavior-training/dog-behavior-training/training-your-dog/how-to-stop-poor-dog-behavior',
        urlFrom: 'https://www.petplace.com/article/dogs/pet-behavior-training/dog-behavior-training/training-your-dog/tips-on-how-to-stop-your-dog-from-barking-at-strangers4',
        priority: 'high',
        urlsSuggested: [
          'https://www.petplace.com/article/dogs/pet-behavior-training/dog-behavior-training/dog-behavior-problems/why-is-my-dog-not-drinking-water',
          'https://www.petplace.com/article/dogs/pet-behavior-training/sexual-behavior-in-dogs',
          'https://www.petplace.com/article/dogs/pet-behavior-training/why-do-dogs-smell-crotches-and-butts',
        ],
        aiRationale: 'The suggested URLs are selected based on their relevance to dog behavior and training, closely aligning with the context of the broken URL which focuses on addressing poor dog behavior through training.',
      },
      {
        trafficDomain: 100,
        urlTo: 'https://www.petplace.com/article/dogs/pet-behavior-training/dog-behavior-training/training-your-dog/how-to-stop-poor-dog-behavior',
        urlFrom: 'https://www.petplace.com/article/dogs/pet-behavior-training/dog-behavior-training/training-your-dog/tips-on-how-to-stop-your-dog-from-barking-at-strangers5',
        priority: 'high',
        urlsSuggested: [
          'https://www.petplace.com/article/dogs/pet-behavior-training/dog-behavior-training/dog-behavior-problems/why-is-my-dog-not-drinking-water',
          'https://www.petplace.com/article/dogs/pet-behavior-training/sexual-behavior-in-dogs',
          'https://www.petplace.com/article/dogs/pet-behavior-training/why-do-dogs-smell-crotches-and-butts',
        ],
        aiRationale: 'The suggested URLs are selected based on their relevance to dog behavior and training, closely aligning with the context of the broken URL which focuses on addressing poor dog behavior through training.',
      },
      {
        trafficDomain: 100,
        urlTo: 'https://www.petplace.com/article/dogs/pet-behavior-training/dog-behavior-training/training-your-dog/how-to-stop-poor-dog-behavior',
        urlFrom: 'https://www.petplace.com/article/dogs/pet-behavior-training/dog-behavior-training/training-your-dog/tips-on-how-to-stop-your-dog-from-barking-at-strangers6',
        priority: 'high',
        urlsSuggested: [
          'https://www.petplace.com/article/dogs/pet-behavior-training/dog-behavior-training/dog-behavior-problems/why-is-my-dog-not-drinking-water',
          'https://www.petplace.com/article/dogs/pet-behavior-training/sexual-behavior-in-dogs',
          'https://www.petplace.com/article/dogs/pet-behavior-training/why-do-dogs-smell-crotches-and-butts',
        ],
        aiRationale: 'The suggested URLs are selected based on their relevance to dog behavior and training, closely aligning with the context of the broken URL which focuses on addressing poor dog behavior through training.',
      },
      {
        trafficDomain: 100,
        urlTo: 'https://www.petplace.com/article/dogs/pet-behavior-training/dog-behavior-training/training-your-dog/how-to-stop-poor-dog-behavior',
        urlFrom: 'https://www.petplace.com/article/dogs/pet-behavior-training/dog-behavior-training/training-your-dog/tips-on-how-to-stop-your-dog-from-barking-at-strangers7',
        priority: 'high',
        urlsSuggested: [
          'https://www.petplace.com/article/dogs/pet-behavior-training/dog-behavior-training/dog-behavior-problems/why-is-my-dog-not-drinking-water',
          'https://www.petplace.com/article/dogs/pet-behavior-training/sexual-behavior-in-dogs',
          'https://www.petplace.com/article/dogs/pet-behavior-training/why-do-dogs-smell-crotches-and-butts',
        ],
        aiRationale: 'The suggested URLs are selected based on their relevance to dog behavior and training, closely aligning with the context of the broken URL which focuses on addressing poor dog behavior through training.',
      },
      {
        trafficDomain: 100,
        urlTo: 'https://www.petplace.com/article/dogs/pet-behavior-training/dog-behavior-training/training-your-dog/how-to-stop-poor-dog-behavior',
        urlFrom: 'https://www.petplace.com/article/dogs/pet-behavior-training/dog-behavior-training/training-your-dog/tips-on-how-to-stop-your-dog-from-barking-at-strangers8',
        priority: 'high',
        urlsSuggested: [
          'https://www.petplace.com/article/dogs/pet-behavior-training/dog-behavior-training/dog-behavior-problems/why-is-my-dog-not-drinking-water',
          'https://www.petplace.com/article/dogs/pet-behavior-training/sexual-behavior-in-dogs',
          'https://www.petplace.com/article/dogs/pet-behavior-training/why-do-dogs-smell-crotches-and-butts',
        ],
        aiRationale: 'The suggested URLs are selected based on their relevance to dog behavior and training, closely aligning with the context of the broken URL which focuses on addressing poor dog behavior through training.',
      },
      {
        trafficDomain: 100,
        urlTo: 'https://www.petplace.com/article/dogs/pet-behavior-training/dog-behavior-training/training-your-dog/how-to-stop-poor-dog-behavior',
        urlFrom: 'https://www.petplace.com/article/dogs/pet-behavior-training/dog-behavior-training/training-your-dog/tips-on-how-to-stop-your-dog-from-barking-at-strangers9',
        priority: 'high',
        urlsSuggested: [
          'https://www.petplace.com/article/dogs/pet-behavior-training/dog-behavior-training/dog-behavior-problems/why-is-my-dog-not-drinking-water',
          'https://www.petplace.com/article/dogs/pet-behavior-training/sexual-behavior-in-dogs',
          'https://www.petplace.com/article/dogs/pet-behavior-training/why-do-dogs-smell-crotches-and-butts',
        ],
        aiRationale: 'The suggested URLs are selected based on their relevance to dog behavior and training, closely aligning with the context of the broken URL which focuses on addressing poor dog behavior through training.',
      },
      {
        trafficDomain: 100,
        urlTo: 'https://www.petplace.com/article/dogs/pet-behavior-training/dog-behavior-training/training-your-dog/how-to-stop-poor-dog-behavior',
        urlFrom: 'https://www.petplace.com/article/dogs/pet-behavior-training/dog-behavior-training/training-your-dog/tips-on-how-to-stop-your-dog-from-barking-at-strangers10',
        priority: 'high',
        urlsSuggested: [
          'https://www.petplace.com/article/dogs/pet-behavior-training/dog-behavior-training/dog-behavior-problems/why-is-my-dog-not-drinking-water',
          'https://www.petplace.com/article/dogs/pet-behavior-training/sexual-behavior-in-dogs',
          'https://www.petplace.com/article/dogs/pet-behavior-training/why-do-dogs-smell-crotches-and-butts',
        ],
        aiRationale: 'The suggested URLs are selected based on their relevance to dog behavior and training, closely aligning with the context of the broken URL which focuses on addressing poor dog behavior through training.',
      },
      {
        trafficDomain: 100,
        urlTo: 'https://www.petplace.com/article/dogs/pet-behavior-training/dog-behavior-training/training-your-dog/how-to-stop-poor-dog-behavior',
        urlFrom: 'https://www.petplace.com/article/dogs/pet-behavior-training/dog-behavior-training/training-your-dog/tips-on-how-to-stop-your-dog-from-barking-at-strangers11',
        priority: 'high',
        urlsSuggested: [
          'https://www.petplace.com/article/dogs/pet-behavior-training/dog-behavior-training/dog-behavior-problems/why-is-my-dog-not-drinking-water',
          'https://www.petplace.com/article/dogs/pet-behavior-training/sexual-behavior-in-dogs',
          'https://www.petplace.com/article/dogs/pet-behavior-training/why-do-dogs-smell-crotches-and-butts',
        ],
        aiRationale: 'The suggested URLs are selected based on their relevance to dog behavior and training, closely aligning with the context of the broken URL which focuses on addressing poor dog behavior through training.',
      },
      {
        trafficDomain: 100,
        urlTo: 'https://www.petplace.com/article/dogs/pet-behavior-training/dog-behavior-training/training-your-dog/how-to-stop-poor-dog-behavior',
        urlFrom: 'https://www.petplace.com/article/dogs/pet-behavior-training/dog-behavior-training/training-your-dog/tips-on-how-to-stop-your-dog-from-barking-at-strangers12',
        priority: 'high',
        urlsSuggested: [
          'https://www.petplace.com/article/dogs/pet-behavior-training/dog-behavior-training/dog-behavior-problems/why-is-my-dog-not-drinking-water',
          'https://www.petplace.com/article/dogs/pet-behavior-training/sexual-behavior-in-dogs',
          'https://www.petplace.com/article/dogs/pet-behavior-training/why-do-dogs-smell-crotches-and-butts',
        ],
        aiRationale: 'The suggested URLs are selected based on their relevance to dog behavior and training, closely aligning with the context of the broken URL which focuses on addressing poor dog behavior through training.',
      },
      {
        trafficDomain: 100,
        urlTo: 'https://www.petplace.com/article/dogs/pet-behavior-training/dog-behavior-training/training-your-dog/how-to-stop-poor-dog-behavior',
        urlFrom: 'https://www.petplace.com/article/dogs/pet-behavior-training/dog-behavior-training/training-your-dog/tips-on-how-to-stop-your-dog-from-barking-at-strangers13',
        priority: 'high',
        urlsSuggested: [
          'https://www.petplace.com/article/dogs/pet-behavior-training/dog-behavior-training/dog-behavior-problems/why-is-my-dog-not-drinking-water',
          'https://www.petplace.com/article/dogs/pet-behavior-training/sexual-behavior-in-dogs',
          'https://www.petplace.com/article/dogs/pet-behavior-training/why-do-dogs-smell-crotches-and-butts',
        ],
        aiRationale: 'The suggested URLs are selected based on their relevance to dog behavior and training, closely aligning with the context of the broken URL which focuses on addressing poor dog behavior through training.',
      },
      {
        trafficDomain: 100,
        urlTo: 'https://www.petplace.com/article/dogs/pet-health/carbamate-and-organophosphate-toxicity-in-dogs',
        urlFrom: 'https://www.petplace.com/article/dogs/pet-health/tremorsshaking-in-dogs',
        priority: 'high',
        urlsSuggested: [
          'https://www.petplace.com/article/dogs/pet-health/21-symptoms-you-should-never-ignore-in-your-dog',
          'https://www.petplace.com/article/dogs/pet-health/6-deadly-poisons-that-could-kill-your-dog',
          'https://www.petplace.com/article/dogs/pet-health/home-care-for-dogs-with-diarrhea-and-vomiting',
        ],
        aiRationale: 'The suggested URLs are selected based on their relevance to dog health, which aligns with the context of the broken URL focusing on a specific health issue (toxicity) in dogs. These alternatives cover general health symptoms, poisons that could be harmful to dogs, and care for dogs with symptoms that could be related to toxicity, providing a broad spectrum of information that could be useful for readers seeking related content.',
      },
      {
        trafficDomain: 100,
        urlTo: 'https://www.petplace.com/article/cats/pet-health/red-eye-in-cats',
        urlFrom: 'https://www.petplace.com/article/cats/vet-qa-parent/vet-qa/what-causes-a-cat-to-have-blood-shot-eyes',
        priority: 'high',
        urlsSuggested: [
          'https://www.petplace.com/article/cats/pet-health/cat-health/cat-diet-nutrition/can-cats-eat-grapes',
          'https://www.petplace.com/article/cats/pet-health/cat-health/cat-diet-nutrition/can-cats-eat-shrimp',
          'https://www.petplace.com/article/cats/pet-health/cat-health/cat-diet-nutrition/can-cats-eat-strawberries',
        ],
        aiRationale: "The suggested URLs are selected based on the context of pet health, specifically focusing on cats, which aligns with the original broken URL's theme. Although the suggested URLs do not directly address 'red eye in cats', they remain within the broader category of cat health and nutrition, making them relevant alternatives given the constraints.",
      },
      {
        trafficDomain: 100,
        urlTo: 'https://www.petplace.com/article/cats/pet-behavior-training/why-do-cats-spray',
        urlFrom: 'https://www.petplace.com/article/cats/vet-qa-parent/vet-qa/why-does-my-cat-wiggle-the-top-of-his-bum-with-his-tail-straight-up-in-the-air',
        priority: 'medium',
        urlsSuggested: [
          'https://www.petplace.com/article/cats/pet-care/cat-care/why-is-my-neutered-cat-spraying',
          'https://www.petplace.com/article/cats/pet-behavior-training/sexual-aggression-in-cats',
          'https://www.petplace.com/article/cats/pet-behavior-training/why-do-cats-smell-other-cats-butts',
        ],
        aiRationale: "The suggested URLs are selected based on their relevance to the original broken URL's topic, which involves cat behavior and training. The first suggestion directly addresses a behavior closely related to spraying, which is neutered cats spraying. The second and third suggestions involve other aspects of cat behavior that could be of interest to someone looking into why cats spray.",
      },
      {
        trafficDomain: 786,
        urlTo: 'https://www.petplace.com/article/general/pet-health/ear-cleaning-cats-dogs',
        urlFrom: 'https://www.petplace.com/article/drug-library/drug-library/library/trizedta-dermapet-for-dogs-and-cats',
        priority: 'medium',
        urlsSuggested: [
          'https://www.petplace.com/',
        ],
        aiRationale: 'After reviewing the provided list of alternative URLs, no direct match or closely related content focusing specifically on ear cleaning for cats and dogs was identified. Therefore, the base URL is suggested as the most suitable alternative to provide a starting point for users to search for related pet health information.',
      },
      {
        trafficDomain: 5000,
        urlTo: 'https://www.petplace.com/article/general/pet-health/does-my-pet-have-an-ear-infection',
        urlFrom: 'https://www.petplace.com/article/dogs/pet-health/flush-dog-ears',
        priority: 'low',
        urlsSuggested: [
          'https://www.petplace.com/',
        ],
        aiRationale: 'After reviewing the provided list of alternative URLs, no specific match related to ear infections was found. Therefore, the base URL is suggested as the most suitable alternative to provide a starting point for users to search for related pet health information.',
      },
      {
        trafficDomain: 100,
        urlTo: 'https://www.petplace.com/article/dogs/pet-behavior-training/timing-matters-when-socializing-a-puppy',
        urlFrom: 'https://www.petplace.com/discovery',
        priority: 'low',
        urlsSuggested: [
          'https://www.petplace.com/article/dogs/pet-behavior-training/dog-behavior-training/dog-behavior-problems/why-is-my-dog-not-drinking-water',
          'https://www.petplace.com/article/dogs/pet-behavior-training/sexual-behavior-in-dogs',
          'https://www.petplace.com/article/dogs/pet-behavior-training/why-do-dogs-smell-crotches-and-butts',
        ],
        aiRationale: 'The suggested URLs are selected based on their relevance to dog behavior and training, which aligns with the context of the broken URL focused on puppy socialization. Each suggested URL covers aspects of dog behavior, offering alternative resources within the same domain of interest.',
      },
      {
        trafficDomain: 100,
        urlTo: 'https://www.petplace.com/article/cats/just-for-fun/fun-stuff/food-puzzles-for-cats',
        urlFrom: 'https://www.petplace.com/article/cats/pet-behavior-training/keep-your-cat-entertained',
        priority: 'low',
        urlsSuggested: [
          'https://www.petplace.com/article/cats/just-for-fun/is-giving-catnip-to-a-kitten-like-giving-marijuana-to-a-teenager-irreverent-vet',
          'https://www.petplace.com/article/cats/just-for-fun/the-irreverent-vet-speaks-out-how-long-do-expired-dog-medications-last',
        ],
        aiRationale: "The suggested URLs are selected based on the closest match in context ('just-for-fun') and content type (articles related to cats and fun aspects) from the provided list to the broken URL. They offer content that aligns with the entertainment or informative nature of the original link.",
      },
      {
        trafficDomain: 100,
        urlTo: 'https://www.petplace.com/article/dogs/breeds/choosing-an-airedale',
        urlFrom: 'https://www.petplace.com/article/dogs/pet-care/american-kennel-club-akc-dog-breeds-alphabetical',
        priority: 'low',
        urlsSuggested: [
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/doberman-ear-cropping-necessary',
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/doberman-pinschers-like-kids',
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/french-bulldog-breathing-problems-things-to-know',
        ],
        aiRationale: 'The suggested URLs are selected based on their relevance to dog breeds, which aligns with the context of the broken URL about choosing an Airedale. These alternatives provide information on other dog breeds and related considerations, offering readers valuable insights into dog breed selection and care.',
      },
      {
        trafficDomain: 100,
        urlTo: 'https://www.petplace.com/article/dogs/breeds/choosing-an-airedale',
        urlFrom: 'https://www.petplace.com/article/dogs/pet-care/american-kennel-club-akc-dog-breeds-alphabetical',
        priority: 'low',
        urlsSuggested: [
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/doberman-ear-cropping-necessary',
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/doberman-pinschers-like-kids',
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/french-bulldog-breathing-problems-things-to-know',
        ],
        aiRationale: 'The suggested URLs are selected based on their relevance to dog breeds, which aligns with the context of the broken URL about choosing an Airedale. These alternatives provide information on other dog breeds and related considerations, offering readers valuable insights into dog breed selection and care.',
      }, {
        trafficDomain: 100,
        urlTo: 'https://www.petplace.com/article/dogs/breeds/choosing-an-airedale',
        urlFrom: 'https://www.petplace.com/article/dogs/pet-care/american-kennel-club-akc-dog-breeds-alphabetical',
        priority: 'low',
        urlsSuggested: [
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/doberman-ear-cropping-necessary',
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/doberman-pinschers-like-kids',
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/french-bulldog-breathing-problems-things-to-know',
        ],
        aiRationale: 'The suggested URLs are selected based on their relevance to dog breeds, which aligns with the context of the broken URL about choosing an Airedale. These alternatives provide information on other dog breeds and related considerations, offering readers valuable insights into dog breed selection and care.',
      }, {
        trafficDomain: 100,
        urlTo: 'https://www.petplace.com/article/dogs/breeds/choosing-an-airedale',
        urlFrom: 'https://www.petplace.com/article/dogs/pet-care/american-kennel-club-akc-dog-breeds-alphabetical',
        priority: 'low',
        urlsSuggested: [
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/doberman-ear-cropping-necessary',
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/doberman-pinschers-like-kids',
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/french-bulldog-breathing-problems-things-to-know',
        ],
        aiRationale: 'The suggested URLs are selected based on their relevance to dog breeds, which aligns with the context of the broken URL about choosing an Airedale. These alternatives provide information on other dog breeds and related considerations, offering readers valuable insights into dog breed selection and care.',
      }, {
        trafficDomain: 100,
        urlTo: 'https://www.petplace.com/article/dogs/breeds/choosing-an-airedale',
        urlFrom: 'https://www.petplace.com/article/dogs/pet-care/american-kennel-club-akc-dog-breeds-alphabetical',
        priority: 'low',
        urlsSuggested: [
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/doberman-ear-cropping-necessary',
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/doberman-pinschers-like-kids',
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/french-bulldog-breathing-problems-things-to-know',
        ],
        aiRationale: 'The suggested URLs are selected based on their relevance to dog breeds, which aligns with the context of the broken URL about choosing an Airedale. These alternatives provide information on other dog breeds and related considerations, offering readers valuable insights into dog breed selection and care.',
      }, {
        trafficDomain: 100,
        urlTo: 'https://www.petplace.com/article/dogs/breeds/choosing-an-airedale',
        urlFrom: 'https://www.petplace.com/article/dogs/pet-care/american-kennel-club-akc-dog-breeds-alphabetical',
        priority: 'low',
        urlsSuggested: [
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/doberman-ear-cropping-necessary',
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/doberman-pinschers-like-kids',
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/french-bulldog-breathing-problems-things-to-know',
        ],
        aiRationale: 'The suggested URLs are selected based on their relevance to dog breeds, which aligns with the context of the broken URL about choosing an Airedale. These alternatives provide information on other dog breeds and related considerations, offering readers valuable insights into dog breed selection and care.',
      }, {
        trafficDomain: 100,
        urlTo: 'https://www.petplace.com/article/dogs/breeds/choosing-an-airedale',
        urlFrom: 'https://www.petplace.com/article/dogs/pet-care/american-kennel-club-akc-dog-breeds-alphabetical',
        priority: 'low',
        urlsSuggested: [
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/doberman-ear-cropping-necessary',
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/doberman-pinschers-like-kids',
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/french-bulldog-breathing-problems-things-to-know',
        ],
        aiRationale: 'The suggested URLs are selected based on their relevance to dog breeds, which aligns with the context of the broken URL about choosing an Airedale. These alternatives provide information on other dog breeds and related considerations, offering readers valuable insights into dog breed selection and care.',
      }, {
        trafficDomain: 100,
        urlTo: 'https://www.petplace.com/article/dogs/breeds/choosing-an-airedale',
        urlFrom: 'https://www.petplace.com/article/dogs/pet-care/american-kennel-club-akc-dog-breeds-alphabetical',
        priority: 'low',
        urlsSuggested: [
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/doberman-ear-cropping-necessary',
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/doberman-pinschers-like-kids',
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/french-bulldog-breathing-problems-things-to-know',
        ],
        aiRationale: 'The suggested URLs are selected based on their relevance to dog breeds, which aligns with the context of the broken URL about choosing an Airedale. These alternatives provide information on other dog breeds and related considerations, offering readers valuable insights into dog breed selection and care.',
      }, {
        trafficDomain: 100,
        urlTo: 'https://www.petplace.com/article/dogs/breeds/choosing-an-airedale',
        urlFrom: 'https://www.petplace.com/article/dogs/pet-care/american-kennel-club-akc-dog-breeds-alphabetical',
        priority: 'low',
        urlsSuggested: [
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/doberman-ear-cropping-necessary',
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/doberman-pinschers-like-kids',
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/french-bulldog-breathing-problems-things-to-know',
        ],
        aiRationale: 'The suggested URLs are selected based on their relevance to dog breeds, which aligns with the context of the broken URL about choosing an Airedale. These alternatives provide information on other dog breeds and related considerations, offering readers valuable insights into dog breed selection and care.',
      }, {
        trafficDomain: 100,
        urlTo: 'https://www.petplace.com/article/dogs/breeds/choosing-an-airedale',
        urlFrom: 'https://www.petplace.com/article/dogs/pet-care/american-kennel-club-akc-dog-breeds-alphabetical',
        priority: 'low',
        urlsSuggested: [
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/doberman-ear-cropping-necessary',
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/doberman-pinschers-like-kids',
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/french-bulldog-breathing-problems-things-to-know',
        ],
        aiRationale: 'The suggested URLs are selected based on their relevance to dog breeds, which aligns with the context of the broken URL about choosing an Airedale. These alternatives provide information on other dog breeds and related considerations, offering readers valuable insights into dog breed selection and care.',
      }, {
        trafficDomain: 100,
        urlTo: 'https://www.petplace.com/article/dogs/breeds/choosing-an-airedale',
        urlFrom: 'https://www.petplace.com/article/dogs/pet-care/american-kennel-club-akc-dog-breeds-alphabetical',
        priority: 'low',
        urlsSuggested: [
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/doberman-ear-cropping-necessary',
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/doberman-pinschers-like-kids',
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/french-bulldog-breathing-problems-things-to-know',
        ],
        aiRationale: 'The suggested URLs are selected based on their relevance to dog breeds, which aligns with the context of the broken URL about choosing an Airedale. These alternatives provide information on other dog breeds and related considerations, offering readers valuable insights into dog breed selection and care.',
      }, {
        trafficDomain: 100,
        urlTo: 'https://www.petplace.com/article/dogs/breeds/choosing-an-airedale',
        urlFrom: 'https://www.petplace.com/article/dogs/pet-care/american-kennel-club-akc-dog-breeds-alphabetical',
        priority: 'low',
        urlsSuggested: [
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/doberman-ear-cropping-necessary',
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/doberman-pinschers-like-kids',
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/french-bulldog-breathing-problems-things-to-know',
        ],
        aiRationale: 'The suggested URLs are selected based on their relevance to dog breeds, which aligns with the context of the broken URL about choosing an Airedale. These alternatives provide information on other dog breeds and related considerations, offering readers valuable insights into dog breed selection and care.',
      }, {
        trafficDomain: 100,
        urlTo: 'https://www.petplace.com/article/dogs/breeds/choosing-an-airedale',
        urlFrom: 'https://www.petplace.com/article/dogs/pet-care/american-kennel-club-akc-dog-breeds-alphabetical',
        priority: 'low',
        urlsSuggested: [
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/doberman-ear-cropping-necessary',
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/doberman-pinschers-like-kids',
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/french-bulldog-breathing-problems-things-to-know',
        ],
        aiRationale: 'The suggested URLs are selected based on their relevance to dog breeds, which aligns with the context of the broken URL about choosing an Airedale. These alternatives provide information on other dog breeds and related considerations, offering readers valuable insights into dog breed selection and care.',
      }, {
        trafficDomain: 100,
        urlTo: 'https://www.petplace.com/article/dogs/breeds/choosing-an-airedale',
        urlFrom: 'https://www.petplace.com/article/dogs/pet-care/american-kennel-club-akc-dog-breeds-alphabetical',
        priority: 'low',
        urlsSuggested: [
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/doberman-ear-cropping-necessary',
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/doberman-pinschers-like-kids',
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/french-bulldog-breathing-problems-things-to-know',
        ],
        aiRationale: 'The suggested URLs are selected based on their relevance to dog breeds, which aligns with the context of the broken URL about choosing an Airedale. These alternatives provide information on other dog breeds and related considerations, offering readers valuable insights into dog breed selection and care.',
      }, {
        trafficDomain: 100,
        urlTo: 'https://www.petplace.com/article/dogs/breeds/choosing-an-airedale',
        urlFrom: 'https://www.petplace.com/article/dogs/pet-care/american-kennel-club-akc-dog-breeds-alphabetical',
        priority: 'low',
        urlsSuggested: [
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/doberman-ear-cropping-necessary',
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/doberman-pinschers-like-kids',
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/french-bulldog-breathing-problems-things-to-know',
        ],
        aiRationale: 'The suggested URLs are selected based on their relevance to dog breeds, which aligns with the context of the broken URL about choosing an Airedale. These alternatives provide information on other dog breeds and related considerations, offering readers valuable insights into dog breed selection and care.',
      }, {
        trafficDomain: 100,
        urlTo: 'https://www.petplace.com/article/dogs/breeds/choosing-an-airedale',
        urlFrom: 'https://www.petplace.com/article/dogs/pet-care/american-kennel-club-akc-dog-breeds-alphabetical',
        priority: 'low',
        urlsSuggested: [
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/doberman-ear-cropping-necessary',
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/doberman-pinschers-like-kids',
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/french-bulldog-breathing-problems-things-to-know',
        ],
        aiRationale: 'The suggested URLs are selected based on their relevance to dog breeds, which aligns with the context of the broken URL about choosing an Airedale. These alternatives provide information on other dog breeds and related considerations, offering readers valuable insights into dog breed selection and care.',
      }, {
        trafficDomain: 100,
        urlTo: 'https://www.petplace.com/article/dogs/breeds/choosing-an-airedale',
        urlFrom: 'https://www.petplace.com/article/dogs/pet-care/american-kennel-club-akc-dog-breeds-alphabetical',
        priority: 'low',
        urlsSuggested: [
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/doberman-ear-cropping-necessary',
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/doberman-pinschers-like-kids',
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/french-bulldog-breathing-problems-things-to-know',
        ],
        aiRationale: 'The suggested URLs are selected based on their relevance to dog breeds, which aligns with the context of the broken URL about choosing an Airedale. These alternatives provide information on other dog breeds and related considerations, offering readers valuable insights into dog breed selection and care.',
      }, {
        trafficDomain: 100,
        urlTo: 'https://www.petplace.com/article/dogs/breeds/choosing-an-airedale',
        urlFrom: 'https://www.petplace.com/article/dogs/pet-care/american-kennel-club-akc-dog-breeds-alphabetical',
        priority: 'low',
        urlsSuggested: [
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/doberman-ear-cropping-necessary',
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/doberman-pinschers-like-kids',
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/french-bulldog-breathing-problems-things-to-know',
        ],
        aiRationale: 'The suggested URLs are selected based on their relevance to dog breeds, which aligns with the context of the broken URL about choosing an Airedale. These alternatives provide information on other dog breeds and related considerations, offering readers valuable insights into dog breed selection and care.',
      }, {
        trafficDomain: 100,
        urlTo: 'https://www.petplace.com/article/dogs/breeds/choosing-an-airedale',
        urlFrom: 'https://www.petplace.com/article/dogs/pet-care/american-kennel-club-akc-dog-breeds-alphabetical',
        priority: 'low',
        urlsSuggested: [
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/doberman-ear-cropping-necessary',
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/doberman-pinschers-like-kids',
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/french-bulldog-breathing-problems-things-to-know',
        ],
        aiRationale: 'The suggested URLs are selected based on their relevance to dog breeds, which aligns with the context of the broken URL about choosing an Airedale. These alternatives provide information on other dog breeds and related considerations, offering readers valuable insights into dog breed selection and care.',
      }, {
        trafficDomain: 100,
        urlTo: 'https://www.petplace.com/article/dogs/breeds/choosing-an-airedale',
        urlFrom: 'https://www.petplace.com/article/dogs/pet-care/american-kennel-club-akc-dog-breeds-alphabetical',
        priority: 'low',
        urlsSuggested: [
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/doberman-ear-cropping-necessary',
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/doberman-pinschers-like-kids',
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/french-bulldog-breathing-problems-things-to-know',
        ],
        aiRationale: 'The suggested URLs are selected based on their relevance to dog breeds, which aligns with the context of the broken URL about choosing an Airedale. These alternatives provide information on other dog breeds and related considerations, offering readers valuable insights into dog breed selection and care.',
      }, {
        trafficDomain: 100,
        urlTo: 'https://www.petplace.com/article/dogs/breeds/choosing-an-airedale',
        urlFrom: 'https://www.petplace.com/article/dogs/pet-care/american-kennel-club-akc-dog-breeds-alphabetical',
        priority: 'low',
        urlsSuggested: [
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/doberman-ear-cropping-necessary',
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/doberman-pinschers-like-kids',
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/french-bulldog-breathing-problems-things-to-know',
        ],
        aiRationale: 'The suggested URLs are selected based on their relevance to dog breeds, which aligns with the context of the broken URL about choosing an Airedale. These alternatives provide information on other dog breeds and related considerations, offering readers valuable insights into dog breed selection and care.',
      }, {
        trafficDomain: 100,
        urlTo: 'https://www.petplace.com/article/dogs/breeds/choosing-an-airedale',
        urlFrom: 'https://www.petplace.com/article/dogs/pet-care/american-kennel-club-akc-dog-breeds-alphabetical',
        priority: 'low',
        urlsSuggested: [
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/doberman-ear-cropping-necessary',
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/doberman-pinschers-like-kids',
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/french-bulldog-breathing-problems-things-to-know',
        ],
        aiRationale: 'The suggested URLs are selected based on their relevance to dog breeds, which aligns with the context of the broken URL about choosing an Airedale. These alternatives provide information on other dog breeds and related considerations, offering readers valuable insights into dog breed selection and care.',
      }, {
        trafficDomain: 100,
        urlTo: 'https://www.petplace.com/article/dogs/breeds/choosing-an-airedale',
        urlFrom: 'https://www.petplace.com/article/dogs/pet-care/american-kennel-club-akc-dog-breeds-alphabetical',
        priority: 'low',
        urlsSuggested: [
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/doberman-ear-cropping-necessary',
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/doberman-pinschers-like-kids',
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/french-bulldog-breathing-problems-things-to-know',
        ],
        aiRationale: 'The suggested URLs are selected based on their relevance to dog breeds, which aligns with the context of the broken URL about choosing an Airedale. These alternatives provide information on other dog breeds and related considerations, offering readers valuable insights into dog breed selection and care.',
      }, {
        trafficDomain: 100,
        urlTo: 'https://www.petplace.com/article/dogs/breeds/choosing-an-airedale',
        urlFrom: 'https://www.petplace.com/article/dogs/pet-care/american-kennel-club-akc-dog-breeds-alphabetical',
        priority: 'low',
        urlsSuggested: [
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/doberman-ear-cropping-necessary',
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/doberman-pinschers-like-kids',
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/french-bulldog-breathing-problems-things-to-know',
        ],
        aiRationale: 'The suggested URLs are selected based on their relevance to dog breeds, which aligns with the context of the broken URL about choosing an Airedale. These alternatives provide information on other dog breeds and related considerations, offering readers valuable insights into dog breed selection and care.',
      }, {
        trafficDomain: 100,
        urlTo: 'https://www.petplace.com/article/dogs/breeds/choosing-an-airedale',
        urlFrom: 'https://www.petplace.com/article/dogs/pet-care/american-kennel-club-akc-dog-breeds-alphabetical',
        priority: 'low',
        urlsSuggested: [
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/doberman-ear-cropping-necessary',
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/doberman-pinschers-like-kids',
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/french-bulldog-breathing-problems-things-to-know',
        ],
        aiRationale: 'The suggested URLs are selected based on their relevance to dog breeds, which aligns with the context of the broken URL about choosing an Airedale. These alternatives provide information on other dog breeds and related considerations, offering readers valuable insights into dog breed selection and care.',
      }, {
        trafficDomain: 100,
        urlTo: 'https://www.petplace.com/article/dogs/breeds/choosing-an-airedale',
        urlFrom: 'https://www.petplace.com/article/dogs/pet-care/american-kennel-club-akc-dog-breeds-alphabetical',
        priority: 'low',
        urlsSuggested: [
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/doberman-ear-cropping-necessary',
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/doberman-pinschers-like-kids',
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/french-bulldog-breathing-problems-things-to-know',
        ],
        aiRationale: 'The suggested URLs are selected based on their relevance to dog breeds, which aligns with the context of the broken URL about choosing an Airedale. These alternatives provide information on other dog breeds and related considerations, offering readers valuable insights into dog breed selection and care.',
      }, {
        trafficDomain: 100,
        urlTo: 'https://www.petplace.com/article/dogs/breeds/choosing-an-airedale',
        urlFrom: 'https://www.petplace.com/article/dogs/pet-care/american-kennel-club-akc-dog-breeds-alphabetical',
        priority: 'low',
        urlsSuggested: [
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/doberman-ear-cropping-necessary',
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/doberman-pinschers-like-kids',
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/french-bulldog-breathing-problems-things-to-know',
        ],
        aiRationale: 'The suggested URLs are selected based on their relevance to dog breeds, which aligns with the context of the broken URL about choosing an Airedale. These alternatives provide information on other dog breeds and related considerations, offering readers valuable insights into dog breed selection and care.',
      }, {
        trafficDomain: 100,
        urlTo: 'https://www.petplace.com/article/dogs/breeds/choosing-an-airedale',
        urlFrom: 'https://www.petplace.com/article/dogs/pet-care/american-kennel-club-akc-dog-breeds-alphabetical',
        priority: 'low',
        urlsSuggested: [
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/doberman-ear-cropping-necessary',
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/doberman-pinschers-like-kids',
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/french-bulldog-breathing-problems-things-to-know',
        ],
        aiRationale: 'The suggested URLs are selected based on their relevance to dog breeds, which aligns with the context of the broken URL about choosing an Airedale. These alternatives provide information on other dog breeds and related considerations, offering readers valuable insights into dog breed selection and care.',
      }, {
        trafficDomain: 100,
        urlTo: 'https://www.petplace.com/article/dogs/breeds/choosing-an-airedale',
        urlFrom: 'https://www.petplace.com/article/dogs/pet-care/american-kennel-club-akc-dog-breeds-alphabetical',
        priority: 'low',
        urlsSuggested: [
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/doberman-ear-cropping-necessary',
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/doberman-pinschers-like-kids',
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/french-bulldog-breathing-problems-things-to-know',
        ],
        aiRationale: 'The suggested URLs are selected based on their relevance to dog breeds, which aligns with the context of the broken URL about choosing an Airedale. These alternatives provide information on other dog breeds and related considerations, offering readers valuable insights into dog breed selection and care.',
      },
      {
        trafficDomain: 100,
        urlTo: 'https://www.petplace.com/article/dogs/breeds/choosing-an-airedale',
        urlFrom: 'https://www.petplace.com/article/dogs/pet-care/american-kennel-club-akc-dog-breeds-alphabetical',
        priority: 'low',
        urlsSuggested: [
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/doberman-ear-cropping-necessary',
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/doberman-pinschers-like-kids',
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/french-bulldog-breathing-problems-things-to-know',
        ],
        aiRationale: 'The suggested URLs are selected based on their relevance to dog breeds, which aligns with the context of the broken URL about choosing an Airedale. These alternatives provide information on other dog breeds and related considerations, offering readers valuable insights into dog breed selection and care.',
      },
      {
        trafficDomain: 100,
        urlTo: 'https://www.petplace.com/article/dogs/breeds/choosing-an-airedale',
        urlFrom: 'https://www.petplace.com/article/dogs/pet-care/american-kennel-club-akc-dog-breeds-alphabetical',
        priority: 'low',
        urlsSuggested: [
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/doberman-ear-cropping-necessary',
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/doberman-pinschers-like-kids',
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/french-bulldog-breathing-problems-things-to-know',
        ],
        aiRationale: 'The suggested URLs are selected based on their relevance to dog breeds, which aligns with the context of the broken URL about choosing an Airedale. These alternatives provide information on other dog breeds and related considerations, offering readers valuable insights into dog breed selection and care.',
      }, {
        trafficDomain: 100,
        urlTo: 'https://www.petplace.com/article/dogs/breeds/choosing-an-airedale',
        urlFrom: 'https://www.petplace.com/article/dogs/pet-care/american-kennel-club-akc-dog-breeds-alphabetical',
        priority: 'low',
        urlsSuggested: [
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/doberman-ear-cropping-necessary',
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/doberman-pinschers-like-kids',
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/french-bulldog-breathing-problems-things-to-know',
        ],
        aiRationale: 'The suggested URLs are selected based on their relevance to dog breeds, which aligns with the context of the broken URL about choosing an Airedale. These alternatives provide information on other dog breeds and related considerations, offering readers valuable insights into dog breed selection and care.',
      }, {
        trafficDomain: 100,
        urlTo: 'https://www.petplace.com/article/dogs/breeds/choosing-an-airedale',
        urlFrom: 'https://www.petplace.com/article/dogs/pet-care/american-kennel-club-akc-dog-breeds-alphabetical',
        priority: 'low',
        urlsSuggested: [
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/doberman-ear-cropping-necessary',
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/doberman-pinschers-like-kids',
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/french-bulldog-breathing-problems-things-to-know',
        ],
        aiRationale: 'The suggested URLs are selected based on their relevance to dog breeds, which aligns with the context of the broken URL about choosing an Airedale. These alternatives provide information on other dog breeds and related considerations, offering readers valuable insights into dog breed selection and care.',
      }, {
        trafficDomain: 100,
        urlTo: 'https://www.petplace.com/article/dogs/breeds/choosing-an-airedale',
        urlFrom: 'https://www.petplace.com/article/dogs/pet-care/american-kennel-club-akc-dog-breeds-alphabetical',
        priority: 'low',
        urlsSuggested: [
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/doberman-ear-cropping-necessary',
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/doberman-pinschers-like-kids',
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/french-bulldog-breathing-problems-things-to-know',
        ],
        aiRationale: 'The suggested URLs are selected based on their relevance to dog breeds, which aligns with the context of the broken URL about choosing an Airedale. These alternatives provide information on other dog breeds and related considerations, offering readers valuable insights into dog breed selection and care.',
      }, {
        trafficDomain: 100,
        urlTo: 'https://www.petplace.com/article/dogs/breeds/choosing-an-airedale',
        urlFrom: 'https://www.petplace.com/article/dogs/pet-care/american-kennel-club-akc-dog-breeds-alphabetical',
        priority: 'low',
        urlsSuggested: [
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/doberman-ear-cropping-necessary',
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/doberman-pinschers-like-kids',
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/french-bulldog-breathing-problems-things-to-know',
        ],
        aiRationale: 'The suggested URLs are selected based on their relevance to dog breeds, which aligns with the context of the broken URL about choosing an Airedale. These alternatives provide information on other dog breeds and related considerations, offering readers valuable insights into dog breed selection and care.',
      }, {
        trafficDomain: 100,
        urlTo: 'https://www.petplace.com/article/dogs/breeds/choosing-an-airedale',
        urlFrom: 'https://www.petplace.com/article/dogs/pet-care/american-kennel-club-akc-dog-breeds-alphabetical',
        priority: 'low',
        urlsSuggested: [
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/doberman-ear-cropping-necessary',
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/doberman-pinschers-like-kids',
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/french-bulldog-breathing-problems-things-to-know',
        ],
        aiRationale: 'The suggested URLs are selected based on their relevance to dog breeds, which aligns with the context of the broken URL about choosing an Airedale. These alternatives provide information on other dog breeds and related considerations, offering readers valuable insights into dog breed selection and care.',
      }, {
        trafficDomain: 100,
        urlTo: 'https://www.petplace.com/article/dogs/breeds/choosing-an-airedale',
        urlFrom: 'https://www.petplace.com/article/dogs/pet-care/american-kennel-club-akc-dog-breeds-alphabetical',
        priority: 'low',
        urlsSuggested: [
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/doberman-ear-cropping-necessary',
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/doberman-pinschers-like-kids',
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/french-bulldog-breathing-problems-things-to-know',
        ],
        aiRationale: 'The suggested URLs are selected based on their relevance to dog breeds, which aligns with the context of the broken URL about choosing an Airedale. These alternatives provide information on other dog breeds and related considerations, offering readers valuable insights into dog breed selection and care.',
      }, {
        trafficDomain: 100,
        urlTo: 'https://www.petplace.com/article/dogs/breeds/choosing-an-airedale',
        urlFrom: 'https://www.petplace.com/article/dogs/pet-care/american-kennel-club-akc-dog-breeds-alphabetical',
        priority: 'low',
        urlsSuggested: [
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/doberman-ear-cropping-necessary',
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/doberman-pinschers-like-kids',
          'https://www.petplace.com/article/dogs/breeds/dog-breeds/french-bulldog-breathing-problems-things-to-know',
        ],
        aiRationale: 'The suggested URLs are selected based on their relevance to dog breeds, which aligns with the context of the broken URL about choosing an Airedale. These alternatives provide information on other dog breeds and related considerations, offering readers valuable insights into dog breed selection and care.',
      },
    ],
  },
  fullAuditRef: 'https://petplace.com',
  id: 'f2be2b3b-9ac4-42b8-a1ac-713c7ad2e343',
};
