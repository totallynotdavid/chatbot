const isWindows = process.platform === "win32";

module.exports = {
  apps: [
    {
      name: "backend",
      script: isWindows ? "cmd" : "sh",
      args: isWindows
        ? ["/c", "bun", "src/index.ts", "--env-file=../../.env"]
        : ["-c", "bun src/index.ts --env-file=../../.env"],
      exec_mode: "fork",
      cwd: "apps/backend",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    },
    {
      name: "frontend",
      script: isWindows ? "cmd" : "sh",
      args: isWindows
        ? ["/c", "bun", "dist/index.js"]
        : ["-c", "bun dist/index.js"],
      exec_mode: "fork",
      cwd: "apps/frontend",
      env: {
        PORT: 5173,
      },
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    },
    {
      name: "notifier",
      script: isWindows ? "cmd" : "sh",
      args: isWindows
        ? ["/c", "bun", "src/index.ts", "--env-file=../../.env"]
        : ["-c", "bun src/index.ts --env-file=../../.env"],
      exec_mode: "fork",
      cwd: "apps/notifier",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    },
    {
      name: "tunnel",
      script: "scripts/tunnel.ts",
      interpreter: "bun",
      args: ["start"],
      exec_mode: "fork",
      cwd: ".",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    },
  ],
};
