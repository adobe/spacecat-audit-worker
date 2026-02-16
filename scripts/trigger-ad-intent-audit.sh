#!/usr/bin/env bash
# trigger-ad-intent-audit.sh
#
# Directly invokes step 2 (runPaidKeywordAnalysisStep) of the ad-intent-mismatch
# audit on a specific site via AWS Lambda. This bypasses step 1 (import trigger)
# and goes straight to Athena analysis + Mystique message send.
#
# Prerequisites:
#   - AWS CLI configured (klam login / klsa)
#   - An existing audit entity in DynamoDB (created by step 1 or a previous run)
#   - The Lambda function must have S3_IMPORTER_BUCKET_NAME and
#     QUEUE_SPACECAT_TO_MYSTIQUE env vars set
#
# Usage:
#   ./scripts/trigger-ad-intent-audit.sh \
#     --site-id <SITE_UUID> \
#     --audit-id <AUDIT_UUID> \
#     [--lambda-alias latest] \
#     [--profile spacecat-dev]

set -euo pipefail

# Defaults
LAMBDA_ALIAS="latest"
AWS_PROFILE="spacecat-dev"
LAMBDA_FUNCTION="spacecat-services-audit-worker"
SITE_ID=""
AUDIT_ID=""

usage() {
  cat <<EOF
Usage: $0 --site-id <UUID> --audit-id <UUID> [OPTIONS]

Required:
  --site-id       UUID of the site to analyze
  --audit-id      UUID of an existing audit entity (from step 1 or previous run)

Options:
  --lambda-alias  Lambda alias to invoke (default: latest)
  --profile       AWS CLI profile (default: spacecat-dev)
  --help          Show this help message

Examples:
  # Invoke step 2 on dev with default alias
  $0 --site-id abc-123 --audit-id def-456

  # Invoke a specific Lambda alias
  $0 --site-id abc-123 --audit-id def-456 --lambda-alias my-alias

  # Use prod profile
  $0 --site-id abc-123 --audit-id def-456 --profile spacecat-prod
EOF
  exit 1
}

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --site-id) SITE_ID="$2"; shift 2 ;;
    --audit-id) AUDIT_ID="$2"; shift 2 ;;
    --lambda-alias) LAMBDA_ALIAS="$2"; shift 2 ;;
    --profile) AWS_PROFILE="$2"; shift 2 ;;
    --help) usage ;;
    *) echo "Unknown option: $1"; usage ;;
  esac
done

# Validate required arguments
if [[ -z "$SITE_ID" ]]; then
  echo "Error: --site-id is required"
  usage
fi

if [[ -z "$AUDIT_ID" ]]; then
  echo "Error: --audit-id is required"
  usage
fi

# Build the SQS message payload
# auditContext.next = "runPaidKeywordAnalysisStep" tells the StepAudit
# to skip step 1 and run step 2 directly
MESSAGE_BODY=$(cat <<EOF
{
  "type": "ad-intent-mismatch",
  "siteId": "${SITE_ID}",
  "auditContext": {
    "next": "runPaidKeywordAnalysisStep",
    "auditId": "${AUDIT_ID}",
    "auditType": "ad-intent-mismatch",
    "importWasEnabled": false
  }
}
EOF
)

# Wrap in SQS Lambda event format
LAMBDA_PAYLOAD=$(cat <<EOF
{
  "Records": [
    {
      "body": $(echo "$MESSAGE_BODY" | jq -c '.' | jq -Rs '.')
    }
  ]
}
EOF
)

echo "=== Ad Intent Mismatch - Step 2 Direct Invocation ==="
echo ""
echo "Profile:      ${AWS_PROFILE}"
echo "Function:     ${LAMBDA_FUNCTION}:${LAMBDA_ALIAS}"
echo "Site ID:      ${SITE_ID}"
echo "Audit ID:     ${AUDIT_ID}"
echo ""
echo "Message payload:"
echo "$MESSAGE_BODY" | jq '.'
echo ""

# Create temp file for response
RESPONSE_FILE=$(mktemp)
trap 'rm -f "$RESPONSE_FILE"' EXIT

echo "Invoking Lambda..."
echo ""

aws lambda invoke \
  --profile "$AWS_PROFILE" \
  --function-name "${LAMBDA_FUNCTION}:${LAMBDA_ALIAS}" \
  --payload "$(echo "$LAMBDA_PAYLOAD" | jq -c '.')" \
  --cli-binary-format raw-in-base64-out \
  "$RESPONSE_FILE" \
  2>&1

echo ""
echo "=== Lambda Response ==="
if [[ -f "$RESPONSE_FILE" ]]; then
  cat "$RESPONSE_FILE" | jq '.' 2>/dev/null || cat "$RESPONSE_FILE"
fi
echo ""
echo "Done."
