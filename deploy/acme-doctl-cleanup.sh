#!/usr/bin/env bash
# certbot --manual-cleanup-hook counterpart to acme-doctl-auth.sh: delete the
# _acme-challenge TXT record(s) doctl created for this validation. Best-effort —
# never fail the renewal because cleanup hiccuped.
set -euo pipefail

DNS_DOMAIN="${FFC_DNS_DOMAIN:-lab980.com}"

host="${CERTBOT_DOMAIN%".$DNS_DOMAIN"}"
if [ "$host" = "$CERTBOT_DOMAIN" ]; then
  record_name="_acme-challenge"
else
  record_name="_acme-challenge.$host"
fi

# Find and delete every matching TXT record (there can be more than one when a
# cert covers both the apex and a wildcard for the same name).
doctl compute domain records list "$DNS_DOMAIN" --no-header \
  --format ID,Type,Name,Data 2>/dev/null \
| while read -r id type name data; do
    if [ "$type" = "TXT" ] && [ "$name" = "$record_name" ] && [ "$data" = "$CERTBOT_VALIDATION" ]; then
      doctl compute domain records delete "$DNS_DOMAIN" "$id" -f >/dev/null 2>&1 || true
    fi
  done
