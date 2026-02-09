// PM2 ecosystem config for Clawgent
module.exports = {
  apps: [
    {
      name: "clawgent",
      script: "./node_modules/.bin/tsx",
      args: "server.ts",
      cwd: "/opt/clawgent/app",
      env: {
        NODE_ENV: "production",
        PORT: "3001",
      },
      // Restart on crash, but not on clean exit
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      // Kill unresponsive process after 8s before sending SIGKILL
      kill_timeout: 8000,
      // Restart if memory exceeds 1.5 GB (leak protection)
      max_memory_restart: "1500M",
      // Log files
      error_file: "/opt/clawgent/logs/error.log",
      out_file: "/opt/clawgent/logs/out.log",
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      // Watch for changes (disabled in prod — use deploy.sh)
      watch: false,
    },
  ],
};
