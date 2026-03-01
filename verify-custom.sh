#!/bin/bash
BASE_URL="http://localhost:3000"
# Use random suffixes for a clean run
RAND=$RANDOM
CONT="cont_$RAND"
TABLE="table_$RAND"
USER_ID="dev-master-root"
ADMIN_PASS="admin123" # Default password from .env or seed

echo "Using: Container=$CONT, Table=$TABLE, User=$USER_ID"

# No registration needed for dev-master-root
echo "2. Logging in as admin..."
LOGIN_RES=$(curl -s -X POST "$BASE_URL/auth/login" -H "Content-Type: application/json" -H "x-user-id: $USER_ID" -d "{\"email\":\"admin@example.com\", \"password\":\"$ADMIN_PASS\", \"role\":\"admin\"}")
TOKEN=$(echo $LOGIN_RES | python3 -c "import sys, json; print(json.load(sys.stdin).get('token', ''))")
if [ -z "$TOKEN" ]; then echo "Login failed: $LOGIN_RES"; exit 1; fi
echo "Token obtained: ${TOKEN:0:10}..."
echo -e "\n"

echo "3. Creating table with custom endpoints..."
curl -s -X POST "$BASE_URL/$CONT/$TABLE" \
     -H "Authorization: Bearer $TOKEN" \
     -H "x-user-id: $USER_ID" \
     -H "Content-Type: application/json" \
     -d "{\"_init\":true, \"_customPaths\":{\"get\":\"/api/v1/list-$RAND\", \"post\":\"/api/v1/create-$RAND\"}}"
echo -e "\n"

echo "4. Verifying custom GET..."
curl -s -X GET "$BASE_URL/api/v1/list-$RAND" \
     -H "Authorization: Bearer $TOKEN" \
     -H "x-user-id: $USER_ID"
echo -e "\n"

echo "5. Updating custom endpoints (Adding PATCH)..."
curl -s -X PATCH "$BASE_URL/$CONT/$TABLE/custom-paths" \
     -H "Authorization: Bearer $TOKEN" \
     -H "x-user-id: $USER_ID" \
     -H "Content-Type: application/json" \
     -d "{\"method\":\"patch\", \"path\":\"/api/v1/update-$RAND\"}"
echo -e "\n"

echo "6. Creating record via custom POST..."
POST_RES=$(curl -s -X POST "$BASE_URL/api/v1/create-$RAND" \
     -H "Authorization: Bearer $TOKEN" \
     -H "x-user-id: $USER_ID" \
     -H "Content-Type: application/json" \
     -d '{"name":"Curl Test"}')
RECORD_ID=$(echo $POST_RES | python3 -c "import sys, json; print(json.load(sys.stdin).get('id', ''))")
echo "Record ID: $RECORD_ID"
echo -e "\n"

echo "7. Updating record via custom PATCH..."
curl -s -X PATCH "$BASE_URL/api/v1/update-$RAND/$RECORD_ID" \
     -H "Authorization: Bearer $TOKEN" \
     -H "x-user-id: $USER_ID" \
     -H "Content-Type: application/json" \
     -d '{"name":"Curl Updated"}'
echo -e "\n"

echo "8. Verifying update..."
curl -s -X GET "$BASE_URL/$CONT/$TABLE/$RECORD_ID" \
     -H "Authorization: Bearer $TOKEN" \
     -H "x-user-id: $USER_ID"
echo -e "\n"

echo "9. Removing custom GET endpoint..."
curl -s -X PATCH "$BASE_URL/$CONT/$TABLE/custom-paths" \
     -H "Authorization: Bearer $TOKEN" \
     -H "x-user-id: $USER_ID" \
     -H "Content-Type: application/json" \
     -d '{"remove":"get"}'
echo -e "\n"

echo "10. Verifying GET no longer works via custom path..."
# It should return 401/404 because the re-routing won't happen
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X GET "$BASE_URL/api/v1/list-$RAND" \
     -H "Authorization: Bearer $TOKEN" \
     -H "x-user-id: $USER_ID")
echo "HTTP Status (should be 4xx): $STATUS"
echo -e "\n"
