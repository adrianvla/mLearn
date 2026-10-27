#!/usr/bin/env bash
set -euo pipefail

# CI-only: retain Ubuntu's signed metadata and package hashes, but avoid the
# hosted Azure mirror stalls recorded before either consuming suite could run.
mkdir -p verification
cp /etc/apt/apt-mirrors.txt verification/apt-mirrors-before.txt
printf '%s\n' 'https://archive.ubuntu.com/ubuntu/' | sudo tee /etc/apt/apt-mirrors.txt
cp /etc/apt/apt-mirrors.txt verification/apt-mirrors-used.txt
printf '%s\n' \
  'Acquire::http::Timeout "30";' \
  'Acquire::https::Timeout "30";' \
  'Acquire::Retries "2";' \
  | sudo tee /etc/apt/apt.conf.d/99-mlearn-network
cp /etc/apt/apt.conf.d/99-mlearn-network verification/apt-network-options.txt
