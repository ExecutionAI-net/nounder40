"""The five UI locales, mirror of frontend/src/i18n/routing.ts.

One list for the whole backend: e-mail language, invite links, tutorial
languages, School.language validation. Adding a locale means editing this
tuple and the frontend routing, nothing else. (The four-language tuples in
catalog/views.py and catalog/image_views.py are NOT this list: they mirror
the `name_it/en/fr/es` DB columns, which have no German.)
"""

LOCALES = ("en", "it", "es", "fr", "de")
DEFAULT_LOCALE = "en"


def clamp_locale(value, default: str = DEFAULT_LOCALE) -> str:
    """`value` if it is a shipped locale, else `default`."""
    return value if value in LOCALES else default
