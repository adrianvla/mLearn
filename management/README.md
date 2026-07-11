# mLearn Management Console

A self-hosted Docker management console for the mLearn language-learning stack. Ships as a single Docker image and runs as a service inside a Docker Compose deployment.

## What This Is

The self-hosted school control plane for administrators and teachers. After `docker compose up -d`, open the management console in a browser to:

- Manage administrator, teacher, and learner accounts in permission-scoped groups
- Publish inherited policies and lock settings in the mLearn app
- Route learner LLM requests through school-owned providers and hard quotas
- Review permission-scoped, encrypted learner conversation history and usage
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

### Frontend (React 19 + HeroUI 3)

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

The production console uses named user sessions, an authorized active-group
scope, and permission-aware navigation. Use `/bootstrap` once with the recovery
credential to create the first root administrator; the recovery credential is
sent only to that endpoint and is never stored by the browser. Operational
container, storage, distribution, and redacted-log tools live under
**Settings → Diagnostics** and require the root administrator.

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
| `MLEARN_ENCRYPTION_KEY_PATH` | `/data/encryption-key` | Protected persistent 32-byte AES key; generated atomically with mode `0600` when absent |
| `MLEARN_ENCRYPTION_KEY` | _(empty)_ | Optional externally managed key using `hex:` or unpadded `base64url:` encoding |
| `MLEARN_POLICY_SIGNING_KEY_PATH` | `/data/policy-signing-key` | Protected persistent Ed25519 policy-signing key |
| `MLEARN_CONVERSATION_RETENTION_DAYS` | `90` | Days to retain encrypted conversation content (`1..3650`) |
| `MLEARN_ENV` | `production` | `production` (fail-closed auth) or `development` |
| `MLEARN_DEPLOYMENT_MODE` | `self-hosted` | `local-only`, `self-hosted`, or `cloud-connected` |

## Security Model

- **Bound to localhost by default.** The console only listens on `127.0.0.1`. Setting `MLEARN_BIND_ADDRESS=0.0.0.0` without a reverse proxy + TLS is dangerous.
- **Admin token required.** All `/api/*` endpoints (except `/api/health`) require a valid Bearer token. In production mode with no token configured, ALL authenticated requests are rejected (fail-closed).
- **No Docker socket exposure to the browser.** The frontend never accesses Docker directly — all operations go through the Rust backend, which validates and scopes every action.
- **Secret redaction.** The backend redacts secrets from all API responses and log lines before sending them to the frontend. Key names matching `KEY`, `TOKEN`, `SECRET`, `PASSWORD`, etc. and values matching API key patterns (`sk-...`, `AKIA...`, JWTs, long hex/base64) are masked.
- **Scoped to mLearn project.** Container actions are validated against the `com.docker.compose.project` label. Actions on non-mLearn containers are rejected.
- **No destructive operations in v1.** Volume deletion, container removal, and image pruning are intentionally not implemented.
- **Encrypted provider credentials.** Provider secrets use AES-256-GCM with a random nonce and entity-bound associated data. API responses expose only `hasSecret`; health validation never returns a credential or performs an outbound request.
- **Back up keys with the database.** Back up `/data/encryption-key`, `/data/policy-signing-key`, and `/data/management.db` together. A lost encryption key cannot be reconstructed and encrypted provider credentials cannot be recovered from the database alone.

## Connect the mLearn App

The management service deliberately implements the app's existing cloud seams.
In mLearn, enable the cloud endpoint override and replace only these URLs:

- **Login URL:** the value of `MLEARN_MANAGEMENT_PUBLIC_URL`
- **API URL:** the same origin; the compatible streaming endpoint is `POST /api/llm/stream`

For example, if the console is served from your school's TLS origin, both app
URLs use that origin. Do not include `/api/llm/stream` in the API URL itself.
Desktop and browser login use the management authentication routes; Capacitor
uses the same HTTPS API and needs no Electron-only integration.

`GET /api/health` intentionally reports only process availability and does not
require a session. It does not prove that a provider is configured or reachable.
Protected identity/group management, policy, quota, conversation, and
configuration routes require a named session or an explicitly scoped service
key. Bootstrap/recovery, login, desktop-init/exchange, and refresh are public
authentication entry points with their own token, one-time-code, credential, or
rate-limit checks; they do not accept a management capability as authorization.
Provider health validation is permission-scoped and never returns a credential
or provider response body.

## LLM Providers and Governed Routing

Administrators configure providers, models, prompt profiles, and immutable price
versions through the management API or console. Supported provider kinds are:

- `openaiCompatible` for HTTPS OpenAI-compatible streaming APIs
- `ollama` for the built-in `ollama` or `mlearn-backend` Compose service

Provider URLs cannot contain credentials, queries, or fragments. Public providers
must use HTTPS. Resolution is pinned for each request, redirects and ambient
proxies are disabled, and private/link-local targets are rejected except for the
named built-in Ollama services. Put credentials in the provider secret field,
never in the URL.

Policies select providers, models, and prompt profiles by their immutable IDs.
Clients cannot choose an upstream model or inject a system prompt. Keep those IDs
stable when editing display names; replacing a resource creates a deliberate new
policy target. A request is rejected before provider contact when its active group
has no allowed route, no governed hard quota, or insufficient remaining capacity.

Prices are append-only versions stored in integer **micros** per million tokens.
For example, a currency unit is one million micros; no floating-point money is
used. Every reconciled request retains its exact price-version ID. Never edit old
price rows in place—publish a new version so historical accounting remains exact.

## Quotas, Rate Limits, and Accounting

Quota definitions use one of these metrics:

- `requests`: completed or conservatively recovered provider requests
- `inputTokens`, `outputTokens`, and `totalTokens`: integer token counts
- `costMicros`: integer micros calculated from the immutable price version

Periods are `daily`, `weekly`, `monthly`, or `term`, derived from the root
school's versioned IANA-timezone calendar. Definitions and calendar revisions are
immutable after accounting begins. A child group may tighten an ancestor limit,
but cannot enlarge it. Each reservation atomically charges the learner, active
group, and every ancestor; compatible concurrent requests cannot overspend a
parent cap.

Policy also controls `requestsPerMinute` and `maxConcurrentStreams`. These are
durable gateway leases rather than process-local counters. Pre-provider failures
release reservations without charge. Once provider headers succeed, disconnects
or crashes retain a conservative pending reservation which is reconciled exactly
once during the next quota operation. Usage frames produce exact accounting;
otherwise the record is explicitly marked estimated.

## Conversation Retention and Access

Prompts, assistant responses, and tool payloads are encrypted per message with
AES-256-GCM and row-bound associated data. Operational errors, audit records, and
container logs contain stable error codes—not prompt text, provider bodies,
credentials, ciphertext, or key material. Conversation queries still enforce live
sessions and downward group permissions: a teacher can see an authorized child
group, never a sibling or parent group. Authorized ancestors retain access to an
archived child's history.

`MLEARN_CONVERSATION_RETENTION_DAYS` controls encrypted-content retention.
Expired content is redacted in bounded opportunistic batches while accounting and
auditable metadata remain. Treat retention as a maximum, not as a backup policy.

## Key Storage, Backup, and Rotation

The preferred deployment leaves `MLEARN_ENCRYPTION_KEY` empty. On first start the
service atomically creates 32 random bytes at `MLEARN_ENCRYPTION_KEY_PATH`. If an
external secret manager is required, `MLEARN_ENCRYPTION_KEY` accepts exactly
`hex:` followed by 32 encoded bytes or unpadded `base64url:`; do not place sample
or real keys in Compose files, documentation, tickets, or logs.

On Unix, encryption and policy-signing key files must be regular, non-symlink
files and are opened with no-follow semantics and mode `0600`. The service fails
startup on malformed or unsafe key material instead of silently rotating it.
Ensure the container user owns the files and the data directory is not readable
by other host users.

Use one consistent snapshot procedure for `management.db`, its WAL state, the
encryption key, and the policy-signing key. A database backup without its matching
encryption key cannot restore provider secrets or conversations. Losing or
rotating the signing key changes the public policy identity and is a **client
trust reset**: distribute and approve the new public key before managed clients
resume. Encryption-key rotation requires an explicit decrypt-and-reencrypt
migration; replacing the file alone permanently strands existing ciphertext.

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
