.PHONY: db schema poc listing details monitor test e2e

db:
	docker compose up -d postgres

schema:
	.venv/bin/python -m coches_scraper.scripts.init_schema

poc:
	.venv/bin/python -m coches_scraper.scripts.poc_fetch --page 1

listing:
	.venv/bin/scrapy crawl listing -a max_pages=$(or $(MAX_PAGES),3)

details:
	.venv/bin/scrapy crawl details -a batch_size=$(or $(BATCH),50) -a max_items=$(or $(MAX_ITEMS),50)

monitor:
	.venv/bin/uvicorn coches_scraper.services.monitor_api:app --host 0.0.0.0 --port 8001

test:
	.venv/bin/pytest coches_scraper/tests -q

e2e:
	.venv/bin/python -m coches_scraper.scripts.e2e_local_server
