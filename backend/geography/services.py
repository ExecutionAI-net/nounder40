"""Da nome-paese in chiaro a codice ISO 3166-1 alpha-2.

`School.country` e' testo libero e nella pratica contiene di tutto: "Italy",
"Spain", "IT". Stripe invece vuole il codice ISO alla creazione dell'account
Connect — e il paese di un account Stripe **non e' modificabile dopo la
creazione**: sbagliarlo significa cancellare l'account e rifare l'onboarding
da zero. Per questo qui non esiste un default: o il paese si risolve, o chi
chiama riceve None e si ferma.

Ordine di risoluzione: prima la tabella HQCountry (che HQ gestisce e che e'
la fonte di verita' per la geografia del network), poi la tabella di alias
qui sotto per i nomi scritti nelle cinque lingue dell'interfaccia.
"""

from __future__ import annotations

# Nomi (inglese + le cinque lingue dell'app + endonimo) → ISO alpha-2.
# Volutamente corta: i paesi in cui la rete opera o puo' plausibilmente
# aprire. Un paese fuori da qui non passa in silenzio, da' errore.
_ALIASES: dict[str, str] = {}


def _register(code: str, *names: str) -> None:
    for name in names:
        _ALIASES[name.casefold()] = code


_register("IT", "italy", "italia", "italie", "italien")
_register("ES", "spain", "spagna", "españa", "espana", "espagne", "spanien")
_register("FR", "france", "francia", "frankreich", "francja")
_register("DE", "germany", "germania", "alemania", "allemagne", "deutschland")
_register("GB", "united kingdom", "uk", "great britain", "regno unito",
          "reino unido", "royaume-uni", "vereinigtes königreich", "vereinigtes koenigreich")
_register("TR", "turkey", "türkiye", "turkiye", "turchia", "turquía", "turquia",
          "turquie", "türkei", "tuerkei")
_register("PT", "portugal", "portogallo", "portugalia")
_register("NL", "netherlands", "paesi bassi", "países bajos", "paises bajos",
          "pays-bas", "niederlande", "holland", "olanda")
_register("BE", "belgium", "belgio", "bélgica", "belgica", "belgique", "belgien")
_register("CH", "switzerland", "svizzera", "suiza", "suisse", "schweiz")
_register("AT", "austria", "autriche", "österreich", "oesterreich")
_register("IE", "ireland", "irlanda", "irlande", "irland")
_register("GR", "greece", "grecia", "grèce", "grece", "griechenland")
_register("PL", "poland", "polonia", "pologne", "polen")
_register("SE", "sweden", "svezia", "suecia", "suède", "suede", "schweden")
_register("DK", "denmark", "danimarca", "dinamarca", "danemark", "dänemark", "daenemark")
_register("NO", "norway", "norvegia", "noruega", "norvège", "norvege", "norwegen")
_register("FI", "finland", "finlandia", "finlande", "finnland")
_register("US", "united states", "usa", "stati uniti", "estados unidos",
          "états-unis", "etats-unis", "vereinigte staaten")
# America Latina
_register("BR", "brazil", "brasile", "brasil", "brésil", "bresil", "brasilien")
_register("AR", "argentina", "argentine", "argentinien")
_register("CL", "chile", "cile", "chili")
_register("CO", "colombia", "colombie", "kolumbien")
_register("MX", "mexico", "messico", "méxico", "mexique", "mexiko")
_register("PR", "puerto rico", "porto rico", "portorico", "puerto-rico")


_KNOWN_CODES = frozenset(_ALIASES.values())

# English display name per code (the first alias registered is the English
# one); the client localises from the code with Intl.DisplayNames.
ENGLISH_NAMES: dict[str, str] = {}
for _name, _code in _ALIASES.items():
    ENGLISH_NAMES.setdefault(_code, _name.title())
ENGLISH_NAMES.update({"GB": "United Kingdom", "US": "United States", "NL": "Netherlands", "PR": "Puerto Rico"})


def country_code_for(value: str | None) -> str | None:
    """ISO alpha-2 per un paese scritto in chiaro, o None se non risolvibile."""
    raw = (value or "").strip()
    if not raw:
        return None
    key = raw.casefold()

    # HQCountry: la geografia che HQ ha davvero configurato
    from .models import HQCountry

    for country in HQCountry.objects.all():
        if country.code and country.code.strip().casefold() == key:
            return country.code.strip().upper()
        if country.name and country.name.strip().casefold() == key:
            code = (country.code or "").strip().upper()
            if code:
                return code

    if key in _ALIASES:
        return _ALIASES[key]

    # Codice gia' scritto a mano ("IT") con HQCountry non popolata
    if len(key) == 2 and key.upper() in _KNOWN_CODES:
        return key.upper()

    return None
