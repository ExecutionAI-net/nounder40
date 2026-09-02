# Phase 8 — Supabase → Django ETL

Migrates the old Supabase Postgres (data + storage) into this project's Django
Postgres. The **database** half is implemented and verified end-to-end
(`backend/core/management/commands/etl_from_supabase.py`). The **storage** half
(bucket bytes) is documented below and runs during the live cutover, when
Supabase prod credentials are available.

---

## 1. Database ETL

### How it works

The Django models deliberately kept the Supabase `db_table` and column names, so
for ~40 of the ~46 tables the migration is a column-for-column copy that
preserves primary keys, foreign keys and timestamps. The command is
**introspection-driven**: for each target table it copies the intersection of
source and target columns, so it tolerates schema drift automatically. Only the
genuine divergences are hand-coded:

| Divergence | Handling |
|---|---|
| `auth.users` + `profiles` → `accounts_user` | dedicated join reader; `name`→`full_name`, `school_id`→`active_school_id`, bcrypt password re-encoded |
| `hq_members.id` → `hq_members.user_id` | per-table transform |
| `schools.user_id` (owner) → `owner_id` | per-table transform |
| `assigned_to` / `validated_by` / `granted_by` / `invited_by` (no `_id` suffix) | generic `_id`-strip fallback |
| composite-key link tables (`teacher_schools`, `school_memberships`) | source has no surrogate `id`; the DB assigns one |
| target-only NOT NULL fields with a Python default (`students.ical_token`, `email_templates.created_at`) | generated (fresh UUID / `now()`) |
| cyclic FK `accounts_user.active_school_id` ↔ `schools.owner_id` | one transaction + `SET CONSTRAINTS ALL DEFERRED` (Django FKs are `DEFERRABLE INITIALLY DEFERRED`) |

### Passwords

Supabase (GoTrue) stores plain bcrypt hashes. They are re-encoded to Django's
`bcrypt$$2b$…` form so **email/password logins keep working** — this needs the
`bcrypt` package (in `requirements.txt`) and the BCrypt hashers (in
`PASSWORD_HASHERS`). OAuth-only accounts (no hash) get an unusable password and
sign in with Google, or reset.

### Running the cutover

```bash
# 1. Fresh target schema + Django's reference-data seeds
python manage.py migrate

# 2. Load Supabase data (‑‑truncate clears the reference seeds so the source,
#    the source of truth, wins). DSN can also come from $SUPABASE_DB_URL.
python manage.py etl_from_supabase \
  --source-dsn="postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/postgres" \
  --truncate
```

Useful flags: `--dry-run` (map + roll back), `--only schools,students`
(subset), `--batch-size N`.

> The whole load is one transaction — it commits everything or nothing.

### Verification

Two layers, both green:

- **Unit** (`backend/core/tests/test_etl_mapping.py`, `pytest`): the DB-free
  mapping/coercion logic — password re-encoding, the `_id`-strip fallback,
  transform precedence, JSONB wrapping, NOT-NULL-text coercion.
- **End-to-end**: replay the real `supabase/migrations/*.sql` into a throwaway
  Postgres, seed a connected graph, run the ETL into a fresh Django schema, and
  assert the tricky columns landed. Reproduce with the fixtures here:

```bash
# from repo root, with the dev stack up (make up)
docker compose exec -T db psql -U danza -d danza \
  -c "DROP DATABASE IF EXISTS supabase_src" -c "CREATE DATABASE supabase_src OWNER danza"
{ cat docs/etl/00_stubs.sql; \
  for f in $(ls supabase/migrations/*.sql | sort); do cat "$f"; done; \
  cat docs/etl/99_seed.sql; } \
  | docker compose exec -T db psql -U danza -d supabase_src   # note: migration 009 re-declares
                                                              # library/shop RLS policies already in
                                                              # 002 — that one duplicate-policy error is
                                                              # harmless (no columns lost)

docker compose exec -T db psql -U danza -d danza \
  -c "DROP DATABASE IF EXISTS etl_target" -c "CREATE DATABASE etl_target OWNER danza"
docker compose exec -T -e POSTGRES_DB=etl_target django python manage.py migrate --noinput
docker compose exec -T -e POSTGRES_DB=etl_target django python manage.py etl_from_supabase \
  --source-dsn=postgresql://danza:danza@db:5432/supabase_src --truncate
```

`00_stubs.sql` stubs the Supabase-only objects the migrations reference
(`auth.users`, `auth.uid()`, the `supabase_realtime` publication) so the real
migration files replay on vanilla Postgres.

---

## 2. Storage transfer (live cutover, needs Supabase service key)

The DB ETL preserves file references verbatim — it does **not** move bytes.
Local media is a two-tree layout (`backend/core/storage.py`):

- `MEDIA_ROOT/public/<subdir>/…` — served directly by nginx at `/media/public/`.
  Referenced by full URL in DB columns: `schools.logo_url`, `*.image_url`,
  `teachers.photo_url`, `library_content.file_url`/`thumbnail_url`, `shop_products.images[]`.
- `MEDIA_ROOT/private/<subdir>/…` — never served directly; only via a
  permission-checked Django view that returns an `X-Accel-Redirect`. Referenced
  by relative `path` in `student_documents.files[].path` and chat attachments.

Supabase buckets map as: `school-assets` → public; `documents`,
`chat-attachments`, `metodo-library` → private.

**Procedure** (run once, with the Supabase service-role key):

1. Download each bucket (Supabase CLI or Storage REST API), e.g.
   `supabase storage cp -r ss:///documents ./_dump/documents`.
2. For each stored reference, copy the object to the matching local tree and
   re-key through the `save_public` / `save_private` helpers (or place it at the
   path the DB already records and keep that path). Because DB values were
   preserved by the ETL, the simplest faithful option is to **lay the bucket
   files down under `MEDIA_ROOT` at the exact paths the DB rows reference**, then
   spot-check that a private-document view and a public logo both resolve.
3. Verify: one `student_documents` download (private, permission-checked) and
   one `schools.logo_url` (public) both return 200.

This step is intentionally left for the cutover rather than shipped as
speculative code, since the correct path rewriting depends on the actual
Supabase object paths in prod.
