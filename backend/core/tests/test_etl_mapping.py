"""Unit tests for the Phase 8 ETL's pure mapping/coercion logic.

These need no database — they exercise the DB-free helpers that decide how a
Supabase row becomes a Django target record (the part most likely to regress).
The full end-to-end ETL is verified separately against a real Supabase-shaped
Postgres.
"""

import psycopg2.extras
from chat.models import Conversation

from core.management.commands.etl_from_supabase import (
    Command,
    _hq_members_transform,
    _map_password,
    map_row_to_record,
)

BCRYPT = "$2b$10$abcdefghijklmnopqrstuv0123456789ABCDEFGHIJKLMNOPQRSTU"


# --------------------------------------------------------------------------
# _map_password
# --------------------------------------------------------------------------
def test_bcrypt_hash_is_re_encoded_for_django():
    assert _map_password(BCRYPT) == "bcrypt" + BCRYPT
    assert _map_password("$2a$10$" + "x" * 53).startswith("bcrypt$2a$")


def test_missing_password_is_unusable():
    # Django marks unusable passwords with a leading "!".
    assert _map_password(None).startswith("!")
    assert _map_password("").startswith("!")


def test_unknown_hash_scheme_is_unusable():
    assert _map_password("plaintext-nope").startswith("!")


def test_argon2_hash_is_passed_through_with_prefix():
    argon = "$argon2id$v=19$m=65536,t=3,p=4$c2FsdA$aGFzaA"
    assert _map_password(argon) == "argon2" + argon


# --------------------------------------------------------------------------
# map_row_to_record
# --------------------------------------------------------------------------
def test_direct_column_names_copy_through():
    row = {"id": 1, "name": "Studio A", "slug": "studio-a"}
    rec = map_row_to_record(row, ["id", "name", "slug"], {"id", "name", "slug"})
    assert rec == {"id": 1, "name": "Studio A", "slug": "studio-a"}


def test_fk_without_id_suffix_falls_back():
    # Supabase columns: assigned_to / validated_by / invited_by / granted_by.
    row = {"id": "u1", "assigned_to": "hq-7"}
    rec = map_row_to_record(row, ["id", "assigned_to_id"], {"id", "assigned_to"})
    assert rec["assigned_to_id"] == "hq-7"


def test_direct_id_suffix_beats_fallback():
    # If the source already has the _id column, use it verbatim.
    row = {"id": "c1", "school_id": "s1"}
    rec = map_row_to_record(row, ["id", "school_id"], {"id", "school_id"})
    assert rec["school_id"] == "s1"


def test_auto_pk_is_omitted_when_source_has_no_id():
    # teacher_schools / school_memberships: composite natural key, no surrogate.
    row = {"teacher_id": "t1", "school_id": "s1", "active": True}
    rec = map_row_to_record(
        row,
        ["id", "teacher_id", "school_id", "active"],
        {"teacher_id", "school_id", "active"},
    )
    assert "id" not in rec
    assert rec == {"teacher_id": "t1", "school_id": "s1", "active": True}


def test_transform_runs_first_and_wins():
    # hq_members: source `id` maps to target `user_id`.
    row = {"id": "hq-1", "email": "a@b.co", "name": "Ann"}
    rec = map_row_to_record(
        row, ["user_id", "email", "name"], {"id", "email", "name"}, _hq_members_transform
    )
    assert rec["user_id"] == "hq-1"
    assert rec["email"] == "a@b.co" and rec["name"] == "Ann"


def test_never_copy_columns_are_skipped():
    row = {"id": "u1", "password": "leak", "is_staff": True}
    rec = map_row_to_record(row, ["id", "password", "is_staff"], {"id", "password", "is_staff"})
    assert rec == {"id": "u1"}


def test_target_only_columns_are_left_unset():
    # e.g. Student.ical_token has no source column → omitted → DB/Django default.
    row = {"id": "st1", "name": "Bea"}
    rec = map_row_to_record(row, ["id", "name", "ical_token"], {"id", "name"})
    assert "ical_token" not in rec


# --------------------------------------------------------------------------
# Command._coerce
# --------------------------------------------------------------------------
def test_jsonb_values_are_wrapped_as_json():
    out = Command._coerce({"a": 1}, {"data_type": "jsonb", "nullable": True})
    assert isinstance(out, psycopg2.extras.Json)
    listed = Command._coerce([], {"data_type": "jsonb", "nullable": False})
    assert isinstance(listed, psycopg2.extras.Json)


def test_jsonb_null_stays_null():
    assert Command._coerce(None, {"data_type": "jsonb", "nullable": True}) is None


def test_not_null_text_none_becomes_empty_string():
    assert Command._coerce(None, {"data_type": "text", "nullable": False}) == ""
    assert Command._coerce(None, {"data_type": "character varying", "nullable": False}) == ""


def test_nullable_text_none_stays_none():
    assert Command._coerce(None, {"data_type": "text", "nullable": True}) is None


def test_scalar_values_pass_through():
    assert Command._coerce(7, {"data_type": "integer", "nullable": False}) == 7


def test_required_null_field_receives_its_django_model_default():
    records = [{"id": "conversation-1", "tags": None}]
    target_meta = {
        "id": {"data_type": "uuid", "nullable": False, "has_default": False},
        "tags": {"data_type": "ARRAY", "nullable": False, "has_default": False},
    }

    Command._fill_generated_defaults(records, target_meta, Conversation)

    assert records[0]["tags"] == []
