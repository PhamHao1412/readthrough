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
	// R2 Cloudflare Configuration
	R2AccessKeyID     string `mapstructure:"R2_ACCESS_KEY_ID"`
	R2SecretAccessKey string `mapstructure:"R2_SECRET_ACCESS_KEY"`
	R2AccountID       string `mapstructure:"R2_ACCOUNT_ID"`
	R2BucketName      string `mapstructure:"R2_BUCKET_NAME"`
}

type PGConfig struct {
	URL string `mapstructure:"URL"`
}
