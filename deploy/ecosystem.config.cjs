module.exports = {
  apps: [
    {
      name: 'nexuserp-api',
      cwd: '/opt/nexuserp/apps/api',
      script: 'dist/src/main.js',
      env: { NODE_ENV: 'production' },
      max_memory_restart: '512M',
    },
    {
      name: 'nexuserp-web',
      cwd: '/opt/nexuserp/apps/web',
      script: '/opt/nexuserp/node_modules/next/dist/bin/next',
      args: 'start -p 3020',
      env: { NODE_ENV: 'production', PORT: '3020' },
      max_memory_restart: '512M',
    },
  ],
};
