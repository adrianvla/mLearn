FROM node:20-slim AS frontend-builder
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install --legacy-peer-deps
COPY frontend/ ./
RUN npm run build

FROM rust:1-bookworm AS backend-builder
WORKDIR /build
COPY backend/ ./backend/
COPY --from=frontend-builder /build/frontend/dist ./frontend/dist
RUN touch backend/src/main.rs && cargo build --release --manifest-path backend/Cargo.toml

FROM debian:bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates wget && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=backend-builder /build/backend/target/release/mlearn-management /app/mlearn-management
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget --spider -q http://127.0.0.1:3000/api/health || exit 1
CMD ["./mlearn-management"]
