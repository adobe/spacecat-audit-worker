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

export const criticalLevel = 'critical';
export const seriousLevel = 'serious';
export const impactLevels = [criticalLevel, seriousLevel];
const violansObject = {
  violations: {
    total: 0,
    [criticalLevel]: {
      count: 0,
      items: {},
    },
    [seriousLevel]: {
      count: 0,
      items: {},
    },
  },
  traffic: 0,
};

export const levelsMappedToLetter = {
  wcag2a: 'A',
  wcag2aa: 'AA',
  wcag21a: 'A',
  wcag21aa: 'AA',
  wcag22aa: 'AA',
};

export function getViolationsObject() {
  return JSON.parse(JSON.stringify(violansObject));
}

export const batchSize = 5;
export const isHeadless = false;

export const complianceLevels = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

export const dataNeededForA11yAudit = {
  siteData: {
    name: 'theplayers',
    siteId: '917ca4a0-bb8e-47a8-aa6e-c4eb73defb97',
  },
  urls: [
    {
      url: 'https://theplayers.com/',
      traffic: '3600',
    },
    {
      url: 'https://theplayers.com/plan-your-visit',
      traffic: '2800',
    },
    {
      url: 'https://theplayers.com/parking',
      traffic: '1700',
    },
    {
      url: 'https://theplayers.com/chip-in',
      traffic: '1600',
    },
    {
      url: 'https://theplayers.com/tickets',
      traffic: '1500',
    },
    {
      url: 'https://theplayers.com/chip-in/leaderboard',
      traffic: '400',
    },
    {
      url: 'https://theplayers.com/military',
      traffic: '300',
    },
    {
      url: 'https://theplayers.com/equipment',
      traffic: '200',
    },
    {
      url: 'https://theplayers.com/hospitality',
      traffic: '200',
    },
    {
      url: 'https://theplayers.com/birdies',
      traffic: '200',
    },
    {
      url: 'https://theplayers.com/TICKETS',
      traffic: '200',
    },
    {
      url: 'https://theplayers.com/news/2025/02/19/format-field-creator-classic-tpc-sawgrass',
      traffic: '100',
    },
    {
      url: 'https://theplayers.com/past-results',
      traffic: '100',
    },
    {
      url: 'https://theplayers.com/volunteer',
      traffic: '100',
    },
    {
      url: 'https://theplayers.com/trophy',
      traffic: '100',
    },
    {
      url: 'https://theplayers.com/community',
      traffic: '100',
    },
  ],
};

export const successCriteriaLinks = {
  111: {
    name: 'Non-text Content',
    understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/non-text-content.html',
    howToMeetUrl: 'https://www.w3.org/WAI/WCAG22/quickref/#non-text-content',
    successCriterionUrl: 'https://www.w3.org/TR/WCAG/#non-text-content',
  },
  121: {
    name: 'Audio-only and Video-only (Prerecorded)',
    understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/audio-only-and-video-only-prerecorded.html',
    howToMeetUrl: 'https://www.w3.org/WAI/WCAG22/quickref/#audio-only-and-video-only-prerecorded',
    successCriterionUrl: 'https://www.w3.org/TR/WCAG/#audio-only-and-video-only-prerecorded',
  },
  122: {
    name: 'Captions (Prerecorded)',
    understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/captions-prerecorded.html',
    howToMeetUrl: 'https://www.w3.org/WAI/WCAG22/quickref/#captions-prerecorded',
    successCriterionUrl: 'https://www.w3.org/TR/WCAG/#captions-prerecorded',
  },
  123: {
    name: 'Audio Description or Media Alternative (Prerecorded)',
    understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/audio-description-or-media-alternative-prerecorded.html',
    howToMeetUrl: 'https://www.w3.org/WAI/WCAG22/quickref/#audio-description-or-media-alternative-prerecorded',
    successCriterionUrl: 'https://www.w3.org/TR/WCAG/#audio-description-or-media-alternative-prerecorded',
  },
  124: {
    name: 'Captions (Live)',
    understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/captions-live.html',
    howToMeetUrl: 'https://www.w3.org/WAI/WCAG22/quickref/#captions-live',
    successCriterionUrl: 'https://www.w3.org/TR/WCAG/#captions-live',
  },
  125: {
    name: 'Audio Description (Prerecorded)',
    understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/audio-description-prerecorded.html',
    howToMeetUrl: 'https://www.w3.org/WAI/WCAG22/quickref/#audio-description-prerecorded',
    successCriterionUrl: 'https://www.w3.org/TR/WCAG/#audio-description-prerecorded',
  },
  126: {
    name: 'Sign Language (Prerecorded)',
    understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/sign-language-prerecorded.html',
    howToMeetUrl: 'https://www.w3.org/WAI/WCAG22/quickref/#sign-language-prerecorded',
    successCriterionUrl: 'https://www.w3.org/TR/WCAG/#sign-language-prerecorded',
  },
  127: {
    name: 'Extended Audio Description (Prerecorded)',
    understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/extended-audio-description-prerecorded.html',
    howToMeetUrl: 'https://www.w3.org/WAI/WCAG22/quickref/#extended-audio-description-prerecorded',
    successCriterionUrl: 'https://www.w3.org/TR/WCAG/#extended-audio-description-prerecorded',
  },
  128: {
    name: 'Media Alternative (Prerecorded)',
    understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/media-alternative-prerecorded.html',
    howToMeetUrl: 'https://www.w3.org/WAI/WCAG22/quickref/#media-alternative-prerecorded',
    successCriterionUrl: 'https://www.w3.org/TR/WCAG/#media-alternative-prerecorded',
  },
  129: {
    name: 'Audio-only (Live)',
    understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/audio-only-live.html',
    howToMeetUrl: 'https://www.w3.org/WAI/WCAG22/quickref/#audio-only-live',
    successCriterionUrl: 'https://www.w3.org/TR/WCAG/#audio-only-live',
  },
  131: {
    name: 'Info and Relationships',
    understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/info-and-relationships.html',
    howToMeetUrl: 'https://www.w3.org/WAI/WCAG22/quickref/#info-and-relationships',
    successCriterionUrl: 'https://www.w3.org/TR/WCAG/#info-and-relationships',
  },
  132: {
    name: 'Meaningful Sequence',
    understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/meaningful-sequence.html',
    howToMeetUrl: 'https://www.w3.org/WAI/WCAG22/quickref/#meaningful-sequence',
    successCriterionUrl: 'https://www.w3.org/TR/WCAG/#meaningful-sequence',
  },
  133: {
    name: 'Sensory Characteristics',
    understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/sensory-characteristics.html',
    howToMeetUrl: 'https://www.w3.org/WAI/WCAG22/quickref/#sensory-characteristics',
    successCriterionUrl: 'https://www.w3.org/TR/WCAG/#sensory-characteristics',
  },
  134: {
    name: 'Orientation',
    understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/orientation.html',
    howToMeetUrl: 'https://www.w3.org/WAI/WCAG22/quickref/#orientation',
    successCriterionUrl: 'https://www.w3.org/TR/WCAG/#orientation',
  },
  135: {
    name: 'Identify Input Purpose',
    understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/identify-input-purpose.html',
    howToMeetUrl: 'https://www.w3.org/WAI/WCAG22/quickref/#identify-input-purpose',
    successCriterionUrl: 'https://www.w3.org/TR/WCAG/#identify-input-purpose',
  },
  136: {
    name: 'Identify Purpose',
    understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/identify-purpose.html',
    howToMeetUrl: 'https://www.w3.org/WAI/WCAG22/quickref/#identify-purpose',
    successCriterionUrl: 'https://www.w3.org/TR/WCAG/#identify-purpose',
  },
  141: {
    name: 'Use of Color',
    understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html',
    howToMeetUrl: 'https://www.w3.org/WAI/WCAG22/quickref/#use-of-color',
    successCriterionUrl: 'https://www.w3.org/TR/WCAG/#use-of-color',
  },
  142: {
    name: 'Audio Control',
    understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/audio-control.html',
    howToMeetUrl: 'https://www.w3.org/WAI/WCAG22/quickref/#audio-control',
    successCriterionUrl: 'https://www.w3.org/TR/WCAG/#audio-control',
  },
  143: {
    name: 'Contrast (Minimum)',
    understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html',
    howToMeetUrl: 'https://www.w3.org/WAI/WCAG22/quickref/#contrast-minimum',
    successCriterionUrl: 'https://www.w3.org/TR/WCAG/#contrast-minimum',
  },
  144: {
    name: 'Resize Text',
    understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html',
    howToMeetUrl: 'https://www.w3.org/WAI/WCAG22/quickref/#resize-text',
    successCriterionUrl: 'https://www.w3.org/TR/WCAG/#resize-text',
  },
  145: {
    name: 'Images of Text',
    understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/images-of-text.html',
    howToMeetUrl: 'https://www.w3.org/WAI/WCAG22/quickref/#images-of-text',
    successCriterionUrl: 'https://www.w3.org/TR/WCAG/#images-of-text',
  },
  146: {
    name: 'Contrast (Enhanced)',
    understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/contrast-enhanced.html',
    howToMeetUrl: 'https://www.w3.org/WAI/WCAG22/quickref/#contrast-enhanced',
    successCriterionUrl: 'https://www.w3.org/TR/WCAG/#contrast-enhanced',
  },
  147: {
    name: 'Low or No Background Audio',
    understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/low-or-no-background-audio.html',
    howToMeetUrl: 'https://www.w3.org/WAI/WCAG22/quickref/#low-or-no-background-audio',
    successCriterionUrl: 'https://www.w3.org/TR/WCAG/#low-or-no-background-audio',
  },
  148: {
    name: 'Visual Presentation',
    understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/visual-presentation.html',
    howToMeetUrl: 'https://www.w3.org/WAI/WCAG22/quickref/#visual-presentation',
    successCriterionUrl: 'https://www.w3.org/TR/WCAG/#visual-presentation',
  },
  149: {
    name: 'Images of Text (No Exception)',
    understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/images-of-text-no-exception.html',
    howToMeetUrl: 'https://www.w3.org/WAI/WCAG22/quickref/#images-of-text-no-exception',
    successCriterionUrl: 'https://www.w3.org/TR/WCAG/#images-of-text-no-exception',
  },
  1410: {
    name: 'Reflow',
    understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/reflow.html',
    howToMeetUrl: 'https://www.w3.org/WAI/WCAG22/quickref/#reflow',
    successCriterionUrl: 'https://www.w3.org/TR/WCAG/#reflow',
  },
  1411: {
    name: 'Non-text Contrast',
    understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html',
    howToMeetUrl: 'https://www.w3.org/WAI/WCAG22/quickref/#non-text-contrast',
    successCriterionUrl: 'https://www.w3.org/TR/WCAG/#non-text-contrast',
  },
  1412: {
    name: 'Text Spacing',
    understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/text-spacing.html',
    howToMeetUrl: 'https://www.w3.org/WAI/WCAG22/quickref/#text-spacing',
    successCriterionUrl: 'https://www.w3.org/TR/WCAG/#text-spacing',
  },
  1413: {
    name: 'Content on Hover or Focus',
    understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/content-on-hover-or-focus.html',
    howToMeetUrl: 'https://www.w3.org/WAI/WCAG22/quickref/#content-on-hover-or-focus',
    successCriterionUrl: 'https://www.w3.org/TR/WCAG/#content-on-hover-or-focus',
  },
  211: {
    name: 'Keyboard',
    understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/keyboard.html',
    howToMeetUrl: 'https://www.w3.org/WAI/WCAG22/quickref/#keyboard',
    successCriterionUrl: 'https://www.w3.org/TR/WCAG/#keyboard',
  },
  212: {
    name: 'No Keyboard Trap',
    understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/no-keyboard-trap.html',
    howToMeetUrl: 'https://www.w3.org/WAI/WCAG22/quickref/#no-keyboard-trap',
    successCriterionUrl: 'https://www.w3.org/TR/WCAG/#no-keyboard-trap',
  },
  213: {
    name: 'Keyboard (No Exception)',
    understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/keyboard-no-exception.html',
    howToMeetUrl: 'https://www.w3.org/WAI/WCAG22/quickref/#keyboard-no-exception',
    successCriterionUrl: 'https://www.w3.org/TR/WCAG/#keyboard-no-exception',
  },
  214: {
    name: 'Character Key Shortcuts',
    understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/character-key-shortcuts.html',
    howToMeetUrl: 'https://www.w3.org/WAI/WCAG22/quickref/#character-key-shortcuts',
    successCriterionUrl: 'https://www.w3.org/TR/WCAG/#character-key-shortcuts',
  },
  221: {
    name: 'Timing Adjustable',
    understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/timing-adjustable.html',
    howToMeetUrl: 'https://www.w3.org/WAI/WCAG22/quickref/#timing-adjustable',
    successCriterionUrl: 'https://www.w3.org/TR/WCAG/#timing-adjustable',
  },
  222: {
    name: 'Pause, Stop, Hide',
    understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html',
    howToMeetUrl: 'https://www.w3.org/WAI/WCAG22/quickref/#pause-stop-hide',
    successCriterionUrl: 'https://www.w3.org/TR/WCAG/#pause-stop-hide',
  },
  223: {
    name: 'No Timing',
    understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/no-timing.html',
    howToMeetUrl: 'https://www.w3.org/WAI/WCAG22/quickref/#no-timing',
    successCriterionUrl: 'https://www.w3.org/TR/WCAG/#no-timing',
  },
  224: {
    name: 'Interruptions',
    understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/interruptions.html',
    howToMeetUrl: 'https://www.w3.org/WAI/WCAG22/quickref/#interruptions',
    successCriterionUrl: 'https://www.w3.org/TR/WCAG/#interruptions',
  },
  225: {
    name: 'Re-authenticating',
    understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/re-authenticating.html',
    howToMeetUrl: 'https://www.w3.org/WAI/WCAG22/quickref/#re-authenticating',
    successCriterionUrl: 'https://www.w3.org/TR/WCAG/#re-authenticating',
  },
  226: {
    name: 'Timeouts',
    understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/timeouts.html',
    howToMeetUrl: 'https://www.w3.org/WAI/WCAG22/quickref/#timeouts',
    successCriterionUrl: 'https://www.w3.org/TR/WCAG/#timeouts',
  },
  231: {
    name: 'Three Flashes or Below Threshold',
    understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html',
    howToMeetUrl: 'https://www.w3.org/WAI/WCAG22/quickref/#three-flashes-or-below-threshold',
    successCriterionUrl: 'https://www.w3.org/TR/WCAG/#three-flashes-or-below-threshold',
  },
  232: {
    name: 'Three Flashes',
    understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/three-flashes.html',
    howToMeetUrl: 'https://www.w3.org/WAI/WCAG22/quickref/#three-flashes',
    successCriterionUrl: 'https://www.w3.org/TR/WCAG/#three-flashes',
  },
  233: {
    name: 'Animation from Interactions',
    understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html',
    howToMeetUrl: 'https://www.w3.org/WAI/WCAG22/quickref/#animation-from-interactions',
    successCriterionUrl: 'https://www.w3.org/TR/WCAG/#animation-from-interactions',
  },
  241: {
    name: 'Bypass Blocks',
    understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/bypass-blocks.html',
    howToMeetUrl: 'https://www.w3.org/WAI/WCAG22/quickref/#bypass-blocks',
    successCriterionUrl: 'https://www.w3.org/TR/WCAG/#bypass-blocks',
  },
  242: {
    name: 'Page Titled',
    understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/page-titled.html',
    howToMeetUrl: 'https://www.w3.org/WAI/WCAG22/quickref/#page-titled',
    successCriterionUrl: 'https://www.w3.org/TR/WCAG/#page-titled',
  },
  243: {
    name: 'Focus Order',
    understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/focus-order.html',
    howToMeetUrl: 'https://www.w3.org/WAI/WCAG22/quickref/#focus-order',
    successCriterionUrl: 'https://www.w3.org/TR/WCAG/#focus-order',
  },
  244: {
    name: 'Link Purpose (In Context)',
    understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/link-purpose-in-context.html',
    howToMeetUrl: 'https://www.w3.org/WAI/WCAG22/quickref/#link-purpose-in-context',
    successCriterionUrl: 'https://www.w3.org/TR/WCAG/#link-purpose-in-context',
  },
  245: {
    name: 'Multiple Ways',
    understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/multiple-ways.html',
    howToMeetUrl: 'https://www.w3.org/WAI/WCAG22/quickref/#multiple-ways',
    successCriterionUrl: 'https://www.w3.org/TR/WCAG/#multiple-ways',
  },
  246: {
    name: 'Headings and Labels',
    understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/headings-and-labels.html',
    howToMeetUrl: 'https://www.w3.org/WAI/WCAG22/quickref/#headings-and-labels',
    successCriterionUrl: 'https://www.w3.org/TR/WCAG/#headings-and-labels',
  },
  247: {
    name: 'Focus Visible',
    understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html',
    howToMeetUrl: 'https://www.w3.org/WAI/WCAG22/quickref/#focus-visible',
    successCriterionUrl: 'https://www.w3.org/TR/WCAG/#focus-visible',
  },
  248: {
    name: 'Location',
    understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/location.html',
    howToMeetUrl: 'https://www.w3.org/WAI/WCAG22/quickref/#location',
    successCriterionUrl: 'https://www.w3.org/TR/WCAG/#location',
  },
  249: {
    name: 'Link Purpose (Link Only)',
    understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/link-purpose-link-only.html',
    howToMeetUrl: 'https://www.w3.org/WAI/WCAG22/quickref/#link-purpose-link-only',
    successCriterionUrl: 'https://www.w3.org/TR/WCAG/#link-purpose-link-only',
  },
  2410: {
    name: 'Section Headings',
    understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/section-headings.html',
    howToMeetUrl: 'https://www.w3.org/WAI/WCAG22/quickref/#section-headings',
    successCriterionUrl: 'https://www.w3.org/TR/WCAG/#section-headings',
  },
  2411: {
    name: 'Focus Not Obscured (Minimum)',
    understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html',
    howToMeetUrl: 'https://www.w3.org/WAI/WCAG22/quickref/#focus-not-obscured-minimum',
    successCriterionUrl: 'https://www.w3.org/TR/WCAG/#focus-not-obscured-minimum',
  },
  2412: {
    name: 'Focus Not Obscured (Enhanced)',
    understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-enhanced.html',
    howToMeetUrl: 'https://www.w3.org/WAI/WCAG22/quickref/#focus-not-obscured-enhanced',
    successCriterionUrl: 'https://www.w3.org/TR/WCAG/#focus-not-obscured-enhanced',
  },
  2413: {
    name: 'Focus Appearance',
    understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html',
    howToMeetUrl: 'https://www.w3.org/WAI/WCAG22/quickref/#focus-appearance',
    successCriterionUrl: 'https://www.w3.org/TR/WCAG/#focus-appearance',
  },
  251: {
    name: 'Pointer Gestures',
    understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/pointer-gestures.html',
    howToMeetUrl: 'https://www.w3.org/WAI/WCAG22/quickref/#pointer-gestures',
    successCriterionUrl: 'https://www.w3.org/TR/WCAG/#pointer-gestures',
  },
  252: {
    name: 'Pointer Cancellation',
    understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/pointer-cancellation.html',
    howToMeetUrl: 'https://www.w3.org/WAI/WCAG22/quickref/#pointer-cancellation',
    successCriterionUrl: 'https://www.w3.org/TR/WCAG/#pointer-cancellation',
  },
  253: {
    name: 'Label in Name',
    understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/label-in-name.html',
    howToMeetUrl: 'https://www.w3.org/WAI/WCAG22/quickref/#label-in-name',
    successCriterionUrl: 'https://www.w3.org/TR/WCAG/#label-in-name',
  },
  254: {
    name: 'Motion Actuation',
    understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/motion-actuation.html',
    howToMeetUrl: 'https://www.w3.org/WAI/WCAG22/quickref/#motion-actuation',
    successCriterionUrl: 'https://www.w3.org/TR/WCAG/#motion-actuation',
  },
  255: {
    name: 'Target Size (Enhanced)',
    understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html',
    howToMeetUrl: 'https://www.w3.org/WAI/WCAG22/quickref/#target-size-enhanced',
    successCriterionUrl: 'https://www.w3.org/TR/WCAG/#target-size-enhanced',
  },
  256: {
    name: 'Concurrent Input Mechanisms',
    understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/concurrent-input-mechanisms.html',
    howToMeetUrl: 'https://www.w3.org/WAI/WCAG22/quickref/#concurrent-input-mechanisms',
    successCriterionUrl: 'https://www.w3.org/TR/WCAG/#concurrent-input-mechanisms',
  },
  257: {
    name: 'Dragging Movements',
    understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html',
    howToMeetUrl: 'https://www.w3.org/WAI/WCAG22/quickref/#dragging-movements',
    successCriterionUrl: 'https://www.w3.org/TR/WCAG/#dragging-movements',
  },
  258: {
    name: 'Target Size (Minimum)',
    understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html',
    howToMeetUrl: 'https://www.w3.org/WAI/WCAG22/quickref/#target-size-minimum',
    successCriterionUrl: 'https://www.w3.org/TR/WCAG/#target-size-minimum',
  },
  311: {
    name: 'Language of Page',
    understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/language-of-page.html',
    howToMeetUrl: 'https://www.w3.org/WAI/WCAG22/quickref/#language-of-page',
    successCriterionUrl: 'https://www.w3.org/TR/WCAG/#language-of-page',
  },
  312: {
    name: 'Language of Parts',
    understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/language-of-parts.html',
    howToMeetUrl: 'https://www.w3.org/WAI/WCAG22/quickref/#language-of-parts',
    successCriterionUrl: 'https://www.w3.org/TR/WCAG/#language-of-parts',
  },
  313: {
    name: 'Unusual Words',
    understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/unusual-words.html',
    howToMeetUrl: 'https://www.w3.org/WAI/WCAG22/quickref/#unusual-words',
    successCriterionUrl: 'https://www.w3.org/TR/WCAG/#unusual-words',
  },
  314: {
    name: 'Abbreviations',
    understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/abbreviations.html',
    howToMeetUrl: 'https://www.w3.org/WAI/WCAG22/quickref/#abbreviations',
    successCriterionUrl: 'https://www.w3.org/TR/WCAG/#abbreviations',
  },
  315: {
    name: 'Reading Level',
    understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/reading-level.html',
    howToMeetUrl: 'https://www.w3.org/WAI/WCAG22/quickref/#reading-level',
    successCriterionUrl: 'https://www.w3.org/TR/WCAG/#reading-level',
  },
  316: {
    name: 'Pronunciation',
    understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/pronunciation.html',
    howToMeetUrl: 'https://www.w3.org/WAI/WCAG22/quickref/#pronunciation',
    successCriterionUrl: 'https://www.w3.org/TR/WCAG/#pronunciation',
  },
  321: {
    name: 'On Focus',
    understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/on-focus.html',
    howToMeetUrl: 'https://www.w3.org/WAI/WCAG22/quickref/#on-focus',
    successCriterionUrl: 'https://www.w3.org/TR/WCAG/#on-focus',
  },
  322: {
    name: 'On Input',
    understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/on-input.html',
    howToMeetUrl: 'https://www.w3.org/WAI/WCAG22/quickref/#on-input',
    successCriterionUrl: 'https://www.w3.org/TR/WCAG/#on-input',
  },
  323: {
    name: 'Consistent Navigation',
    understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/consistent-navigation.html',
    howToMeetUrl: 'https://www.w3.org/WAI/WCAG22/quickref/#consistent-navigation',
    successCriterionUrl: 'https://www.w3.org/TR/WCAG/#consistent-navigation',
  },
  324: {
    name: 'Consistent Identification',
    understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/consistent-identification.html',
    howToMeetUrl: 'https://www.w3.org/WAI/WCAG22/quickref/#consistent-identification',
    successCriterionUrl: 'https://www.w3.org/TR/WCAG/#consistent-identification',
  },
  325: {
    name: 'Change on Request',
    understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/change-on-request.html',
    howToMeetUrl: 'https://www.w3.org/WAI/WCAG22/quickref/#change-on-request',
    successCriterionUrl: 'https://www.w3.org/TR/WCAG/#change-on-request',
  },
  326: {
    name: 'Consistent Help',
    understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/consistent-help.html',
    howToMeetUrl: 'https://www.w3.org/WAI/WCAG22/quickref/#consistent-help',
    successCriterionUrl: 'https://www.w3.org/TR/WCAG/#consistent-help',
  },
  331: {
    name: 'Error Identification',
    understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/error-identification.html',
    howToMeetUrl: 'https://www.w3.org/WAI/WCAG22/quickref/#error-identification',
    successCriterionUrl: 'https://www.w3.org/TR/WCAG/#error-identification',
  },
  332: {
    name: 'Labels or Instructions',
    understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/labels-or-instructions.html',
    howToMeetUrl: 'https://www.w3.org/WAI/WCAG22/quickref/#labels-or-instructions',
    successCriterionUrl: 'https://www.w3.org/TR/WCAG/#labels-or-instructions',
  },
  333: {
    name: 'Error Suggestion',
    understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/error-suggestion.html',
    howToMeetUrl: 'https://www.w3.org/WAI/WCAG22/quickref/#error-suggestion',
    successCriterionUrl: 'https://www.w3.org/TR/WCAG/#error-suggestion',
  },
  334: {
    name: 'Error Prevention (Legal, Financial, Data)',
    understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/error-prevention-legal-financial-data.html',
    howToMeetUrl: 'https://www.w3.org/WAI/WCAG22/quickref/#error-prevention-legal-financial-data',
    successCriterionUrl: 'https://www.w3.org/TR/WCAG/#error-prevention-legal-financial-data',
  },
  335: {
    name: 'Help',
    understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/help.html',
    howToMeetUrl: 'https://www.w3.org/WAI/WCAG22/quickref/#help',
    successCriterionUrl: 'https://www.w3.org/TR/WCAG/#help',
  },
  336: {
    name: 'Error Prevention (All)',
    understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/error-prevention-all.html',
    howToMeetUrl: 'https://www.w3.org/WAI/WCAG22/quickref/#error-prevention-all',
    successCriterionUrl: 'https://www.w3.org/TR/WCAG/#error-prevention-all',
  },
  337: {
    name: 'Redundant Entry',
    understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/redundant-entry.html',
    howToMeetUrl: 'https://www.w3.org/WAI/WCAG22/quickref/#redundant-entry',
    successCriterionUrl: 'https://www.w3.org/TR/WCAG/#redundant-entry',
  },
  338: {
    name: 'Accessible Authentication (Minimum)',
    understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/accessible-authentication-minimum.html',
    howToMeetUrl: 'https://www.w3.org/WAI/WCAG22/quickref/#accessible-authentication-minimum',
    successCriterionUrl: 'https://www.w3.org/TR/WCAG/#accessible-authentication-minimum',
  },
  339: {
    name: 'Accessible Authentication (Enhanced)',
    understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/accessible-authentication-enhanced.html',
    howToMeetUrl: 'https://www.w3.org/WAI/WCAG22/quickref/#accessible-authentication-enhanced',
    successCriterionUrl: 'https://www.w3.org/TR/WCAG/#accessible-authentication-enhanced',
  },
  411: {
    name: 'Parsing (Obsolete and removed)',
    understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/parsing.html',
    howToMeetUrl: 'https://www.w3.org/WAI/WCAG22/quickref/#parsing',
    successCriterionUrl: 'https://www.w3.org/TR/WCAG/#parsing',
  },
  412: {
    name: 'Name, Role, Value',
    understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/name-role-value.html',
    howToMeetUrl: 'https://www.w3.org/WAI/WCAG22/quickref/#name-role-value',
    successCriterionUrl: 'https://www.w3.org/TR/WCAG/#name-role-value',
  },
  413: {
    name: 'Status Messages',
    understandingUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html',
    howToMeetUrl: 'https://www.w3.org/WAI/WCAG22/quickref/#status-messages',
    successCriterionUrl: 'https://www.w3.org/TR/WCAG/#status-messages',
  },
};
