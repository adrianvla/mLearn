# mLearn Management Console

A self-hosted Docker management console for the mLearn language-learning stack. Ships as a single Docker image and runs as a service inside a Docker Compose deployment.

## What This Is

An admin appliance for school IT administrators and self-hosters. After `docker compose up -d`, open the management console in a browser to:

- View the health and status of all mLearn services
- Start, stop, and restart containers
- Tail and search container logs (with automatic secret redaction)
- Inspect safe deployment configuration (secrets are masked)
- Check storage volumes and bind mounts
- Review AI provider status (local vs. cloud)
- Verify school deployment safety posture

## What This Is Not

- Not a SaaS admin panel
- Not a generic Docker/Portainer replacement
- Not a public cloud dashboard
- Not a development debug tool
- Does not expose secrets, API keys, or tokens
- Does not perform destructive data/volume deletion (v1)

## Quick Start

```bash
cd management/
cp .env.example .env
# Edit .env — set MLEARN_MANAGEMENT_TOKEN to a strong random string
docker compose up -d
```

Then open `http://127.0.0.1:3000` in a browser.

If you did not set a token, one is generated on first boot:

```bash
docker compose logs mlearn-management 2>&1 | grep "admin token"
```

Generated tokens are persisted in the management data volume and printed again
on restart. If an older install only has a hash-only token file, delete the
token file or set `MLEARN_MANAGEMENT_TOKEN` to choose a new token.

To reset a generated token from the command line:

```bash
# Local development
cd management/backend
cargo run -- reset-admin-token

# Docker, while the management service is running
cd management
docker compose exec mlearn-management ./mlearn-management reset-admin-token
docker compose restart mlearn-management

# Docker, if the management service is stopped
cd management
docker compose run --rm --no-deps mlearn-management ./mlearn-management reset-admin-token
docker compose up -d mlearn-management
```

## Development

### Backend (Rust)

```bash
cd management/backend
cargo run    # serves http://127.0.0.1:3000
cargo test   # run all tests
```

### Frontend (SolidJS)

```bash
cd management/frontend
npm install
npm run dev    # Vite dev server on http://127.0.0.1:5173 (proxies /api to :3000)
npm test       # run tests
npm run build  # production build → dist/
```

### Full Stack (dev)

Terminal 1: `cd management/backend && cargo run`
Terminal 2: `cd management/frontend && npm run dev`
Open `http://127.0.0.1:5173`

## Environment Variables

See [`.env.example`](.env.example) for the full list with documentation.

| Variable | Default | Description |
|----------|---------|-------------|
| `MLEARN_COMPOSE_PROJECT` | `mlearn` | Docker Compose project name to scope container management |
| `MLEARN_MANAGEMENT_PORT` | `3000` | Port the console listens on |
| `MLEARN_BIND_ADDRESS` | `127.0.0.1` | Bind address. Use `0.0.0.0` only behind a reverse proxy |
| `MLEARN_MANAGEMENT_PUBLIC_URL` | `http://127.0.0.1:3000` | Navigable browser origin used in desktop login links. Set this to the external HTTPS origin behind a reverse proxy |
| `MLEARN_MANAGEMENT_TOKEN` | _(empty)_ | Admin token for API auth. Generated on first boot if empty |
| `MLEARN_MANAGEMENT_TOKEN_HASH` | _(empty)_ | Pre-hashed token (SHA-256 hex). Takes precedence over plaintext |
| `MLEARN_ENV` | `production` | `production` (fail-closed auth) or `development` |
| `MLEARN_DEPLOYMENT_MODE` | `self-hosted` | `local-only`, `self-hosted`, or `cloud-connected` |

## Security Model

- **Bound to localhost by default.** The console only listens on `127.0.0.1`. Setting `MLEARN_BIND_ADDRESS=0.0.0.0` without a reverse proxy + TLS is dangerous.
- **Admin token required.** All `/api/*` endpoints (except `/api/health`) require a valid Bearer token. In production mode with no token configured, ALL authenticated requests are rejected (fail-closed).
- **No Docker socket exposure to the browser.** The frontend never accesses Docker directly — all operations go through the Rust backend, which validates and scopes every action.
- **Secret redaction.** The backend redacts secrets from all API responses and log lines before sending them to the frontend. Key names matching `KEY`, `TOKEN`, `SECRET`, `PASSWORD`, etc. and values matching API key patterns (`sk-...`, `AKIA...`, JWTs, long hex/base64) are masked.
- **Scoped to mLearn project.** Container actions are validated against the `com.docker.compose.project` label. Actions on non-mLearn containers are rejected.
- **No destructive operations in v1.** Volume deletion, container removal, and image pruning are intentionally not implemented.

## Docker Socket Assumptions

The management container mounts `/var/run/docker.sock` (read-only) to communicate with the Docker daemon. This is required for the console to function.

The socket mount grants significant host access. In production:
1. Run the management container on a trusted host
2. Keep it bound to `127.0.0.1`
3. Use a reverse proxy (nginx/caddy) with TLS if remote access is needed
4. Never expose the management port directly to the internet

When using a reverse proxy, set `MLEARN_MANAGEMENT_PUBLIC_URL` to its external
origin (for example, `https://mlearn.school.edu`). Do not set it to the
container bind address `0.0.0.0` or `::`; those are listening addresses, not
navigable browser destinations.

## Architecture

```
┌─────────────────────────────────────────────┐
│  Browser (admin)                            │
│  ┌───────────────────────────────────────┐  │
│  │  SolidJS SPA (embedded static assets) │  │
│  └───────────────┬───────────────────────┘  │
└──────────────────┼──────────────────────────┘
                   │ HTTP (Bearer token)
┌──────────────────┼──────────────────────────┐
│  mlearn-management container                │
│  ┌──────────────▼───────────────────────┐  │
│  │  Rust backend (axum)                 │  │
│  │  - Auth middleware                   │  │
│  │  - Secret redaction                  │  │
│  │  - Input validation                  │  │
│  │  - Project scoping                   │  │
│  └──────────────┬───────────────────────┘  │
│                 │ bollard (Unix socket)     │
└─────────────────┼───────────────────────────┘
                  │
┌─────────────────┼───────────────────────────┐
│  Docker daemon (/var/run/docker.sock)       │
│  - mlearn-backend container                 │
│  - mlearn-app container                     │
│  - other mLearn services                    │
└─────────────────────────────────────────────┘
```

## License

Sustainable Use License v1.0. See the root [LICENSE](../LICENSE) file.

## TODO

- [ ] Localization (currently English-only)
- [ ] Config editing for safe values
- [ ] WebSocket log streaming
- [ ] Volume size monitoring (via `docker system df`)
- [ ] Container resource metrics (CPU/memory)
- [ ] Multi-project support
