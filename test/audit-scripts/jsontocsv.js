/* eslint-disable */
import { createObjectCsvWriter } from 'csv-writer';

const seoData = {
  "title": {
    "length_check_fail_tags": [
      {
        "tagContent": "Bulk™ | Affiliates",
        "url": "/uk/affiliates/"
      },
      {
        "tagContent": "Bulk™ Reviews",
        "url": "/uk/bulk-reviews/"
      },
      {
        "tagContent": "Bulk™️ | Returns",
        "url": "/uk/clothing-returns/"
      },
      {
        "tagContent": "Millions®",
        "url": "/uk/millions/"
      },
      {
        "tagContent": "Diet Noodles | Bulk™ UK",
        "url": "/uk/products/diet-noodles/bpf-dnoo/"
      },
      {
        "tagContent": "Refer a friend",
        "url": "/uk/referafriend/"
      },
      {
        "tagContent": "bulk first logo | Bulk™",
        "url": "/uk/the-core/16-things-you-didnt-know-about-bulk/bulk-first-logo/"
      },
      {
        "tagContent": "Today’s Offers | Bulk™",
        "url": "/uk/todays-offers/"
      }
    ]
  },
  "description": {
    "length_check_fail_tags": [
      {
        "tagContent": "Bulk™️ | Returns",
        "url": "/uk/clothing-returns/"
      },
      {
        "tagContent": "Shop high quality Zero Calorie Foods at unbeatable prices. Craving sweet or sour? Choose from our selection of syrups and sauces. Add flavour to your food with no calories! Bulk™",
        "url": "/uk/foods/zero-calorie-foods/"
      },
      {
        "tagContent": "Explore our selection of Diet Shakes & Supplements for weight management. Designed to mantain your macros with low calories. Enjoy high quality at low prices with FREE delivery.",
        "url": "/uk/health-wellbeing/high-fibre-supplements/"
      },
      {
        "tagContent": "Shop our range of high quality Vitamins and Minerals at low prices. You can find them in capsules, powder or spray. Suitable for any fitness goal or to maintain a healthy lifestyle. Bulk™",
        "url": "/uk/health-wellbeing/multivitamins/"
      },
      {
        "tagContent": "Beef Jerky from Bulk™ gives a massive 60g protein per pack! We have sourced the highest quality and best tasting topside Beef Jerky we could find in the UK. Bulk, formerly Bulk Powders.",
        "url": "/uk/products/beef-jerky/bpf-bjer/"
      },
      {
        "tagContent": "Buy Hydrolysed Beef Protein Isolate Powder (HydroBEEF) containing a massive 97% protein - this high quality Beef Isolate has an impressive amino acid profile and is perfect for building lean mass. Bulk, formerly Bulk Powders.",
        "url": "/uk/products/beef-protein-isolate-97-hydrobeef/bpb-hbee-0000/"
      },
      {
        "tagContent": "Caffeine Tablets provide excellent value for money, not only because they are low cost, but because they really work. Caffeine Tablets act as a powerful stimulant. Bulk, formerly Bulk Powders.",
        "url": "/uk/products/caffeine-tablets/bpb-caff-t000/"
      },
      {
        "tagContent": "Buy our smooth and velvety Collagen Hot Chocolate, offering 20g of protein per cup. The perfect winter warmer and ideal post-workout or pre-bedtime snack. Bulk, formerly Bulk Powders.",
        "url": "/uk/products/collagen-hot-chocolate/bpf-phot/"
      },
      {
        "tagContent": "A combination of hydrolysed collagen peptides & ascorbic acid, Collagen & Vitamin C is a powdered protein supplement free from fat, saturated fat & sugar. Bulk, formerly Bulk Powders.",
        "url": "/uk/products/collagen-vitamin-c/bpb-coll-vitc/"
      },
      {
        "tagContent": "Complete Greens™ from Bulk™ contains a massive 24 nutrient dense super foods. This high quality super greens powder is unrivalled in terms of quality and efficacy. Bulk, formerly Bulk Powders.",
        "url": "/uk/products/complete-greens/bble-cgre/"
      },
      {
        "tagContent": "Containing Whey &amp; Milk Protein, plus added Glutamine and Instant Oats, Complete Lean Mass™ provides an optimal 1:1 ratio of protein to carbohydrate. Bulk, formerly Bulk Powders.",
        "url": "/uk/products/complete-lean-mass-gainer/bble-clma/"
      },
      {
        "tagContent": "This Complete Multivitamin Complex™ Powder provides over 30 vitamins, minerals, antioxidants, probiotics, fruit and plant extracts only from highly bioavailable sources. Bulk, formerly Bulk Powders.",
        "url": "/uk/products/complete-multivitamin-complex-powder/bble-cmvc-powd/"
      },
      {
        "tagContent": "Complete Nootropic is the most advanced cognitive brain supplement in the UK with 17 ingredients. Improves concentration and alertness when feeling tired. Bulk, formerly Bulk Powders.",
        "url": "/uk/products/complete-nootropic/bble-noot/"
      },
      {
        "tagContent": "Buy Creapure German Creatine at the UK's cheapest price from bulk.com. Bulk, formerly Bulk Powders.",
        "url": "/uk/products/creapure-creatine-monohydrate/bpb-crea-0000/"
      },
      {
        "tagContent": "CUTTING EDGE™ is the strongest fat burner and fat loss supplement in the UK. CUTTING EDGE™ will contains only proven ingredients in powerful dosages. Bulk, formerly Bulk Powders.",
        "url": "/uk/products/cutting-edge/bpps-cedg/"
      },
      {
        "tagContent": "Buy our Diet Udon noodles to support weight loss goals. Containing Glucomannan, they offer a nutritious alternative to traditional noodles. Bulk, formerly Bulk Powder Bulk, formerly Bulk Powders.",
        "url": "/uk/products/diet-noodles/bpf-dnoo/"
      },
      {
        "tagContent": "Buy Essential Mass Gainer, a more cost-effective alternative to our popular range of mass gainers. A quality mass gainer at an extraordinary price. Bulk, formerly Bulk Powders.",
        "url": "/uk/products/essential-mass-gainer/bble-emas/"
      },
      {
        "tagContent": "High Protein Biltong is manufactured exclusively for Bulk™ and contains a massive 53g protein per 100g bag. This Biltong is made from the equivalent of 250g Silverside Beef. Bulk, formerly Bulk Powders.",
        "url": "/uk/products/high-protein-biltong/bpf-bilt/"
      },
      {
        "tagContent": "Buy 100% pure Inositol Powder at the UK's lowest price. Bulk™ Inositol Powder has benefits in relation to mood, concentration, cognition and weight loss. Bulk, formerly Bulk Powders.",
        "url": "/uk/products/inositol/bpb-inos-0000/"
      },
      {
        "tagContent": "Buy our Lion’s Mane Capsules, an increasingly popular nootropic mushroom. Enhance your focus, memory, and mental clarity with this all-round brain-booster! Bulk, formerly Bulk Powders.",
        "url": "/uk/products/lions-mane-capsules/bpb-lman-0500/"
      },
      {
        "tagContent": "Bulk™ LiquiFlav™ is the UK's best liquid flavouring system. It can be used to flavour anything from protein to water. Containing up to 200 servings per bottle. Bulk, formerly Bulk Powders.",
        "url": "/uk/products/liquiflav/bp-liqu-50ml/"
      },
      {
        "tagContent": "Buy Micellar Casein protein - with a market-leading 85% protein, this Micellar Casein is slow-release protein shake that is rich in BCAA & L Glutamine. Bulk, formerly Bulk Powders.",
        "url": "/uk/products/micellar-casein/bpb-mpi9-0000/"
      },
      {
        "tagContent": "Shop our powerful Mushroom Complex supplement, providing 500mg of mushroom extract to help support health and wellbeing. Vegetarian and vegan friendly. Bulk, formerly Bulk Powders.",
        "url": "/uk/products/mushroom-complex-capsules/bble-mush/"
      },
      {
        "tagContent": "Natural Pure Whey Isolate™ 90 from Bulk™. This all natural protein powder uses Stevia sweetener and delivers an impressive 26g pure protein per serving. Bulk, formerly Bulk Powders.",
        "url": "/uk/products/natural-pure-whey-isolate-90/bpb-npwi/"
      },
      {
        "tagContent": "Pistachio Butter is a delicious high protein food sold in the UK by bulk™. Find great deals on this all natural source of protein and healthy fats. Bulk, formerly Bulk Powders.",
        "url": "/uk/products/pistachio-butter/bpf-pisb/"
      },
      {
        "tagContent": "Buy Super Pea Protein Isolate from Bulk™. This popular plant based vegan protein powder provides 80g protein per 100g, with minimal fat and carbohydrate content. Bulk, formerly Bulk Powders.",
        "url": "/uk/products/super-pea-protein-isolate/bpb-sppi-0000/"
      },
      {
        "tagContent": "Buy Ultra Fine Scottish Oats which is a 100% pure source of this high fibre, muscle building carbohydrate powder and exclusively available from Bulk™. Bulk, formerly Bulk Powders.",
        "url": "/uk/products/ultra-fine-scottish-oats/bpb-oats-0000/"
      },
      {
        "tagContent": "Buy our Vegan Collagen, expertly formulated with VeCollal® - the world’s first plant-based alternative, which is identical to human type 1 collagen. Bulk, formerly Bulk Powders.",
        "url": "/uk/products/vegan-collagen/vser-vcol/"
      },
      {
        "tagContent": "<span style=\"color: rgb(0, 0, 0); font-family: Arial; white-space-collapse: preserve;\">Upgrade to Bulk™ Vegan Protein Powder! Our refined blend features 27g of protein per serving, now smoother and tastier. Bulk, formerly Bulk Powders.</span>",
        "url": "/uk/products/vegan-protein-powder/vser-vppo/"
      },
      {
        "tagContent": "Buy VitaFiber™ Powder. This high fibre sugar substitute is great for use in baking sugar free recipes as well as being a natural sweetener for food and drinks. Bulk, formerly Bulk Powders.",
        "url": "/uk/products/vitafiber-powder/bpb-vfib-0000/"
      },
      {
        "tagContent": "Buy our Zero Calorie barista style coffee syrup which is perfect to add into hot drinks for that added sweetness with zero sugar and zero calories. Bulk, formerly Bulk Powders.",
        "url": "/uk/products/zero-calorie-barista-syrup/bpf-zcbs/"
      },
      {
        "tagContent": "Zero Calorie Syrup™ is a delicious and convenient syrup that can be used by all - no matter what your goal. They are free from sugar, fat and calories. Bulk, formerly Bulk Powders.",
        "url": "/uk/products/zero-calorie-syrup/bpf-zcsy/"
      },
      {
        "tagContent": "Explore Collagen Supplements from Bulk™ to support healthy skin and joints. Try our Collagen Protein Powder for a premium source of protein in your routine. Bulk, formerly Bulk Powders.",
        "url": "/uk/protein/collagen/"
      },
      {
        "tagContent": "Boost your gains with our Mass Gainer Protein range. From high-calorie powders to vegan options, find top-rated Weight Gainer Shakes or Beef Jerky at Bulk™. Bulk, formerly Bulk Powders.",
        "url": "/uk/protein/mass-gainers/"
      },
      {
        "tagContent": "Shop our premium Protein Powder, including Whey and Vegan Protein, for top-quality Protein Shakes. Perfect for muscle growth and recovery at Bulk™. Bulk, formerly Bulk Powders.",
        "url": "/uk/protein/"
      },
      {
        "tagContent": "Shop our wide range of high quality Unflavoured Protein Powders at low prices. If you need a versatile way to add protein to your smoothie the unflavour protein are the one for you. Bulk™",
        "url": "/uk/protein/unflavoured-protein/"
      },
      {
        "tagContent": "Shop premium Whey Protein Powder and Whey Isolate Protein Powder for muscle growth and recovery. Fuel your fitness with high-quality protein from Bulk™. Bulk, formerly Bulk Powders.",
        "url": "/uk/protein/whey-protein/"
      },
      {
        "tagContent": "Shop our wide range of high quality Branched aminoacids (BCAA) Supplements at low prices. Find them in powder or tablets. Suitable for any fitness goal. FREE UK delivery. Bulk™",
        "url": "/uk/sports-nutrition/amino-acids/bcaa/"
      },
      {
        "tagContent": "Fuel your training with Bulk™ Pre Workout Powder. Boost energy, focus, and performance with our potent pre workout supplements. Maximise your fitness goals! Bulk, formerly Bulk Powders.",
        "url": "/uk/sports-nutrition/pre-workout/"
      },
      {
        "tagContent": "Grow your calf muscles with three expertly picked easy and effective exercises.",
        "url": "/uk/the-core/3-killer-exercises-build-calf-muscles/"
      },
      {
        "tagContent": "Looking to find out more about cod liver oil, and how it can help you? Our expertly-written guide runs through the benefits, ideal dosage and side effects, giving you all the information you need to get started with this supplement!",
        "url": "/uk/the-core/cod-liver-oil-benefits-dosage-side-effects/"
      },
      {
        "tagContent": "the best leg day workouts, leg exercises and routines. ",
        "url": "/uk/the-core/leg-day-workout/"
      },
      {
        "tagContent": "Target your Teres Minor and Teres Major muscles with this selection of effective exercises.",
        "url": "/uk/the-core/target-teres-minor-major/"
      },
      {
        "tagContent": "Boost your health with our range of Vitamins and Minerals. Explore Vitamin Tablets and vegan supplements designed to support your wellness goals with Bulk™. Bulk, formerly Bulk Powders.",
        "url": "/uk/vitamins/"
      },
      {
        "tagContent": "Explore our selection of Diet Shakes & Supplements for weight management. Designed to mantain your macros with low calories. Enjoy high quality at low prices with FREE delivery.",
        "url": "/uk/weight-loss/"
      }
    ],
    "missing_tags": {
      "pageUrls": [
        "/uk/referafriend/",
        "/uk/the-core/16-things-you-didnt-know-about-bulk/bulk-first-logo/",
        "/uk/the-core/best-bulking-foods/",
        "/uk/the-core/deadlift-muscles-worked/",
        "/uk/the-core/diet-for-muscle-gain/",
        "/uk/the-core/how-long-does-pre-workout-last/",
        "/uk/the-core/should-you-eat-a-protein-bar-before-or-after-a-workout/",
        "/uk/the-core/when-to-take-ashwagandha/",
        "/uk/the-core/whey-protein-vs-mass-gainer/",
        "/uk/the-core/why-does-pre-workout-make-you-itch/"
      ]
    },
    "duplicate_tags": [
      {
        "tagContent": "Bulk™ is the leading supplier of bodybuilding supplements &amp; sports nutrition – covering Protein, Creatine, Vitamins, Fat Loss &amp; more! Formerly Bulk Powders.",
        "pageUrls": [
          "/uk/about/",
          "/uk/bulk-reviews/",
          "/uk/",
          "/uk/student-discount/"
        ]
      },
      {
        "tagContent": "Explore our selection of Diet Shakes & Supplements for weight management. Designed to mantain your macros with low calories. Enjoy high quality at low prices with FREE delivery.",
        "pageUrls": [
          "/uk/health-wellbeing/high-fibre-supplements/",
          "/uk/weight-loss/"
        ]
      },
      {
        "tagContent": "Try our low calorie sauces which are packed with flavour and are ideal to add into your food. Bulk, formerly Bulk Powders.",
        "pageUrls": [
          "/uk/products/low-calorie-sauces/bpf-lcsa/",
          "/uk/products/nutritional-yeast/bpf-nyea/"
        ]
      }
    ],
    "empty_tags": {
      "pageUrls": [
        "/uk/millions/",
        "/uk/todays-offers/"
      ]
    }
  },
  "h1": {
    "multiple_h1_count": [
      {
        "tagContent": "[\"THIS IS BULK™\",\"BULK™ STORY\",\"CHANGE NUTRITION, CHANGE THE GAME.CHANGE ATTITUDES, CHANGE LIVES.\"]",
        "pageUrl": "/uk/about/"
      },
      {
        "tagContent": "[\"Gym Bags & Backpacks\",\"Gym Bags & Backpacks(3 of 3)\"]",
        "pageUrl": "/uk/accessories-clothing/bags-backpacks/"
      },
      {
        "tagContent": "[\"Empty Capsules\",\"Empty Capsules(1 of 1)\"]",
        "pageUrl": "/uk/accessories-clothing/empty-capsules/"
      },
      {
        "tagContent": "[\"Protein Shakers & Bottles\",\"Protein Shakers & Bottles(12 of 12)\"]",
        "pageUrl": "/uk/accessories-clothing/shaker-bottles/"
      },
      {
        "tagContent": "[\"T-Shirts & Tops\",\"T-Shirts & Tops(1 of 1)\"]",
        "pageUrl": "/uk/accessories-clothing/t-shirts-tops/"
      },
      {
        "tagContent": "[\"BLACK FRIDAY SALE\",\"BLACK FRIDAY SALE(0 of 0)\"]",
        "pageUrl": "/uk/black-friday-sale/"
      },
      {
        "tagContent": "[\"Breakfast\",\"Breakfast(20 of 23)\"]",
        "pageUrl": "/uk/foods/breakfast/"
      },
      {
        "tagContent": "[\"Zero Calorie Foods\",\"Zero Calorie Foods(9 of 9)\"]",
        "pageUrl": "/uk/foods/zero-calorie-foods/"
      },
      {
        "tagContent": "[\"Greens Supplements\",\"Greens Supplements(8 of 8)\"]",
        "pageUrl": "/uk/health-wellbeing/greens-supplements/"
      },
      {
        "tagContent": "[\"High Fibre Supplements\",\"High Fibre Supplements(16 of 16)\"]",
        "pageUrl": "/uk/health-wellbeing/high-fibre-supplements/"
      },
      {
        "tagContent": "[\"Multivitamins\",\"Multivitamins(9 of 9)\"]",
        "pageUrl": "/uk/health-wellbeing/multivitamins/"
      },
      {
        "tagContent": "[\"Millions®\",\"Millions®(4 of 4)\"]",
        "pageUrl": "/uk/millions/"
      },
      {
        "tagContent": "[\"1kg Protein Powders\",\"1kg Protein Powders(20 of 58)\"]",
        "pageUrl": "/uk/protein/1kg-protein-powders/"
      },
      {
        "tagContent": "[\"5kg Protein Powders\",\"5kg Protein Powders(20 of 31)\"]",
        "pageUrl": "/uk/protein/5kg-protein-powders/"
      },
      {
        "tagContent": "[\"Chocolate Protein Powders & Shakes\",\"Chocolate Protein Powders & Shakes(20 of 23)\"]",
        "pageUrl": "/uk/protein/chocolate-protein-powders/"
      },
      {
        "tagContent": "[\"Collagen Supplements\",\"Collagen Supplements(7 of 7)\"]",
        "pageUrl": "/uk/protein/collagen/"
      },
      {
        "tagContent": "[\"Cookie Protein Powders & Shakes\",\"Cookie Protein Powders & Shakes(6 of 6)\"]",
        "pageUrl": "/uk/protein/cookie-protein-powders/"
      },
      {
        "tagContent": "[\"Egg Protein\",\"Egg Protein(6 of 6)\"]",
        "pageUrl": "/uk/protein/egg-protein/"
      },
      {
        "tagContent": "[\"Mass Gainer Protein\",\"Mass Gainer Protein(12 of 12)\"]",
        "pageUrl": "/uk/protein/mass-gainers/"
      },
      {
        "tagContent": "[\"Natural Protein\",\"Natural Protein(20 of 22)\"]",
        "pageUrl": "/uk/protein/natural-protein/"
      },
      {
        "tagContent": "[\"Peanut Protein Powders & Shakes\",\"Peanut Protein Powders & Shakes(8 of 8)\"]",
        "pageUrl": "/uk/protein/peanut-protein-powders/"
      },
      {
        "tagContent": "[\"Protein Bars\",\"Protein Bars(8 of 8)\"]",
        "pageUrl": "/uk/protein/protein-bars/"
      },
      {
        "tagContent": "[\"Protein Powder\",\"Protein Powder(20 of 116)\"]",
        "pageUrl": "/uk/protein/"
      },
      {
        "tagContent": "[\"Strawberry Protein Powders & Shakes\",\"Strawberry Protein Powders & Shakes(20 of 26)\"]",
        "pageUrl": "/uk/protein/strawberry-protein-powders/"
      },
      {
        "tagContent": "[\"Vanilla Protein Powders & Shakes\",\"Vanilla Protein Powders & Shakes(20 of 21)\"]",
        "pageUrl": "/uk/protein/vanilla-protein-powders/"
      },
      {
        "tagContent": "[\"Vegan Protein\",\"Vegan Protein(20 of 25)\"]",
        "pageUrl": "/uk/protein/vegan-protein/"
      },
      {
        "tagContent": "[\"All in One Protein Supplements\",\"All in One Protein Supplements(9 of 9)\"]",
        "pageUrl": "/uk/sports-nutrition/all-in-one-supplements/"
      },
      {
        "tagContent": "[\"BCAA Supplements\",\"BCAA Supplements(7 of 7)\"]",
        "pageUrl": "/uk/sports-nutrition/amino-acids/bcaa/"
      },
      {
        "tagContent": "[\"Carbohydrate Supplements\",\"Carbohydrate Supplements(16 of 16)\"]",
        "pageUrl": "/uk/sports-nutrition/carbohydrates/"
      },
      {
        "tagContent": "[\"Creatine Supplements\",\"Creatine Supplements(12 of 12)\"]",
        "pageUrl": "/uk/sports-nutrition/creatine/"
      },
      {
        "tagContent": "[\"Hydration Supplements\",\"Hydration Supplements(13 of 13)\"]",
        "pageUrl": "/uk/sports-nutrition/endurance-hydration/"
      },
      {
        "tagContent": "[\"Protein Drinks\",\"Protein Drinks(14 of 14)\"]",
        "pageUrl": "/uk/sports-nutrition/post-workout/protein-drinks/"
      },
      {
        "tagContent": "[\"Nitric Oxide & Pump\",\"Nitric Oxide & Pump(13 of 13)\"]",
        "pageUrl": "/uk/sports-nutrition/pre-workout/nitric-oxide-pump/"
      },
      {
        "tagContent": "[\"Pre Workout\",\"Pre Workout(20 of 47)\"]",
        "pageUrl": "/uk/sports-nutrition/pre-workout/"
      },
      {
        "tagContent": "[\"How to Target the Teres Minor & Major\",\"Teres Minor & Teres Major: How To Target These Muscles And Why\"]",
        "pageUrl": "/uk/the-core/target-teres-minor-major/"
      },
      {
        "tagContent": "[\"Offers\",\"Offers\"]",
        "pageUrl": "/uk/todays-offers/"
      },
      {
        "tagContent": "[\"Vegan\",\"Vegan(20 of 134)\"]",
        "pageUrl": "/uk/vegan/"
      },
      {
        "tagContent": "[\"Vegan Protein\",\"Vegan Protein(11 of 11)\"]",
        "pageUrl": "/uk/vegan/vegan-protein-powders/"
      },
      {
        "tagContent": "[\"Magnesium Supplements\",\"Magnesium Supplements\"]",
        "pageUrl": "/uk/vitamins/minerals/magnesium/"
      },
      {
        "tagContent": "[\"Vitamins and Minerals\",\"Vitamins and Minerals(20 of 67)\"]",
        "pageUrl": "/uk/vitamins/"
      },
      {
        "tagContent": "[\"Diet Shakes\",\"Diet Shakes(7 of 7)\"]",
        "pageUrl": "/uk/weight-loss/diet-shakes/"
      },
      {
        "tagContent": "[\"Weight Loss Supplements\",\"Weight Loss Supplements(20 of 20)\"]",
        "pageUrl": "/uk/weight-loss/"
      }
    ],
    "missing_tags": {
      "pageUrls": [
        "/uk/bulk-boost/",
        "/uk/clothing-returns/",
        "/uk/products/collagen-vitamin-c/bpb-coll-vitc/",
        "/uk/products/complete-mass-gainer/bble-cmas/",
        "/uk/products/creatine-monohydrate/bpb-cmon-0000/",
        "/uk/products/electrolyte-powder/bpb-elec-0000/",
        "/uk/products/vegan-protein-powder/vser-vppo/",
        "/uk/referafriend/",
        "/uk/",
        "/uk/student-discount/"
      ]
    },
    "duplicate_tags": [
      {
        "tagContent": "Vegan Protein",
        "pageUrls": [
          "/uk/protein/vegan-protein/",
          "/uk/vegan/vegan-protein-powders/"
        ]
      }
    ]
  }
};
const baseUrl = 'https://www.bulk.com';

const titleCsvWriter = createObjectCsvWriter({
  path: './audit-scripts/output/Title.csv',
  header: [
    { id: 'SEOImpact', title: 'SEO Impact' },
    { id: 'Issue', title: 'Issue' },
    { id: 'Details', title: 'Details' },
    { id: 'TagContent', title: 'Tag Content' },
    { id: 'PageUrl', title: 'Page URL' },
    { id: 'SEORecommendation', title: 'SEO Recommendation' }
  ]
});

const descriptionCsvWriter = createObjectCsvWriter({
  path: './audit-scripts/output/Description.csv',
  header: [
    { id: 'SEOImpact', title: 'SEO Impact' },
    { id: 'Issue', title: 'Issue' },
    { id: 'Details', title: 'Details' },
    { id: 'TagContent', title: 'Tag Content' },
    { id: 'PageUrl', title: 'Page URL' },
    { id: 'SEORecommendation', title: 'SEO Recommendation' }
  ]
});

const h1CsvWriter = createObjectCsvWriter({
  path: './audit-scripts/output/H1.csv',
  header: [
    { id: 'SEOImpact', title: 'SEO Impact' },
    { id: 'Issue', title: 'Issue' },
    { id: 'Details', title: 'Details' },
    { id: 'TagContent', title: 'Tag Content' },
    { id: 'PageUrl', title: 'Page URL' },
    { id: 'SEORecommendation', title: 'SEO Recommendation' }
  ]
});

const titleData = [];

if (seoData.title.empty_tags) {
  seoData.title.empty_tags.pageUrls.forEach(url => {
    titleData.push({
      SEOImpact: 'High',
      Issue: 'Empty Title tag',
      Details: 'Title tag is empty',
      TagContent: '-',
      PageUrl: baseUrl + url,
      SEORecommendation: 'Should have 40-60 length'
    });
  });
}

if (seoData.title.missing_tags) {
  seoData.title.missing_tags.pageUrls.forEach(url => {
    titleData.push({
      SEOImpact: 'High',
      Issue: 'Missing Title tag',
      Details: 'Title tag is missing',
      TagContent: '-',
      PageUrl: baseUrl + url,
      SEORecommendation: 'Should be present'
    });
  });
}

if (seoData.title.duplicate_tags) {
  seoData.title.duplicate_tags.forEach(duplicateContent => {
    duplicateContent.pageUrls.forEach((url) => {
      titleData.push({
        SEOImpact: 'High',
        Issue: 'Duplicate Titles',
        Details: `${duplicateContent.pageUrls.length} pages share this title`,
        TagContent: duplicateContent.tagContent,
        PageUrl: baseUrl + url,
        SEORecommendation: 'Unique across pages'
      });
    })
  });
}

if (seoData.title.length_check_fail_tags) {
  seoData.title.length_check_fail_tags.forEach(({ tagContent, url }) => {
    const issueDetails = tagContent.length > 60 ? `${tagContent.length - 60} chars over limit` : `${40 - tagContent.length} chars below limit`;
    titleData.push({
      SEOImpact: 'Moderate',
      Issue: 'Length deviation',
      Details: issueDetails,
      TagContent: tagContent,
      PageUrl: baseUrl + url,
      SEORecommendation: '40-60 characters long'
    });
  });
}

const descriptionData = [];

if (seoData.description.missing_tags) {
  seoData.description.missing_tags.pageUrls.forEach(url => {
    descriptionData.push({
      SEOImpact: 'High',
      Issue: 'Missing Description tag',
      Details: 'Description tag is missing',
      TagContent: '-',
      PageUrl: baseUrl + url,
      SEORecommendation: 'Should be present'
    });
  });
}

if (seoData.description.empty_tags) {
  seoData.description.empty_tags.pageUrls.forEach(url => {
    descriptionData.push({
      SEOImpact: 'High',
      Issue: 'Empty Description tag',
      Details: 'Description tag is empty',
      TagContent: '-',
      PageUrl: baseUrl + url,
      SEORecommendation: 'Should have 140-160 length'
    });
  });
}

if (seoData.description.duplicate_tags) {
  seoData.description.duplicate_tags.forEach(duplicateContent => {
    duplicateContent.pageUrls.forEach((url) => {
      descriptionData.push({
        SEOImpact: 'High',
        Issue: 'Duplicate Description',
        Details: `${duplicateContent.pageUrls.length} pages share this description`,
        TagContent: duplicateContent.tagContent,
        PageUrl: baseUrl + url,
        SEORecommendation: 'Unique across pages'
      });
    })
  });
}

if (seoData.description.length_check_fail_tags) {
  seoData.description.length_check_fail_tags.forEach(({ tagContent, url }) => {
    const issueDetails = tagContent.length > 160 ? `${tagContent.length - 160} chars over limit` : `${140 - tagContent.length} chars below limit`;
    descriptionData.push({
      SEOImpact: 'Moderate',
      Issue: 'Length deviation',
      Details: issueDetails,
      TagContent: tagContent,
      PageUrl: baseUrl + url,
      SEORecommendation: '140-160 characters long'
    });
  });
}

const h1Data = [];

if (seoData.h1.missing_tags) {
  seoData.h1.missing_tags.pageUrls.forEach(url => {
    h1Data.push({
      SEOImpact: 'High',
      Issue: 'Missing H1 tag',
      Details: 'H1 tag is missing',
      TagContent: '-',
      PageUrl: baseUrl + url,
      SEORecommendation: 'Should be present'
    });
  });
}

if (seoData.h1.empty_tags) {
  seoData.h1.empty_tags.pageUrls.forEach(url => {
    h1Data.push({
      SEOImpact: 'High',
      Issue: 'Empty H1 tag',
      Details: 'H1 tag is empty',
      TagContent: '-',
      PageUrl: baseUrl + url,
      SEORecommendation: 'Should have 30-70 length'
    });
  });
}

if (seoData.h1.multiple_h1_count) {
  seoData.h1.multiple_h1_count.forEach(({ tagContent, pageUrl }) => {
    tagContent = JSON.parse(tagContent);
    h1Data.push({
      SEOImpact: 'Moderate',
      Issue: 'Multiple H1 on same page',
      Details: `${tagContent.length} H1 tags detected`,
      TagContent: tagContent,
      PageUrl: baseUrl + pageUrl,
      SEORecommendation: '1 H1 on each page'
    });
  });
}

if (seoData.h1.length_check_fail_tags) {
  seoData.h1.length_check_fail_tags.forEach(({ tagContent, url }) => {
    const issueDetails = `${tagContent.length - 70} chars over limit`;
    h1Data.push({
      SEOImpact: 'Moderate',
      Issue: 'Length deviation',
      Details: issueDetails,
      TagContent: tagContent,
      PageUrl: baseUrl + url,
      SEORecommendation: 'Below 70 characters'
    });
  });
}

(async () => {
  await titleCsvWriter.writeRecords(titleData);
  await descriptionCsvWriter.writeRecords(descriptionData);
  await h1CsvWriter.writeRecords(h1Data);

  console.log('CSV files generated successfully.');
})();