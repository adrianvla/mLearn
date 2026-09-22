FROM node:20-slim AS frontend-builder
WORKDIR /build/management/frontend
COPY management/frontend/package.json management/frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY management/frontend/ ./
COPY src/html/assets/icons/logo.png /build/src/html/assets/icons/logo.png
RUN npm run build

FROM rust:1.98.1-bookworm AS backend-builder
WORKDIR /build
COPY management/backend/ ./management/backend/
COPY --from=frontend-builder /build/management/frontend/dist ./management/frontend/dist
RUN touch management/backend/src/main.rs && cargo build --locked --release --manifest-path management/backend/Cargo.toml

FROM debian:bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates wget && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=backend-builder /build/management/backend/target/release/mlearn-management /app/mlearn-management
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget --spider -q http://127.0.0.1:3000/api/health || exit 1
CMD ["./mlearn-management"]
