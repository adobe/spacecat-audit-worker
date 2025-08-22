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
   'airindia.com': [
    {
      name: 'Booking & Search',
      regex: '^/(book(-flights)?|booking|search|multicity-booking|group-travel|plan(-and-book)?|google-flight-booking|exclusive-deals.*|special-offers.*|add-ons.*|fly-the-all-new-air-india).*',
    },
    {
      name: 'Manage Booking / Check-in / Refund / Flight Status',
      regex: '^/(manage.*|web-check-in.*|check-?in.*|view-ticket.*|pnr-status.*|refund.*|refund-and-cancellation|refund-policy|request-refund.*|manage-add-baggage.*|manage-my-booking.*|plan-and-book/manage-booking.*|booking.*|flight-status.*|optional-services.*|booked-itinerary.*|booked/my-booking.*|delayed-damaged-baggage.*).*',
    },
    {
      name: 'Baggage & Travel Information',
      regex: '^/(baggage.*|checked-baggage.*|cabin-baggage.*|excess-baggage.*|travel-info.*|travel-information.*|first-time-flyers.*|personal-cargo.*|track-shipment.*|shipment-enquiry.*|health-medical-assistance.*|visa-documents.*|visa-services.*|airport-information.*).*',
    },
    {
      name: 'Offers & Promotions',
      regex: '^/(offers.*|special-offers.*|exclusive-deals.*|namaste-world-sale.*|student-(fares|discount|offer|flight-offer).*|smart-fares.*|armed-forces.*|hdfc-bank.*|tata-employees.*|group-flight-offer.*|india-flight-discount.*|better-non-stop.*|netbanking-payments-offer.*).*',
    },
    {
      name: 'Flying Returns / Loyalty Programs',
      regex: '^/(flying-returns.*|flyingreturns.*|frequent-flyer.*|maharaja-club.*|FrequentFlyerLogin.*|loyalty-tier-status-upgrade).*',
    },
    {
      name: 'News & Press Releases',
      regex: '^/(newsroom.*|press-release.*|press-releases.*|press-releases-archive.*|fly-air-india/press-releases.*|content/dam/air-india/newsroom/.*|topics/.*|articles/.*).*',
    },
    {
      name: 'Support & Contact',
      regex: '^/(contact.*|customer-support.*|feedback.*|complaints.*|lost-and-found.*|grievance.*|help/customer-support.*).*',
    },
    {
      name: 'Legal / Policy',
      regex: '^/(terms.*|evoucher-terms.*|vouchers-terms.*|refund-policy.*|passenger-rights.*|eu-claim-form.*).*',
    },
    {
      name: 'Corporate / Investor / Careers',
      regex: '^/(careers.*|business-solutions.*|corporate-information.*|investor-relations.*|annual-report.*|about-air-india.*|about-us.*|our-history.*|vihaan-ai-transformation).*',
    },
    {
      name: 'Cargo & Products',
      regex: '^/(air-india-cargo.*|products.*|personal-cargo.*|courier.*|dangerous-goods.*).*',
    },
    {
      name: 'Pilot Training / Courses',
      regex: '^/(trainee-pilot.*|cadetpilot.*|training.*|course-details.*).*',
    },
  ],
'adobe.com': [
    {
      name: 'Acrobat',
      regex: '(?!.*blog|.*learn)(/?acrobat.|/?acrobat/|/?products/acrobat)',
    },
    {
      name: 'Firefly',
      regex: '(?!.*blog|.*learn)(/products/firefly|/ai/.*firefly)',
    },
    {
      name: 'Express',
      regex: '(?!.*blog|.*learn)(/?express)',
    },
    {
      name: 'Creative Cloud',
      regex: '(?!.*blog|.*learn)(/?creativecloud)',
    },
  ],
  'business.adobe.com': [
    {
      regex: '^(?!/blog|/learn).*?/products/([^/.]+)',
    },
  ],
  'wilson.com': [
    {
      name: 'Tennis Rackets',
      regex: '^/(?:[a-z]{2}-[a-z]{2}/)?(?!.*blog|.*explore)(?:product/(?:blade|pro-staff|clash|ultra|burn|shift|tour-slam)|tennis/(?:tennis-rackets|collections))',
    },
    {
      name: 'Tennis Shoes',
      regex: '^/(?:[a-z]{2}-[a-z]{2}/)?(?!.*blog|.*explore)(?:product|shoes)/(?:intrigue|tour-slam)',
    },
    {
      name: 'Basketball',
      regex: '^/(?:[a-z]{2}-[a-z]{2}/)?(?!.*blog|.*explore)basketball',
    },
    {
      name: 'Golf',
      regex: '^/(?:[a-z]{2}-[a-z]{2}/)?(?!.*blog|.*explore)golf',
    },
    {
      name: 'Baseball',
      regex: '^/(?:[a-z]{2}-[a-z]{2}/)?(?!.*blog|.*explore)baseball',
    },
    {
      name: 'Padel',
      regex: '^/(?:[a-z]{2}-[a-z]{2}/)?(?!.*blog|.*explore)padel',
    },
    {
      name: 'Football',
      regex: '^/(?:[a-z]{2}-[a-z]{2}/)?(?!.*blog|.*explore)football',
    },
    {
      name: 'Volleyball',
      regex: '^/(?:[a-z]{2}-[a-z]{2}/)?(?!.*blog|.*explore)volleyball',
    },
  ],
};
