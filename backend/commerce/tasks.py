"""Manutenzione periodica del commercio.

Due scope, due direzioni, stessa causa: quando i webhook di Stripe non
arrivano, niente si chiude e niente si accredita da solo.

* `expire_stale_shop_orders_task` (R2-M14c / ST-R2-18) chiude gli ordini del
  Negozio rimasti `pending` quando `checkout.session.expired` /
  `payment_intent.payment_failed` non arrivano: senza, l'ordine resta "In
  attesa" per sempre in "I miei acquisti".
* `reconcile_stripe_checkout_sessions_task` (R3-H5 / ST-R3-01) fa l'opposto:
  accredita le sessioni **pagate** che nessuno ha ancora riscattato. Sul giro
  3 di QA 0 pagamenti su 10 sono stati evasi dal webhook — tutti e dieci li ha
  salvati la chiamata a `verify-session` che la pagina di rientro fa dopo il
  redirect. Con il redirect bloccato (tab chiusa, rete che cade, rientro
  annullato) i soldi erano presi e il pacchetto no: tre prove controllate sono
  rimaste appese, una per 22 minuti, finche' non e' stata sbloccata a mano.
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


#: Quanto lasciar decantare una sessione prima di considerarla non riscattata.
#: La pagina di rientro accredita entro ~15 s dal pagamento e il webhook, dove
#: e' consegnato, entro pochi secondi: mezz'ora e' abbondante e tiene la scopa
#: fuori dai piedi della strada normale.
RECONCILE_AFTER_MINUTES = 30

#: Quanto indietro guardare. Le sessioni di Checkout scadono dopo 24h, ma un
#: endpoint webhook rotto per un fine settimana intero deve comunque rientrare.
RECONCILE_LOOKBACK_HOURS = 72

#: Tetto di sicurezza sul numero di sessioni esaminate in un giro.
RECONCILE_MAX_SESSIONS = 200

#: Gli esiti che valgono come recupero vero. Elencare quelli buoni e non
#: quelli neutri e' deliberato: `activate_*` e i gestori dei webhook hanno una
#: dozzina di stringhe di "non ho fatto niente" (`already_processed`,
#: `missing_refs`, `no_payment_id`, ...) e ogni nuova che si aggiungesse
#: verrebbe contata come un recupero da una lista di esclusioni.
_RECOVERED_RESULTS = {
    "package_activated",
    "shop_order_activated",
    "subscription_activated",
    "recurring_package_activated",
}


@shared_task
def reconcile_stripe_checkout_sessions_task(
    after_minutes: int = RECONCILE_AFTER_MINUTES,
    lookback_hours: int = RECONCILE_LOOKBACK_HOURS,
    max_sessions: int = RECONCILE_MAX_SESSIONS,
):
    """Accredita le sessioni di Checkout pagate che nessuno ha riscattato.

    Terza strada verso l'accredito, accanto al webhook e alla pagina di
    rientro, e deliberatamente la stessa strada: chiama
    `commerce.checkout_activation.activate_checkout_session`, cioe' esattamente
    quello che esegue `/api/stripe/verify-session/`. Una seconda copia della
    logica di accredito sarebbe il modo piu' rapido per farle divergere.

    Non c'e' una traccia locale delle sessioni create (la `Transaction` nasce
    all'accredito), quindi la lista la chiede Stripe: sessioni `complete`
    create nella finestra, e di quelle solo le `paid`. Tutto e' idempotente,
    percio' ripassare su una sessione gia' accreditata e' un no-op.
    """
    from datetime import timedelta

    import stripe
    from django.utils import timezone

    from .checkout_activation import activate_checkout_session

    now = timezone.now()
    window = {
        "gte": int((now - timedelta(hours=lookback_hours)).timestamp()),
        "lte": int((now - timedelta(minutes=after_minutes)).timestamp()),
    }
    try:
        page = stripe.checkout.Session.list(created=window, status="complete", limit=100)
    except Exception:
        # Chiave Stripe non configurata (dev), rete, rate limit: la scopa
        # ripassa fra un'ora, non deve far rumore da task fallito.
        logger.exception("stripe checkout reconciliation could not list sessions")
        return 0

    seen = recovered = 0
    for session in page.auto_paging_iter():
        if seen >= max_sessions:
            logger.warning("checkout reconciliation stopped at the %s-session cap", max_sessions)
            break
        seen += 1
        if getattr(session, "payment_status", None) != "paid":
            continue
        try:
            result = activate_checkout_session(session)
        except Exception:
            # Una sessione rotta (metadata di un'altra epoca, prodotto
            # cancellato) non deve fermare le altre.
            logger.exception("checkout reconciliation failed on session %s", getattr(session, "id", "?"))
            continue
        if result in _RECOVERED_RESULTS:
            recovered += 1
            logger.info(
                "checkout reconciliation activated session %s: %s", getattr(session, "id", "?"), result
            )
    if recovered:
        logger.info("checkout reconciliation recovered %s of %s session(s)", recovered, seen)
    return recovered
