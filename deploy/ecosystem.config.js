// PM2 ecosystem config for Clawgent
module.exports = {
  apps: [
    {
      name: "clawgent",
      script: "npx",
      args: "tsx server.ts",
      cwd: "/opt/clawgent/app",
      env: {
        NODE_ENV: "production",
        PORT: "3001",
      },
      // Restart on crash, but not on clean exit
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      // Log files
      error_file: "/opt/clawgent/logs/error.log",
      out_file: "/opt/clawgent/logs/out.log",
      merge_logs: true,
      // Watch for changes (disabled in prod — use deploy.sh)
      watch: false,
    },
  ],
};
