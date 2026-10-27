package main

import (
	"context"
	"errors"
	"net/http"
	"os"
	"os/signal"
	"time"

	"github.com/freygold/go-boilerplate/internal/config"
	"github.com/freygold/go-boilerplate/internal/database"
	"github.com/freygold/go-boilerplate/internal/handler"
	"github.com/freygold/go-boilerplate/internal/logger"
	"github.com/freygold/go-boilerplate/internal/repository"
	"github.com/freygold/go-boilerplate/internal/router"
	"github.com/freygold/go-boilerplate/internal/server"
	"github.com/freygold/go-boilerplate/internal/service"
)

const DefaultContextTimeout = 30

func main() {
	cfg, err := config.LoadConfig()
	if err != nil {
		panic("failed to load config: " + err.Error())
	}

	loggerService := logger.NewLoggerService(cfg.Observability)
	defer loggerService.Shutdown()

	log := logger.NewLoggerWithService(cfg.Observability, loggerService)

	if cfg.Primary.Env != "local" {
		if err := database.Migrate(context.Background(), &log, cfg); err != nil {
			log.Fatal().Err(err).Msg("failed to migrate database")
		}
	}

	s, err := server.New(cfg, &log, loggerService)
	if err != nil {
		log.Fatal().Err(err).Msg("failed to initialize server")
	}

	repos := repository.NewRepositories(s)
	services, serviceErr := service.NewServices(s, repos)
	if serviceErr != nil {
		log.Fatal().Err(serviceErr).Msg("could not create services")
	}

	handlers := handler.NewHandlers(s, services)

	r := router.NewRouter(s, handlers, services)

	s.SetupHTTPServer(r)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)

	go func() {
		if err = s.Start(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatal().Err(err).Msg("Failed to start server")
		}
	}()

	<-ctx.Done()
	ctx, cancel := context.WithTimeout(context.Background(), DefaultContextTimeout*time.Second)

	if err = s.Shutdown(ctx); err != nil {
		log.Fatal().Err(err).Msg("server forced to shutdown")
	}

	stop()
	cancel()

	log.Info().Msg("server exited properly")
}
