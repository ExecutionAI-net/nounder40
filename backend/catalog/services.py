"""Da crediti a lezioni: la traduzione che serve all'allieva.

I crediti sono la nostra contabilita'. Chi compra ragiona in lezioni: quante
ne fa e quanto le costa una. Un pacchetto "100 crediti a 95 euro" non dice
niente; "5 lezioni a 19 euro l'una" si confronta con la lezione singola in un
secondo.

La conversione e' possibile solo se i tipi di lezione coperti costano tutti
lo stesso: con corsi da 11 e da 15 crediti nello stesso pacchetto non esiste
un "numero di lezioni". In quel caso non si inventa nulla e la vetrina resta
sui crediti — e' lo stesso limite che il pannello scuola segnala quando si
marca un prezzo lezione singola.
"""

from __future__ import annotations

from decimal import Decimal


def course_cost_index(school_ids) -> dict:
    """{(school_id, lesson_type_id): {(costo, is_online), ...}} per i corsi
    attivi delle scuole indicate. Una query sola: la vetrina elenca decine di
    pacchetti e calcolarlo per pacchetto sarebbe un N+1."""
    from .models import Course

    index: dict = {}
    rows = Course.objects.filter(school_id__in=list(school_ids), active=True).values_list(
        "school_id", "lesson_type_id", "credit_cost", "is_online"
    )
    for school_id, lesson_type_id, cost, is_online in rows:
        if lesson_type_id is None or cost is None:
            continue
        index.setdefault((school_id, lesson_type_id), set()).add((Decimal(cost), is_online))
    return index


def package_lesson_cost(package, index: dict) -> Decimal | None:
    """Quanti crediti costa UNA lezione fra quelle che il pacchetto copre, o
    None se i tipi coperti costano diverso (o non ci sono corsi)."""
    allowed = [t for t in (package.allowed_lesson_types or [])]
    if not allowed:
        return None

    mode = package.mode_filter or "all"
    costs = set()
    for lesson_type_id in allowed:
        for cost, is_online in index.get((package.school_id, _as_uuid(lesson_type_id)), ()):
            if mode == "online" and not is_online:
                continue
            if mode == "in_person" and is_online:
                continue
            costs.add(cost)
    if len(costs) != 1:
        return None
    cost = costs.pop()
    return cost if cost > 0 else None


def _as_uuid(value):
    import uuid

    if isinstance(value, uuid.UUID):
        return value
    try:
        return uuid.UUID(str(value))
    except (ValueError, AttributeError):
        return value
