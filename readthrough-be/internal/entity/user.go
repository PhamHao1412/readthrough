package entity

type User struct {
	BaseEntity
	Username     string `gorm:"column:username;type:varchar(100);not null;unique" json:"username"`
	Email        string `gorm:"column:email;type:varchar(100);not null;unique" json:"email"`
	PasswordHash string `gorm:"column:password_hash;type:text;not null" json:"-"`
}

func (User) TableName() string {
	return SchemaName() + "users"
}
