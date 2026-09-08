#!/bin/bash
set -euo pipefail

cp /tmp/erp.nginx /etc/nginx/sites-available/erp.bretunetch.com
ln -sfn /etc/nginx/sites-available/erp.bretunetch.com /etc/nginx/sites-enabled/erp.bretunetch.com

# Same-origin API URL so frontend works for whichever hostname resolves
printf 'NEXT_PUBLIC_API_URL=/api\n' > /opt/nexuserp/apps/web/.env.local

# Allow both candidate origins for CORS
python3 - <<'PY'
from pathlib import Path
p = Path('/opt/nexuserp/apps/api/.env')
lines = []
for line in p.read_text().splitlines():
    if line.startswith('WEB_ORIGIN='):
        lines.append('WEB_ORIGIN="https://erp.bretunetch.com,https://erp.bretunetech.com,http://erp.bretunetch.com,http://erp.bretunetech.com"')
    else:
        lines.append(line)
p.write_text('\n'.join(lines) + '\n')
print('api env updated')
PY

cd /opt/nexuserp
npm run build -w @nexuserp/web
pm2 restart nexuserp-api nexuserp-web
nginx -t
systemctl reload nginx
sleep 3
curl -sS -H 'Host: erp.bretunetch.com' http://127.0.0.1/api/health; echo
curl -sI -H 'Host: erp.bretunetch.com' http://127.0.0.1/login | head -5
pm2 status
echo READY_WAITING_DNS
