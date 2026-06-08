package app

type Config struct {
	Port         string `mapstructure:"PORT"`
	Env          string `mapstructure:"ENV"`
	AppName      string `mapstructure:"APP_NAME"`
	DBSchemaName string `mapstructure:"DB_SCHEMA_NAME"`
	DbUrl        string `mapstructure:"DB_URL"`
	LogLevel     string `mapstructure:"LOG_LEVEL"`
	JWTSecret    string `mapstructure:"JWT_SECRET"`
	UploadDir    string `mapstructure:"UPLOAD_DIR"`
}

type PGConfig struct {
	URL string `mapstructure:"URL"`
}
