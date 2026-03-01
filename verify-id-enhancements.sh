#!/bin/bash

# Configuration
PORT=3000
BASE_URL="http://localhost:$PORT"
CONTAINER="test_cont_$(date +%s)"
TABLE="test_table_$(date +%s)"
USER_ID="dev-master-root"

echo "Using: Container=$CONTAINER, Table=$TABLE"

# 1. Login as admin
echo "1. Logging in..."
TOKEN_RESP=$(curl -s -X POST "$BASE_URL/auth/dev-login" \
  -H "Content-Type: application/json" \
  -d '{"email":"laurindocbenjamim@gmail.com", "password":"JDMLauri201990#"}')
TOKEN=$(echo $TOKEN_RESP | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')

if [ -z "$TOKEN" ]; then
    echo "Failed to login"
    exit 1
fi

# 2. Create table with default _id
echo "2. Creating table..."
curl -s -X POST "$BASE_URL/$CONTAINER/$TABLE" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"_init": true}' > /dev/null

# 3. Create record and verify _id
echo "3. Creating record (expecting _id)..."
REC1=$(curl -s -X POST "$BASE_URL/$CONTAINER/$TABLE" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com", "name":"Test User"}')
echo "Record: $REC1"

if [[ $REC1 == *"_id"* ]]; then
    echo "✅ Default _id found"
else
    echo "❌ Default _id NOT found"
    exit 1
fi

_ID=$(echo $REC1 | sed -n 's/.*"_id":"\([^"]*\)".*/\1/p')

# 4. Verify unique validation (email)
echo "4. Testing unique validation (duplicate email)..."
RESP2=$(curl -s -X POST "$BASE_URL/$CONTAINER/$TABLE" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com", "name":"Duplicate"}')
echo "Response: $RESP2"

if [[ $RESP2 == *"must be unique"* ]]; then
    echo "✅ Unique validation worked"
else
    echo "❌ Unique validation FAILED"
    exit 1
fi

# 5. Set custom _primaryKey
echo "5. Setting custom _primaryKey to 'user_id'..."
curl -s -X PATCH "$BASE_URL/$CONTAINER/$TABLE/primary-key" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"primaryKey": "user_id"}' > /dev/null

# 6. Create record with user_id
echo "6. Creating record with user_id..."
REC3=$(curl -s -X POST "$BASE_URL/$CONTAINER/$TABLE" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"email":"other@example.com", "name":"Other User"}')
echo "Record: $REC3"

if [[ $REC3 == *"user_id"* ]]; then
    echo "✅ Custom primaryKey 'user_id' used"
else
    echo "❌ Custom primaryKey 'user_id' NOT used"
    exit 1
fi

USER_ID_VAL=$(echo $REC3 | sed -n 's/.*"user_id":"\([^"]*\)".*/\1/p')

# 7. Get record by custom user_id
echo "7. Getting record by user_id..."
GET_RESP=$(curl -s -X GET "$BASE_URL/$CONTAINER/$TABLE/$USER_ID_VAL" \
  -H "Authorization: Bearer $TOKEN")
echo "Response: $GET_RESP"

if [[ $GET_RESP == *"$USER_ID_VAL"* ]]; then
    echo "✅ Successfully retrieved by custom PK"
else
    echo "❌ Failed to retrieve by custom PK"
    exit 1
fi

# 8. Delete by custom user_id
echo "8. Deleting by user_id..."
DEL_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$BASE_URL/$CONTAINER/$TABLE/$USER_ID_VAL" \
  -H "Authorization: Bearer $TOKEN")
echo "Delete Status: $DEL_STATUS"

if [ "$DEL_STATUS" == "204" ]; then
    echo "✅ Successfully deleted by custom PK"
else
    echo "❌ Failed to delete by custom PK"
    exit 1
fi

echo "ALL TESTS PASSED!"
