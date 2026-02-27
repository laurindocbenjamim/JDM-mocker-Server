# test curl

curl -X POST http://localhost:3000/auth/register


# login
curl -X POST http://localhost:3000/auth/login   -H "x-user-id:aa56679a-e2a2-4f35-ae55-c20fcd7daf10"   -H "Content-Type: application/json"   -d '{
    "role": "Admin",
    "expiresIn": 2000
  }'