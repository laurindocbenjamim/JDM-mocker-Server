#!/bin/bash

# Configuration
BASE_URL="http://localhost:3000"
USER_ID="449d1266-2d37-4828-80f4-205edddf3c7d"
TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI0NDlkMTI2Ni0yZDM3LTQ4MjgtODBmNC0yMDVlZGRkZjNjN2QiLCJyb2xlIjoiYWRtaW4iLCJpYXQiOjE3NzI0MDI0NzcsImV4cCI6MTc3MjQ4ODg3N30.HG4zz9rGe-lyjrnd72N6X4Vf5-hUTnXUwt2u7TACghU"
CONTAINER="mock_test"
TABLE="contacts_test"

# Header helpers
HEADERS_AUTH=(-H "x-user-id: $USER_ID" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json")
HEADERS_NO_TOKEN=(-H "x-user-id: $USER_ID" -H "Content-Type: application/json")

echo "--- 1. INITIALIZING CONTAINER & TABLE ---"
curl -X POST "$BASE_URL/$CONTAINER/$TABLE" \
  "${HEADERS_AUTH[@]}" \
  -d '{"_init": true, "_schema": {"id_c": "String", "full_name": "String", "phone": "String", "category": "String"}}'
echo -e "\n"

echo "--- 2. SETTING PRIMARY KEY (id_c) ---"
curl -X PATCH "$BASE_URL/$CONTAINER/$TABLE/primary-key" \
  "${HEADERS_AUTH[@]}" \
  -d '{"primaryKey": "id_c"}'
echo -e "\n"

echo "--- 3. ADDING CUSTOM ENDPOINTS ---"
curl -X PATCH "$BASE_URL/$CONTAINER/$TABLE/custom-paths" \
  "${HEADERS_AUTH[@]}" \
  -d '{"method": "get", "path": "/api/v1/all-contacts"}'
echo -e "\n"

echo "--- 4. TESTING POST (Add Record) ---"
RECORD_ID="TEST-001"
curl -X POST "$BASE_URL/$CONTAINER/$TABLE" \
  "${HEADERS_AUTH[@]}" \
  -d "{\"id_c\": \"$RECORD_ID\", \"full_name\": \"Test User\", \"phone\": \"123456\", \"category\": \"tester\"}"
echo -e "\n"

echo "--- 5. TESTING GET ALL (Standard) ---"
curl -X GET "$BASE_URL/$CONTAINER/$TABLE" \
  "${HEADERS_AUTH[@]}"
echo -e "\n"

echo "--- 6. TESTING GET ALL (Custom Path) ---"
curl -X GET "$BASE_URL/api/v1/all-contacts" \
  "${HEADERS_AUTH[@]}"
echo -e "\n"

echo "--- 7. TESTING GET BY PK ($RECORD_ID) ---"
curl -X GET "$BASE_URL/$CONTAINER/$TABLE/$RECORD_ID" \
  "${HEADERS_AUTH[@]}"
echo -e "\n"

echo "--- 8. TESTING PATCH RECORD ---"
curl -X PATCH "$BASE_URL/$CONTAINER/$TABLE/$RECORD_ID" \
  "${HEADERS_AUTH[@]}" \
  -d '{"full_name": "Updated Test User"}'
echo -e "\n"

echo "--- 9. TESTING SELECTIVE AUTH (GET without Token) ---"
echo "Note: This assumes you have DISABLED GET validation in the Security Card for this User ID!"
curl -X GET "$BASE_URL/$CONTAINER/$TABLE/$RECORD_ID" \
  "${HEADERS_NO_TOKEN[@]}"
echo -e "\n"

echo "--- 11. TESTING FILTERING (Query Params: id_c & phone) ---"
curl -X GET "$BASE_URL/$CONTAINER/$TABLE?id_c=$RECORD_ID&phone=123456" \
  "${HEADERS_AUTH[@]}"
echo -e "\n"

echo "--- 12. TESTING FILTERING (Name with Space - Encoded) ---"
# Using %20 for space
curl -X GET "$BASE_URL/$CONTAINER/$TABLE?full_name=Updated%20Test%20User" \
  "${HEADERS_AUTH[@]}"
echo -e "\n"

echo "--- 13. TESTING DELETE RECORD ---"
curl -X DELETE "$BASE_URL/$CONTAINER/$TABLE/$RECORD_ID" \
  "${HEADERS_AUTH[@]}"
echo -e "\n"

echo "--- TEST COMPLETE ---"
