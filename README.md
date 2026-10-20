# Atlas

Modular algorithmic trading platform (Go). Single binary + Redis. Simulation-first with dual Supertrend + EMA.

## Quick start — local / docker (recommended)

```bash
cp .env.example .env
make dev-up          # Redis 7 in Docker, data volume atlas-redis-data
make dev-replay      # SIMULATION bar walk; trades stored in Redis
make dev-once        # single snapshot workflow against Redis
go run ./cmd/atlas -report  # replay + JSON performance report
```

Wipe local Redis data: `make docker-reset`

No Redis (memory only): `make replay` / `make once`

```bash
make docker-up       # Redis + one-shot atlas container (-replay)
make docker-down
make deploy-docker-vm   # VM PAPER stack (Redis + -serve)
```

## Modes

| Flag | Behavior |
|------|----------|
| (default, SIMULATION) | `-replay` bar-by-bar forward test |
| `-once` | One workflow on latest snapshot |
| `-replay` | Explicit forward walk |
| `-synthetic` | Force generated candles (ignore short fixtures) |
| `-serve` | Scheduler loop (IST candle closes) until SIGINT |

Config: `configs/atlas.example.yaml` (YAML). Redis override is optional for trade persistence.

**VM / production:** see [docs/vm-deploy.md](docs/vm-deploy.md) for Oracle/Hetzner Docker or systemd deployment.

## Documentation

| Document | Description |
|----------|-------------|
| [docs/vm-deploy.md](docs/vm-deploy.md) | VM deployment (Docker, systemd, Flattrade OAuth) |
| [IMPLEMENTATION.md](IMPLEMENTATION.md) | Frozen decisions + phase plan |
| [docs/flattrade-api.md](docs/flattrade-api.md) | Flattrade Pi API + static IP notes |
| [docs/10-terminal-api.md](docs/10-terminal-api.md) | Paper-safe chart and drawing API |
| [docs/](docs/) | Vision, HLD, LLD, workflow, trade manager |

## Layout

```
cmd/atlas/          Entry point
internal/           app, workflow, trade, market, scheduler, repository, …
plugins/            flattrade, indicators, dual_supertrend_ema
configs/            YAML
deployments/        Dockerfile + compose
test/               Integration / smoke tests
```

## License

Private — all rights reserved.
