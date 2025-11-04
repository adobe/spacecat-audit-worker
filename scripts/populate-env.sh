#!/bin/bash

# Define the secret name and region
unset AWS_ACCESS_KEY_ID    
unset AWS_SECRET_ACCESS_KEY
unset AWS_SESSION_TOKEN

aws sts get-caller-identity

SECRET_NAME="/helix-deploy/spacecat-services/audit-worker/latest"
REGION="us-east-1"

# Retrieve the secret from AWS Secrets Manager
SECRET_JSON=$(aws secretsmanager get-secret-value --secret-id $SECRET_NAME --region $REGION --query SecretString --output text)

touch env.sh

# Parse the JSON and write to env.sh
echo "$SECRET_JSON" | jq -r 'to_entries | .[] | "export \(.key)=\(.value | @sh)"' >> env.sh

echo "env.sh file has been populated with secrets from AWS Secrets Manager."