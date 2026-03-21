#!/bin/bash
# Seed test data for wikipedia-analysis local testing
# 
# Usage:
#   ./scripts/seed-test-data.sh <siteId> <apiKey> [baseUrl]
#
# Example:
#   ./scripts/seed-test-data.sh abc-123-uuid your-api-key
#   ./scripts/seed-test-data.sh abc-123-uuid your-api-key https://spacecat-services--api-service.aem-dev.hlx.page

set -e

SITE_ID=${1:?"Usage: $0 <siteId> <apiKey> [baseUrl]"}
API_KEY=${2:?"Usage: $0 <siteId> <apiKey> [baseUrl]"}
BASE_URL=${3:-"https://spacecat-services--api-service.aem-dev.hlx.page"}

echo "=== Seeding test data for wikipedia-analysis ==="
echo "Site ID: $SITE_ID"
echo "Base URL: $BASE_URL"
echo ""

# =============================================================================
# 1. Add Wikipedia URLs to URL Store
# =============================================================================
echo ">>> Adding Wikipedia URLs to URL Store..."

curl -s -X POST "$BASE_URL/sites/$SITE_ID/url-store" \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '[
    {
      "url": "https://en.wikipedia.org/wiki/Adobe_Inc.",
      "audits": ["wikipedia-analysis"],
      "byCustomer": false
    },
    {
      "url": "https://en.wikipedia.org/wiki/Adobe_Experience_Platform",
      "audits": ["wikipedia-analysis"],
      "byCustomer": false
    }
  ]' | jq .

echo ""

# =============================================================================
# 2. Create Sentiment Topics
# =============================================================================
echo ">>> Creating Sentiment Topics..."

curl -s -X POST "$BASE_URL/sites/$SITE_ID/sentiment/topics" \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '[
    {
      "name": "Adobe Creative Cloud",
      "description": "Track sentiment about Creative Cloud products",
      "subPrompts": [
        "What do users say about Photoshop?",
        "How is Premiere Pro perceived?",
        "Subscription pricing sentiment?"
      ],
      "enabled": true
    },
    {
      "name": "Adobe Experience Cloud",
      "description": "Monitor sentiment about AEM and analytics",
      "subPrompts": [
        "AEM usability feedback?",
        "Analytics product sentiment?"
      ],
      "enabled": true
    }
  ]' | jq .

echo ""

# =============================================================================
# 3. Create Sentiment Guidelines for wikipedia-analysis
# =============================================================================
echo ">>> Creating Sentiment Guidelines..."

curl -s -X POST "$BASE_URL/sites/$SITE_ID/sentiment/guidelines" \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '[
    {
      "name": "Wikipedia Content Quality",
      "instruction": "Analyze the Wikipedia article for factual accuracy, completeness of coverage, and neutrality of tone. Note any areas where information appears outdated or missing.",
      "audits": ["wikipedia-analysis"],
      "enabled": true
    },
    {
      "name": "Brand Representation",
      "instruction": "Evaluate how the brand is represented on Wikipedia. Look for positive mentions, criticisms, controversies, and overall sentiment conveyed through the article structure and content.",
      "audits": ["wikipedia-analysis"],
      "enabled": true
    }
  ]' | jq .

echo ""

# =============================================================================
# 4. Verify: Get the sentiment config
# =============================================================================
echo ">>> Verifying sentiment config for wikipedia-analysis..."

curl -s "$BASE_URL/sites/$SITE_ID/sentiment/config?audit=wikipedia-analysis" \
  -H "x-api-key: $API_KEY" | jq .

echo ""

# =============================================================================
# 5. Verify: List URLs by audit type
# =============================================================================
echo ">>> Verifying Wikipedia URLs in URL Store..."

curl -s "$BASE_URL/sites/$SITE_ID/url-store/by-audit/wikipedia-analysis" \
  -H "x-api-key: $API_KEY" | jq .

echo ""
echo "=== Done! Test data seeded successfully ==="
