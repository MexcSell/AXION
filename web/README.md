# AXION web

The React and TypeScript client connects to the AXION API for accounts, missions, approvals, conversations, artifacts, agents and cloud model providers. Browser preferences include navigation, theme and accessibility.

## Run

Start the API in one terminal. Its PostgreSQL configuration is described in [the server README](../server/README.md).

```bash
cd server
npm ci
npm start
```

Build and serve the frontend in a second terminal, starting from the repository root.

```bash
cd web
npm ci
npm run build
npm start
```

The compiled app listens on 127.0.0.1:5190 and proxies API requests to 127.0.0.1:5191. To connect through SSH, run `ssh -L 5190:127.0.0.1:5190 <vps>` and open <http://localhost:5190>. During development, `npm run dev` starts Vite with hot reload.

## Sign in

Enter a name and password on the Connect screen. The first registered user becomes the administrator. Later users and new devices wait for approval in **Settings › Users**. If the API is unavailable, the sign-in screen shows the connection error and retries. An administrator who loses access to their device can run `npm run admin:approve-device -- <name>` in the server directory.

## Cloud models

Open **System Operations › Models › Providers** to view configured models and their latest connection and quota checks. Administrators can refresh, enable, disable or remove a model. Use **Playground** to send a prompt to an enabled model.

## Verify

Run `npm run typecheck` and `npm run build` in this directory. Run `npm test` in the server directory for API tests against the configured test database.
