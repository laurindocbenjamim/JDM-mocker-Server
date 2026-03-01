#!/bin/bash

# Configuration
BASE_URL="http://localhost:3000"
USER_ID="81557238-6d29-4a07-b002-e767d019a24e"
CONTAINER="mocktest"
TABLE="person"

echo "🎯 Starting Unitary Test for User: $USER_ID"
echo "------------------------------------------------"

# 1. Login to get a fresh token (using Admin role)
echo "Step 1: Logging in..."
LOGIN_RES=$(curl -s -X POST "$BASE_URL/auth/login" \
  -H "x-user-id: $USER_ID" \
  -H "Content-Type: application/json" \
  -d '{ "role": "admin" }')

TOKEN=$(echo $LOGIN_RES | grep -oP '"token":"\K[^"]+')

if [ -z "$TOKEN" ]; then
    echo "❌ Login failed! Response: $LOGIN_RES"
    exit 1
fi

echo "✅ Login successful. Token obtained."
echo "------------------------------------------------"

# 2. Create Container / Table (POST)
# We will use the fresh token in Authorization header
echo "Step 2: Creating container '$CONTAINER' and table '$TABLE'..."
CREATE_RES=$(curl -s -X POST "$BASE_URL/$CONTAINER/$TABLE" \
  -H "x-user-id: $USER_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "name": "John Doe", "age": 30 }')

echo "Response: $CREATE_RES"

if [[ $CREATE_RES == *"error"* ]]; then
    echo "❌ Creation failed!"
else
    echo "✅ Record created successfully."
fi
echo "------------------------------------------------"

# 3. Verify via x-api-key (UUID-based Auth)
# Demonstrating that you don't even need the token if you use x-api-key
echo "Step 3: Verifying storage using x-api-key (UUID Bypassing JWT)..."
VERIFY_RES=$(curl -s -X GET "$BASE_URL/introspect" \
  -H "x-user-id: $USER_ID" \
  -H "x-api-key: $USER_ID")

if [[ $VERIFY_RES == *"$CONTAINER"* ]]; then
    echo "✅ Verification successful! Container '$CONTAINER' found in storage."
else
    echo "❌ Verification failed! Container not found in introspection."
    echo "Full Response: $VERIFY_RES"
fi

echo "------------------------------------------------"
# 4. Custom Mock Endpoint Test
echo "Step 4: Testing Custom Mock Endpoint..."
# 4a. Create table with custom GET path
curl -s -X POST "$BASE_URL/$CONTAINER/custom-table" \
  -H "x-user-id: $USER_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "_init": true, "_customPaths": { "get": "/api/my-custom-data" } }' > /dev/null

# 4b. Access via custom path
CUSTOM_RES=$(curl -s -X GET "$BASE_URL/api/my-custom-data" \
  -H "x-user-id: $USER_ID" \
  -H "Authorization: Bearer $TOKEN")

if [[ $CUSTOM_RES == "[]" ]]; then
    echo "✅ Custom path resolution successful! Mapped to empty table."
else
    echo "❌ Custom path resolution failed! Response: $CUSTOM_RES"
fi

echo "------------------------------------------------"
echo "🚀 Test Completed."
