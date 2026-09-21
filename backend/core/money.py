"""Money as the reader sees it in e-mails — the one place the backend turns
an amount into text (the frontend has lib/format-money.ts for the screen).

Thousands separator always, even on four digits ("1.657,55 €", never
"1657,55 €" — Carlo, 2026-09-21), decimal mark and symbol position of the
reader's locale, EUR only (the platform bills in euro). No Babel: five
locales, one table.
"""
from decimal import Decimal, ROUND_HALF_UP

from .locales import DEFAULT_LOCALE, clamp_locale

#: (thousands separator, decimal mark, symbol before the number)
_STYLE = {
    "en": (",", ".", True),
    "it": (".", ",", False),
    "es": (".", ",", False),
    "de": (".", ",", False),
    "fr": (" ", ",", False),  # narrow no-break space, as CLDR has it
}


def format_money(value, locale: str = DEFAULT_LOCALE, *, decimals: int = 2) -> str:
    """`value` (Decimal, int, float, numeric string or None → 0) as "€1,657.55"
    for en, "1.657,55 €" for it/es/de, "1 657,55 €" for fr."""
    amount = Decimal(str(value or 0)).quantize(Decimal(1).scaleb(-decimals), rounding=ROUND_HALF_UP)
    thousands, mark, symbol_first = _STYLE[clamp_locale(locale)]
    sign = "-" if amount < 0 else ""
    digits = f"{abs(amount):,.{decimals}f}".replace(",", "\0").replace(".", mark).replace("\0", thousands)
    return f"{sign}€{digits}" if symbol_first else f"{sign}{digits} €"
