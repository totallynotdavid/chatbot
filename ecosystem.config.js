module.exports = {
  apps: [
    {
      name: 'backend',
      script: 'src/index.ts',
      interpreter: 'bun',
      args: ['--env-file=../../.env'],
      cwd: 'apps/backend'
    },
    {
      name: 'frontend',
      script: 'x vite dev --host',
      interpreter: 'bun',
      args: ['--env-file=../../.env'],
      cwd: 'apps/frontend'
    },
    {
      name: 'notifier',
      script: 'src/index.ts',
      interpreter: 'bun',
      args: ['--env-file=../../.env'],
      cwd: 'apps/notifier'
    },
    {
      name: 'tunnel',
      script: 'scripts/tunnel.ts',
      interpreter: 'bun',
      args: ['start'],
      cwd: '.'
    }
  ]
};
