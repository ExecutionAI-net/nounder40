"""HQ-R3-11: the test mail must be readable in the language it is sent in.

`locale` picked the template and built the URLs, but every prose sample was
Italian, so the English and German tests arrived saying "Invitation from
Dance Studio Roma - Amministratrice". Someone re-reading a template to check
its language found an Italian word inside it - exactly the mistake the test
send exists to reveal.
"""
import pytest

from notifications.views import _SAMPLE_BY_LOCALE, _test_send_context

pytestmark = pytest.mark.django_db

LOCALES = ("en", "it", "es", "fr", "de")


def test_the_invite_role_follows_the_locale():
    assert _test_send_context("de")["invite_role"] == "Administratorin"
    assert _test_send_context("en")["invite_role"] == "Administrator"
    assert _test_send_context("it")["invite_role"] == "Amministratrice"


@pytest.mark.parametrize("key", sorted(_SAMPLE_BY_LOCALE))
def test_every_localized_sample_covers_all_five_languages(key):
    assert set(_SAMPLE_BY_LOCALE[key]) == set(LOCALES), key


@pytest.mark.parametrize("locale", LOCALES)
def test_no_localized_sample_leaks_another_language(locale):
    """Each locale gets its own value, never the Italian default by accident."""
    ctx = _test_send_context(locale)
    for key, per_locale in _SAMPLE_BY_LOCALE.items():
        assert ctx[key] == per_locale[locale], (locale, key)


@pytest.mark.parametrize("locale", LOCALES)
def test_the_school_info_block_uses_the_translated_heading(locale):
    from bookings.services import _SCHOOL_INFO_HEADING

    block = _test_send_context(locale)["school_info_block"]
    assert _SCHOOL_INFO_HEADING[locale] in block
    assert _SAMPLE_BY_LOCALE["school_info"][locale] in block


def test_an_unknown_locale_falls_back_to_english_rather_than_italian():
    ctx = _test_send_context("pt")
    assert ctx["invite_role"] == "Administrator"


def test_names_and_amounts_stay_neutral():
    """Only prose is localized: a sample person or city translated per locale
    would be noise, not a better test."""
    en, de = _test_send_context("en"), _test_send_context("de")
    for key in ("student_name", "school_name", "school_city", "amount", "lesson_date"):
        assert en[key] == de[key], key
