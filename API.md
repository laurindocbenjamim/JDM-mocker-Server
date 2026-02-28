# jdm-mock-server API & Usage Guide

This document provides instructions for interacting with the Multi-User, Multi-Tenant JSON Database Engine using Token-Based Authentication. 

## 1. User Provisioning

Before you can build containers, define schemas, or store data, you must register as a user to receive an isolated workspace identifier (`UUID`). 

**Request:**
```bash
curl -X POST http://localhost:3000/auth/register
```

**Response (201 Created):**
```json
{
  "message": "Registration successful",
  "x-user-id": "e8a93a0b-1f7c-473d-9d48-386b099f6608"
}
```

## 2. Token Authentication (Login)

You must log in to obtain a Bearer Token. You can define your role (`admin` or `viewer`) and an expiration time in milliseconds. If you want the server to attach an HttpOnly cookie, append `"useCookie": true`.

**Request:**
```bash
curl -X POST http://localhost:3000/auth/login \
  -H "x-user-id: <your-uuid>" \
  -H "Content-Type: application/json" \
  -d '{
    "role": "admin",
    "expiresIn": 2000
  }'
```

**Response (200 OK):**
```json
{
  "message": "Login successful",
  "token": "4a73b4e9f9c8d7...4534a73b4e9f9c8d7",
  "expires_at": "2026-02-26T22:20:00.000Z",
  "role": "admin"
}
```

---

## 3. Testing 401 Expired Token

By supplying an artificially short `expiresIn` (e.g., 2000 milliseconds = 2 seconds), you can easily test expiration logic from your frontend or CLI.

**Step 1:** Run the Login command above (`"expiresIn": 2000`). Grab the `token`.

**Step 2:** Wait 3 seconds.

**Step 3:** Try to access any endpoint using the expired token:
```bash
curl -X GET http://localhost:3000/containers \
  -H "x-user-id: <your-uuid>" \
  -H "Authorization: Bearer <your-token>"
```

**Response (401 Unauthorized):**
*(The server will deny the request since `expires_at` is safely evaluated before letting the middleware proceed)*
```json
{
  "error": "token_expired"
}
```

---

## 4. Full Authentication Headers required

All data management endpoints (`/:container/:table`) require **BOTH**:
1. User target folder: `x-user-id: <your-uuid>`
2. Token pass (via Header OR HttpOnly Cookie OR CSRF-Token): 
   - `Authorization: Bearer <your-token>`
   - *OR* `CSRF-Token: <your-token>`
   - *OR* `x-csrf-token: <your-token>`

### 4.1 Direct Access (API Key)

For programmatic access (e.g., from a backend script), you can bypass the token handshake by using a persistent API Key. User ID is still required for workspace isolation.

**Request:**
```bash
curl -X GET http://localhost:3000/containers \
  -H "x-user-id: <your-uuid>" \
  -H "x-api-key: <your-api-key>"
```

### Role-Based Access Control (RBAC)
When generating your token via `/auth/login`, if you set `"role": "admin"`, you can securely perform `POST`, `PUT`, `DELETE` and `PATCH` actions. Viewers will receive `403 Forbidden`.

---

## 5. Fetch Example (Browser Javascript) with Pagination

Below is an interactive snippet of creating an authenticated session, setting a token, and fetching paginated constraints contextually:

```javascript
async function workflow() {
  try {
    // 1. Register to get UUID
    const regRes = await fetch('http://localhost:3000/auth/register', { method: 'POST' });
    const regData = await regRes.json();
    const myUuid = regData['x-user-id'];
    console.log('My ID:', myUuid);

    // 2. Login
    const loginRes = await fetch('http://localhost:3000/auth/login', {
      method: 'POST',
      headers: {
        'x-user-id': myUuid,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ role: "admin", expiresIn: 3600000 })
    });
    const { token } = await loginRes.json();

    // 3. Make a paginated request using Auth headers
    const response = await fetch('http://localhost:3000/games/highscores?page=1&limit=5', {
      method: 'GET',
      headers: {
        'x-user-id': myUuid,
        'Authorization': `Bearer ${token}`
      }
    });

    const data = await response.json();
    console.log('Highscores Page 1:', data);

  } catch (error) {
    console.error('Error fetching data:', error);
  }
}

workflow();
```

---

## 6. CLI Execution & SSL Configuration

jdm-mock-server acts as a robust local binary out of the box.

### Quick Start
```bash
jdm-mock --port 3050 --db-dir ./my-custom-data
```
*   `--port` (or `-p`): Defines the server port (Default: 3000)
*   `--db-dir` (or `-d`): The absolute or relative path to isolated user spaces. (Default: `./data`)

### Activating Native HTTPS
If you want to proxy requests strictly over HTTPS (`https://localhost`):
```bash
# 1. Generate local testing certificates
openssl req -nodes -new -x509 -keyout server.key -out server.cert -days 1 -subj "/C=US/ST=State/L=City/O=Org/OU=OrgUnit/CN=localhost"

# 2. Start the server with the SSL flag
jdm-mock --ssl
```
*Note: The binary will automatically find `server.key` and `server.cert` in the execution directory.*

---

## 7. Configuration Overrides

### Forcing Secure Cookies on HTTP
If you are developing a frontend (like React/Vite) that strictly requires cross-origin (`SameSite=None`, `Secure`) cookie logic, but you do not want to configure local SSL certs, you can force the server to emit Secure headers purely over HTTP:

**Request:**
```bash
curl -X POST http://localhost:3000/config/force-secure-cookies \
  -H "Content-Type: application/json" \
  -d '{"enabled": true}'
```

**Response (200 OK):**
```json
{
  "message": "Secure cookie forcing enabled"
}
```
*When activated, your next `/auth/login` containing `"useCookie": true` will instantly generate cross-origin simulated secure headers.*

---

## 8. Complete API Reference (cURL)

Below are `curl` examples for every available endpoint. For all examples, assume you have registered and logged in to obtain your `<your-uuid>` and `<your-token>`.

> **Note:** Most of these endpoints require an `admin` role token for any mutation (POST, PUT, PATCH, DELETE).

### Introspection & Admin Ops

**1. Get full database state (Introspect)**
```bash
curl -X GET http://localhost:3000/introspect \
  -H "x-user-id: <your-uuid>" \
  -H "Authorization: Bearer <your-token>"
```

**Example Introspection Response:**
```json
{
  "storage": {
    "my-container": {
      "my-table": {
        "_schema": {
          "name": "String",
          "age": "Number",
          "is_active": "Boolean"
        },
        "records": [...]
      }
    }
  },
  "role": "admin"
}
```

**2. List all containers (JSON files)**
```bash
curl -X GET http://localhost:3000/containers \
  -H "x-user-id: <your-uuid>" \
  -H "Authorization: Bearer <your-token>"
```

**3. Delete a container**
```bash
curl -X DELETE http://localhost:3000/containers/my-database \
  -H "x-user-id: <your-uuid>" \
  -H "Authorization: Bearer <your-token>"
```

### Table Ops

**4. Delete a table from a container**
```bash
curl -X DELETE http://localhost:3000/my-database/users \
  -H "x-user-id: <your-uuid>" \
  -H "Authorization: Bearer <your-token>"
```

**5. Rename a table**
```bash
curl -X PATCH http://localhost:3000/my-database/users/rename \
  -H "x-user-id: <your-uuid>" \
  -H "Authorization: Bearer <your-token>" \
  -H "Content-Type: application/json" \
  -d '{"newName": "customers"}'
```

**6. Bulk Record Transformation (Schema Logic)**
Update fields across **all** existing records in a table.
```bash
curl -X PATCH http://localhost:3000/my-database/users/schema \
  -H "x-user-id: <your-uuid>" \
  -H "Authorization: Bearer <your-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "remove": ["old_field"],
    "rename": {"current_name": "new_name"},
    "set": {"status": "active"}
  }'
```

**7. Define Validation Schema**
Specify data types for columns to enforce integrity. Supported types: `String`, `Number`, `Boolean`, `Date`.
```bash
curl -X PATCH http://localhost:3000/my-database/users/schema-definition \
  -H "x-user-id: <your-uuid>" \
  -H "Authorization: Bearer <your-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "price",
    "type": "Number"
  }'
```
*To remove a validation rule: `{"remove": "price"}`*

### Data Ops (CRUD)

**7. Create a record (POST)**
```bash
curl -X POST http://localhost:3000/my-database/users \
  -H "x-user-id: <your-uuid>" \
  -H "Authorization: Bearer <your-token>" \
  -H "Content-Type: application/json" \
  -d '{"name": "Alice", "age": 28}'
```

**8. List records (GET) with optional filtering and pagination**
```bash
# Get all records
curl -X GET http://localhost:3000/my-database/users \
  -H "x-user-id: <your-uuid>" \
  -H "Authorization: Bearer <your-token>"

# With Pagination and Filtering (e.g., page 1, 5 per page, where age=28)
curl -X GET "http://localhost:3000/my-database/users?page=1&limit=5&age=28" \
  -H "x-user-id: <your-uuid>" \
  -H "Authorization: Bearer <your-token>"
```

**9. Get a specific record by ID (GET)**
```bash
curl -X GET http://localhost:3000/my-database/users/<record-id> \
  -H "x-user-id: <your-uuid>" \
  -H "Authorization: Bearer <your-token>"
```

**10. Update/Replace Record (PUT)**
Full replacement of a record. Missing fields will be removed.
```bash
curl -X PUT http://localhost:3000/my-database/users/<record-id> \
  -H "x-user-id: <your-uuid>" \
  -H "Authorization: Bearer <your-token>" \
  -H "Content-Type: application/json" \
  -d '{"name": "Alice updated", "age": 29}'
```

**11. Partial Update Record (PATCH)**
Only update the specific fields provided in the body.
```bash
curl -X PATCH http://localhost:3000/my-database/users/<record-id> \
  -H "x-user-id: <your-uuid>" \
  -H "Authorization: Bearer <your-token>" \
  -H "Content-Type: application/json" \
  -d '{"age": 30}'
```

**11. Delete a specific record by ID (DELETE)**
```bash
curl -X DELETE http://localhost:3000/my-database/users/<record-id> \
  -H "x-user-id: <your-uuid>" \
  -H "Authorization: Bearer <your-token>"
```

### User Identity Ops

**12. Rotate/Update UUID (Migrates all your data to a new UUID)**
```bash
curl -X PATCH http://localhost:3000/auth/update-uuid \
  -H "x-user-id: <your-uuid>" \
  -H "Authorization: Bearer <your-token>"
```

**14. Delete Account (Wipes all your data entirely)**
```bash
curl -X DELETE http://localhost:3000/auth/account \
  -H "x-user-id: <your-uuid>" \
  -H "Authorization: Bearer <your-token>"
```

---

## 9. Custom Mock Endpoints (Path Overrides)

You can define specific, optional paths for your mock data operations. This allows you to match existing API contracts exactly (e.g., using `/api/v1/users/list` instead of `/:container/:table`).

### 9.1 Initializing Table with Custom Paths

When creating a table, you can send a `_customPaths` object. Each key (`get`, `post`, `put`, `delete`) defines a specific URI that will be mapped to this table.

**Request:**
```bash
curl -X POST http://localhost:3000/my-database/users \
  -H "x-user-id: <your-uuid>" \
  -H "Authorization: Bearer <your-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "_init": true,
    "_customPaths": {
      "get": "/users/all",
      "post": "/users/new",
      "put": "/users/update",
      "delete": "/users/remove"
    }
  }'
```

### 9.2 Using Custom Endpoints

Once defined, you can use these paths directly. The server automatically resolves them to the correct workspace and table.

**Example GET:**
```bash
curl -X GET http://localhost:3000/users/all \
  -H "x-user-id: <your-uuid>" \
  -H "Authorization: Bearer <your-token>"
```

**Example POST:**
```bash
curl -X POST http://localhost:3000/users/new \
  -H "x-user-id: <your-uuid>" \
  -H "Authorization: Bearer <your-token>" \
  -d '{"name": "John Doe"}'
```

*Note: IDs should be appended to the custom path for individual record operations (e.g., `PUT /users/update/<record-id>`).*

---

## 10. Scenarios & Data Integrity

### Scenario: The Schema Shield
If you define `age` as a `Number`, the server will reject any `POST`, `PUT`, or `PATCH` that provides a string.

1. **Set Schema:** `PATCH /users/schema-definition` with `{"name": "age", "type": "Number"}`
2. **Try Invalid Update:**
```bash
curl -X PATCH http://localhost:3000/my-db/users/<id> \
  -d '{"age": "twenty-eight"}'
```
3. **Response (400 Bad Request):**
```json
{
  "error": "Validation Error: Field 'age' expects Number"
}
```

### Scenario: High-Volume Tables
The Test Dashboard includes a built-in horizontal scrollbar and vertical modal scrolling to handle tables with 50+ columns seamlessly.
