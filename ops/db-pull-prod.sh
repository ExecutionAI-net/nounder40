#!/usr/bin/env bash
# Allinea database e media LOCALI a quelli di PRODUZIONE.
#
# Produzione e locale girano lo stesso stack (postgres:16-alpine in docker
# compose), quindi il dump è una copia fedele: nessuna conversione di mezzo.
#
# I dati arrivano ANONIMIZZATI: sono per fare test, non per lavorare su
# persone reali. Restano intatti solo i ruoli elencati in KEEP_ROLES
# (default: admin HQ e insegnanti), così puoi ancora entrare con le loro
# credenziali di produzione.
#
# Configurazione: copia .env.sync.example in .env.sync e riempilo (non è
# versionato). Poi basta `make db-pull` su qualsiasi PC.
#
# ATTENZIONE: il database locale viene CANCELLATO e ricreato dal dump.
set -euo pipefail

cd "$(dirname "$0")/.."

[ -f .env.sync ] || { echo "Manca .env.sync — copialo da .env.sync.example e riempilo."; exit 1; }
set -a; . ./.env.sync; set +a
: "${PROD_SSH:?PROD_SSH non impostato in .env.sync}"
: "${PROD_DIR:?PROD_DIR non impostato in .env.sync}"

DUMP_DIR="${DUMP_DIR:-./.dumps}"
MEDIA_CACHE="${MEDIA_CACHE:-./.dumps/media-cache}"
STAMP=$(date +%Y%m%d-%H%M%S)
DUMP="$DUMP_DIR/prod-$STAMP.dump"
mkdir -p "$DUMP_DIR"

PROD_COMPOSE="docker compose -f docker-compose.prod.yml --env-file .env.prod"

# I ruoli da NON anonimizzare. Solo lettere minuscole e virgole: questa stringa
# finisce dentro una query SQL.
KEEP_ROLES="${KEEP_ROLES:-hq,teacher}"
[[ "$KEEP_ROLES" =~ ^[a-z_,]+$ ]] || { echo "KEEP_ROLES non valido: '$KEEP_ROLES' (solo lettere minuscole e virgole)"; exit 1; }

echo "==> 1/6  Dump del database da produzione ($PROD_SSH)"
# Le credenziali restano sul server: le legge da .env.prod dentro la sessione ssh.
ssh "$PROD_SSH" "cd '$PROD_DIR' && set -a && . ./.env.prod && set +a && \
  $PROD_COMPOSE exec -T db pg_dump -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -Fc --no-owner --no-privileges" > "$DUMP"

[ -s "$DUMP" ] || { echo "Dump vuoto — interrotto, il locale non è stato toccato."; exit 1; }
echo "    dump ok: $DUMP ($(du -h "$DUMP" | cut -f1))"

echo "==> 2/6  Scarico i media da produzione"
# Il volume media si divide in due alberi (vedi backend/core/storage.py):
#   public/   immagini servite dal sito (prodotti, loghi, foto) -> servono per i test
#   private/  documenti riservati (certificati medici) -> esclusi salvo richiesta
MEDIA_ARGS=(--exclude 'private/')
[ "${MEDIA_PRIVATE:-0}" = "1" ] && MEDIA_ARGS=()
mkdir -p "$MEDIA_CACHE"

if [ -n "${PROD_MEDIA_PATH:-}" ]; then
  # Via preferita: rsync incrementale sul volume, ritrasferisce solo ciò che cambia.
  echo "    rsync da $PROD_MEDIA_PATH"
  rsync -az --delete "${MEDIA_ARGS[@]}" "$PROD_SSH:$PROD_MEDIA_PATH/" "$MEDIA_CACHE/"
else
  # Fallback: tar dal container. Non incrementale, ma non richiede di leggere
  # il volume Docker sul server (che di norma è di root).
  echo "    PROD_MEDIA_PATH non impostato: uso tar dal container"
  EXCL=""
  [ "${MEDIA_PRIVATE:-0}" = "1" ] || EXCL="--exclude=./private"
  rm -rf "$MEDIA_CACHE"; mkdir -p "$MEDIA_CACHE"
  ssh "$PROD_SSH" "cd '$PROD_DIR' && $PROD_COMPOSE exec -T django tar -C /var/www/media $EXCL -cf - ." \
    | tar -C "$MEDIA_CACHE" -xf -
fi
echo "    media in cache: $(du -sh "$MEDIA_CACHE" | cut -f1)"

echo "==> 3/6  Fermo i servizi che tengono aperte connessioni al DB"
docker compose stop django celery celery_beat >/dev/null

echo "==> 4/6  Ricreo il database locale"
DB="${POSTGRES_DB:-danza}"; DBU="${POSTGRES_USER:-danza}"
docker compose exec -T db psql -U "$DBU" -d postgres -v ON_ERROR_STOP=1 \
  -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$DB' AND pid<>pg_backend_pid();" >/dev/null
docker compose exec -T db psql -U "$DBU" -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS $DB;" >/dev/null
docker compose exec -T db psql -U "$DBU" -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE $DB OWNER $DBU;" >/dev/null
docker compose exec -T db pg_restore -U "$DBU" -d "$DB" --no-owner --no-privileges < "$DUMP"

docker compose start django celery celery_beat >/dev/null

echo "==> 5/6  Anonimizzo i dati personali (intatti: $KEEP_ROLES)"
docker compose exec -T db psql -U "$DBU" -d "$DB" -v ON_ERROR_STOP=1 -q <<SQL
BEGIN;

-- Account: chi non è in KEEP_ROLES perde i dati identificativi. L'id resta,
-- quindi le email restano uniche e le foreign key non si muovono.
UPDATE accounts_user SET
  email      = 'user-' || left(id::text, 8) || '@example.test',
  full_name  = 'Utente ' || left(id::text, 8),
  first_name = 'Utente',
  last_name  = left(id::text, 8),
  phone      = ''
WHERE is_superuser = false
  AND role <> ALL (string_to_array('$KEEP_ROLES', ','))
  AND NOT (roles::text[] && string_to_array('$KEEP_ROLES', ','));

-- Studenti. Città e nazione restano: servono per provare la ricerca per città.
-- La data di nascita è portata al 1° gennaio: mantiene la fascia d'età senza
-- identificare la persona.
UPDATE students SET
  name       = 'Studente ' || left(id::text, 8),
  first_name = 'Studente',
  last_name  = left(id::text, 8),
  email      = 'studente-' || left(id::text, 8) || '@example.test',
  phone      = '',
  address    = '',
  date_of_birth = CASE WHEN date_of_birth IS NULL THEN NULL
                       ELSE make_date(extract(year FROM date_of_birth)::int, 1, 1) END;

-- Conversazioni che coinvolgono uno studente: il contenuto è corrispondenza reale.
UPDATE messages SET content = '[contenuto anonimizzato]'
WHERE content <> ''
  AND conversation_id IN (SELECT id FROM conversations WHERE student_id IS NOT NULL);

-- Note sui documenti: testo libero scritto dalla segreteria sulle persone.
UPDATE student_documents SET note = '' WHERE note <> '';

COMMIT;
SQL

echo "==> 6/6  Carico i media nel volume locale"
# Su macOS il volume Docker non è raggiungibile dal filesystem host, quindi
# ci si passa attraverso un container.
docker compose exec -T django sh -c 'rm -rf /var/www/media/* && mkdir -p /var/www/media'
tar -C "$MEDIA_CACHE" -cf - . | docker compose exec -T django tar -C /var/www/media -xf -

echo
echo "Fatto. Il locale rispecchia la produzione, con i dati anonimizzati."
docker compose exec -T db psql -U "$DBU" -d "$DB" -t -c "
SELECT 'utenti: '||count(*) FROM accounts_user
UNION ALL SELECT 'di cui non anonimizzati: '||count(*) FROM accounts_user
  WHERE is_superuser OR role = ANY (string_to_array('$KEEP_ROLES', ',')) OR roles::text[] && string_to_array('$KEEP_ROLES', ',')
UNION ALL SELECT 'scuole: '||count(*) FROM schools
UNION ALL SELECT 'lezioni: '||count(*) FROM lessons
UNION ALL SELECT 'prodotti shop: '||count(*) FROM shop_products;"
echo
echo "Le password di produzione restano valide per i ruoli non anonimizzati ($KEEP_ROLES)."
