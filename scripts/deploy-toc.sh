#!/usr/bin/env bash
# deploy-toc.sh
#
# Builds the audit-worker zip locally, then prints manual steps to:
#   1. Upload the zip to Lambda (AWS console)
#   2. Send the SQS trigger to kick off the TOC audit
#
# ─────────────────────────────────────────────────────────────────────────────
# QUEUE & SQS TRIGGER
# ─────────────────────────────────────────────────────────────────────────────
#
# Queue name : spacecat-audit-jobs-anagarwa
# Queue URL  : https://sqs.us-east-1.amazonaws.com/682033462621/spacecat-audit-jobs-anagarwa
#
# SQS message to trigger step 1 (import-top-pages):
#   {
#     "type": "toc",
#     "siteId": "<SITE_ID>",
#     "auditContext": {}
#   }
#
# Step flow: import-top-pages → submit-for-scraping → process-toc-results
#
# CloudWatch logs:
#   aws logs tail /aws/lambda/spacecat-services--audit-worker \
#     --region us-east-1 --follow --filter-pattern '[TOC]'
#
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; CYAN='\033[0;36m'; NC='\033[0m'

log_info()    { echo -e "${BLUE}[INFO]${NC}    $(date '+%H:%M:%S')  $1"; }
log_success() { echo -e "${GREEN}[OK]${NC}      $(date '+%H:%M:%S')  $1"; }
log_step()    { echo -e "\n${CYAN}━━━  $1  ━━━${NC}"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PKG_VERSION="latestlocal"
ALIAS="anagarwa"
LAMBDA_FUNCTION="spacecat-services--audit-worker"
QUEUE_URL="https://sqs.us-east-1.amazonaws.com/682033462621/spacecat-audit-jobs-anagarwa"

# ─────────────────────────────────────────────────────────────────────────────
# Build
# ─────────────────────────────────────────────────────────────────────────────
log_step "Building zip via hedy"
cd "$REPO_ROOT"

# VPC vars required by hedy to resolve ${env.VPC_*} references in wsk-manifest
export VPC_SUBNET_1="subnet-052fec4fa471efefa"
export VPC_SUBNET_2="subnet-07b53318ac4bd7a51"
export VPC_SG_ID="sg-01a3594167b2f9229"
export AWS_ACCOUNT_ID="682033462621"

CI_BUILD_NUM=local npx hedy -v \
  --test-bundle \
  --pkgVersion="$PKG_VERSION" 2>&1 | grep -E "^(ok:|--|error:|warn:|✓|✗)" | sed 's/^/  /' || true

FOUND_ZIP=$(find "$REPO_ROOT/dist/spacecat-services" -name "audit-worker@${PKG_VERSION}*.zip" 2>/dev/null | sort | tail -1 || true)

if [[ -z "$FOUND_ZIP" ]]; then
  echo ""
  echo -e "${YELLOW}Zip not found via hedy — trying npm run build...${NC}"
  npm run build 2>&1 | tail -5 || true
  FOUND_ZIP=$(find "$REPO_ROOT/dist/spacecat-services" -name "*.zip" 2>/dev/null | sort | tail -1 || true)
fi

if [[ -z "$FOUND_ZIP" ]]; then
  echo -e "\n${YELLOW}Could not locate zip. Check dist/spacecat-services/ manually.${NC}"
  FOUND_ZIP="<path-to-zip>"
else
  log_success "Zip ready: $FOUND_ZIP  ($(du -sh "$FOUND_ZIP" | cut -f1))"
fi

# ─────────────────────────────────────────────────────────────────────────────
# Manual deploy instructions
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  STEP 1 — Upload zip to Lambda${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  1. AWS Lambda console → ${YELLOW}${LAMBDA_FUNCTION}${NC}"
echo -e "  2. Click ${YELLOW}Upload from > .zip file${NC}"
echo -e "  3. Upload: ${GREEN}${FOUND_ZIP}${NC}"
echo -e "  4. Click ${YELLOW}Deploy${NC} → note the new version number"
echo -e "  5. Go to ${YELLOW}Aliases → ${ALIAS}${NC} → edit → point to new version"
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  STEP 2 — Send SQS trigger (after alias is updated)${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  Queue: ${YELLOW}${QUEUE_URL}${NC}"
echo ""
echo -e "  aws sqs send-message \\"
echo -e "    --queue-url ${QUEUE_URL} \\"
echo -e "    --message-body '{\"type\":\"toc\",\"siteId\":\"<SITE_ID>\",\"auditContext\":{}}' \\"
echo -e "    --region us-east-1"
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  STEP 3 — Watch CloudWatch logs${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  aws logs tail /aws/lambda/spacecat-services--audit-worker \\"
echo -e "    --region us-east-1 --follow --filter-pattern '[TOC]'"
echo ""
