# Deployment

Installs mise, bun, prompts for credentials, builds frontend, installs systemd services:

```bash
chmod +x deployment/deploy.sh
sudo deployment/deploy.sh .env.production
```

It starts the following services:

```
totem-backend.service    :3000
totem-notifier.service   :3001
totem-frontend.service   :80
```

Useful commands:

```bash
# Status
sudo systemctl status totem-*

# Logs
sudo journalctl -u totem-backend -f

# Restart
sudo systemctl restart totem-*

# Health
curl localhost:3000/health
```

To trigger a reconfiguration, remove the .env.production file and run deploy.sh again:

```bash
rm .env.production
bash deployment/deploy.sh
```
