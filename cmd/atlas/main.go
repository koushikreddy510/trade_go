// Package main is the entry point for the Atlas algorithmic trading platform.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"github.com/koushik-bangaru/atlas/internal/app"
	"github.com/koushik-bangaru/atlas/internal/config"
	"github.com/koushik-bangaru/atlas/internal/logging"
)

var version = "dev"

func main() {
	configPath := flag.String("config", "configs/atlas.example.yaml", "path to Atlas configuration file")
	showVersion := flag.Bool("version", false, "print version and exit")
	runOnce := flag.Bool("once", false, "run a single snapshot workflow then exit")
	runReplay := flag.Bool("replay", false, "bar-by-bar forward replay then exit")
	runServe := flag.Bool("serve", false, "start scheduler candle jobs (blocks until SIGINT)")
	tokenJob := flag.Bool("token-job", false, "run daily session-token job once then exit (cron/EventBridge style)")
	useSynthetic := flag.Bool("synthetic", false, "force synthetic bars even if fixture exists")
	exchangeToken := flag.String("exchange-token", "", "OAuth request_code: exchange for jKey and store in Redis")
	authURL := flag.Bool("auth-url", false, "print Flattrade browser OAuth URL and exit")
	listenAuth := flag.Bool("listen-auth", false, "HTTP server to capture OAuth redirect and store jKey in Redis")
	authPort := flag.Int("auth-port", 8080, "port for -listen-auth callback server")
	flag.Parse()

	log := logging.New("atlas")

	if *showVersion {
		fmt.Printf("atlas %s\n", version)
		os.Exit(0)
	}

	log.Info("starting atlas", "version", version, "config", *configPath)

	if _, err := os.Stat(*configPath); err != nil {
		log.Error("config file not found", "path", *configPath, "error", err)
		os.Exit(1)
	}

	loader := config.NewFileLoader()
	cfg, err := loader.Load(*configPath)
	if err != nil {
		log.Error("config load failed", "path", *configPath, "error", err)
		os.Exit(1)
	}

	log.Info("config loaded",
		"config_version", cfg.Version,
		"execution_mode", cfg.Execution.Mode,
	)

	ctx := context.Background()

	authHandled, err := runAuthCommands(ctx, cfg, log, authOptions{
		ExchangeToken: *exchangeToken,
		AuthURL:       *authURL,
		ListenAuth:    *listenAuth,
		AuthPort:      *authPort,
	})
	if err != nil {
		log.Error("auth command failed", "error", err)
		os.Exit(1)
	}
	if authHandled {
		os.Exit(0)
	}

	application, err := app.New(ctx, cfg, log, app.Options{
		ConfigPath:    *configPath,
		UseSynthetic:  *useSynthetic,
		RedisOptional: true,
	})
	if err != nil {
		log.Error("app init failed", "error", err)
		os.Exit(1)
	}
	defer func() {
		if err := application.Close(); err != nil {
			log.Warn("app close", "error", err)
		}
	}()

	switch {
	case *tokenJob:
		if err := application.RunSessionTokenJob(ctx); err != nil {
			log.Error("session token job failed", "error", err)
			os.Exit(1)
		}
		log.Info("session token job completed")
	case *runServe:
		if err := runServeMode(ctx, log, application); err != nil {
			log.Error("serve failed", "error", err)
			os.Exit(1)
		}
	case *runOnce:
		if err := application.RunOnce(ctx); err != nil {
			log.Error("run once failed", "error", err)
			os.Exit(1)
		}
		log.Info("run once completed")
	case *runReplay:
		if err := runReplayMode(ctx, log, application); err != nil {
			os.Exit(1)
		}
	default:
		if cfg.Execution.Mode == config.ModeSimulation {
			if err := runReplayMode(ctx, log, application); err != nil {
				os.Exit(1)
			}
		} else {
			log.Error("PAPER/LIVE requires -serve or -once", "mode", cfg.Execution.Mode)
			os.Exit(1)
		}
	}
}

func runReplayMode(ctx context.Context, log *logging.Logger, application *app.App) error {
	summary, err := application.RunReplay(ctx)
	if err != nil {
		log.Error("replay failed", "error", err)
		return err
	}
	log.Info("replay completed",
		"bars", summary.Bars,
		"buys", summary.Buys,
		"sells", summary.Sells,
		"exits", summary.Exits,
		"ignores", summary.Ignores,
		"trades_opened", summary.TradesOpened,
		"active_trades", summary.ActiveTrades,
		"closed_trades", summary.ClosedTrades,
	)
	return nil
}

func runServeMode(ctx context.Context, log *logging.Logger, application *app.App) error {
	ctx, stop := signal.NotifyContext(ctx, syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	log.Info("serve mode: waiting for candle jobs (SIGINT/SIGTERM to stop)")
	if err := application.RunServe(ctx); err != nil && !errors.Is(err, context.Canceled) {
		return err
	}
	log.Info("scheduler stopped")
	return nil
}
