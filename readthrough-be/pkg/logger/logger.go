package logger

import (
	"readthrough-be/internal/app"
	"sync"

	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

var (
	log  *zap.Logger
	once sync.Once
)

func Init(cfg *app.Config) {
	once.Do(func() {
		zapCfg := zap.NewProductionConfig()

		if cfg.Env == "dev" {
			zapCfg = zap.NewDevelopmentConfig()
		}

		// log level
		if err := zapCfg.Level.UnmarshalText([]byte(cfg.LogLevel)); err != nil {
			zapCfg.Level = zap.NewAtomicLevelAt(zap.InfoLevel)
		}

		zapCfg.EncoderConfig.TimeKey = "timestamp"
		zapCfg.EncoderConfig.EncodeTime = zapcore.ISO8601TimeEncoder

		zapCfg.InitialFields = map[string]interface{}{
			"service": cfg.AppName,
			"env":     cfg.Env,
		}

		var err error
		log, err = zapCfg.Build(
			zap.AddCaller(),
			zap.AddCallerSkip(1),
		)
		if err != nil {
			panic(err)
		}
	})
}

func mustLogger() *zap.Logger {
	if log == nil {
		panic("logger is not setup, call logger.Init() in main")
	}
	return log
}
