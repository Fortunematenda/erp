#!/bin/bash
set -euo pipefail

cp /tmp/ecosystem.config.cjs /opt/nexuserp/ecosystem.config.cjs
cp /tmp/erp.bretunetch.com.nginx /etc/nginx/sites-available/erp.bretunetch.com
ln -sfn /etc/nginx/sites-available/erp.bretunetch.com /etc/nginx/sites-enabled/erp.bretunetch.com

pm2 delete nexuserp-api >/dev/null 2>&1 || true
pm2 delete nexuserp-web >/dev/null 2>&1 || true
pm2 start /opt/nexuserp/ecosystem.config.cjs
pm2 save

nginx -t
systemctl reload nginx

sleep 3
echo '=== api health ==='
curl -sS -w '\nHTTP:%{http_code}\n' http://127.0.0.1:4020/api/health || true
echo '=== web ==='
curl -sI http://127.0.0.1:3020 | head -5
echo '=== nginx host ==='
curl -sI -H 'Host: erp.bretunetch.com' http://127.0.0.1/ | head -8
curl -sS -w '\nHTTP:%{http_code}\n' -H 'Host: erp.bretunetch.com' http://127.0.0.1/api/health || true

certbot --nginx -d erp.bretunetch.com --non-interactive --agree-tos --register-unsafely-without-email --redirect

pm2 status
echo FIX_DONE
