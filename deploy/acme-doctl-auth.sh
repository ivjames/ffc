#!/usr/bin/env bash
# certbot --manual-auth-hook for DNS-01 via DigitalOcean, using the droplet's
# existing doctl auth (no plugin, no separate credentials file). Certbot calls
# this once per requested name with $CERTBOT_DOMAIN + $CERTBOT_VALIDATION set.
#
# It creates a TXT record _acme-challenge.<host> under the base DNS domain, then
# waits briefly for propagation. The cleanup counterpart removes it again.
set -euo pipefail

# The DNS zone doctl manages. Override with FFC_DNS_DOMAIN if the base domain
# differs from lab980.com.
DNS_DOMAIN="${FFC_DNS_DOMAIN:-lab980.com}"

# Record name is _acme-challenge.<the part of the domain before .DNS_DOMAIN>.
# For an apex challenge (CERTBOT_DOMAIN == DNS_DOMAIN) the name is just
# "_acme-challenge". For "*.ffc.lab980.com" certbot passes CERTBOT_DOMAIN as
# "ffc.lab980.com", so the record is "_acme-challenge.ffc".
host="${CERTBOT_DOMAIN%".$DNS_DOMAIN"}"
if [ "$host" = "$CERTBOT_DOMAIN" ]; then
  record_name="_acme-challenge"          # apex
else
  record_name="_acme-challenge.$host"
fi

doctl compute domain records create "$DNS_DOMAIN" \
  --record-type TXT \
  --record-name "$record_name" \
  --record-data "$CERTBOT_VALIDATION" \
  --record-ttl 30 >/dev/null

# Give DO's nameservers a moment to serve the new record before certbot asks
# Let's Encrypt to validate. DNS-01 propagation on DO is typically seconds.
sleep 30
