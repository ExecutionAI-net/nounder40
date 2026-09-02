# Supabase Import: Backend Code Changes

Only two backend files were changed for the Supabase import fixes.

## `backend/core/management/commands/etl_from_supabase.py`

This is the Django management command that imports Supabase PostgreSQL data
into the Django PostgreSQL database.

### Original import implementation

- Added the `etl_from_supabase` Django management command.
- Added support for the source DSN through `--source-dsn` or the
  `SUPABASE_DB_URL` environment variable.
- Added `--truncate`, `--dry-run`, `--only`, and `--batch-size` options.
- Added an ordered plan for importing 47 application tables.
- Wrapped the complete target import in `transaction.atomic()`.
- Deferred foreign-key constraints to support cyclic relationships.
- Merged Supabase `auth.users` and `profiles` into Django `accounts_user`.
- Converted Supabase bcrypt hashes into Django's bcrypt format.
- Added custom schema mappings, including:
  - `hq_members.id` to `hq_members.user_id`;
  - `schools.user_id` to `schools.owner_id`;
  - names such as `assigned_to` to Django's `assigned_to_id`.
- Preserved primary keys, foreign keys, timestamps, arrays, and JSON values.

### Required Django defaults for Supabase `NULL` values

Changed `_fill_generated_defaults()` so it can receive the Django model for the
table being imported. For a required field with a Django model default, the
importer now calls `field.get_default()` when the Supabase value is `NULL`.

Example:

```text
Supabase conversations.tags = NULL
Django conversations.tags = []
```

This is required because raw SQL inserts do not execute Django model defaults.

### Missing or null required text values

Extended `_fill_generated_defaults()` to identify non-null PostgreSQL `text`
and `character varying` columns. Missing or null values are converted to an
empty string before the INSERT column list is generated.

Example:

```text
Supabase library_content.stripe_product_id = NULL or column absent
Django library_content.stripe_product_id = ""
```

### Legacy `shop_orders.student_id` mapping

Added `_map_legacy_student_id()` because older Supabase data may store an
`auth.users.id` in `shop_orders.student_id`, while Django expects a
`students.id`.

The importer now:

- preserves an existing valid student ID;
- maps a legacy user ID through `students.user_id` to `students.id`;
- changes a genuinely orphaned reference to `NULL`, matching Django's nullable
  `SET_NULL` relationship;
- reports how many shop-order references were remapped or cleared.

### Deferred constraint checks during dry runs

Added the following before a dry-run rollback:

```sql
SET CONSTRAINTS ALL IMMEDIATE
```

Foreign keys are deferred during loading and normally checked at commit. Since
a dry run rolls back instead, this explicit check ensures it detects the same
foreign-key violations as a real import.

## `backend/core/tests/test_etl_mapping.py`

This file tests the importer mapping and coercion logic.

### Original importer tests

- Supabase bcrypt-to-Django password conversion.
- Missing and unsupported password handling.
- Direct column copying.
- Foreign-key `_id` suffix fallback.
- Protected columns that must not be copied.
- Target-only column handling.
- JSONB adaptation.
- Required and nullable text coercion.

### Tests added for production import errors

- A required `NULL` field receives its Django model default.
- A missing required text field receives an empty string.
- A legacy shop-order user ID maps to the corresponding student ID.
- A current shop-order student ID remains unchanged.
- An orphaned shop-order student reference becomes `NULL`.

