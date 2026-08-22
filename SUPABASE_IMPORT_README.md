# Supabase to Django Import Guide

This document describes the one-time ETL used to copy the legacy Supabase
PostgreSQL data into the Django PostgreSQL database, including the compatibility
fixes added while validating the production dataset.

## Changed files

### `backend/core/management/commands/etl_from_supabase.py`

The Django management command performs the database import. It:

- reads the Supabase connection from `--source-dsn` or `SUPABASE_DB_URL`;
- copies 47 business tables inside one atomic target-database transaction;
- preserves primary keys, foreign keys, and timestamps where schemas match;
- merges Supabase `auth.users` and `profiles` into Django `accounts_user`;
- converts Supabase bcrypt hashes to Django's bcrypt representation;
- maps schema differences such as `hq_members.id` to `user_id` and legacy FK
  columns that omit Django's `_id` suffix;
- defers cyclic foreign-key checks until all tables have loaded;
- supports `--only`, `--batch-size`, `--truncate`, and `--dry-run`.

Production-data compatibility fixes added during migration testing:

1. **Required model defaults for legacy `NULL` values**
   Raw SQL inserts bypass Django model defaults. Required fields with a Django
   default now receive that default when Supabase contains `NULL`. For example,
   `conversations.tags=NULL` becomes `[]` because the Django field uses
   `default=list`.

2. **Missing required text columns**
   Some optional-in-business-logic Django text fields are `NOT NULL` in the
   target database but are nullable or absent in older Supabase schemas. These
   values are normalized to the empty string. One observed example was
   `library_content.stripe_product_id`.

3. **Legacy shop-order student references**
   Early Supabase versions stored an `auth.users.id` in
   `shop_orders.student_id`; Django expects a `students.id`. The importer now:

   - preserves values that already contain a student ID;
   - translates legacy user IDs through `students.user_id`;
   - sets a truly orphaned reference to `NULL`, which matches Django's nullable
     `SET_NULL` relationship;
   - reports remapped and orphaned reference counts without printing personal
     data.

4. **Foreign-key validation during dry runs**
   PostgreSQL deferred constraints normally run at commit. A dry run rolls back
   intentionally, so it could previously report success without checking those
   constraints. The command now executes `SET CONSTRAINTS ALL IMMEDIATE` before
   the dry-run rollback.

### `backend/core/tests/test_etl_mapping.py`

This test module covers the pure ETL mapping behavior, including:

- password-hash conversion;
- direct and suffix-stripped foreign-key mapping;
- protected columns that must never be copied;
- JSON and text coercion;
- required Django model defaults;
- missing required text values;
- current, legacy, and orphaned shop-order student references.

### `SUPABASE_IMPORT_README.md`

This file documents operating and validating the import for the development and
operations teams.

## Preconditions

Before importing:

1. Deploy the backend image containing the latest ETL fixes.
2. Confirm Django migrations have completed successfully.
3. Confirm the Supabase pooler permits connections from the EC2 instance.
4. Use a newly rotated Supabase database password if a previous connection
   string was exposed in chat, logs, tickets, or shell history.
5. Take a backup of the target Django PostgreSQL database before the real
   `--truncate` import.

Do not commit a Supabase DSN or password. In a PostgreSQL URI, the separator
before the hostname is plain `@`, not `\@`. Special characters inside the
password must be percent-encoded.

## Safe import procedure on EC2

Change to the deployment directory:

```bash
cd /home/ubuntu/nounder40
```

Read the DSN without placing it in shell history:

```bash
read -rsp "Supabase connection string: " SUPABASE_DSN
echo
```

### 1. Run the complete dry run

Always combine `--truncate` with `--dry-run` when validating a complete import.
Without the transactional truncate, rows already in Django can cause duplicate
key errors that do not represent a clean migration.

```bash
docker exec \
  -e SUPABASE_DB_URL="$SUPABASE_DSN" \
  nounder40-django-1 \
  python manage.py etl_from_supabase --truncate --dry-run
```

The successful result must end with output similar to:

```text
dry-run: rolling back
Done. 10018 rows across 47 tables (rolled back).
```

A dry run performs inserts and constraint validation inside a transaction, then
rolls it back. It does not leave imported rows or a truncated target database.
Do not proceed if it ends with a traceback.

### 2. Run the real import

This command permanently replaces the target business data:

```bash
docker exec \
  -e SUPABASE_DB_URL="$SUPABASE_DSN" \
  nounder40-django-1 \
  python manage.py etl_from_supabase --truncate
```

The import is atomic. If any insert or deferred constraint fails, PostgreSQL
rolls back both the truncation and all inserted rows. A successful run ends
with `Done` and does not say `rolled back`.

Remove the DSN from the current shell afterward:

```bash
unset SUPABASE_DSN
```

## Validate target row counts

The following checks representative imported models:

```bash
docker exec nounder40-django-1 python manage.py shell -c "
from accounts.models import User
from schools.models import School
from students.models import Student
from teachers.models import Teacher
from catalog.models import Lesson
from commerce.models import ShopOrder
from translations.models import Translation

print('Users:', User.objects.count())
print('Schools:', School.objects.count())
print('Students:', Student.objects.count())
print('Teachers:', Teacher.objects.count())
print('Lessons:', Lesson.objects.count())
print('Shop orders:', ShopOrder.objects.count())
print('Translations:', Translation.objects.count())
"
```

Compare these counts with the per-table counts from the successful ETL output.

## Validate through Django Admin

Open:

```text
https://danzaclassicanounder40.com/admin/
```

Imported Supabase users default to `is_staff=False` and
`is_superuser=False`. To promote an intended administrator:

```bash
docker exec -it nounder40-django-1 python manage.py shell
```

```python
from accounts.models import User

user = User.objects.get(email="ADMIN_EMAIL")
user.is_staff = True
user.is_superuser = True
user.is_active = True
user.save(update_fields=["is_staff", "is_superuser", "is_active"])
exit()
```

If necessary, reset the password interactively:

```bash
docker exec -it nounder40-django-1 \
  python manage.py changepassword ADMIN_EMAIL
```

Representative Admin locations:

| Imported data | Django Admin section |
| --- | --- |
| Users | Accounts → Users |
| Schools and memberships | Schools |
| Students and documents | Students |
| Teachers and compensation | Teachers |
| Courses, lessons, and packages | Catalog |
| Bookings and attendance | Bookings |
| Transactions, products, and shop orders | Commerce |
| Conversations and messages | Chat |
| Library content and progress | Library |
| Translations and platform settings | Translations |
| Email templates and notifications | Notifications |

## Important limitations

- The ETL copies database rows only.
- It does not copy Supabase Storage object bytes. Existing `file_url` and
  `files[].path` values are preserved, but referenced files remain in Supabase
  until a separate storage migration is completed.
- `--truncate` is destructive after a successful commit. Always complete a
  clean dry run and take a target backup first.
- Do not use `--only` with `--truncate`; the command intentionally ignores
  truncation for partial imports.
- Do not run multiple imports concurrently.

## Relevant commits

- `fe46f67` — initial Supabase-to-Django ETL command and mapping tests
- `e8933c4` — apply Django defaults to required fields containing legacy NULLs
- `b96be48` — handle missing required text fields
- `5cadade` — remap legacy shop-order student references and validate deferred
  constraints during dry runs

