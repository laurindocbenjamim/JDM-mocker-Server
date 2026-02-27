# jdm-mocker-Server

A modular, multi-user JSON mock backend service built natively with Node.js and Express. It provides a multi-tenant JSON database engine perfectly suited for frontend prototyping.

## Features

- **Strict User Isolation**: Create independent workspaces mapped exclusively to UUIDs.
- **Dynamic Schema & Tables**: Create JSON contexts on the fly automatically upon initial table inserts (`/:container/:table`).
- **Full CRUD API**: RESTful endpoints with built-in pagination limits (`?page=1&limit=5`).
- **Storage Quotas & Cleanup**: Enforces a strict 5MB quota per UUID and cleans up any UUID directories unused for 7+ days automatically.
- **Role-Based Authentication**: Secure JWT/Token session authentication dictating `admin` vs `viewer` modification rights natively.
- **Persistence & Admin Dashboard**: Natively runs on SQLite/File-System and provides an embedded visual dashboard at `/admin/dashboard`.

## Local Execution (CLI Support)

You can run the engine globally or anywhere on your machine by overriding the default port, dataset mapping, and protocol execution via the CLI.

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Start the server with custom CLI options:**
   ```bash
   jdm-mocker --port 8080 --db-dir /path/to/my/mock-data --ssl
   ```
   *Alternatively, if running locally via script:*
   ```bash
   node server.js --port 8080 --db-dir /path/to/my/mock-data
   ```

   **Options:**
   - `-p, --port <number>`: Port to run the server on (default: `3000` or `process.env.PORT`).
   - `-d, --db-dir <path>`: Local absolute or relative path where user UUID folders and JSON databases will persist (default: `./data`).
   - `--ssl`: Native flag that boots an HTTPS server rather than HTTP. (Requires `server.key` and `server.cert` to reside in the execution scope).

## Configuration Extras

- **Simulating Secure Cookies:** You can bypass generating complex SSL environments but still force the frontend to natively swallow cross-domain `Secure` and `SameSite=None` attributes purely via HTTP.
  ```bash
  curl -X POST http://localhost:3000/config/force-secure-cookies -H "Content-Type: application/json" -d '{"enabled": true}'
  ```

## Deployment Instructions (Render / Railway)

1. **Connect Repository:** Link your GitHub repository to your Render or Railway dashboard.
2. **Build Settings:**
   - **Environment:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
3. **Environment Variables:**
   - Ensure you set any deployment-specific variables if necessary.
4. **Data Persistence Context:**
   - On ephemeral hosting like Render's free tier, the `/data` folder will reset upon each deployment or sleep cycle. If you need persistent storage, attach a persistent disk (Render) or equivalent storage volume (Railway) and map it to the `/data` directory within your project workspace, or change the `DATA_DIR` path in `server.js` to point to your volume.

## API Documentation

For detailed instructions on how to interact with the API endpoints (including using `curl` and `fetch`), please refer to [API.md](./API.md).
