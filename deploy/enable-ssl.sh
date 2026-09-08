#!/bin/bash
set -euo pipefail

DOMAIN=erp.bretunetech.com

# Ensure nginx lists the correct names
cp /tmp/erp.nginx /etc/nginx/sites-available/erp.bretunetch.com
ln -sfn /etc/nginx/sites-available/erp.bretunetch.com /etc/nginx/sites-enabled/erp.bretunetch.com
nginx -t
systemctl reload nginx

# Prefer correct primary domain CORS/origin
python3 - <<'PY'
from pathlib import Path
p = Path('/opt/nexuserp/apps/api/.env')
lines = []
for line in p.read_text().splitlines():
    if line.startswith('WEB_ORIGIN='):
        lines.append('WEB_ORIGIN="https://erp.bretunetech.com,http://erp.bretunetech.com,https://erp.bretunetch.com,http://erp.bretunetch.com"')
    else:
        lines.append(line)
p.write_text('\n'.join(lines) + '\n')
print('origin updated')
PY
pm2 restart nexuserp-api --update-env

certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect

echo '=== local https ==='
curl -sS "https://${DOMAIN}/api/health"; echo
curl -sI "https://${DOMAIN}/login" | head -12
echo '=== http redirect ==='
curl -sI "http://${DOMAIN}/login" | head -10
pm2 status | sed -n '1,20p'
echo SSL_DONE
