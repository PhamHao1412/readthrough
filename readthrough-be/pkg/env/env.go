package env

import (
	"reflect"

	"github.com/spf13/viper"
)

// ReadAppConfig loads app config with default settings.l
// It will try to read .env file from the current working directory (for local dev),
// and automatically bind OS environment variables matching the struct tags (for production like Render).
func ReadAppConfig[T any]() (T, error) {
	v := viper.New()

	// 1. Setup config file path and name
	v.SetConfigName(".env")
	v.SetConfigType("env")
	v.AddConfigPath(".")

	// Read config file if it exists. If it doesn't, that's fine for production.
	if err := v.ReadInConfig(); err != nil {
		if _, ok := err.(viper.ConfigFileNotFoundError); !ok {
			return *new(T), err
		}
	}

	// 2. Automatically bind environment variables matching the struct tags (using reflection)
	var cfg T
	t := reflect.TypeOf(cfg)
	if t.Kind() == reflect.Ptr {
		t = t.Elem()
	}

	for i := 0; i < t.NumField(); i++ {
		field := t.Field(i)
		tag := field.Tag.Get("mapstructure")
		if tag != "" {
			// Bind the tag to the environment variable of the same name (e.g. PORT, DB_URL, etc.)
			if err := v.BindEnv(tag); err != nil {
				return *new(T), err
			}
		}
	}

	// 3. Unmarshal the config into the struct
	if err := v.Unmarshal(&cfg); err != nil {
		return *new(T), err
	}

	return cfg, nil
}
