.PHONY: build test lint fmt docker-up docker-down docker-reset dev-up dev-down dev-replay dev-once run clean replay once auth-url listen-auth token-job serve deploy-docker-vm

BINARY := atlas
VERSION ?= dev
LDFLAGS := -ldflags "-X main.version=$(VERSION)"
CONFIG := $(or $(ATLAS_CONFIG),configs/atlas.example.yaml)
DEV_CONFIG := configs/atlas.dev.yaml
PAPER_CONFIG := configs/atlas.paper.yaml
COMPOSE := docker compose -f deployments/docker-compose.yml

build:
	go build $(LDFLAGS) -o bin/$(BINARY) ./cmd/atlas

test:
	go test ./...

lint:
	go vet ./...

fmt:
	go fmt ./...

# --- local / docker (Redis volume persists trades + tokens) ---

dev-up:
	$(COMPOSE) up -d redis
	@echo "Redis ready at localhost:6379 (volume: atlas-redis-data)"

dev-down:
	$(COMPOSE) stop redis

docker-up:
	$(COMPOSE) --profile full up -d --build

docker-down:
	$(COMPOSE) --profile full down

docker-reset:
	$(COMPOSE) --profile full down -v
	@echo "Redis volume wiped"

dev-replay: build dev-up
	REDIS_ADDR=localhost:6379 ./bin/$(BINARY) -config $(DEV_CONFIG) -replay -synthetic

dev-once: build dev-up
	REDIS_ADDR=localhost:6379 ./bin/$(BINARY) -config $(DEV_CONFIG) -once -synthetic

run: build
	./bin/$(BINARY) -config $(CONFIG)

replay: build
	./bin/$(BINARY) -config $(CONFIG) -replay -synthetic

once: build
	./bin/$(BINARY) -config $(CONFIG) -once -synthetic

auth-url: build
	./bin/$(BINARY) -config $(CONFIG) -auth-url

listen-auth: build
	./bin/$(BINARY) -config $(CONFIG) -listen-auth

token-job: build
	./bin/$(BINARY) -config $(CONFIG) -token-job

serve: build
	./bin/$(BINARY) -config $(or $(ATLAS_CONFIG),$(PAPER_CONFIG)) -serve

deploy-docker-vm:
	docker compose -f deployments/docker-compose.vm.yml up -d --build

clean:
	rm -rf bin/
