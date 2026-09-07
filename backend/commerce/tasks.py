"""Manutenzione periodica del commercio.

Oggi una cosa sola: la scopa degli ordini del Negozio rimasti appesi
(R2-M14c / ST-R2-18). I webhook `checkout.session.expired` e
`payment_intent.payment_failed` chiudono l'ordine quando Stripe ci avvisa;
questa scopa e' la rete di sicurezza per quando l'evento non arriva affatto
(consegna webhook non configurata, endpoint irraggiungibile per ore, ...):
senza, l'ordine resta "In attesa" per sempre nella pagina "I miei acquisti".
"""

import logging

from celery import shared_task

logger = logging.getLogger(__name__)

#: Le sessioni di Checkout di Stripe scadono dopo 24h. Diamo un margine
#: perche' il webhook di scadenza possa arrivare prima della scopa.
STALE_ORDER_HOURS = 36


@shared_task
def expire_stale_shop_orders_task(hours: int = STALE_ORDER_HOURS):
    from datetime import timedelta

    from django.utils import timezone

    from .models import ShopOrder
    from .services import fail_shop_order

    cutoff = timezone.now() - timedelta(hours=hours)
    stale = list(
        ShopOrder.objects.filter(status=ShopOrder.Status.PENDING, created_at__lt=cutoff)
        .values_list("id", flat=True)[:500]
    )
    swept = 0
    for order_id in stale:
        # Uno per uno: `fail_shop_order` prende il lock di riga e ricontrolla
        # lo stato, cosi' un pagamento che atterra proprio adesso vince.
        if fail_shop_order(order_id=order_id, status=ShopOrder.Status.EXPIRED) == "shop_order_expired":
            swept += 1
    if swept:
        logger.info("expired %s stale shop orders (older than %sh)", swept, hours)
    return swept
