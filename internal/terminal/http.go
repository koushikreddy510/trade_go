package terminal

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/koushik-bangaru/atlas/internal/domain"
	"github.com/koushik-bangaru/atlas/internal/trade"
)

// API exposes chart, drawing, live quote, and paper-safe order endpoints.
// Authentication is not yet introduced, so the local user identity is only a
// namespacing mechanism.
type API struct {
	service *Service
	live    *Live
}

func NewAPI(service *Service) *API { return &API{service: service} }

func (a *API) WithLive(live *Live) *API {
	a.live = live
	return a
}

func (a *API) Register(mux *http.ServeMux) {
	mux.HandleFunc("/api/v1/chart", a.chart)
	mux.HandleFunc("/api/v1/drawings", a.drawings)
	mux.HandleFunc("/api/v1/live", a.liveState)
	mux.HandleFunc("/api/v1/orders", a.orders)
	mux.HandleFunc("/api/v1/orders/close", a.closeOrder)
	mux.HandleFunc("/api/v1/stream", a.stream)
}

func (a *API) chart(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w)
		return
	}
	tf, ok := parseTimeframe(w, r)
	if !ok {
		return
	}
	out, err := a.service.Chart(r.Context(), tf)
	if err != nil {
		internalError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func (a *API) drawings(w http.ResponseWriter, r *http.Request) {
	tf, ok := parseTimeframe(w, r)
	if !ok {
		return
	}
	user := r.URL.Query().Get("user")
	if user == "" {
		user = "local"
	}
	switch r.Method {
	case http.MethodGet:
		out, err := a.service.Drawings(r.Context(), user, tf)
		if err != nil {
			internalError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, out)
	case http.MethodPut:
		var d Drawing
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&d); err != nil {
			http.Error(w, "invalid JSON", http.StatusBadRequest)
			return
		}
		d.Timeframe = tf.String()
		if err := a.service.SaveDrawing(r.Context(), user, d); err != nil {
			drawingError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, d)
	case http.MethodDelete:
		id := r.URL.Query().Get("id")
		if err := a.service.DeleteDrawing(r.Context(), user, tf, id); err != nil {
			drawingError(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	default:
		methodNotAllowed(w)
	}
}

func (a *API) liveState(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w)
		return
	}
	if a.live == nil {
		http.Error(w, "live feed unavailable", http.StatusServiceUnavailable)
		return
	}
	writeJSON(w, http.StatusOK, a.live.Snapshot())
}

func (a *API) orders(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w)
		return
	}
	if a.live == nil {
		http.Error(w, "live feed unavailable", http.StatusServiceUnavailable)
		return
	}
	var req OrderRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&req); err != nil {
		http.Error(w, "invalid JSON", http.StatusBadRequest)
		return
	}
	opened, err := a.live.Place(r.Context(), req)
	if err != nil {
		orderError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, opened)
}

func (a *API) closeOrder(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w)
		return
	}
	if a.live == nil {
		http.Error(w, "live feed unavailable", http.StatusServiceUnavailable)
		return
	}
	var req OrderRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&req); err != nil {
		http.Error(w, "invalid JSON", http.StatusBadRequest)
		return
	}
	closed, err := a.live.Close(r.Context(), req.TradeID, req.Price)
	if err != nil {
		orderError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, closed)
}

func (a *API) stream(w http.ResponseWriter, r *http.Request) {
	if a.live == nil {
		http.Error(w, "live feed unavailable", http.StatusServiceUnavailable)
		return
	}
	a.live.Hub().ServeWS(w, r, a.live.Snapshot)
}

func orderError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrLiveOrdersDisabled):
		http.Error(w, err.Error(), http.StatusForbidden)
	case errors.Is(err, ErrNoMarkPrice), errors.Is(err, trade.ErrInvalidSignal):
		http.Error(w, err.Error(), http.StatusBadRequest)
	case errors.Is(err, trade.ErrDuplicateOpen), errors.Is(err, trade.ErrTradeNotOpen):
		http.Error(w, err.Error(), http.StatusConflict)
	case errors.Is(err, trade.ErrTradeNotFound):
		http.Error(w, err.Error(), http.StatusNotFound)
	default:
		internalError(w, err)
	}
}

func parseTimeframe(w http.ResponseWriter, r *http.Request) (domain.Timeframe, bool) {
	tf, err := domain.ParseTimeframe(r.URL.Query().Get("timeframe"))
	if err != nil {
		http.Error(w, "timeframe must be 1H, 2H, or 4H", http.StatusBadRequest)
		return 0, false
	}
	return tf, true
}
func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func methodNotAllowed(w http.ResponseWriter) {
	http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
}
func drawingError(w http.ResponseWriter, err error) {
	if errors.Is(err, ErrInvalidDrawing) {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	internalError(w, err)
}
func internalError(w http.ResponseWriter, _ error) {
	http.Error(w, "internal server error", http.StatusInternalServerError)
}
