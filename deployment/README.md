# Deployment

Deploy to Ubuntu server:

```bash
./scripts/deploy.sh
```

The script installs mise, Bun (via mise), grants port 80 access, builds frontend, and sets up systemd services.

Edit `.env.production` with your secrets:
```
NODE_ENV=production
BACKEND_URL=http://localhost:3001
PORT=3001
DATABASE_PATH=./data/database.sqlite
JWT_SECRET=
WHATSAPP_API_TOKEN=
```

Service commands:
```bash
sudo systemctl status totem-frontend
sudo journalctl -u totem-frontend -f
sudo systemctl restart totem-frontend
```

Backend runs on localhost:3001. Frontend runs on 0.0.0.0:80. Frontend makes server-side calls to backend.
