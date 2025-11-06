#!/bin/bash
#export AWS_ACCESS_KEY_ID=1234
#export AWS_SECRET_ACCESS_KEY=1234


# Wait for LocalStack to be ready
echo "Waiting for LocalStack to be ready..."
while ! curl -s http://localhost:4566/_localstack/health | grep -q '"sqs": "available"'; do
    sleep 2
done

echo "LocalStack is ready. Creating SQS FIFO queue..."

# Create the SQS FIFO queue
awslocal sqs create-queue \
    --queue-name importworker

echo "SQS FIFO queue 'importworker' created successfully!"
