#!/bin/bash

# Configuration
BASE_URL="http://localhost:3000"
USER_ID="anon-test-$(date +%s)"
CONTAINER="anon_test"
TABLE="items"

# Headers with ONLY x-user-id
HEADERS=(-H "x-user-id: $USER_ID" -H "Content-Type: application/json")

echo "--- 1. REGISTERING USER ---"
# Note: In real app, /auth/register creates the user. 
# Our middleware allows x-user-id to 'auto-create' if storage allows, but let's be formal.
curl -X POST "$BASE_URL/auth/register" -H "Content-Type: application/json"
echo -e "\n"

echo "--- 2. INITIALIZING TABLE (POST) ---"
curl -X POST "$BASE_URL/$CONTAINER/$TABLE" \
  "${HEADERS[@]}" \
  -d '{"_init": true, "name": "Initial Item"}'
echo -e "\n"

echo "--- 3. ADDING RECORD (POST) ---"
RECORD_ID="ITEM-001"
curl -X POST "$BASE_URL/$CONTAINER/$TABLE" \
  "${HEADERS[@]}" \
  -d "{\"_id\": \"$RECORD_ID\", \"name\": \"Anonymous Item\", \"status\": \"new\"}"
echo -e "\n"

echo "--- 4. UPDATING RECORD (PATCH) ---"
curl -X PATCH "$BASE_URL/$CONTAINER/$TABLE/$RECORD_ID" \
  "${HEADERS[@]}" \
  -d '{"status": "updated"}'
echo -e "\n"

echo "--- 5. VERIFYING UPDATE (GET) ---"
curl -X GET "$BASE_URL/$CONTAINER/$TABLE/$RECORD_ID" \
  "${HEADERS[@]}"
echo -e "\n"

echo "--- 6. TESTING PROTECTED DELETE (Should FAIL) ---"
echo "Deleting SHOULD fail because we kept DELETE: true in defaults."
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$BASE_URL/$CONTAINER/$TABLE/$RECORD_ID" "${HEADERS[@]}")
if [ "$RESPONSE" == "401" ]; then
  echo "SUCCESS: Delete blocked as expected (401 Unauthorized)"
else
  echo "FAILURE: Delete was NOT blocked (Status: $RESPONSE)"
fi
echo -e "\n"

echo "--- TEST COMPLETE ---"
