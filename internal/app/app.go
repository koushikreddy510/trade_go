// Package app wires Atlas components into a runnable simulation and serve runtime.
package app

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/koushik-bangaru/atlas/internal/broker"
	"github.com/koushik-bangaru/atlas/internal/config"
	"github.com/koushik-bangaru/atlas/internal/domain"
	"github.com/koushik-bangaru/atlas/internal/events"
	"github.com/koushik-bangaru/atlas/internal/execctx"
	"github.com/koushik-bangaru/atlas/internal/health"
	"github.com/koushik-bangaru/atlas/internal/indicator"
	"github.com/koushik-bangaru/atlas/internal/instruments"
	"github.com/koushik-bangaru/atlas/internal/logging"
	"github.com/koushik-bangaru/atlas/internal/market"
	"github.com/koushik-bangaru/atlas/internal/repository"
	"github.com/koushik-bangaru/atlas/internal/scheduler"
	"github.com/koushik-bangaru/atlas/internal/sessionjob"
	"github.com/koushik-bangaru/atlas/internal/simulation"
	"github.com/koushik-bangaru/atlas/internal/strategy"
	"github.com/koushik-bangaru/atlas/internal/trade"
	"github.com/koushik-bangaru/atlas/internal/trailing"
	"github.com/koushik-bangaru/atlas/internal/workflow"
	"github.com/koushik-bangaru/atlas/plugins/broker/flattrade"
	"github.com/koushik-bangaru/atlas/plugins/broker/paper"
	dual "github.com/koushik-bangaru/atlas/plugins/strategies/dual_supertrend_ema"
	"github.com/koushik-bangaru/atlas/plugins/trailing/price"
	"github.com/redis/go-redis/v9"
)

// Options configures App construction.
type Options struct {
	ConfigPath    string
	FixturePath   string // override config simulation.fixture_path
	UseSynthetic  bool
	RedisOptional bool // default true: if redis ping fails, memory repo + warn
}

// ReplaySummary aggregates bar-walk replay statistics.
type ReplaySummary struct {
	Bars         int
	Buys         int
	Sells        int
	Exits        int
	Ignores      int
	TradesOpened int
	ActiveTrades int
	ClosedTrades int
}

// App is the wired Atlas runtime.
type App struct {
	cfg        *config.Config
	log        *logging.Logger
	opts       Options

	bus        events.Bus
	marketSvc  *market.Service
	provider   market.Provider

	strat      strategy.Strategy
	indEng     *indicator.Engine
	mgr        *trade.Manager
	redis      *redis.Client

	ftClient   *flattrade.Client
	sessionMgr *flattrade.SessionManager

	wfEng      *workflow.Engine
	fullPipe   *workflow.Pipeline
	replayPipe *workflow.Pipeline

	symbol     domain.Symbol
	entryTF    domain.Timeframe
	timeframes []domain.Timeframe
	lookback   int
	warmup     int

	sched      *scheduler.Scheduler
}

// New builds and wires an App from configuration.
func New(ctx context.Context, cfg *config.Config, log *logging.Logger, opts Options) (*App, error) {
	if cfg == nil {
		return nil, fmt.Errorf("app: config required")
	}
	if log == nil {
		log = logging.New("app")
	}
	if err := validateModeCredentials(cfg); err != nil {
		return nil, err
	}
	if err := validateExecutionMode(cfg); err != nil {
		return nil, err
	}
	if !cfg.Strategies.DualSupertrendEMA.Enabled {
		return nil, fmt.Errorf("app: dual_supertrend_ema must be enabled")
	}

	stratCfg := cfg.Strategies.DualSupertrendEMA
	strat, indEng, err := dual.NewFromConfig(stratCfg)
	if err != nil {
		return nil, fmt.Errorf("app: strategy: %w", err)
	}

	entryTF, err := domain.ParseTimeframe(stratCfg.EntryTimeframe)
	if err != nil {
		return nil, fmt.Errorf("app: entry timeframe: %w", err)
	}

	timeframes, err := parseTimeframes(cfg.Timeframes)
	if err != nil {
		return nil, fmt.Errorf("app: timeframes: %w", err)
	}

	symbol := resolveSymbol(cfg, stratCfg)
	warmup := warmupBars(stratCfg)
	lookback := warmup + 50
	if lookback < 100 {
		lookback = 100
	}

	mgr, redisClient, err := buildTradeManager(ctx, cfg, log, opts)
	if err != nil {
		return nil, err
	}

	ftClient, sessionMgr := wireFlattradeSession(ctx, cfg, log, redisClient)

	symbol, err = maybeResolveFutures(ctx, cfg, symbol, ftClient, log)
	if err != nil {
		if redisClient != nil {
			_ = redisClient.Close()
		}
		return nil, err
	}

	provider, err := buildProvider(cfg, opts, log, ftClient)
	if err != nil {
		if redisClient != nil {
			_ = redisClient.Close()
		}
		return nil, err
	}

	marketSvc := market.NewService(provider, market.WithBaseTimeframe(entryTF))
	bus := events.NewBus()

	execMode, _ := domain.ParseExecutionMode(string(cfg.Execution.Mode))
	br := buildBroker(cfg, ftClient, execMode)

	indProc := indicator.NewIndicatorProcessor(indEng)
	stratProc := strategy.NewProcessor([]strategy.Strategy{strat})
	tradeProc := trade.NewProcessor(mgr, &trade.ProcessorConfig{
		Broker: br,
		Mode:   execMode,
	})
	simProc := simulation.NewProcessor(mgr, simulation.DefaultConfig())
	trailProc := trailing.NewProcessor(mgr, price.PriceTrail{TrailPoints: defaultTrailPoints()}, trailing.Config{
		EMAIndicatorKey: trailing.DefaultConfig().EMAIndicatorKey,
		Broker:          br,
		Mode:            execMode,
		Log:             log.With("component", "trailing"),
	})

	marketProc, err := market.NewMarketProcessor(market.ProcessorConfig{
		Service:    marketSvc,
		Timeframes: timeframes,
		Lookback:   lookback,
	})
	if err != nil {
		if redisClient != nil {
			_ = redisClient.Close()
		}
		return nil, fmt.Errorf("app: market processor: %w", err)
	}

	includeSimulation := !isLiveExecution(cfg)
	fullPipe := buildPipeline(marketProc, indProc, stratProc, tradeProc, simProc, trailProc, includeSimulation)
	replayPipe := buildPipeline(nil, indProc, stratProc, tradeProc, simProc, trailProc, includeSimulation)

	sched := scheduler.New(bus)

	a := &App{
		cfg:        cfg,
		log:        log,
		opts:       opts,
		bus:        bus,
		marketSvc:  marketSvc,
		provider:   provider,
		strat:      strat,
		indEng:     indEng,
		mgr:        mgr,
		redis:      redisClient,
		ftClient:   ftClient,
		sessionMgr: sessionMgr,
		wfEng:      workflow.NewEngine(bus),
		fullPipe:   fullPipe,
		replayPipe: replayPipe,
		symbol:     symbol,
		entryTF:    entryTF,
		timeframes: timeframes,
		lookback:   lookback,
		warmup:     warmup,
		sched:      sched,
	}

	a.sched.RegisterFunc(scheduler.JobCandleClosed, a.handleCandleClosed)
	a.registerSessionTokenJob()

	return a, nil
}

func (a *App) registerSessionTokenJob() {
	jobCfg := a.cfg.SessionJob
	if !jobCfg.Enabled || a.sessionMgr == nil {
		return
	}
	mode := sessionjob.Mode(strings.ToLower(strings.TrimSpace(jobCfg.Mode)))
	if mode == "" {
		mode = sessionjob.ModeCheck
	}
	timeout := time.Duration(jobCfg.ListenTimeoutMin) * time.Minute
	runner := sessionjob.NewRunner(sessionjob.Config{
		Enabled:         true,
		Mode:            mode,
		HourIST:         jobCfg.HourIST,
		MinuteIST:       jobCfg.MinuteIST,
		ListenPort:      jobCfg.ListenPort,
		ListenTimeout:   timeout,
		RequestCodeFile: jobCfg.RequestCodeFile,
		APIKey:          a.cfg.Flattrade.APIKey,
	}, a.sessionMgr, a.log.With("component", "sessionjob"))

	a.sched.Register(scheduler.JobSessionToken, runner.Handler())
	hour, minute := jobCfg.HourIST, jobCfg.MinuteIST
	if hour == 0 && minute == 0 {
		hour, minute = 8, 15
	}
	a.sched.ScheduleDailyAt(scheduler.JobSessionToken, hour, minute, map[string]string{
		"mode": string(mode),
	})
	a.log.Info("session token job scheduled",
		"hour_ist", hour,
		"minute_ist", minute,
		"mode", mode,
	)
}

// RunSessionTokenJob runs the daily jKey job once (cron / EventBridge equivalent).
func (a *App) RunSessionTokenJob(ctx context.Context) error {
	if a.sessionMgr == nil {
		return fmt.Errorf("app: session manager unavailable (need Flattrade creds + Redis)")
	}
	jobCfg := a.cfg.SessionJob
	mode := sessionjob.Mode(strings.ToLower(strings.TrimSpace(jobCfg.Mode)))
	if mode == "" {
		mode = sessionjob.ModeCheck
	}
	timeout := time.Duration(jobCfg.ListenTimeoutMin) * time.Minute
	runner := sessionjob.NewRunner(sessionjob.Config{
		Enabled:         true,
		Mode:            mode,
		HourIST:         jobCfg.HourIST,
		MinuteIST:       jobCfg.MinuteIST,
		ListenPort:      jobCfg.ListenPort,
		ListenTimeout:   timeout,
		RequestCodeFile: jobCfg.RequestCodeFile,
		APIKey:          a.cfg.Flattrade.APIKey,
	}, a.sessionMgr, a.log.With("component", "sessionjob"))
	return runner.Run(ctx)
}

// FlattradeClient returns the wired Flattrade API client, if session management is active.
func (a *App) FlattradeClient() *flattrade.Client {
	return a.ftClient
}

// Session returns the Flattrade session manager for daily jKey lifecycle.
func (a *App) Session() *flattrade.SessionManager {
	return a.sessionMgr
}

// RunReplay walks candles bar-by-bar (forward test) and returns a summary.
func (a *App) RunReplay(ctx context.Context) (ReplaySummary, error) {
	candles, err := a.fetchAllCandles(ctx)
	if err != nil {
		return ReplaySummary{}, err
	}
	if len(candles) == 0 {
		return ReplaySummary{}, fmt.Errorf("app: replay: no candles")
	}
	if a.warmup >= len(candles) {
		return ReplaySummary{}, fmt.Errorf("app: replay: need at least %d candles, got %d", a.warmup+1, len(candles))
	}

	var summary ReplaySummary
	summary.Bars = len(candles) - a.warmup

	for i := a.warmup; i <= len(candles); i++ {
		window := candles[:i]
		last := window[len(window)-1]

		ec := a.newExecutionContext(last.Time)
		ec.Market = domain.MarketSnapshot{
			Symbol:    a.symbol,
			Timeframe: a.entryTF,
			Candles:   window,
		}

		beforeActive := len(a.mgr.GetActive())
		if err := a.replayPipe.Run(ctx, ec); err != nil {
			return summary, fmt.Errorf("app: replay bar %d: %w", i, err)
		}
		afterActive := len(a.mgr.GetActive())
		if beforeActive == 0 && afterActive == 1 {
			summary.TradesOpened++
		}

		for _, sig := range ec.Signals {
			switch sig.Action {
			case domain.ActionBuy:
				summary.Buys++
			case domain.ActionSell:
				summary.Sells++
			case domain.ActionExit:
				summary.Exits++
			case domain.ActionIgnore:
				summary.Ignores++
			}
		}
	}

	summary.ActiveTrades = len(a.mgr.GetActive())
	summary.ClosedTrades = countClosedTrades(a.mgr, dual.StrategyID)
	return summary, nil
}

// RunOnce runs a single workflow on the full candle snapshot (latest lookback).
func (a *App) RunOnce(ctx context.Context) error {
	ec := a.newExecutionContext(time.Now().UTC())
	ec.Metadata[market.MetadataKeyTimeframes] = a.timeframes

	wf := domain.Workflow{
		Type:          domain.WorkflowTrading,
		Symbol:        a.symbol,
		Timeframe:     a.entryTF,
		Status:        domain.WorkflowCreated,
		ConfigVersion: a.cfg.Version,
	}

	if err := a.wfEng.Start(ctx, wf, ec, a.fullPipe); err != nil {
		return fmt.Errorf("app: run once: %w", err)
	}
	return nil
}

// RunServe starts scheduler candle jobs that call RunOnce; blocks until ctx is cancelled.
func (a *App) RunServe(ctx context.Context) error {
	addr := a.cfg.Server.HTTPAddr
	if addr == "" {
		addr = ":8080"
	}

	healthSrv := health.NewServer(addr, a.healthSnapshot)
	healthSrv.Start()
	defer func() {
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = healthSrv.Shutdown(shutdownCtx)
	}()

	symbols := scheduleSymbols(a.cfg)
	a.sched.ScheduleCandleClosures(a.timeframes, symbols)
	a.log.Info("scheduler started",
		"symbols", symbols,
		"timeframes", timeframeStrings(a.timeframes),
		"health_addr", addr,
	)
	return a.sched.Start(ctx)
}

func (a *App) healthSnapshot(ctx context.Context) health.Snapshot {
	snap := health.Snapshot{
		Status: "ok",
		Mode:   string(a.cfg.Execution.Mode),
		Redis:  "fail",
	}
	if a.redis != nil {
		if err := repository.Ping(ctx, a.redis); err == nil {
			snap.Redis = "ok"
		}
	}
	snap.HasSessionToken = a.hasSessionToken(ctx)
	return snap
}

func (a *App) hasSessionToken(ctx context.Context) bool {
	if a.sessionMgr != nil && a.sessionMgr.Token() != "" {
		return true
	}
	if a.redis == nil {
		return false
	}
	store := repository.NewRedisTokenStore(a.redis)
	_, err := store.Get(ctx, repository.FlattradeTokenKey())
	return err == nil
}

// Close releases redis client and event bus resources.
func (a *App) Close() error {
	if a.bus != nil {
		_ = a.bus.Close()
	}
	if a.redis != nil {
		return a.redis.Close()
	}
	return nil
}

func (a *App) handleCandleClosed(ctx context.Context, job scheduler.Job) error {
	a.log.Debug("candle closed", "symbol", job.Symbol, "timeframe", job.Timeframe.String())
	return a.RunOnce(ctx)
}

func (a *App) newExecutionContext(ts time.Time) *execctx.ExecutionContext {
	mode, _ := domain.ParseExecutionMode(string(a.cfg.Execution.Mode))
	return &execctx.ExecutionContext{
		ConfigVersion: a.cfg.Version,
		Symbol:        a.symbol,
		Timeframe:     a.entryTF,
		ExecutionMode: mode,
		Timestamp:     ts,
		Metadata: map[string]any{
			dual.MetadataQuantityKey: 1,
		},
	}
}

func (a *App) fetchAllCandles(ctx context.Context) ([]domain.Candle, error) {
	from := time.Time{}
	to := time.Now().UTC()
	candles, err := a.provider.FetchCandles(ctx, a.symbol, a.entryTF, from, to)
	if err != nil {
		return nil, fmt.Errorf("app: fetch candles: %w", err)
	}
	return candles, nil
}

func buildProvider(cfg *config.Config, opts Options, log *logging.Logger, ftClient *flattrade.Client) (market.Provider, error) {
	mode := cfg.Execution.Mode
	if mode == config.ModePaper || mode == config.ModeLive {
		if ftClient == nil || ftClient.SessionToken() == "" {
			return nil, fmt.Errorf(
				"app: %s mode requires Flattrade session token; run atlas -token-job or exchange daily jKey (see docs/flattrade-api.md)",
				mode,
			)
		}
		if strings.TrimSpace(cfg.Simulation.SymbolToken) == "" {
			return nil, fmt.Errorf("app: %s mode requires simulation.symbol_token (or resolve_futures: true)", mode)
		}
		log.Info("using flattrade market data", "mode", mode, "symbol_token", cfg.Simulation.SymbolToken)
		return flattrade.NewMarketProvider(ftClient), nil
	}

	token := cfg.Simulation.SymbolToken
	if token == "" {
		token = "26000"
	}

	syntheticBars := cfg.Simulation.SyntheticBars
	if syntheticBars <= 0 {
		syntheticBars = 120
	}

	fixturePath := opts.FixturePath
	if fixturePath == "" {
		fixturePath = cfg.Simulation.FixturePath
	}

	if opts.UseSynthetic {
		log.Info("using synthetic market data", "bars", syntheticBars)
		return newSyntheticProvider(token, syntheticBars), nil
	}

	if fixturePath != "" {
		if _, err := os.Stat(fixturePath); err == nil {
			log.Info("using fixture market data", "path", fixturePath)
			return market.NewFixtureProvider(fixturePath, token)
		}
		if syntheticBars > 0 {
			log.Warn("fixture not found, using synthetic bars", "path", fixturePath, "bars", syntheticBars)
			return newSyntheticProvider(token, syntheticBars), nil
		}
		return nil, fmt.Errorf("app: fixture not found: %s", fixturePath)
	}

	if syntheticBars > 0 {
		log.Info("using synthetic market data", "bars", syntheticBars)
		return newSyntheticProvider(token, syntheticBars), nil
	}

	return nil, fmt.Errorf("app: no market data source configured (set simulation.fixture_path or synthetic_bars)")
}

func newSyntheticProvider(token string, count int) market.Provider {
	start := time.Date(2026, 6, 1, 9, 0, 0, 0, time.UTC)
	base := 75000.0
	provider := market.NewSyntheticProvider(token, count, start, base)
	// Strong uptrend so short fixtures can trigger BUY signals.
	candles := bullTrendCandles(count, start, base)
	provider.SetCandles(token, candles)
	return provider
}

func bullTrendCandles(n int, start time.Time, base float64) []domain.Candle {
	out := make([]domain.Candle, n)
	for i := 0; i < n; i++ {
		o := base + float64(i)*150
		out[i] = domain.Candle{
			Time:   start.Add(time.Duration(i) * time.Hour),
			Open:   o,
			High:   o + 40,
			Low:    o - 15,
			Close:  o + 30,
			Volume: int64(1000 + i),
		}
	}
	return out
}

func buildTradeManager(ctx context.Context, cfg *config.Config, log *logging.Logger, opts Options) (*trade.Manager, *redis.Client, error) {
	redisOptional := true
	if opts.RedisOptional == false {
		redisOptional = false
	}

	client := repository.NewRedisClient(cfg.Redis.Addr, cfg.Redis.DB)
	if err := repository.Ping(ctx, client); err != nil {
		_ = client.Close()
		if !redisOptional {
			return nil, nil, fmt.Errorf("app: redis required but unavailable: %w", err)
		}
		log.Warn("redis unavailable, using memory trade repository", "error", err)
		mgr := trade.NewManager(trade.WithRepository(repository.NewMemoryTradeRepository()))
		return mgr, nil, nil
	}

	repo := repository.NewRedisTradeRepository(client)
	mgr := trade.NewManager(trade.WithRepository(repo))
	if err := mgr.LoadActiveFromRepo(ctx); err != nil {
		_ = client.Close()
		return nil, nil, fmt.Errorf("app: load active trades: %w", err)
	}
	log.Info("redis trade repository connected", "addr", cfg.Redis.Addr)
	return mgr, client, nil
}

func resolveSymbol(cfg *config.Config, stratCfg config.DualSupertrendEMAConfig) domain.Symbol {
	exchange := cfg.Simulation.Exchange
	if exchange == "" {
		exchange = "MCX"
	}
	token := cfg.Simulation.SymbolToken
	if token == "" {
		token = "26000"
	}
	name := stratCfg.Symbol
	if name == "" {
		name = "SILVERMIC"
	}
	return domain.Symbol{
		Exchange: exchange,
		Token:    token,
		Name:     name,
		LotSize:  1,
	}
}

// maybeResolveFutures picks the MCX futures contract via SearchScrip (old Lambda logic).
// Updates cfg.Simulation.SymbolToken so market data uses the resolved token.
func maybeResolveFutures(
	ctx context.Context,
	cfg *config.Config,
	symbol domain.Symbol,
	ftClient *flattrade.Client,
	log *logging.Logger,
) (domain.Symbol, error) {
	if !cfg.Simulation.ResolveFutures {
		return symbol, nil
	}
	mode := cfg.Execution.Mode
	if mode != config.ModePaper && mode != config.ModeLive {
		log.Warn("resolve_futures ignored in SIMULATION mode (using static/fixture symbol)")
		return symbol, nil
	}
	if ftClient == nil || ftClient.SessionToken() == "" {
		return symbol, fmt.Errorf("app: resolve_futures requires Flattrade session token")
	}

	search := strings.TrimSpace(cfg.Simulation.SearchText)
	root := strings.TrimSpace(cfg.Simulation.FuturesRoot)
	if search == "" {
		search = symbol.Name
	}
	if root == "" {
		root = search
	}
	if root == "" {
		return symbol, fmt.Errorf("app: resolve_futures requires search_text or futures_root (e.g. SILVERMIC)")
	}

	policy := instruments.PolicyFixed
	if strings.EqualFold(cfg.Simulation.MonthPolicy, string(instruments.PolicySmart)) {
		policy = instruments.PolicySmart
	}
	offset := cfg.Simulation.MonthOffset
	if policy == instruments.PolicyFixed && offset == 0 {
		offset = 2 // default: current + 2 months (legacy-safe)
	}

	sel := instruments.SelectConfig{
		Root:           strings.ToUpper(root),
		Policy:         policy,
		MonthOffset:    offset,
		NearExpiryDays: cfg.Simulation.NearExpiryDays,
		InstFilter:     "FUTCOM",
	}

	contract, err := ftClient.ResolveFutures(ctx, symbol.Exchange, search, sel, time.Now())
	if err != nil {
		return symbol, fmt.Errorf("app: resolve futures %s: %w", root, err)
	}

	cfg.Simulation.SymbolToken = contract.Token
	out := flattrade.ContractToSymbol(contract, symbol.LotSize, symbol.TickSize)
	log.Info("resolved futures contract",
		"root", contract.Root,
		"tsym", contract.Tsym,
		"token", contract.Token,
		"offset_months", contract.Offset,
		"policy", policy,
	)
	return out, nil
}

func warmupBars(cfg config.DualSupertrendEMAConfig) int {
	max := cfg.EMA.Period
	if cfg.SupertrendLower.Period > max {
		max = cfg.SupertrendLower.Period
	}
	if cfg.SupertrendHigher.Period > max {
		max = cfg.SupertrendHigher.Period
	}
	return max + 5
}

func parseTimeframes(raw []string) ([]domain.Timeframe, error) {
	if len(raw) == 0 {
		return []domain.Timeframe{domain.TF1H, domain.TF2H, domain.TF4H}, nil
	}
	out := make([]domain.Timeframe, 0, len(raw))
	for _, s := range raw {
		tf, err := domain.ParseTimeframe(s)
		if err != nil {
			return nil, err
		}
		out = append(out, tf)
	}
	return out, nil
}

func validateModeCredentials(cfg *config.Config) error {
	mode := cfg.Execution.Mode
	if mode != config.ModePaper && mode != config.ModeLive {
		return nil
	}
	if strings.TrimSpace(cfg.Flattrade.ClientID) == "" || strings.TrimSpace(cfg.Flattrade.APIKey) == "" {
		return fmt.Errorf("app: %s mode requires flattrade.client_id and flattrade.api_key", mode)
	}
	return nil
}

func validateExecutionMode(cfg *config.Config) error {
	if cfg.Execution.Mode == config.ModeLive && !cfg.Execution.LiveOrders {
		return fmt.Errorf(
			"app: LIVE mode requires execution.live_orders=true to place real orders; set live_orders=true or use PAPER mode for forward-test fills",
		)
	}
	return nil
}

func isLiveExecution(cfg *config.Config) bool {
	return cfg.Execution.Mode == config.ModeLive && cfg.Execution.LiveOrders
}

func buildBroker(cfg *config.Config, ftClient *flattrade.Client, mode domain.ExecutionMode) broker.Broker {
	switch mode {
	case domain.ExecutionPaper:
		return paper.New()
	case domain.ExecutionLive:
		if ftClient == nil {
			return nil
		}
		return flattrade.NewOrderBroker(ftClient, cfg.Flattrade.ClientID)
	default:
		return nil
	}
}

func buildPipeline(
	marketProc *market.MarketProcessor,
	indProc *indicator.IndicatorProcessor,
	stratProc *strategy.Processor,
	tradeProc *trade.Processor,
	simProc *simulation.Processor,
	trailProc *trailing.Processor,
	includeSimulation bool,
) *workflow.Pipeline {
	if includeSimulation {
		if marketProc != nil {
			return workflow.NewPipeline(marketProc, indProc, stratProc, tradeProc, simProc, trailProc)
		}
		return workflow.NewPipeline(indProc, stratProc, tradeProc, simProc, trailProc)
	}
	if marketProc != nil {
		return workflow.NewPipeline(marketProc, indProc, stratProc, tradeProc, trailProc)
	}
	return workflow.NewPipeline(indProc, stratProc, tradeProc, trailProc)
}

func hasFlattradeCredentials(cfg *config.Config) bool {
	return strings.TrimSpace(cfg.Flattrade.ClientID) != "" &&
		strings.TrimSpace(cfg.Flattrade.APIKey) != ""
}

func wireFlattradeSession(
	ctx context.Context,
	cfg *config.Config,
	log *logging.Logger,
	redisClient *redis.Client,
) (*flattrade.Client, *flattrade.SessionManager) {
	mode := cfg.Execution.Mode
	shouldWire := mode == config.ModePaper || mode == config.ModeLive ||
		(hasFlattradeCredentials(cfg) && redisClient != nil) ||
		(cfg.SessionJob.Enabled && hasFlattradeCredentials(cfg) && redisClient != nil)
	if !shouldWire {
		return nil, nil
	}

	client := flattrade.NewClient(flattrade.Config{
		BaseURL:   cfg.Flattrade.BaseURL,
		APIKey:    cfg.Flattrade.APIKey,
		APISecret: cfg.Flattrade.APISecret,
		UserID:    cfg.Flattrade.ClientID,
	})

	if redisClient == nil {
		log.Warn("flattrade session: redis unavailable; jKey will not be loaded from store")
		return client, nil
	}

	store := repository.NewRedisTokenStore(redisClient)
	mgr := flattrade.NewSessionManager(client, store, log.With("component", "flattrade.session"))

	if err := mgr.Load(ctx); err != nil {
		if errors.Is(err, repository.ErrTokenNotFound) {
			log.Warn("flattrade session token not in redis; exchange daily before live API calls",
				"key", repository.FlattradeTokenKey(),
			)
		} else {
			log.Warn("flattrade session load failed", "error", err)
		}
	} else {
		log.Info("flattrade session token loaded from redis")
	}

	return client, mgr
}

func scheduleSymbols(cfg *config.Config) []string {
	if len(cfg.Symbols) > 0 {
		return append([]string(nil), cfg.Symbols...)
	}
	if cfg.Strategies.DualSupertrendEMA.Symbol != "" {
		return []string{cfg.Strategies.DualSupertrendEMA.Symbol}
	}
	return []string{"SILVERM"}
}

func timeframeStrings(tfs []domain.Timeframe) []string {
	out := make([]string, len(tfs))
	for i, tf := range tfs {
		out[i] = tf.String()
	}
	return out
}

func defaultTrailPoints() float64 {
	return 100
}

func countClosedTrades(mgr *trade.Manager, strategyID string) int {
	n := 0
	for _, tr := range mgr.GetByStrategy(strategyID) {
		if tr.State == domain.TradeStateClosed {
			n++
		}
	}
	return n
}
