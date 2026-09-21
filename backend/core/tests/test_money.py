"""core/money.format_money: thousands separator even on four digits, the
reader's decimal mark and symbol position (the e-mail side of the rule the
frontend applies in lib/format-money.ts)."""
from decimal import Decimal

from core.money import format_money


def test_thousands_separator_even_on_four_digits():
    assert format_money(Decimal("1657.55"), "it") == "1.657,55 €"
    assert format_money(Decimal("1657.55"), "es") == "1.657,55 €"
    assert format_money(Decimal("1657.55"), "de") == "1.657,55 €"
    assert format_money(Decimal("1657.55"), "fr") == "1 657,55 €"
    assert format_money(Decimal("1657.55"), "en") == "€1,657.55"


def test_small_amounts_rounding_and_fallbacks():
    assert format_money(90, "en") == "€90.00"
    assert format_money("1234567.891", "it") == "1.234.567,89 €"
    assert format_money(Decimal("0.005"), "en") == "€0.01"
    assert format_money(None, "it") == "0,00 €"
    assert format_money(Decimal("-1500"), "de") == "-1.500,00 €"
    assert format_money(12, "xx") == "€12.00"  # unknown locale → default
