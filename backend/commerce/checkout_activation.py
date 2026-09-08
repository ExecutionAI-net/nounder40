"""Attivare una sessione di Checkout pagata — un posto solo.

C'erano due strade verso l'accredito: il webhook di Stripe e la chiamata a
`/api/stripe/verify-session/` che la pagina di rientro fa dopo il redirect.
R3-H5 (ST-R3-01) ha mostrato che su dev la prima non arriva mai — 0 su 10
pagamenti del giro sono stati evasi dal webhook — quindi tutto dipende dal
fatto che il browser sopravviva al redirect. Serve una terza strada, periodica
(`commerce.tasks.reconcile_stripe_checkout_sessions_task`), e deve fare
esattamente quello che fa la pagina di rientro: da qui il corpo di
`VerifySessionView._activate` diventa questa funzione, che entrambe chiamano.

Tutti gli accrediti a valle deduplicano sull'id Stripe (`Transaction`
.stripe_payment_id ha un UniqueConstraint parziale, `_handle_subscription_
created` fa update_or_create), quindi chiamare questa funzione due volte —
webhook, rientro e scopa insieme — e' innocuo: il secondo torna
"already_processed".
"""

import logging

import stripe

logger = logging.getLogger(__name__)


def meta_dict(obj) -> dict:
    """Metadata di un oggetto Stripe → dict. In stripe 15 StripeObject non è
    più un dict (niente keys()/__iter__): dict(obj) ci provava col protocollo
    sequenza → obj[0] → il famigerato KeyError: 0 in prod."""
    if not obj:
        return {}
    if hasattr(obj, "to_dict"):
        return dict(obj.to_dict())
    return dict(obj)


def activate_checkout_session(session, metadata=None):
    """Accredita quello che questa sessione ha pagato. Idempotente.

    `metadata` si può passare quando il chiamante l'ha già estratta (la view lo
    fa, perché le serve anche per il controllo "è la mia sessione").
    """
    from .services import activate_package_payment, activate_shop_order_payment

    if metadata is None:
        metadata = meta_dict(getattr(session, "metadata", None))

    result = None
    if session.payment_status == "paid":
        payment_id = session.payment_intent
        if isinstance(payment_id, dict):
            payment_id = payment_id.get("id")
        if payment_id:
            activator = (
                activate_shop_order_payment if metadata.get("kind") == "shop_order"
                else activate_package_payment
            )
            result = activator(
                payment_id=payment_id,
                amount_cents=session.amount_total or 0,
                metadata=metadata,
            )
        elif getattr(session, "subscription", None):
            # Pacchetto ricorrente / abbonamento: mode=subscription NON ha
            # un payment_intent, quindi questo ramo mancava e l'attivazione
            # restava appesa al solo webhook (mai consegnato se l'endpoint
            # non è configurato per l'ambiente, es. Sandbox). Stesso handler
            # del webhook, idempotente (update_or_create sull'id Stripe).
            from commerce.webhooks import _handle_subscription_created

            sub_id = session.subscription
            if isinstance(sub_id, dict):
                sub_id = sub_id.get("id")
            sub = stripe.Subscription.retrieve(sub_id)
            # stripe==15.4.0's StripeObject dropped dict-style .get() (it's
            # not a Mapping anymore — only attribute/[] access work, via
            # __getattr__/__getitem__): .get("x") raises AttributeError,
            # 100% reproducible, confirmed against the real SDK. Converting
            # to a plain dict up front (same helper as meta_dict above)
            # makes every .get() below safe again, items included since
            # to_dict() recurses.
            sub_dict = meta_dict(sub)
            period_end = sub_dict.get("current_period_end")
            if not period_end:
                # API Stripe recenti: current_period_end vive sugli items
                items = (sub_dict.get("items") or {}).get("data") or []
                if items:
                    period_end = items[0].get("current_period_end")
            if period_end:
                result = _handle_subscription_created({
                    "id": sub_dict.get("id"), "status": sub_dict.get("status"),
                    "current_period_end": period_end,
                    "customer": sub_dict.get("customer"),
                    "metadata": sub_dict.get("metadata") or metadata,
                })
            else:
                result = "missing_period_end"

    return result
