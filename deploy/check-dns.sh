#!/bin/bash
echo '=== dig ==='
for h in bretunetech.com www.bretunetech.com erp.bretunetech.com bretunetch.com erp.bretunetch.com tradeflow.bretunetech.com; do
  echo -n "$h -> "
  dig +short "$h" A | tr '\n' ' '
  echo
done
echo '=== server_name ==='
grep -Rh 'server_name' /etc/nginx/sites-enabled/ | sort -u
echo '=== app status ==='
curl -sS http://127.0.0.1:4020/api/health; echo
curl -sI http://127.0.0.1:3020/login | head -5
pm2 describe nexuserp-api | sed -n '1,25p'
