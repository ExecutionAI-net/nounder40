"""
Phase 8 ETL — copy business data from the old Supabase Postgres into this
project's Django Postgres.

Why this is (almost) fully generic
----------------------------------
The Django models were written to keep the *same* ``db_table`` names and the
*same* column names as the Supabase schema (see ``supabase/migrations/*.sql``).
Django's default foreign-key column naming (``<field>_id``) already matches the
Supabase FK columns in almost every case. So the migration is, for ~40 of the
~46 tables, a column-for-column copy that preserves primary keys, foreign keys
and timestamps exactly.

Only two things genuinely diverge and get bespoke handling:

1. ``auth.users`` + ``profiles``  →  ``accounts_user``
   Supabase splits the login row (``auth.users``) from the profile row
   (``profiles``). We merge them: ``profiles.name`` → ``full_name``,
   ``profiles.school_id`` → ``active_school_id``, and the bcrypt password hash
   from ``auth.users.encrypted_password`` is re-encoded into Django's format so
   existing email/password logins keep working.

2. ``hq_members.id``  →  ``hq_members.user_id``
   The Django model makes this a ``OneToOneField(primary_key=True)`` whose
   column is ``user_id``; the source column is ``id``.

Everything else is handled by the generic engine, including four FK columns the
Supabase schema named without the ``_id`` suffix (``assigned_to``,
``validated_by``, ``granted_by``, ``invited_by``) — the engine falls back to the
suffix-stripped name automatically.

Ordering / cyclic FKs
---------------------
``accounts_user.active_school_id`` ↔ ``schools.owner_id`` form a cycle. Django
creates every FK on Postgres as ``DEFERRABLE INITIALLY DEFERRED``, so we run the
whole load inside one transaction with ``SET CONSTRAINTS ALL DEFERRED`` and let
the checks run at COMMIT — insertion order among cyclic rows stops mattering.

Storage files
-------------
This command moves *database rows only*. Supabase Storage objects (the private
``documents`` / ``chat-attachments`` buckets and the public ``school-assets``
bucket) are referenced by ``file_url`` / ``files[].path`` values, which are
preserved verbatim. Copying the actual bytes into the local media volume is a
separate step that needs the Supabase service key — see ``--help`` notes and
``docs``; it is intentionally out of scope here so the row ETL can be built and
tested without live credentials.

Usage
-----
    python manage.py etl_from_supabase --source-dsn=postgresql://user:pass@host:5432/postgres
    python manage.py etl_from_supabase --source-dsn=... --truncate        # wipe target first
    python manage.py etl_from_supabase --source-dsn=... --only schools,students
    python manage.py etl_from_supabase --source-dsn=... --dry-run         # read + map, no writes

The DSN may also come from the ``SUPABASE_DB_URL`` environment variable.
"""

from __future__ import annotations

import os
import uuid
from dataclasses import dataclass
from typing import Callable

from django.contrib.auth.hashers import make_password
from django.core.management.base import BaseCommand, CommandError
from django.db import connection, transaction
from django.utils import timezone

# Target models, imported for their _meta.db_table (and dependency ordering).
from accounts.models import HQMember, HQRole, PendingInvitation
from bookings.models import Attendance, Booking
from catalog.models import (
    AttendanceStatus,
    Course,
    Lesson,
    LessonType,
    Package,
    SubscriptionCatalog,
)
from chat.models import Conversation, Message, QuickReplyTemplate
from commerce.models import (
    DiscountCode,
    ShopOrder,
    ShopProduct,
    ShopProductVariant,
    ShopSale,
    Transaction,
)
from geography.models import HQCity, HQCountry
from library.models import LibraryContent, VideoProgress
from notifications.models import EmailSetting, EmailTemplate, Notification
from schools.models import (
    School,
    SchoolClosure,
    SchoolDocumentType,
    SchoolLocation,
    SchoolMembership,
    SchoolRoom,
    SchoolStudent,
)
from students.models import (
    ManualCreditGrant,
    Student,
    StudentDocument,
    StudentPackage,
    StudentSubscription,
)
from teachers.models import (
    CompensationPlan,
    CompensationPlanRate,
    Teacher,
    TeacherCompensationPayment,
    TeacherSchool,
)
from translations.models import PlatformSetting, Translation

try:
    import psycopg2
    import psycopg2.extras
except ImportError as exc:  # pragma: no cover - psycopg2 is a hard dependency
    raise CommandError("psycopg2 is required for the ETL") from exc


# --------------------------------------------------------------------------
# Table plan — parents before children. Deferred FKs make this order a
# readability aid rather than a hard requirement, but keeping it sane keeps the
# progress log easy to follow.
# --------------------------------------------------------------------------
@dataclass
class Table:
    model: type
    # Optional per-row transform: receives the source row dict and the (mutable)
    # target record dict. Set explicit target columns here; the generic pass
    # fills the rest. Return nothing.
    transform: Callable[[dict, dict], None] | None = None
    # Explicit source table override (defaults to model._meta.db_table).
    source: str | None = None
    # Custom whole-table reader (used only for the accounts_user join).
    reader: Callable | None = None

    @property
    def target_table(self) -> str:
        return self.model._meta.db_table

    @property
    def source_table(self) -> str:
        return self.source or self.model._meta.db_table


def _hq_members_transform(row: dict, rec: dict) -> None:
    # Supabase PK column is `id`; Django's OneToOne PK column is `user_id`.
    rec["user_id"] = row.get("id")


def _schools_transform(row: dict, rec: dict) -> None:
    # Supabase stores the owning user as `schools.user_id` (backfilled from
    # profiles in migration 015); the Django model calls it `owner`.
    rec["owner_id"] = row.get("user_id")


PLAN: list[Table] = [
    # accounts_user is loaded by a dedicated reader (see Command.load_users).
    Table(School, transform=_schools_transform),
    Table(HQMember, transform=_hq_members_transform),
    Table(HQRole),
    Table(PendingInvitation),
    Table(SchoolMembership),
    Table(HQCountry),
    Table(HQCity),
    Table(SchoolLocation),
    Table(SchoolRoom),
    Table(SchoolDocumentType),
    Table(SchoolClosure),
    Table(LessonType),
    Table(Teacher),
    Table(CompensationPlan),
    Table(CompensationPlanRate),
    Table(TeacherSchool),
    Table(TeacherCompensationPayment),
    Table(Course),
    Table(Lesson),
    Table(AttendanceStatus),
    Table(Package),
    Table(SubscriptionCatalog),
    Table(Student),
    Table(SchoolStudent),
    Table(StudentPackage),
    Table(StudentSubscription),
    Table(StudentDocument),
    Table(ManualCreditGrant),
    Table(Booking),
    Table(Attendance),
    Table(Transaction),
    Table(DiscountCode),
    Table(Conversation),
    Table(Message),
    Table(QuickReplyTemplate),
    Table(Notification),
    Table(LibraryContent),
    Table(VideoProgress),
    Table(ShopProduct),
    Table(ShopProductVariant),
    Table(ShopOrder),
    Table(ShopSale),
    Table(Translation),
    Table(PlatformSetting),
    Table(EmailTemplate),
    Table(EmailSetting),
]

# Columns the ETL must never copy from source even when the names line up —
# Django manages them and their source semantics differ.
NEVER_COPY = {"password", "last_login", "is_superuser", "is_staff"}


def map_row_to_record(
    row: dict,
    target_cols: list[str],
    src_cols: set[str],
    transform: Callable[[dict, dict], None] | None = None,
) -> dict:
    """Pure column mapping for one source row → target record.

    - ``transform`` (if given) runs first and may set bespoke target columns.
    - Then every remaining target column is filled from a same-named source
      column, or — for FK columns Supabase named without the suffix — from the
      ``_id``-stripped name (``assigned_to`` → ``assigned_to_id``).
    - A target ``id`` with no source ``id`` is left unset so an auto/serial PK
      can assign it (the composite-key link tables).
    Kept DB-free so it can be unit-tested.
    """
    rec: dict = {}
    if transform:
        transform(row, rec)
    for tcol in target_cols:
        if tcol in rec or tcol in NEVER_COPY:
            continue
        if tcol == "id" and "id" not in src_cols:
            continue
        if tcol in row:
            rec[tcol] = row[tcol]
        elif tcol.endswith("_id") and tcol[:-3] in row:
            rec[tcol] = row[tcol[:-3]]
    return rec


def _map_password(enc: str | None) -> str:
    """Re-encode a Supabase password hash into Django's storage format.

    Supabase (GoTrue) stores plain bcrypt (`$2a$`/`$2b$`/`$2y$`). Django's
    ``BCryptPasswordHasher`` reads exactly that with a ``bcrypt$`` prefix, so
    email/password logins survive the migration (bcrypt must be installed and
    the hasher enabled — both wired up in this change). OAuth-only accounts have
    no hash and get an unusable password (they sign in with Google, or reset).
    """
    if not enc:
        return make_password(None)
    enc = enc.strip()
    if enc.startswith(("$2a$", "$2b$", "$2y$")):
        return "bcrypt" + enc  # Django format: "bcrypt$$2b$..."
    if enc.startswith("$argon2"):
        return "argon2" + enc  # needs argon2-cffi to verify; rare on Supabase
    return make_password(None)


class Command(BaseCommand):
    help = "Copy business data from a Supabase Postgres into the Django Postgres (Phase 8 ETL)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--source-dsn",
            default=os.environ.get("SUPABASE_DB_URL", ""),
            help="Source (Supabase) Postgres DSN. Falls back to $SUPABASE_DB_URL.",
        )
        parser.add_argument(
            "--only",
            default="",
            help="Comma-separated target table names to migrate (default: all).",
        )
        parser.add_argument(
            "--truncate",
            action="store_true",
            help="TRUNCATE every target business table (CASCADE) before loading.",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Read and map rows but roll back instead of committing.",
        )
        parser.add_argument(
            "--batch-size",
            type=int,
            default=1000,
            help="Rows per INSERT batch (default 1000).",
        )

    # -- introspection helpers -------------------------------------------------
    def _target_columns(self, table: str) -> dict[str, dict]:
        """{column: {'data_type', 'nullable', 'has_default'}} for a target table."""
        with connection.cursor() as cur:
            cur.execute(
                """
                SELECT column_name, data_type, is_nullable, column_default
                FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = %s
                """,
                [table],
            )
            return {
                name: {
                    "data_type": dtype,
                    "nullable": nullable == "YES",
                    "has_default": default is not None,
                }
                for name, dtype, nullable, default in cur.fetchall()
            }

    def _source_columns(self, src_cur, table: str, schema: str = "public") -> set[str]:
        src_cur.execute(
            """
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = %s AND table_name = %s
            """,
            [schema, table],
        )
        return {r[0] if not isinstance(r, dict) else r["column_name"] for r in src_cur.fetchall()}

    @staticmethod
    def _fill_generated_defaults(
        records: list[dict], target_meta: dict, model: type | None = None
    ) -> None:
        """Supply values for NOT NULL target columns the source can't provide.

        Some Django fields are NOT NULL with only a *Python-level* default (never
        a DB default), so a raw INSERT would write NULL:
          - ``students.ical_token`` (``default=uuid.uuid4``) — added for the
            personal iCal feed, absent from the Supabase schema.
          - ``email_templates.created_at`` (``default=timezone.now``) — the
            Supabase table only had ``updated_at``.
        Required fields with a Django model default also need that default when
        the legacy source explicitly contains NULL. Raw INSERTs bypass Django's
        normal ``field.get_default()`` handling; without this, fields such as
        ``conversations.tags`` (``ArrayField(default=list)``) fail even though
        newly-created Django objects correctly receive ``[]``.

        Required text columns that are absent from the legacy schema are filled
        with Django's representation of ``blank=True`` (the empty string).
        This must happen before the INSERT column set is selected; doing it only
        in ``_coerce`` is too late when every source row omitted the column.

        We generate a fresh UUID / current timestamp for each such column. The
        ``rec.get(c) is None`` guard means real source values are never touched
        (including primary keys). Any other NOT NULL/no-default gap is left to
        surface as an error rather than be silently papered over.
        """
        if model is not None:
            defaulted_fields = [
                field
                for field in model._meta.concrete_fields
                if field.column in target_meta
                and not target_meta[field.column]["nullable"]
                and field.has_default()
            ]
            for rec in records:
                for field in defaulted_fields:
                    if rec.get(field.column) is None:
                        rec[field.column] = field.get_default()

        _TS = ("timestamp with time zone", "timestamp without time zone")
        _TEXT = ("character varying", "text")
        uuid_cols, ts_cols, text_cols = [], [], []
        for c, m in target_meta.items():
            if m["nullable"] or m["has_default"]:
                continue
            if m["data_type"] == "uuid":
                uuid_cols.append(c)
            elif m["data_type"] in _TS:
                ts_cols.append(c)
            elif m["data_type"] in _TEXT:
                text_cols.append(c)
        if not uuid_cols and not ts_cols and not text_cols:
            return
        for rec in records:
            for c in text_cols:
                if rec.get(c) is None:
                    rec[c] = ""
            for c in uuid_cols:
                if rec.get(c) is None:
                    rec[c] = uuid.uuid4()
            for c in ts_cols:
                if rec.get(c) is None:
                    rec[c] = timezone.now()

    # -- value coercion --------------------------------------------------------
    @staticmethod
    def _coerce(value, meta: dict):
        if meta["data_type"] == "jsonb":
            # dict/list must be adapted as JSON, not as a Postgres array/record.
            if value is None:
                return None
            return psycopg2.extras.Json(value)
        if value is None and not meta["nullable"] and meta["data_type"] in (
            "character varying",
            "text",
        ):
            # Source column optional, target NOT NULL text → Django's blank="".
            return ""
        return value

    # -- the accounts_user join ------------------------------------------------
    def load_users(self, src_conn, target_meta, batch_size, stats):
        table = "accounts_user"
        with src_conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            prof_cols = self._source_columns(cur, "profiles")
            if not prof_cols:
                self.stdout.write(self.style.WARNING("  profiles table not found — skipping users"))
                return
            auth_cols = self._source_columns(cur, "users", schema="auth")

            # Pull auth.users (login side) keyed by id, using only columns present.
            auth_by_id: dict = {}
            if auth_cols:
                wanted = [
                    c
                    for c in (
                        "id",
                        "encrypted_password",
                        "created_at",
                        "last_sign_in_at",
                        "deleted_at",
                    )
                    if c in auth_cols
                ]
                cur.execute(f"SELECT {', '.join(wanted)} FROM auth.users")  # noqa: S608 - fixed identifiers
                for r in cur.fetchall():
                    auth_by_id[r["id"]] = r

            cur.execute("SELECT * FROM profiles")
            profiles = cur.fetchall()

        records = []
        for p in profiles:
            au = auth_by_id.get(p["id"], {})
            rec = {
                "id": p["id"],
                "email": p.get("email") or "",
                "full_name": p.get("name") or "",
                "role": p.get("role") or "",
                "roles": p.get("roles") or [],
                "hq_sub_role": p.get("hq_sub_role") or "",
                "school_sub_role": p.get("school_sub_role") or "",
                "active_school_id": p.get("school_id"),
                "language_preference": p.get("language_preference") or "en",
                "phone": p.get("phone") or "",
                "city": p.get("city") or "",
                "password": _map_password(au.get("encrypted_password")),
                "date_joined": au.get("created_at") or p.get("created_at"),
                "last_login": au.get("last_sign_in_at"),
                "is_active": au.get("deleted_at") is None,
                "is_staff": False,
                "is_superuser": False,
            }
            records.append(rec)

        self._fill_generated_defaults(records, target_meta)
        self._insert(table, records, target_meta, batch_size)
        stats[table] = len(records)
        self.stdout.write(f"  {table:<28} {len(records):>7} rows")

    # -- generic table copy ----------------------------------------------------
    def load_table(self, spec: Table, src_conn, batch_size, stats):
        target_table = spec.target_table
        target_meta = self._target_columns(target_table)
        if not target_meta:
            self.stdout.write(self.style.WARNING(f"  {target_table}: no such target table — skipped"))
            return

        with src_conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            src_cols = self._source_columns(cur, spec.source_table)
            if not src_cols:
                self.stdout.write(
                    self.style.WARNING(f"  {target_table:<28} (source '{spec.source_table}' absent — skipped)")
                )
                return
            cur.execute(f"SELECT * FROM {spec.source_table}")  # noqa: S608 - identifier from model meta
            rows = cur.fetchall()

        target_cols = list(target_meta)
        records = [
            map_row_to_record(row, target_cols, src_cols, spec.transform) for row in rows
        ]

        self._fill_generated_defaults(records, target_meta, spec.model)
        self._insert(target_table, records, target_meta, batch_size)
        stats[target_table] = len(records)
        self.stdout.write(f"  {target_table:<28} {len(records):>7} rows")

    # -- INSERT ----------------------------------------------------------------
    def _insert(self, table, records, target_meta, batch_size):
        if not records:
            return
        # Column set is fixed per table: union of keys across records, ordered.
        cols = [c for c in target_meta if any(c in r for r in records)]
        col_sql = ", ".join(f'"{c}"' for c in cols)
        template = "(" + ", ".join(["%s"] * len(cols)) + ")"

        params = []
        for r in records:
            params.append(tuple(self._coerce(r.get(c), target_meta[c]) for c in cols))

        with connection.cursor() as cur:
            # execute_values needs the raw psycopg2 cursor, not Django's wrapper.
            raw = cur.cursor
            for i in range(0, len(params), batch_size):
                batch = params[i : i + batch_size]
                psycopg2.extras.execute_values(
                    raw,
                    f'INSERT INTO "{table}" ({col_sql}) VALUES %s',
                    batch,
                    template=template,
                    page_size=batch_size,
                )

    # -- truncate --------------------------------------------------------------
    def truncate_targets(self):
        tables = ['"accounts_user"'] + [f'"{t.target_table}"' for t in PLAN]
        # de-dupe preserving order
        seen, ordered = set(), []
        for t in tables:
            if t not in seen:
                seen.add(t)
                ordered.append(t)
        with connection.cursor() as cur:
            cur.execute(f"TRUNCATE {', '.join(ordered)} RESTART IDENTITY CASCADE")
        self.stdout.write(self.style.WARNING(f"  truncated {len(ordered)} target tables"))

    # -- entrypoint ------------------------------------------------------------
    def handle(self, *args, **opts):
        dsn = opts["source_dsn"]
        if not dsn:
            raise CommandError("Provide --source-dsn or set $SUPABASE_DB_URL")

        only = {t.strip() for t in opts["only"].split(",") if t.strip()}
        batch_size = opts["batch_size"]
        dry_run = opts["dry_run"]

        psycopg2.extras.register_uuid()  # UUID <-> uuid.UUID both directions

        self.stdout.write(self.style.MIGRATE_HEADING("Connecting to source Supabase Postgres…"))
        try:
            src_conn = psycopg2.connect(dsn)
        except psycopg2.Error as exc:
            raise CommandError(f"Could not connect to source: {exc}") from exc
        src_conn.set_session(readonly=True, autocommit=True)

        stats: dict[str, int] = {}
        try:
            with transaction.atomic():
                with connection.cursor() as cur:
                    cur.execute("SET CONSTRAINTS ALL DEFERRED")

                if opts["truncate"] and not only:
                    self.truncate_targets()
                elif opts["truncate"] and only:
                    self.stdout.write(self.style.WARNING("  --truncate ignored when --only is set"))

                self.stdout.write(self.style.MIGRATE_HEADING("Loading tables…"))

                if not only or "accounts_user" in only:
                    self.load_users(
                        src_conn, self._target_columns("accounts_user"), batch_size, stats
                    )

                for spec in PLAN:
                    if only and spec.target_table not in only:
                        continue
                    self.load_table(spec, src_conn, batch_size, stats)

                if dry_run:
                    self.stdout.write(self.style.WARNING("dry-run: rolling back"))
                    transaction.set_rollback(True)
        finally:
            src_conn.close()

        total = sum(stats.values())
        self.stdout.write(
            self.style.SUCCESS(
                f"\nDone. {total} rows across {len(stats)} tables"
                + (" (rolled back)" if dry_run else " committed")
                + "."
            )
        )
