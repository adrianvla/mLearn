# mLearn Self-Hosted Deployment Guide

This document explains how the management console fits into a self-hosted Docker Compose deployment for schools and institutions.

## Deployment Modes

The management console recognizes three deployment modes (set via `MLEARN_DEPLOYMENT_MODE`):

### Local-Only

All mLearn services run on a single machine. No network exposure. The management console is accessed from the same machine via `http://127.0.0.1:3000`.

- Safest mode
- No external network access required
- AI runs locally (Ollama or built-in models)
- Recommended for classroom/lab machines

### Self-Hosted

mLearn services run on an institution-managed server. The management console may be accessed from within the school network.

- Institution controls the infrastructure
- Network access within the school required
- AI can be local or institution-hosted
- Requires the institution to manage TLS/SSL if accessed remotely

### Cloud-Connected

The deployment uses hosted cloud features (e.g., Cloud LLM relay at `mlearn-cloud.kikan.net`).

- Cloud LLM access is age-gated (18+)
- Institution is the data controller
- Review [SCHOOL_DEPLOYMENT.md](../SCHOOL_DEPLOYMENT.md) for compliance responsibilities

## Compose Stack Architecture

```yaml
services:
  mlearn-management:    # This console (always runs)
  mlearn-backend:       # Python FastAPI NLP backend (port 7752)
  mlearn-app:           # Electron-equivalent app server (port 7753)
```

The management service is the **only** service that mounts the Docker socket. It acts as the security boundary between the browser and Docker.

## School Deployment Checklist

1. **Set a strong admin token**
   ```bash
   # Generate a random token
   openssl rand -hex 32
   # Set it in .env
   echo "MLEARN_MANAGEMENT_TOKEN=<your-token>" >> .env
   ```

2. **Verify localhost binding**
   - Default `MLEARN_BIND_ADDRESS=127.0.0.1` is correct for local access
   - For network access, use a reverse proxy with TLS — never expose port 3000 directly

3. **Check AI configuration**
   - `MLEARN_LOCAL_AI_ENABLED=true` — local AI is available
   - `MLEARN_CLOUD_AI_ENABLED=false` — cloud LLM is disabled (recommended for schools)
   - If cloud AI is enabled, ensure age-gating and consent requirements are met

4. **Verify the console is healthy**
   ```bash
   docker compose ps
   docker compose exec mlearn-management wget -qO- http://127.0.0.1:3000/api/health
   ```

5. **Review the School Deployment page** in the console for safety warnings

## Security Assumptions

- The Docker socket (`/var/run/docker.sock`) is mounted read-only into the management container
- The management container runs as a non-root user
- All API endpoints (except `/api/health`) require a valid Bearer token
- Secret values are redacted from all API responses and log output
- Container actions are scoped to the configured Compose project
- No destructive operations (volume deletion, container removal) are available in v1

## Why Destructive Operations Are Disabled

The management console is designed for safe day-to-day operation by school IT staff who may not be Docker experts. Accidental data loss (deleting a volume with student flashcards, removing a container mid-lesson) would be catastrophic. Destructive operations require direct Docker CLI access on the host, which creates an intentional barrier.

## Backup Strategy

The management console does not manage backups. The institution is responsible for:
- Backing up the `mlearn-app-data` volume (student flashcards, settings)
- Backing up the `mlearn-language-data` volume (dictionaries, language packages)
- Testing restore procedures

See [SCHOOL_DEPLOYMENT.md §4.4 Data Backup](../SCHOOL_DEPLOYMENT.md) for details.

## Network Configuration

| Port | Service | Purpose |
|------|---------|---------|
| 3000 | mlearn-management | Admin console (bind 127.0.0.1) |
| 7752 | mlearn-backend | Python NLP backend (internal) |
| 7753 | mlearn-app | App server for browser/mobile access |
| 11434 | _(host)_ | Ollama local AI (if used) |

All ports bind to `127.0.0.1` by default. For network access, configure a reverse proxy:

```nginx
server {
    listen 443 ssl;
    server_name mlearn.school.edu;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

## Upgrading

```bash
cd management/
git pull
docker compose build mlearn-management
docker compose up -d mlearn-management
```

The management data volume (`mlearn-management-data`) persists the admin token across restarts.
