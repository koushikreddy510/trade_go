package config

import (
	"fmt"
	"os"
	"strconv"
	"sync"

	"gopkg.in/yaml.v3"
)

// Loader loads and reloads Atlas configuration.
type Loader interface {
	Load(path string) (*Config, error)
	Reload() (*Config, error)
	Version() int
	Current() *Config
}

// FileLoader loads configuration from a YAML file on disk.
type FileLoader struct {
	mu      sync.RWMutex
	path    string
	version int
	current *Config
}

// NewFileLoader returns a Loader backed by the filesystem.
func NewFileLoader() Loader {
	return &FileLoader{}
}

// Load reads, expands, validates, and stores configuration from path.
func (l *FileLoader) Load(path string) (*Config, error) {
	cfg, err := loadFromFile(path)
	if err != nil {
		return nil, err
	}

	l.mu.Lock()
	defer l.mu.Unlock()

	l.path = path
	l.version = cfg.Version
	l.current = cfg
	return cfg, nil
}

// Reload re-reads the last loaded configuration path and bumps the version.
func (l *FileLoader) Reload() (*Config, error) {
	l.mu.RLock()
	path := l.path
	prevVersion := l.version
	l.mu.RUnlock()

	if path == "" {
		return nil, fmt.Errorf("config: no configuration path loaded")
	}

	cfg, err := loadFromFile(path)
	if err != nil {
		return nil, err
	}

	if prevVersion > 0 {
		cfg.Version = prevVersion + 1
	}

	l.mu.Lock()
	defer l.mu.Unlock()

	l.version = cfg.Version
	l.current = cfg
	return cfg, nil
}

// Version returns the current configuration version.
func (l *FileLoader) Version() int {
	l.mu.RLock()
	defer l.mu.RUnlock()
	return l.version
}

// Current returns the last successfully loaded configuration.
func (l *FileLoader) Current() *Config {
	l.mu.RLock()
	defer l.mu.RUnlock()
	return l.current
}

// ApplyRedisOverride merges Redis-stored overrides into cfg.
// TODO: implement Redis override via atlas:config key when repository layer exists.
func ApplyRedisOverride(cfg *Config) error {
	_ = cfg
	return nil
}

func loadFromFile(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("config: read %s: %w", path, err)
	}

	var cfg Config
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("config: parse %s: %w", path, err)
	}

	expandConfig(&cfg)
	cfg.Version = parseYAMLVersion(cfg.YAMLVersion)

	if err := validate(&cfg); err != nil {
		return nil, fmt.Errorf("config: validate: %w", err)
	}

	// Hot-reload watcher and Redis override are intentionally stubbed for Phase 1.
	if err := ApplyRedisOverride(&cfg); err != nil {
		return nil, fmt.Errorf("config: redis override: %w", err)
	}

	return &cfg, nil
}

func parseYAMLVersion(raw string) int {
	if raw == "" {
		return 1
	}
	v, err := strconv.Atoi(raw)
	if err != nil || v < 1 {
		return 1
	}
	return v
}
