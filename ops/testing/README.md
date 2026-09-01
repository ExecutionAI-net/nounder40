# Load & security testing

Free/OSS tooling, all run as containers — nothing is installed on the host.
Findings from the last run: [`REPORT.md`](REPORT.md).

> **Local stack only.** Never point these at production: the load scripts create
> bookings and accounts, and the security probes register users and hammer
> authentication endpoints.

## 0. Prerequisites

```bash
make up
```

nginx is published on the port set by `NGINX_HOST_PORT` in `.env` (8080 here, not 80).
Adjust `BASE` below if yours differs.

## 1. Seed test data

Two fully isolated schools (A and B) so tenant isolation is actually provable,
plus 30 bulk students in school A for the load ramp. Idempotent.

```bash
docker compose exec -T django python manage.py shell < ops/testing/seed_testdata.py
```

Personas — all with password `LoadTest!2024`:

| Email | Role |
|---|---|
| `hq.test@example.test` | HQ |
| `owner.a@example.test` / `owner.b@example.test` | school admin |
| `teacher.a@example.test` / `teacher.b@example.test` | teacher |
| `student.a@example.test` / `student.b@example.test` | student |
| `load001..load030@example.test` | students, school A |

## 2. Security

Authorization, IDOR, JWT, rate limiting, headers, information disclosure:

```bash
docker run --rm --add-host=host.docker.internal:host-gateway -v "$PWD/ops/testing/security:/work" -v "$PWD/ops/testing/reports:/out" -w /work python:3.12-slim sh -c "pip install -q requests && python authz_probe.py"
```

Booking/document object-level IDOR (creates a booking for student B first):

```bash
docker run --rm --add-host=host.docker.internal:host-gateway -v "$PWD/ops/testing/security:/work" -w /work python:3.12-slim sh -c "pip install -q requests && python idor_bookings.py"
```

`verify_findings.py` re-tests findings against personas built through the real
API rather than the seeder — run it before believing anything `authz_probe.py`
reports, since seeded state can fake a vulnerability.

### Static, dependency and secret scanning

```bash
docker run --rm -v "$PWD:/src" -w /src semgrep/semgrep semgrep scan --config=p/security-audit --config=p/django --config=p/typescript --json -o ops/testing/reports/semgrep.json backend frontend
```

```bash
docker run --rm -v "$PWD:/src" zricethezav/gitleaks detect --source=/src --report-path=/src/ops/testing/reports/gitleaks.json --redact
```

```bash
docker run --rm -v "$PWD:/src" -w /src python:3.12-slim sh -c "pip install -q bandit pip-audit && bandit -r backend -f json -o ops/testing/reports/bandit.json -ll -q; pip-audit -r backend/requirements.txt --format json -o ops/testing/reports/pip-audit.json"
```

```bash
docker run --rm -v //var/run/docker.sock:/var/run/docker.sock aquasec/trivy image --severity HIGH,CRITICAL --scanners vuln danza_django:latest
```

### DAST

Nuclei is far faster over the Docker network than via `host.docker.internal`.
Container hostnames contain underscores, which Django rejects as invalid hosts —
use the container IP:

```bash
docker run --rm --network nounder40_default -v "$PWD/ops/testing/reports:/out" projectdiscovery/nuclei -u http://$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' danza_nginx) -severity critical,high,medium,low -jsonl -o /out/nuclei.jsonl -stats
```

```bash
docker run --rm --network nounder40_default -v "$PWD/ops/testing/reports:/zap/wrk:rw" ghcr.io/zaproxy/zaproxy:stable zap-baseline.py -t http://172.19.0.6/api/docs/ -r zap.html -I -z "-config connection.timeoutInSecs=180"
```

## 3. Load

`runserver` + `DEBUG=True` says nothing about capacity. Start a
production-equivalent server first:

```bash
docker compose exec -d -e DJANGO_SETTINGS_MODULE=config.settings.production -e DJANGO_ALLOWED_HOSTS='*' -e DJANGO_DEBUG=False django sh -c "daphne -b 0.0.0.0 -p 8001 config.asgi:application"
```

```bash
docker run --rm --network nounder40_default -v "$PWD/ops/testing:/t" -e BASE=http://$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' danza_django):8001 grafana/k6 run /t/load/api_load.js
```

Three scripts:

| Script | Answers |
|---|---|
| `load/api_load.js` | How does a realistic mixed workload behave? (anon browse + student journey + school dashboard) |
| `load/concurrency_probe.js` | Is the limit the endpoints or the server process? Drives `/api/health/` — one trivial query — to 400 req/s. |
| `load/query_profile.py` | Which endpoints are N+1? Reports SQL query count per endpoint, not just latency. |

```bash
docker compose exec -T django python manage.py shell < ops/testing/load/query_profile.py
```

## 4. Notes

- The Next.js **dev** server crashes under fuzzing (`.next` manifest goes missing).
  That is a dev-mode artifact; scan a production build for frontend coverage.
- `reports/` holds raw tool output and is worth regenerating rather than trusting
  when stale.
