# Deploy

This page owns how VendeYa is deployed: the container stack, its env file, the
public route, backups and the drill that proves them. For what the backend does
once it runs, see [Operations](./operations.md).

The stack is [`deploy/compose.prod.yml`](../deploy/compose.prod.yml). Run it on
a host with Docker Compose. It publishes no port.

## Services

| Service       | Image                       | Does                                                         |
| ------------- | --------------------------- | ------------------------------------------------------------ |
| `postgres`    | `postgres:18-alpine`        | The database server. Reachable only on the `db` network.     |
| `migrate`     | the backend image           | Applies the schema once, then exits. `backend` waits for it. |
| `backend`     | `ghcr.io/…/chatbot/backend` | The API, the webhook handler and the workers.                |
| `web`         | `ghcr.io/…/chatbot/web`     | The dashboard. Relays `/api/*` to `backend`. Port 3000.      |
| `cloudflared` | `cloudflare/cloudflared`    | Connects the stack to Cloudflare with `TUNNEL_TOKEN`.        |
| `backup`      | `ghcr.io/…/chatbot/backup`  | Backs up at start and then every `BACKUP_INTERVAL_SECONDS`.  |

The `db` network has no route out. `postgres` and `migrate` sit only on it.
`backend` and `backup` sit on both networks, `web` and `cloudflared` on `edge`.

The `data` volume holds the backend's SQLite file, its uploads and its private
files. The `postgres` volume holds the Postgres data directory. The backend
reads and writes SQLite; it does not read `postgres` yet. `migrate` runs
[`db/migrate-cli.ts`](../apps/backend/src/db/migrate-cli.ts), which applies the
Postgres migrations that have not run. `backend` and `migrate` get
`DATABASE_URL` from `POSTGRES_PASSWORD`, so the password must not contain `/`,
`@`, `:`, `?` or `#`. The `account` command run in the backend container writes
to Postgres.

## Images

[`deploy.yml`](../.github/workflows/deploy.yml) runs on every push to `master`.
It builds only the images whose inputs changed and pushes each to
`ghcr.io/totallynotdavid/chatbot/<image>` tagged
`sha-<first 7 characters of the commit>`:

| Image     | Rebuilt when a push changes                                                    |
| --------- | ------------------------------------------------------------------------------ |
| `backend` | `apps/backend`, a package it uses, `bun.lock`, its Dockerfile                  |
| `web`     | `apps/frontend`, `packages/{types,utils,tsconfig}`, `bun.lock`, its Dockerfile |
| `backup`  | `deploy/backup`                                                                |

The images are built from [`backend.Dockerfile`](../deploy/backend.Dockerfile),
[`web.Dockerfile`](../deploy/web.Dockerfile) and
[`backup/Dockerfile`](../deploy/backup/Dockerfile). The two Bun images take the
Bun version from `mise.toml` as the `BUN_VERSION` build argument. The images run
as a non-root user.

An image keeps its old tag until a push changes its inputs, so each image has
its own tag in the env file. Read the tags on the repository's Packages page, or
with `docker image ls` after a pull.

### Registry access

GitHub Container Registry keeps a package private until its owner makes it
public, and the host pulls the images, so give the host a login. Create a
personal access token (classic) with only the `read:packages` scope, and sign in
as its owner:

```sh
printf '%s' "$TOKEN" | docker login ghcr.io -u <github user> --password-stdin
```

Docker stores the login in the host's Docker config, so the stack pulls without
further steps. A fork pushes to `ghcr.io/<owner>/<repository>` in lower case,
and sets `IMAGE_REPOSITORY` in the env file to that path. A package made public
in its settings needs no login.

## Backup storage

`backup` writes to a restic repository on S3. Create the bucket and a key that
can only reach it.

On Cloudflare R2:

1. In the dashboard, open **R2 object storage** and create a bucket.
2. On **Overview**, under **Account Details**, select **Manage** next to **API
   Tokens**, then **Create Account API token**.
3. Choose the permission **Object Read & Write**, scope the token to that
   bucket, and create it. Copy the **Access Key ID** and **Secret Access Key**
   now: the dashboard shows the secret once.
4. Set the env file to
   `RESTIC_REPOSITORY=s3:https://<account id>.r2.cloudflarestorage.com/<bucket>`,
   `AWS_DEFAULT_REGION=auto`, and the two keys.

On AWS S3, create the bucket and an IAM user whose only policy is the following,
with its access key in `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:ListBucket", "s3:GetBucketLocation"],
      "Resource": "arn:aws:s3:::<bucket>"
    },
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::<bucket>/*"
    }
  ]
}
```

`RESTIC_PASSWORD` encrypts the repository and is yours to choose. Keep a copy
outside the host: without it no backup can be read.

## The public route

The stack has no public hostname and publishes no port. A Worker on workers.dev
reaches `web` through a Workers VPC service, and the service reaches `web`
through a Cloudflare Tunnel that the `cloudflared` service runs.

1. **Create the tunnel.** In the Cloudflare dashboard open **Networking >
   Tunnels** and select **Create a tunnel**. Name it and create it. The page
   offers an install command for each operating system: copy the token that
   follows `cloudflared service install` into `TUNNEL_TOKEN`, and do not run the
   command, because the stack runs the connector. Add no public hostname and no
   route. Copy the tunnel's ID.
2. **Create the VPC service.** The service points at `web` on port 3000. The
   tunnel resolves the name `web` on the `edge` network, where `cloudflared` and
   `web` sit together:

   ```sh
   npx wrangler vpc service create vendeya-web \
     --type http --tunnel-id <tunnel id> --hostname web --http-port 3000
   ```

   The dashboard has the same form under Workers VPC, **VPC Services**,
   **Create**: choose the tunnel, enter `web` as the host, provide port 3000 and
   choose **Use tunnel as resolver**. Copy the service ID. The role Connectivity
   Directory Admin is required.

3. **Deploy the Worker.** Make a directory with these two files:

   `wrangler.jsonc`:

   ```jsonc
   {
     "name": "vendeya",
     "main": "worker.ts",
     "compatibility_date": "2026-10-16",
     "vpc_services": [{ "binding": "WEB", "service_id": "<service id>" }],
   }
   ```

   `worker.ts`:

   ```ts
   export default {
     async fetch(
       request: Request,
       env: { WEB: { fetch(request: Request): Promise<Response> } },
     ): Promise<Response> {
       const url = new URL(request.url);
       const headers = new Headers(request.headers);
       headers.set("x-forwarded-host", url.host);
       headers.set("x-forwarded-proto", url.protocol.slice(0, -1));
       return env.WEB.fetch(
         new Request(`http://web:3000${url.pathname}${url.search}`, {
           method: request.method,
           headers,
           body: request.body,
           redirect: "manual",
         }),
       );
     },
   };
   ```

   Then run `npx wrangler deploy`. It prints the Worker's address,
   `https://vendeya.<account>.workers.dev`.

4. **Point the stack at it.** Set `PUBLIC_URL` to that address. Meta's callback
   URL is that address followed by `/api/webhook`
   ([The callback URL](./whatsapp.md#the-callback-url)).

SvelteKit refuses a form or multipart POST whose `Origin` differs from the
origin it computes from the request, and the dashboard uploads files that way.
`web` reads the public host and scheme from `X-Forwarded-Host` and
`X-Forwarded-Proto`, and the Worker above sets both on every request. `set`
replaces any value the client sent. Without them an upload answers 403.

## The env file

The stack reads one env file kept outside the repository. Start from
[`.env.production.example`](../.env.production.example), which lists every
variable with what happens without it:

```sh
install -D -m 600 .env.production.example /etc/vendeya/env
```

Generate the two secrets with `openssl rand -hex 32`: `SECRETS_KEY` encrypts the
WhatsApp credentials at rest, and `POSTGRES_PASSWORD` is the Postgres password.
`WHATSAPP_APP_SECRET` and the seed values come from Meta
([Connecting WhatsApp](./whatsapp.md#metas-side)).

Every command below uses this function:

```sh
dc() { docker compose --env-file /etc/vendeya/env -f deploy/compose.prod.yml "$@"; }
```

A required value left empty stops `docker compose` before it starts anything,
and the error names the variable:

```text
$ dc config --quiet
error while interpolating services.cloudflared.environment.TUNNEL_TOKEN: required variable TUNNEL_TOKEN is missing a value: set TUNNEL_TOKEN in the env file
```

The required values are the three image tags, `TUNNEL_TOKEN`, `PUBLIC_URL`,
`SECRETS_KEY`, `POSTGRES_PASSWORD`, `WHATSAPP_APP_SECRET`, `RESTIC_REPOSITORY`,
`RESTIC_PASSWORD`, `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`. The
[environment table](./operations.md#environment) describes what the backend does
without each optional one.

The compose file sets `DB_PATH`, `UPLOAD_DIR` and `PRIVATE_DIR` to paths on the
`data` volume, and `DATABASE_URL` to the `postgres` service. The env file does
not set them.

## Start

```sh
dc up -d --wait
dc ps
```

`up --wait` returns when every service is healthy and fails when one is not. On
a clean host the order is: `postgres` healthy, `migrate` done, `backend`
healthy, `web` healthy, then `cloudflared`.

Create the first account in the running backend. The password comes from the
hidden prompt, or from stdin when it is not a terminal
([Accounts](./operations.md#accounts) has the options):

```sh
printf '%s\n' "$PASSWORD" | dc exec -T backend bun src/cli/account.ts create admin
```

## Health and logs

`backend` and `web` each answer `GET /health` on port 3000 with no session, and
their healthchecks call it. `web` answers `ok`. The backend answers JSON:

```sh
dc exec backend wget -q -O - http://127.0.0.1:3000/health
```

```json
{
  "status": "healthy",
  "database": { "status": "healthy" },
  "providers": {
    "fnb": {
      "status": "healthy",
      "available": true,
      "lastError": null,
      "blockedUntil": null
    },
    "gaso": { "status": "healthy", "available": true, "...": "..." },
    "powerbi": { "status": "healthy", "available": true, "...": "..." }
  },
  "timestamp": "2026-10-16T20:59:18.779Z"
}
```

The code is 503 and `status` is `unavailable` when `SELECT 1` on the backend's
database throws. Otherwise the code is 200, and `status` is `healthy` unless
`fnb` or `gaso` is unavailable, which makes it `degraded`. `powerbi` is reported
and does not change `status`. `providers` reflects the in-memory circuit breaker
and the last error it recorded, not a live check
([`routes/health.ts`](../apps/backend/src/routes/health.ts)).

The database that `/health` probes is the one the backend reads and writes,
which is the SQLite file on the `data` volume. The backend does not use
`postgres` yet, so stopping that service leaves `/health` at 200. `postgres` has
its own healthcheck, and `backend` waits for it to start.

`cloudflared` is healthy when `cloudflared tunnel ready` succeeds. `backup` is
healthy while a backup has succeeded within two intervals.

The backend writes one JSON object per line to stdout. It writes `backend.log`
only when `LOG_DIR` is set, which the compose file does not do. `LOG_LEVEL` sets
the level, and `LOG_LEVEL_<MODULE>` overrides it for one module. Docker keeps 5
files of 10 MB for each service:

```sh
dc logs -f backend
dc logs backend | grep '"level":50'
```

## Backup

`backup` takes a backup when it starts and then every `BACKUP_INTERVAL_SECONDS`.
One backup:

1. copies the SQLite file with `sqlite3 .backup`, which is safe while the
   backend writes;
2. dumps Postgres with `pg_dump --format=custom`;
3. stores both, the uploads and the private files in the restic repository at
   `RESTIC_REPOSITORY`, as one snapshot on the host name `vendeya`;
4. keeps 7 daily, 4 weekly and 12 monthly snapshots, prunes the rest and runs
   `restic check`.

The first backup creates the repository. Take one now, or list the snapshots:

```sh
dc run --rm --no-deps backup backup.sh
dc run --rm --no-deps backup restic snapshots --host vendeya --compact
```

The scripts are in [`deploy/backup`](../deploy/backup).

## Restore

On a host with empty volumes, start Postgres, restore the latest snapshot and
start the rest:

```sh
dc up -d --wait postgres
dc run --rm --no-deps backup restore.sh
dc up -d --wait
```

To restore over a running installation, stop what writes first and pass
`--force`. Give a snapshot id to restore an older one:

```sh
dc stop backend web backup
dc run --rm --no-deps backup restore.sh <snapshot id> --force
dc up -d --wait
```

Without `--force`, `restore.sh` exits 1 when the SQLite file is not empty or
Postgres holds tables. It replaces the SQLite file, runs `pg_restore --clean`,
and copies the uploads and private files back over the volume.

## The drill

[`deploy/drill/drill.sh`](../deploy/drill/drill.sh) builds the three images from
the checkout and runs the stack in a throwaway compose project beside a Graph
fake and an S3 server. It needs Docker and the `openssl` command:

```sh
bash deploy/drill/drill.sh
```

It checks that:

1. `up -d --wait` brings every service healthy on a clean host;
2. a webhook POST signed with `WHATSAPP_APP_SECRET` to `web` produces a text
   reply on the Graph fake, and one signed wrongly is refused;
3. `web` accepts a multipart POST from the public origin and refuses one from
   another;
4. an account created before a backup is still there after both volumes are
   deleted and the backup is restored, and so is a row in Postgres;
5. a second `restore.sh` without `--force` refuses.

It removes everything it created on exit. `KEEP=1` leaves the stack up and
prints the path of its env file.

The tunnel is not part of the drill: `cloudflared` needs a real `TUNNEL_TOKEN`,
so the drill leaves it out.
