"""QA R2-M13: realign the two language columns that had drifted apart.

`User.language_preference` wins. `accounts_user` (User) has no `updated_at` to
compare against `students.updated_at`, so "most recently updated" is not
decidable row by row; the User row is the one the header language switch —
the control students actually use, and the one that already drives login,
welcome and password-reset e-mails — writes, so it is the value to keep.
Rows where the User column is empty fall back to the Student value, and from
here on `accounts.signals` keeps the mirror in step.
"""

from django.db import migrations

FORWARD_SQL = """
UPDATE students AS s
SET language_preference = p.language_preference
FROM accounts_user AS p
WHERE s.user_id = p.id
  AND COALESCE(p.language_preference, '') <> ''
  AND COALESCE(s.language_preference, '') <> COALESCE(p.language_preference, '');

UPDATE accounts_user AS p
SET language_preference = s.language_preference
FROM students AS s
WHERE s.user_id = p.id
  AND COALESCE(p.language_preference, '') = ''
  AND COALESCE(s.language_preference, '') <> '';
"""


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0009_seed_test_personas"),
        ("students", "0001_initial"),
    ]

    operations = [
        migrations.RunSQL(FORWARD_SQL, migrations.RunSQL.noop),
    ]
