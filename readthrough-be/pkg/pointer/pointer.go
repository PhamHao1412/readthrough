package pointer

import (
	"database/sql"
	"time"
)

func To[T any](v T) *T {
	return &v
}

func From[T any](p *T) T {
	if p == nil {
		var zero T
		return zero
	}
	return *p
}

func Value[T any](v *T) T {
	var zero T
	return ValueOrDefault(v, zero)
}

func ValueOrDefault[T any](val *T, d T) T {
	if val != nil {
		return *val
	}
	return d
}

func FromNullTime(t sql.NullTime) *time.Time {
	if t.Valid {
		return &t.Time
	}
	return nil
}
