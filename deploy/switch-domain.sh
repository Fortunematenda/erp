#!/bin/bash
set -euo pipefail

DOMAIN=erp.bretunetech.com

# Remove broken/old site
rm -f /etc/nginx/sites-enabled/erp.bretunetch.com
rm -f /etc/nginx/sites-available/erp.bretunetch.com

cp /tmp/erp.bretunetech.com.nginx /etc/nginx/sites-available/${DOMAIN}
ln -sfn /etc/nginx/sites-available/${DOMAIN} /etc/nginx/sites-enabled/${DOMAIN}

# Update runtime env to correct domain (keep existing secrets)
python3 - <<'PY'
from pathlib import Path
api = Path('/opt/nexuserp/apps/api/.env')
text = api.read_text()
lines = []
for line in text.splitlines():
    if line.startswith('WEB_ORIGIN='):
        lines.append('WEB_ORIGIN="https://erp.bretunetech.com"')
    else:
        lines.append(line)
api.write_text('\n'.join(lines) + '\n')
Path('/opt/nexuserp/apps/web/.env.local').write_text('NEXT_PUBLIC_API_URL=https://erp.bretunetech.com/api\n')
print('env updated')
PY

# Rebuild web so NEXT_PUBLIC_API_URL is baked in
cd /opt/nexuserp
npm run build -w @nexuserp/web

pm2 restart nexuserp-api nexuserp-web
sleep 3

nginx -t
systemctl reload nginx

echo '=== checks ==='
curl -sS -H "Host: ${DOMAIN}" http://127.0.0.1/api/health; echo
curl -sI -H "Host: ${DOMAIN}" http://127.0.0.1/login | head -6

certbot --nginx -d ${DOMAIN} --non-interactive --agree-tos --register-unsafely-without-email --redirect

echo '=== https ==='
curl -sS https://${DOMAIN}/api/health; echo
curl -sI https://${DOMAIN}/login | head -8
pm2 status
echo DOMAIN_FIX_DONE
