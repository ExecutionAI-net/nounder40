# No Under 40 — monorepo orchestration
.PHONY: help up down build rebuild logs ps restart migrate makemigrations db-pull \
        superuser seed shell dbshell lint test backend-sh frontend-sh clean \
        up-prod down-prod build-prod rebuild-prod logs-prod ps-prod \
        migrate-prod superuser-prod dbshell-prod backend-sh-prod

.DEFAULT_GOAL := help

PROD := docker compose -f docker-compose.prod.yml --env-file .env.prod

# Ensure a local .env exists (copied from the template on first run).
.env:
	@cp .env.example .env && echo "Created .env from .env.example — edit it with your secrets."

# Ensure a local .env.prod exists (copied from the template on first run).
.env.prod:
	@cp .env.prod.example .env.prod && echo "Created .env.prod from .env.prod.example — fill in every value before deploying."

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

## ---- Docker lifecycle ----
up: .env ## Start ALL containers (db, redis, django, celery, celery_beat, frontend, nginx)
	docker compose up -d
	@echo ""
	@echo "  App (via nginx):  http://localhost"
	@echo "  Django API:       http://localhost/api/health/"
	@echo "  Django admin:     http://localhost/admin/"
	@echo "  API docs:         http://localhost/api/docs/"

down: ## Stop and remove all containers
	docker compose down

build: .env ## Build all images
	docker compose build

rebuild: .env ## Rebuild images from scratch and start
	docker compose build --no-cache
	docker compose up -d

restart: ## Restart all services
	docker compose restart

logs: ## Tail logs from all services (make logs s=django to filter)
	docker compose logs -f $(s)

ps: ## List running services
	docker compose ps

## ---- Django ----
migrate: ## Apply migrations
	docker compose exec django python manage.py migrate

makemigrations: ## Create migrations
	docker compose exec django python manage.py makemigrations

superuser: ## Create a Django superuser
	docker compose exec django python manage.py createsuperuser

seed: ## Load seed/fixture data (added in Phase 1)
	docker compose exec django python manage.py loaddata seed || echo "no seed fixtures yet"

shell: ## Django shell
	docker compose exec django python manage.py shell

dbshell: ## Postgres shell
	docker compose exec db psql -U $${POSTGRES_USER:-danza} -d $${POSTGRES_DB:-danza}

## ---- Sync con produzione ----
db-pull: ## Allinea il DB locale a produzione (richiede .env.sync)
	./ops/db-pull-prod.sh

backend-sh: ## Bash into the django container
	docker compose exec django bash

frontend-sh: ## Shell into the frontend container
	docker compose exec frontend sh

## ---- Quality ----
lint: ## Lint backend (ruff) + frontend (eslint)
	docker compose exec django ruff check . || true
	docker compose exec frontend npm run lint || true

test: ## Run backend tests (pytest)
	docker compose exec django pytest

clean: ## Stop and remove containers + volumes (DESTROYS local DB data)
	docker compose down -v

## ---- Production (docker-compose.prod.yml + .env.prod) ----
up-prod: .env.prod ## Start the production stack (nginx TLS certs must already exist in nginx/certs/)
	$(PROD) up -d
	@echo "Deployed. Check: $(PROD) ps"

down-prod: ## Stop and remove all production containers
	$(PROD) down

build-prod: .env.prod ## Build production images
	$(PROD) build

rebuild-prod: .env.prod ## Rebuild production images from scratch and start
	$(PROD) build --no-cache
	$(PROD) up -d

logs-prod: ## Tail production logs (make logs-prod s=django to filter)
	$(PROD) logs -f $(s)

ps-prod: ## List running production services
	$(PROD) ps

migrate-prod: ## Apply migrations on the production DB
	$(PROD) exec django python manage.py migrate

superuser-prod: ## Create a Django superuser in production
	$(PROD) exec django python manage.py createsuperuser

dbshell-prod: ## Production Postgres shell
	$(PROD) exec db psql -U $${POSTGRES_USER:-danza} -d $${POSTGRES_DB:-danza}

backend-sh-prod: ## Bash into the production django container
	$(PROD) exec django bash
