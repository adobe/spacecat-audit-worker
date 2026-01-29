#!/bin/bash
# Example script to process all opportunity types for a single site
# Usage: ./oppty-scripts/example-batch-process.sh <site-id>

set -e

if [ -z "$1" ]; then
  echo "Usage: $0 <site-id>"
  echo "Example: $0 123e4567-e89b-12d3-a456-426614174000"
  exit 1
fi

SITE_ID="$1"
MARK_FIXED="${2:-false}"

echo "=========================================="
echo "Processing all opportunity types for site: $SITE_ID"
echo "Mark Fixed: $MARK_FIXED"
echo "=========================================="
echo ""

# Array of opportunity types
TYPES=("alt-text" "broken-backlinks" "broken-internal-links" "structured-data" "sitemap" "meta-tags")

for TYPE in "${TYPES[@]}"; do
  echo "----------------------------------------"
  echo "Processing: $TYPE"
  echo "----------------------------------------"
  
  if [ "$MARK_FIXED" = "true" ]; then
    npm run oppty:check -- --siteId="$SITE_ID" --type="$TYPE" --markFixed
  else
    npm run oppty:check -- --siteId="$SITE_ID" --type="$TYPE"
  fi
  
  echo ""
  echo "Completed: $TYPE"
  echo ""
done

echo "=========================================="
echo "All opportunity types processed!"
echo "Check the oppty-scripts/data/ directory for CSV outputs"
echo "=========================================="
