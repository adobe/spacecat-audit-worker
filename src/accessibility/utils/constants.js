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

import { Audit } from '@adobe/spacecat-shared-data-access';

/**
 * Accessibility success criteria links for common WCAG issues
 * This file contains standardized links to the WCAG success criteria
 * used in generating reports
 * Used for Enhancing accessibility for the top 10 most-visited pages section,
 * specifically "How to meet" column
 */
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

/**
 * Accessibility issues impact descriptions for common WCAG issues
 * This file contains standardized descriptions of how accessibility issues affect users
 * used in generating reports
 * Used for Enhancing accessibility for the top 10 most-visited pages section,
 * specifically "How is the user affected" column
 */
export const accessibilityIssuesImpact = {
  // Critical impact issues (Level A, typically)
  'aria-required-parent': 'Critical',
  'aria-allowed-attr': 'Critical',
  'aria-required-attr': 'Critical',
  'button-name': 'Critical',
  'image-alt': 'Critical',
  'aria-required-children': 'Critical',
  'aria-valid-attr-value': 'Critical',
  'meta-viewport': 'Critical',
  'select-name': 'Critical',

  // Serious impact issues (Level AA, typically)
  'aria-hidden-focus': 'Serious',
  'nested-interactive': 'Serious',
  dlitem: 'Serious',
  'definition-list': 'Serious',
  'link-name': 'Serious',
  'aria-prohibited-attr': 'Serious',
  'aria-input-field-name': 'Serious',
  'role-img-alt': 'Serious',
  'scrollable-region-focusable': 'Serious',
  'frame-title': 'Serious',
  list: 'Serious',
  'frame-focusable-content': 'Serious',
  'link-in-text-block': 'Serious',
  'aria-command-name': 'Serious',
  'aria-roles': 'Serious',
  'color-contrast': 'Serious',
  'target-size': 'Serious',
};

/**
 * Accessibility solutions for common WCAG issues
 * This file contains standardized solutions for accessibility issues
 * used in generating reports
 * Used for Quick Wins section, specifically "How to solve" column
 */
export const accessibilitySolutions = {
  // Level A - Critical issues
  'aria-required-parent': 'Add appropriate parent containers with required roles (e.g., add `role="listbox"` to parent containers of elements with `role="option"`). ',
  'aria-allowed-attr': 'Remove ARIA attributes (i.e. aria-level="3") from elements that do not support them like `<dt>`.',
  'aria-required-attr': 'Add required ARIA attributes to elements that use ARIA roles.',
  'button-name': 'Add accessible names to buttons using aria-label or visible text content.',
  'image-alt': 'Add alt text to images to provide alternative text for screen readers.',
  'aria-required-children': 'Ensure elements with specific roles contain the required child elements.',
  'aria-valid-attr-value': 'Ensure the value inside each attribute is spelled correctly and corresponds to a valid value.',
  'select-name': 'Add accessible names to select elements using aria-label or visible text content.',

  // Level A - Serious issues
  'aria-hidden-focus': 'Add `tabindex="-1"` to all focusable elements inside containers with `aria-hidden="true"` or remove the aria-hidden attribute.',
  'nested-interactive': 'Remove conflicting interactive roles from elements or restructure to avoid nesting interactive elements.',
  dlitem: 'Ensure `<dt>` and `<dd>` elements are contained within a `<dl>` element.',
  'definition-list': 'Ensure `<dl>` elements contain properly-ordered `<dt>` and `<dd>` groups only.',
  'link-name': 'Add accessible names to links using aria-label or visible text content.',
  'aria-prohibited-attr': 'Remove ARIA attributes that are not permitted on the elements.',
  'aria-input-field-name': 'Add accessible names to ARIA input fields using aria-label or aria-labelledby.',
  'role-img-alt': 'Add aria-label or aria-labelledby to elements with role="img".',
  'scrollable-region-focusable': 'Ensure scrollable regions are keyboard accessible by adding tabindex="0" to the container.',
  'link-in-text-block': 'Add a distinct style to links that appear in blocks of text to make them stand out from the text.',
  listitem: 'Ensure all `<li>` elements are properly contained within `<ul>` or `<ol>` elements, or add `role="list"` to parent containers.',
  'aria-command-name': 'Add accessible names to elements with command roles using aria-label or aria-labelledby attributes.',
  'aria-roles': 'Ensure the main element is properly announced by screen readers.',

  // Level AA - Serious issues
  'color-contrast': 'Ensure text has sufficient contrast against its background (4.5:1 for normal text, 3:1 for large text).',
  'target-size': 'Make touch targets at least 44x44 pixels for better mobile accessibility.',

  // Level AA - Critical issues
  'meta-viewport': 'Remove user-scalable=no from the viewport meta tag to allow zooming.',
};

/**
 * Accessibility suggestions for common WCAG issues
 * This file contains standardized suggestions for accessibility issues
 * used in generating reports
 * Used for Enhancing accessibility for the top 10 most-visited pages section,
 * specifically "Suggestion" column
 */
export const accessibilitySuggestions = {
  // Level A - Critical issues
  'aria-required-parent': 'Add `role="group"` or `role="listbox"` attribute to parents of elements with `role="option"` attribute.',
  'aria-allowed-attr': 'Remove `aria-level` attribute from the HTML elements that do not support it.',
  'aria-required-attr': 'Add `aria-level` attribute to elements that are used as headings.',
  'button-name': 'Add aria-label attributes to buttons that lack text content, especially carousel navigation buttons.',
  'image-alt': 'Ensure all informative `<img>` elements have short, descriptive alternate text and all decorative `<img>` elements have empty alt attributes (e.g. `alt=""`).',
  'aria-required-children': 'Ensure elements with aria-controls attribute has a parent with role like "group".',
  'select-name': 'Add aria-label attribute to select tags that do not have explicit labels.',
  label: 'Add explicit label elements connected to inputs using the for attribute.',
  'aria-valid-attr-value': 'Correct mistakes such as `aria-hidden="rtue"` or `aria-expanded="null"`',

  // Level A - Serious issues
  'aria-hidden-focus': 'Remove `aria-hidden="true"` from elements that contain focusable elements, or ensure all focusable elements within hidden containers also have `tabindex="-1"` if the elements should genuinely be hidden from screen readers.',
  'nested-interactive': 'Remove tabindex="-1".',
  dlitem: 'Ensure `<dt>` and `<dd>` elements are properly contained within a `<dl>` element.',
  'definition-list': 'Restructure the definition list to include only properly-ordered `<dt>` and `<dd>` groups.',
  'link-name': 'Add aria-label attribute to links containing only images or icons without alt text.',
  'aria-prohibited-attr': 'Add `role="figure"` attribute to span elements that contain images.',
  'aria-input-field-name': 'Add `aria-label` attribute to sliders.',
  'role-img-alt': 'Add an accessible name to elements with `role="img"` using `aria-label` or `aria-labelledby` attributes.',
  'scrollable-region-focusable': 'Make scrollable regions keyboard accessible by adding tabindex="0" and ensuring proper focus management.',
  'frame-title': 'Add title attributes to all iframe elements to describe their purpose.',
  listitem: 'Ensure all `<li>` elements are properly contained within `<ul>` or `<ol>` elements, or add role="list" to parent containers.',
  list: 'Ensure list elements only contain permitted child elements.',
  'frame-focusable-content': 'Remove tabindex="-1" attribute from iframe elements that contain interactive content.',
  'link-in-text-block': 'Ensure all links that appear in blocks of text have a color contrast difference of at least 3:1 with the surrounding text to ensure that users who cannot distinguish between the colors can still find the link, or give it a distinct style to make it stand out from the text.',
  'aria-command-name': 'Ensure that each element with `role="link"`, `role="button"`, or `role="menuitem"` has either inner text that is discernible to screen reader users; Non-empty aria-label attribute; or aria-labelledby pointing to element with text which is discernible to screen reader users.',
  'aria-roles': 'Ensure that the main element is properly announced by screen readers.',

  // Level AA - Serious issues
  'color-contrast': 'Increase the contrast between the button text and background colors. Ensure a minimum contrast ratio of 4.5:1 for normal text and 3:1 for large text (at least 18pt or 14pt bold).',
  'target-size': 'Increase the size of the search button to at least 24x24 pixels (WCAG AA recommendation) to make it easier to tap on mobile devices',

  // Level AA - Critical issues
  'meta-viewport': 'Remove `user-scalable=no` from the viewport meta tag to allow users to zoom the page.',
};

/**
 * Accessibility user impact descriptions for common WCAG issues
 * This file contains standardized descriptions of how accessibility issues affect users
 * used in generating reports
 * Used for Enhancing accessibility for the top 10 most-visited pages section,
 * specifically "How is the user affected" column
 */
export const accessibilityUserImpact = {
  // Level A - Critical issues
  'aria-required-parent': 'Screen reader users receive incomplete or incorrect information about content organization. When elements require specific parent roles but don\'t have them, the hierarchical relationship is broken, making navigation confusing and unpredictable.',
  'aria-allowed-attr': 'Screen reader users receive misleading or nonsensical information when elements use ARIA attributes they don\'t support. This causes confusion when the announced content doesn\'t match the expected behavior of the element.',
  'aria-required-attr': 'Screen reader users receive incomplete information about an element\'s purpose or state when required ARIA attributes are missing. This prevents users from understanding how to interact with elements or their current state.',
  'button-name': 'Screen reader users cannot determine the purpose of buttons without discernible text. When encountering unnamed buttons, users must guess their function based on context, making interfaces unpredictable and potentially unusable.',
  'image-alt': 'Screen reader users receive no information about images without alternative text. Important visual content becomes completely inaccessible, leaving users with significant information gaps.',
  'aria-required-children': 'Screen reader users receive incomplete information about content structure when ARIA roles requiring specific children lack those children. This breaks expected relationships and makes navigation unpredictable.',
  'aria-valid-attr-value': 'Screen readers or keyboard navigation relys on the value of the attribute to determine the purpose of the element. If the value is incorrect, the user will not be able to interact with the element and will lead to loss of content context and navigational issues.',

  // Level A - Serious issues
  'aria-hidden-focus': 'Keyboard and screen reader users experience confusing interfaces when elements hidden from screen readers (aria-hidden="true") remain focusable. Users can focus on elements they cannot perceive, creating a disconnected experience where their cursor appears to "disappear".',
  'nested-interactive': 'Screen reader and keyboard users face accessibility barriers when interactive controls are nested within other interactive elements. This creates unpredictable behavior, incomplete announcements, and potentially unusable features that trap or skip focus.',
  dlitem: 'Screen reader users receive incomplete or incorrect information about definition terms and their descriptions when list items are not properly contained in a definition list. This breaks the semantic connection between terms and their definitions.',
  'definition-list': 'Screen reader users receive incomplete or incorrect information about content relationships in definition lists when they\'re improperly structured. This breaks the semantic connection between terms and their definitions.',
  'link-name': 'Screen reader users cannot determine the destination or purpose of links without discernible text. This forces users to follow links without knowing where they lead or skip potentially important content.',
  'aria-prohibited-attr': 'Screen reader users receive contradictory or misleading information when elements use ARIA attributes that are explicitly forbidden on those elements. This creates confusion and unpredictable behavior.',
  'aria-input-field-name': 'Screen reader users cannot identify the purpose of input fields without accessible names. When encountering unnamed fields, users must guess their purpose, making forms difficult or impossible to complete accurately.',
  'role-img-alt': 'Screen reader users receive no information about elements with role="img" that lack alternative text. This makes visual content completely inaccessible, similar to images without alt text.',
  'scrollable-region-focusable': 'Keyboard users cannot access content in scrollable regions that aren\'t keyboard accessible. Content becomes completely inaccessible if it can only be reached by scrolling with a mouse.',
  list: 'Users who navigate using keyboards or other assistive devices might struggle to move through improperly structured lists. Properly marked-up lists allow users to navigate efficiently from one list item to the next.',
  listitem: 'Screen reader users receive incorrect or incomplete information about list structures, making content organization difficult to understand.',
  'frame-title': 'Screen reader users cannot determine the purpose of iframes without titles, making it difficult to understand embedded content.',
  label: 'Users who navigate using keyboards or other assistive devices might struggle to identify and interact with unlabeled form elements. Proper labels help users quickly identify and interact with the correct fields, improving their overall experience.',
  'select-name': 'If a `<select>` element does not have a proper accessible name, users may not understand its purpose. Screen readers might announce it as "combo box" or "list box" without providing any context, making it difficult for users to know what options they are selecting from.',
  'frame-focusable-content': 'Screen reader and keyboard users cannot access content inside frames that aren\'t properly configured for keyboard navigation. This creates barriers where users can see that content exists but cannot reach or interact with it, making portions of the page completely unusable.',
  'link-in-text-block': 'Users with visual disabilities or cognitive impairments struggle to identify links that aren\'t visually distinct from surrounding text. When links blend in with regular text, they become invisible to many users who cannot distinguish them by color alone, causing important interactive elements to be missed.',
  'aria-command-name': 'Screen reader users are not able to discern the purpose of elements with `role="link"`, `role="button"`, or `role="menuitem"` that do not have an accessible name.',
  'aria-roles': 'Screen reader users receive incorrect or incomplete information about the structure of a webpage. When the main element is not properly announced, users may not understand the overall layout or navigation, making it difficult to find and interact with important content.',

  // Level AA - Serious issues
  'color-contrast': 'Users with low vision, color blindness, or those in high-glare environments struggle to read text with insufficient contrast. This causes eye strain and can make content completely unreadable for some users.',
  'target-size': 'Users with motor impairments struggle to interact with touch targets smaller than 24px. Small buttons or links are difficult to tap accurately, causing frustration, accidental activations, and preventing successful task completion.',

  // Level AA - Critical issues
  'meta-viewport': 'Users who need to zoom webpages for better visibility cannot do so when zooming is disabled. This makes content completely inaccessible for users with low vision who rely on zoom functionality.',
};

export const accessibilityOpportunitiesMap = {
  'a11y-assistive': [
    'aria-hidden-focus',
    'aria-allowed-attr',
    'aria-required-attr',
    'aria-prohibited-attr',
    'aria-roles',
    'aria-valid-attr-value',
    'aria-required-parent',
    'button-name',
    'link-name',
    'select-name',
  ],
};

/**
 * Accessibility issue types that should be sent to Mystique for remediation guidance
 */
export const issueTypesForMystique = [
  'aria-allowed-attr',
  'aria-prohibited-attr',
  'aria-roles',
  'aria-hidden-focus',
  'aria-required-attr',
  'aria-valid-attr-value',
  'button-name',
  'link-name',
  'select-name',
  'aria-required-parent',
];

/**
 * WCAG 2.2 Success Criteria Counts
 * These constants define the total number of success criteria being tested
 * at different conformance levels
 */
export const WCAG_CRITERIA_COUNTS = {
  LEVEL_A: 30,
  LEVEL_AA: 20,
  get TOTAL() {
    return this.LEVEL_A + this.LEVEL_AA;
  },
};

/**
 * Separator used to create composite keys for URLs with source identifiers
 * This allows tracking issues from different sources (forms, specific elements, etc.)
 * Format: {siteUrl}{URL_SOURCE_SEPARATOR}{sourceIdentifier}
 * Example: https://example.com/contact?source=contact-form (form source)
 * Future: Could be used for other sources like specific sections, components, etc.
 */
export const URL_SOURCE_SEPARATOR = '?source=';

/**
 * Prefixes for different audit types
 */
export const AUDIT_PREFIXES = {
  [Audit.AUDIT_TYPES.ACCESSIBILITY]: {
    logIdentifier: 'A11yAudit',
    storagePrefix: 'accessibility',
  },
  [Audit.AUDIT_TYPES.FORMS_OPPORTUNITIES]: {
    logIdentifier: 'FormsA11yAudit',
    storagePrefix: 'forms-accessibility',
  },
};

export const A11Y_METRICS_AGGREGATOR_IMPORT_TYPE = 'a11y-metrics-aggregator';
