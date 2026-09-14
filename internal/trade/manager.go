package trade

import (
	"context"
	"fmt"
	"sort"
	"sync"
	"time"

	"github.com/koushik-bangaru/atlas/internal/domain"
	"github.com/koushik-bangaru/atlas/internal/repository"
)

// Manager owns trade lifecycle state in memory for V1.
type Manager struct {
	mu sync.RWMutex

	trades      map[string]*domain.Trade
	activeByKey map[string]string
	nextID      int
	repo        repository.TradeRepository
}

// ManagerOption configures a trade manager.
type ManagerOption func(*Manager)

// WithRepository enables optional trade persistence.
func WithRepository(repo repository.TradeRepository) ManagerOption {
	return func(m *Manager) {
		m.repo = repo
	}
}

// NewManager returns an empty in-memory trade manager.
func NewManager(opts ...ManagerOption) *Manager {
	m := &Manager{
		trades:      make(map[string]*domain.Trade),
		activeByKey: make(map[string]string),
		nextID:      1,
	}
	for _, opt := range opts {
		opt(m)
	}
	return m
}

// SetRepository attaches a trade repository after construction.
func (m *Manager) SetRepository(repo repository.TradeRepository) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.repo = repo
}

// LoadActiveFromRepo hydrates in-memory state from persisted active trades.
func (m *Manager) LoadActiveFromRepo(ctx context.Context) error {
	m.mu.RLock()
	repo := m.repo
	m.mu.RUnlock()
	if repo == nil {
		return nil
	}

	trades, err := repo.Active(ctx)
	if err != nil {
		return fmt.Errorf("load active trades: %w", err)
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	maxID := 0
	for i := range trades {
		t := trades[i]
		m.trades[t.TradeID] = cloneTrade(&t)
		if t.State == domain.TradeStateOpen {
			m.activeByKey[positionKey(t.StrategyID, t.Symbol)] = t.TradeID
		}
		var n int
		if _, err := fmt.Sscanf(t.TradeID, "trade-%d", &n); err == nil && n >= maxID {
			maxID = n
		}
	}
	if maxID >= m.nextID {
		m.nextID = maxID + 1
	}
	return nil
}

// OpenTrade creates an OPEN trade from a BUY/SELL signal. Simulation mode fills
// immediately at entryPrice (signal metadata entry_price or market close).
func (m *Manager) OpenTrade(
	ctx context.Context,
	workflowID string,
	configVersion int,
	sig domain.Signal,
	entryPrice float64,
	now time.Time,
) (*domain.Trade, error) {
	if sig.Action != domain.ActionBuy && sig.Action != domain.ActionSell {
		return nil, fmt.Errorf("%w: action %s", ErrInvalidSignal, sig.Action)
	}
	if entryPrice <= 0 {
		return nil, fmt.Errorf("%w: entry price required", ErrInvalidSignal)
	}
	if sig.Quantity <= 0 {
		return nil, fmt.Errorf("%w: quantity required", ErrInvalidSignal)
	}

	key := positionKey(sig.StrategyID, sig.Symbol)

	m.mu.Lock()
	defer m.mu.Unlock()

	if tradeID, ok := m.activeByKey[key]; ok {
		if existing, found := m.trades[tradeID]; found && existing.State == domain.TradeStateOpen {
			return nil, ErrDuplicateOpen
		}
		delete(m.activeByKey, key)
	}

	side := domain.SideBuy
	if sig.Action == domain.ActionSell {
		side = domain.SideSell
	}

	tradeID := fmt.Sprintf("trade-%d", m.nextID)
	m.nextID++

	metadata := cloneMetadata(sig.Metadata)
	trade := &domain.Trade{
		TradeID:       tradeID,
		WorkflowID:    workflowID,
		StrategyID:    sig.StrategyID,
		ConfigVersion: configVersion,
		Symbol:        sig.Symbol,
		Side:          side,
		Quantity:      sig.Quantity,
		State:         domain.TradeStateOpen,
		Position: domain.Position{
			AvgPrice:  entryPrice,
			Quantity:  sig.Quantity,
			EntryTime: now,
		},
		Risk: domain.RiskState{
			StopLoss: sig.StopLoss,
			Target:   targetFromSignal(sig),
		},
		Metadata: metadata,
	}

	m.trades[tradeID] = trade
	m.activeByKey[key] = tradeID

	if m.repo != nil {
		if err := m.repo.Save(ctx, trade); err != nil {
			return nil, fmt.Errorf("persist trade: %w", err)
		}
	}

	return cloneTrade(trade), nil
}

// CloseTrade closes an open trade at exitPrice and records realized PnL.
func (m *Manager) CloseTrade(ctx context.Context, tradeID string, exitPrice float64, now time.Time) (*domain.Trade, error) {
	if exitPrice <= 0 {
		return nil, fmt.Errorf("%w: exit price required", ErrInvalidSignal)
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	trade, ok := m.trades[tradeID]
	if !ok {
		return nil, ErrTradeNotFound
	}
	if trade.State != domain.TradeStateOpen {
		return nil, ErrTradeNotOpen
	}

	m.closeTradeLocked(trade, exitPrice, now)

	if m.repo != nil {
		if err := m.repo.Update(ctx, trade); err != nil {
			return nil, fmt.Errorf("persist trade: %w", err)
		}
		if err := m.repo.DeleteActive(ctx, tradeID); err != nil {
			return nil, fmt.Errorf("delete active trade: %w", err)
		}
	}

	return cloneTrade(trade), nil
}

// CloseBySignal closes the open trade for the signal's strategy+symbol.
func (m *Manager) CloseBySignal(
	ctx context.Context,
	sig domain.Signal,
	exitPrice float64,
	now time.Time,
) (*domain.Trade, error) {
	if sig.Action != domain.ActionExit {
		return nil, fmt.Errorf("%w: action %s", ErrInvalidSignal, sig.Action)
	}
	if exitPrice <= 0 {
		return nil, fmt.Errorf("%w: exit price required", ErrInvalidSignal)
	}

	key := positionKey(sig.StrategyID, sig.Symbol)

	m.mu.Lock()
	defer m.mu.Unlock()

	tradeID, ok := m.activeByKey[key]
	if !ok {
		return nil, ErrNoOpenTrade
	}
	trade, ok := m.trades[tradeID]
	if !ok || trade.State != domain.TradeStateOpen {
		delete(m.activeByKey, key)
		return nil, ErrNoOpenTrade
	}

	m.closeTradeLocked(trade, exitPrice, now)

	if m.repo != nil {
		if err := m.repo.Update(ctx, trade); err != nil {
			return nil, fmt.Errorf("persist trade: %w", err)
		}
		if err := m.repo.DeleteActive(ctx, trade.TradeID); err != nil {
			return nil, fmt.Errorf("delete active trade: %w", err)
		}
	}

	return cloneTrade(trade), nil
}

// SetEntryOrderID records the broker entry order ID on an open trade.
func (m *Manager) SetEntryOrderID(ctx context.Context, tradeID, orderID string) (*domain.Trade, error) {
	return m.setOrderID(ctx, tradeID, orderID, "entry")
}

// SetStopLossOrderID records the broker stop-loss order ID on an open trade.
func (m *Manager) SetStopLossOrderID(ctx context.Context, tradeID, orderID string) (*domain.Trade, error) {
	return m.setOrderID(ctx, tradeID, orderID, "sl")
}

// SetExitOrderID records the broker exit order ID on a trade.
func (m *Manager) SetExitOrderID(ctx context.Context, tradeID, orderID string) (*domain.Trade, error) {
	return m.setOrderID(ctx, tradeID, orderID, "exit")
}

func (m *Manager) setOrderID(ctx context.Context, tradeID, orderID, kind string) (*domain.Trade, error) {
	if orderID == "" {
		return nil, fmt.Errorf("%w: order id required", ErrInvalidSignal)
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	trade, ok := m.trades[tradeID]
	if !ok {
		return nil, ErrTradeNotFound
	}

	switch kind {
	case "entry":
		trade.EntryOrderID = orderID
	case "sl":
		trade.StopLossOrderID = orderID
	case "exit":
		trade.ExitOrderID = orderID
	default:
		return nil, fmt.Errorf("unknown order kind %q", kind)
	}

	if m.repo != nil {
		if err := m.repo.Update(ctx, trade); err != nil {
			return nil, fmt.Errorf("persist trade: %w", err)
		}
	}

	return cloneTrade(trade), nil
}

// MoveStopLoss updates the stop loss on an open trade.
func (m *Manager) MoveStopLoss(tradeID string, newSL float64) (*domain.Trade, error) {
	if newSL <= 0 {
		return nil, fmt.Errorf("%w: stop loss must be positive", ErrInvalidSignal)
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	trade, ok := m.trades[tradeID]
	if !ok {
		return nil, ErrTradeNotFound
	}
	if trade.State != domain.TradeStateOpen {
		return nil, ErrTradeNotOpen
	}

	trade.Risk.StopLoss = newSL
	trade.Trailing.StopLoss = newSL
	trade.Trailing.Enabled = true

	if m.repo != nil {
		if err := m.repo.Update(context.Background(), trade); err != nil {
			return nil, fmt.Errorf("persist trade: %w", err)
		}
	}

	return cloneTrade(trade), nil
}

// GetTrade returns a copy of a trade by ID.
func (m *Manager) GetTrade(tradeID string) (*domain.Trade, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	trade, ok := m.trades[tradeID]
	if !ok {
		return nil, false
	}
	return cloneTrade(trade), true
}

// GetActive returns copies of all OPEN trades.
func (m *Manager) GetActive() []domain.Trade {
	m.mu.RLock()
	defer m.mu.RUnlock()

	out := make([]domain.Trade, 0, len(m.activeByKey))
	for _, tradeID := range m.activeByKey {
		trade, ok := m.trades[tradeID]
		if !ok || trade.State != domain.TradeStateOpen {
			continue
		}
		out = append(out, *cloneTrade(trade))
	}
	return out
}

// GetByStrategy returns copies of all trades owned by strategyID.
func (m *Manager) GetByStrategy(strategyID string) []domain.Trade {
	m.mu.RLock()
	defer m.mu.RUnlock()

	out := make([]domain.Trade, 0)
	for _, trade := range m.trades {
		if trade.StrategyID == strategyID {
			out = append(out, *cloneTrade(trade))
		}
	}
	return out
}

// ListTrades returns copies of every trade, ordered by entry time and then ID.
// It is intended for reporting and must not be used to mutate manager state.
func (m *Manager) ListTrades() []domain.Trade {
	m.mu.RLock()
	defer m.mu.RUnlock()

	out := make([]domain.Trade, 0, len(m.trades))
	for _, t := range m.trades {
		out = append(out, *cloneTrade(t))
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Position.EntryTime.Equal(out[j].Position.EntryTime) {
			return out[i].TradeID < out[j].TradeID
		}
		return out[i].Position.EntryTime.Before(out[j].Position.EntryTime)
	})
	return out
}

// UpdateUnrealizedPnL sets mark-to-market PnL on an open trade.
func (m *Manager) UpdateUnrealizedPnL(tradeID string, mark float64) (*domain.Trade, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	trade, ok := m.trades[tradeID]
	if !ok {
		return nil, ErrTradeNotFound
	}
	if trade.State != domain.TradeStateOpen {
		return nil, ErrTradeNotOpen
	}

	trade.Position.UnrealizedPnL = unrealizedPnL(trade.Side, trade.Position.Quantity, trade.Position.AvgPrice, mark)
	return cloneTrade(trade), nil
}

func (m *Manager) closeTradeLocked(trade *domain.Trade, exitPrice float64, now time.Time) {
	entry := trade.Position.AvgPrice
	qty := trade.Position.Quantity

	trade.State = domain.TradeStateClosed
	trade.Position.RealizedPnL = realizedPnL(trade.Side, qty, entry, exitPrice)
	trade.Position.UnrealizedPnL = 0
	trade.Position.Quantity = 0
	trade.Position.ExitTime = now

	delete(m.activeByKey, positionKey(trade.StrategyID, trade.Symbol))
}

func cloneTrade(t *domain.Trade) *domain.Trade {
	if t == nil {
		return nil
	}
	cp := *t
	cp.Metadata = cloneMetadata(t.Metadata)
	return &cp
}

func cloneMetadata(src map[string]string) map[string]string {
	if len(src) == 0 {
		return nil
	}
	out := make(map[string]string, len(src))
	for k, v := range src {
		out[k] = v
	}
	return out
}
