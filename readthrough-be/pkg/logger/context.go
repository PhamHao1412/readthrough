package logger

import (
	"context"

	"go.uber.org/zap"
)

type ctxKey string

const loggerKey ctxKey = "logger"

func Inject(ctx context.Context, fields ...zap.Field) context.Context {
	l := mustLogger().With(fields...)
	return context.WithValue(ctx, loggerKey, l)
}

func fromContext(ctx context.Context) *zap.Logger {
	if ctx != nil {
		if l, ok := ctx.Value(loggerKey).(*zap.Logger); ok {
			return l
		}
	}
	return mustLogger()
}
