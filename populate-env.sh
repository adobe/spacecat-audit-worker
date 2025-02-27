#!/bin/bash

# Define the secret name and region
SECRET_NAME="/helix-deploy/spacecat-services/audit-worker/ci"
REGION="us-east-1"

# Retrieve the secret from AWS Secrets Manager
SECRET_JSON=$(aws secretsmanager get-secret-value --secret-id $SECRET_NAME --region $REGION --query SecretString --output text)

touch env.sh

# Parse the JSON and write to env.sh
echo "$SECRET_JSON" | jq -r 'to_entries | .[] | "export \(.key)=\(.value | @sh)"' >> env.sh

echo "env.sh file has been populated with secrets from AWS Secrets Manager."