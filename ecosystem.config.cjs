/**
 * PM2 ecosystem file.
 *
 * `pnpm start`       → boot orchestrator + web
 * `pnpm logs`        → tail aggregated logs
 * `pnpm monit`       → live dashboard
 * `pnpm restart`     → reload both
 */
const path = require('node:path');
const ROOT = __dirname;

module.exports = {
  apps: [
    {
      name: 'orchestrator',
      cwd: path.join(ROOT, 'apps/orchestrator'),
      // Point at the real .cjs entry of tsx (the .bin shim is a bash script
      // that Node can't execute directly).
      script: path.join(ROOT, 'apps/orchestrator/node_modules/tsx/dist/cli.cjs'),
      args: 'watch src/index.ts',
      interpreter: 'node',
      env: {
        NODE_ENV: 'development',
      },
      watch: false,
      autorestart: true,
      max_memory_restart: '1G',
      error_file: path.join(ROOT, 'logs/orchestrator-error.log'),
      out_file: path.join(ROOT, 'logs/orchestrator-out.log'),
      merge_logs: true,
      time: true,
    },
    {
      name: 'web',
      cwd: path.join(ROOT, 'apps/web'),
      script: path.join(ROOT, 'apps/web/node_modules/vite/bin/vite.js'),
      args: '',
      interpreter: 'node',
      env: {
        NODE_ENV: 'development',
      },
      watch: false,
      autorestart: true,
      error_file: path.join(ROOT, 'logs/web-error.log'),
      out_file: path.join(ROOT, 'logs/web-out.log'),
      merge_logs: true,
      time: true,
    },
  ],
};
