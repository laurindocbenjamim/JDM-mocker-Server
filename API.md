# DM-mocker-Server API & Usage Guide

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
2. Token pass (via Header OR HttpOnly Cookie): `Authorization: Bearer <your-token>`

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

DM-mocker-Server acts as a robust local binary out of the box.

### Quick Start
```bash
dm-mocker --port 3050 --db-dir ./my-custom-data
```
*   `--port` (or `-p`): Defines the server port (Default: 3000)
*   `--db-dir` (or `-d`): The absolute or relative path to isolated user spaces. (Default: `./data`)

### Activating Native HTTPS
If you want to proxy requests strictly over HTTPS (`https://localhost`):
```bash
# 1. Generate local testing certificates
openssl req -nodes -new -x509 -keyout server.key -out server.cert -days 1 -subj "/C=US/ST=State/L=City/O=Org/OU=OrgUnit/CN=localhost"

# 2. Start the server with the SSL flag
dm-mocker --ssl
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
