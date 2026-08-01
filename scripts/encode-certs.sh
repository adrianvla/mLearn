#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 3 ]]; then
  cat >&2 <<EOF
Usage: ./scripts/encode-certs.sh <certificate.p12> <AuthKey_XXXX.p8> <csc_password>

  certificate.p12  — export of your Developer ID Application identity from Keychain
  AuthKey_XXXX.p8  — App Store Connect API key downloaded from appstoreconnect.apple.com
  csc_password     — password you chose when exporting the certificate

Prints the exact `gh secret set` commands to add all 5 GitHub secrets.
EOF
  exit 1
fi

CERT_PATH="$1"
API_KEY_PATH="$2"
CSC_PASSWORD="$3"

CERT_B64="$(base64 -i "$CERT_PATH" | tr -d '\n')"
APIKEY_B64="$(base64 -i "$API_KEY_PATH" | tr -d '\n')"

read -r -p "Enter App Store Connect API Key ID (e.g. ABC123XYZ): " API_KEY_ID
read -r -p "Enter App Store Connect Issuer ID (UUID):             " ISSUER_ID

cat <<EOF

gh secret set MACOS_CSC_LINK --body '$CERT_B64'
gh secret set MACOS_CSC_KEY_PASSWORD --body '$CSC_PASSWORD'
gh secret set APPLE_API_KEY_BASE64 --body '$APIKEY_B64'
gh secret set APPLE_API_KEY_ID --body '$API_KEY_ID'
gh secret set APPLE_API_ISSUER --body '$ISSUER_ID'
EOF

echo ""
echo "✅ Run the 5 commands above, then push a 'v*' tag to trigger the release workflow."
