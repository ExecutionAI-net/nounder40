# EC2 dev + production deployment

One EC2 instance runs two isolated Compose projects behind host Nginx:

| Branch | GitHub environment | Deploy directory | Compose project | Loopback port | Domain |
|---|---|---|---|---|---|
| `develop` | `develop` | `/home/ubuntu/nounder40` | `nounder40` | `8081` | `dev.danzaclassicanounder40.com` |
| `main` | `production` | `/home/ubuntu/nounder40-production` | `danza-prod` | `8080` | `danzaclassicanounder40.com` |

Only host Nginx binds public ports 80 and 443. The two Compose Nginx services
bind loopback ports, so their databases, Redis instances, networks, media, and
static volumes do not overlap.

## 1. DNS and AWS

Create an `A` record for `dev.danzaclassicanounder40.com` pointing to the EC2
Elastic IP. The EC2 security group must allow inbound TCP 80 and 443. Do not
open ports 8080 or 8081; they are bound to `127.0.0.1` only.

The EC2 instance role needs `secretsmanager:GetSecretValue` for:

- `nounder40/dev-config`
- `nounder40/prod-config`

The workflow pushes immutable SHA tags to four ECR repositories:

- `danza-classica/nounder40/backend-develop`
- `danza-classica/nounder40/frontend-develop`
- `danza-classica/nounder40/backend-prod`
- `danza-classica/nounder40/frontend-prod`

Store each complete env file as the secret's plain-text `SecretString`. Start
from `.env.dev.example` and `.env.prod.example`; never commit filled files.

## 2. GitHub environments

Create GitHub environments named exactly `develop` and `production`. Add these
variables to each environment:

| Variable | develop | production |
|---|---|---|
| `AWS_REGION` | `eu-west-1` | `eu-west-1` |
| `AWS_ACCOUNT_ID` | AWS account ID | AWS account ID |
| `EC2_INSTANCE_ID` | same EC2 ID | same EC2 ID |
| `EC2_DEPLOY_DIR` | `/home/ubuntu/nounder40` | `/home/ubuntu/nounder40-production` |
| `COMPOSE_FILE` | `docker-compose.run.yml` | `docker-compose.prod.yml` |
| `AWS_CONFIG_SECRET_ID` | `nounder40/dev-config` | `nounder40/prod-config` |
| `APP_HTTP_PORT` | `8081` | `8080` |
| `APP_DOMAIN` | `dev.danzaclassicanounder40.com` | `danzaclassicanounder40.com` |

Add `AWS_ROLE_TO_ASSUME` as an environment secret. Add the frontend build-time
secrets and Slack secrets to each environment as required. Protect the
`production` environment with required reviewers.

Useful checks:

```bash
gh variable list --env develop
gh variable list --env production
gh secret list --env develop
gh secret list --env production
```

## 3. Prepare both deploy directories

The SSM deployment expects an existing clone and deploy key in the same places
used by the current workflow:

```bash
sudo -u ubuntu -H git clone git@github.com:ExecutionAI-net/nounder40.git /home/ubuntu/nounder40-production
```

The deploy key is `/home/ubuntu/.ssh/nounder40_deploy_key`, and GitHub's host
key must already be present in `/home/ubuntu/.ssh/known_hosts`.

## 4. Move TLS termination to host Nginx

This is a one-time cutover and causes a short interruption while ports 80/443
move from the old Compose container to host Nginx.

Install Nginx and Certbot, create the webroot, and install the proxy snippet:

```bash
sudo apt-get update
sudo apt-get install -y nginx certbot
sudo install -d -m 755 /var/www/certbot
sudo install -m 644 nginx/nounder40-proxy.conf /etc/nginx/snippets/nounder40-proxy.conf
```

Stop the old container that currently owns ports 80/443. Install the temporary
HTTP-only configuration and start host Nginx:

```bash
docker ps --filter publish=80 --filter publish=443
docker stop nounder40_nginx
sudo install -m 644 nginx/edge-http-bootstrap.conf /etc/nginx/conf.d/nounder40.conf
sudo nginx -t
sudo systemctl enable --now nginx
```

Keep the existing production certificate unchanged. After the dev DNS record
resolves to this EC2 instance, issue only the separate dev certificate:

```bash
sudo certbot certonly --webroot -w /var/www/certbot \
  -d dev.danzaclassicanounder40.com \
  --cert-name dev.danzaclassicanounder40.com
```

The final edge configuration expects the existing production certificate at
`/etc/letsencrypt/live/danzaclassicanounder40.com/` and the new dev certificate
at `/etc/letsencrypt/live/dev.danzaclassicanounder40.com/`. Install it after
confirming both paths exist:

```bash
sudo install -m 644 nginx/edge.conf /etc/nginx/conf.d/nounder40.conf
sudo nginx -t
sudo systemctl reload nginx
sudo certbot renew --dry-run
```

During migration, before production exists on port 8080, install
`nginx/edge-transition.conf` instead. It keeps the existing production domain
online by temporarily routing both domains to the preserved dev stack on 8081.
After the restored production stack is verified, replace it with `edge.conf`.

## 5. Database migration

Deploy production first with an empty production database. Test it through the
loopback upstream before changing traffic:

```bash
curl -I -H 'Host: danzaclassicanounder40.com' http://127.0.0.1:8080/
curl -I -H 'Host: dev.danzaclassicanounder40.com' http://127.0.0.1:8081/
```

For data migration, use `pg_dump`/`pg_restore`, not a live Docker-volume copy.
Take a final source backup during a write freeze, restore into the production
Postgres container, run Django migrations, verify row counts and authentication,
then enable production traffic. Keep the source backup until the new deployment
has been verified and a rollback window has passed.

## 6. Verification

```bash
curl -I https://dev.danzaclassicanounder40.com
curl -I https://danzaclassicanounder40.com
docker compose -f /home/ubuntu/nounder40/docker-compose.run.yml -p nounder40 ps
docker compose -f /home/ubuntu/nounder40-production/docker-compose.prod.yml -p danza-prod ps
sudo certbot certificates
```
