package middleware

import (
	"errors"
	"net/http"
	"readthrough-be/internal/handler/rest/dto"
	"readthrough-be/pkg/security"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// TokenBucket holds the rate limiting state for a single client (IP or User ID).
type TokenBucket struct {
	tokens     float64
	capacity   float64
	rate       float64 // tokens per second
	lastRefill time.Time
	lastAccess time.Time
}

// RateLimiter manages the collection of client token buckets.
type RateLimiter struct {
	mu         sync.Mutex
	buckets    map[string]*TokenBucket
	capacity   float64
	rate       float64
	expiration time.Duration
}

// NewRateLimiter creates a new RateLimiter instance.
func NewRateLimiter(capacity, rate float64, expiration time.Duration) *RateLimiter {
	// Set default safe values if config values are invalid/missing
	if capacity <= 0 {
		capacity = 20
	}
	if rate <= 0 {
		rate = 5
	}
	if expiration <= 0 {
		expiration = 1 * time.Hour
	}

	rl := &RateLimiter{
		buckets:    make(map[string]*TokenBucket),
		capacity:   capacity,
		rate:       rate,
		expiration: expiration,
	}

	// Start clean up worker in the background
	go rl.cleanupLoop(10 * time.Minute)

	return rl
}

// Allow checks if the request is allowed for the given client key.
func (rl *RateLimiter) Allow(key string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()
	bucket, exists := rl.buckets[key]
	if !exists {
		bucket = &TokenBucket{
			tokens:     rl.capacity,
			capacity:   rl.capacity,
			rate:       rl.rate,
			lastRefill: now,
		}
		rl.buckets[key] = bucket
	}

	// Calculate and add refilled tokens
	elapsed := now.Sub(bucket.lastRefill).Seconds()
	bucket.tokens = bucket.tokens + (elapsed * bucket.rate)
	if bucket.tokens > bucket.capacity {
		bucket.tokens = bucket.capacity
	}
	bucket.lastRefill = now
	bucket.lastAccess = now

	// Verify and consume token
	if bucket.tokens >= 1.0 {
		bucket.tokens -= 1.0
		return true
	}

	return false
}

// GetBucketInfo is a helper for testing/introspection to inspect a client bucket state.
func (rl *RateLimiter) GetBucketInfo(key string) (tokens float64, exists bool) {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	bucket, exists := rl.buckets[key]
	if !exists {
		return 0, false
	}
	return bucket.tokens, true
}

func (rl *RateLimiter) cleanupLoop(interval time.Duration) {
	ticker := time.NewTicker(interval)
	for range ticker.C {
		rl.cleanupExpired()
	}
}

// cleanupExpired removes expired token buckets. Extracted for testing.
func (rl *RateLimiter) cleanupExpired() {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	now := time.Now()
	for key, bucket := range rl.buckets {
		if now.Sub(bucket.lastAccess) > rl.expiration {
			delete(rl.buckets, key)
		}
	}
}

// RateLimitMiddleware enforces rate limiting per user or client IP.
func RateLimitMiddleware(limiter *RateLimiter) gin.HandlerFunc {
	return func(c *gin.Context) {
		// 0. Skip rate limiting for health check endpoint to prevent false restarts during deployments
		if c.Request.URL.Path == "/api/v1/health" {
			c.Next()
			return
		}

		var key string

		// 1. Try to get user identity from Context (in case AuthMiddleware has run first)
		if userID, exists := c.Get("userID"); exists {
			if strID, ok := userID.(string); ok {
				key = "user:" + strID
			} else {
				key = "user:" + c.GetString("userID")
			}
		}

		// 2. Try to extract bearer token directly from Authorization header if not already in context
		if key == "" {
			authHeader := c.GetHeader("Authorization")
			if authHeader != "" && strings.HasPrefix(authHeader, "Bearer ") {
				parts := strings.SplitN(authHeader, " ", 2)
				if len(parts) == 2 {
					tokenStr := parts[1]
					if userID, err := security.ValidateAccessToken(tokenStr); err == nil {
						key = "user:" + userID.String()
					}
				}
			}
		}

		// 3. Fallback to IP address if request is anonymous
		if key == "" {
			ip := c.ClientIP()
			if ip == "" {
				ip = "unknown"
			}
			key = "ip:" + ip
		}

		// Check if request is allowed
		if !limiter.Allow(key) {
			errLimit := errors.New("too many requests")
			c.JSON(http.StatusTooManyRequests, dto.Response{
				Succeeded: false,
				Title:     "too many requests",
				Message:   "Too many requests. Please try again later.",
				SttCode:   http.StatusTooManyRequests,
				Errors:    []string{errLimit.Error()},
			})
			c.Abort()
			return
		}

		c.Next()
	}
}

// AICreditManager tracks and limits AI feature usage for general users.
type AICreditManager struct {
	mu               sync.Mutex
	usedIPs          map[string]int
	usedUsers        map[string]int
	whitelistUserIDs map[string]bool
}

// NewAICreditManager creates a new AICreditManager instance.
func NewAICreditManager(whitelistUserIDs []string) *AICreditManager {
	whitelistMap := make(map[string]bool)
	for _, id := range whitelistUserIDs {
		trimmed := strings.TrimSpace(strings.ToLower(id))
		if trimmed != "" {
			whitelistMap[trimmed] = true
		}
	}

	return &AICreditManager{
		usedIPs:          make(map[string]int),
		usedUsers:        make(map[string]int),
		whitelistUserIDs: whitelistMap,
	}
}

// AllowAI checks if the AI request should be allowed for the client.
func (ac *AICreditManager) AllowAI(c *gin.Context) bool {
	var userIDStr string

	// 1. Try to get user identity from Context
	if userID, exists := c.Get("userID"); exists {
		if strID, ok := userID.(string); ok {
			userIDStr = strID
		} else {
			userIDStr = c.GetString("userID")
		}
	} else {
		// 2. Try to get from Authorization header
		authHeader := c.GetHeader("Authorization")
		if authHeader != "" && strings.HasPrefix(authHeader, "Bearer ") {
			parts := strings.SplitN(authHeader, " ", 2)
			if len(parts) == 2 {
				tokenStr := parts[1]
				if userIDVal, err := security.ValidateAccessToken(tokenStr); err == nil {
					userIDStr = userIDVal.String()
				}
			}
		}
	}

	// Case 1: Authenticated User
	if userIDStr != "" {
		ac.mu.Lock()
		defer ac.mu.Unlock()

		normalizedID := strings.ToLower(userIDStr)
		if ac.whitelistUserIDs[normalizedID] {
			// Whitelisted User IDs bypass the 1-time limit
			return true
		}

		// Regular users: allowed exactly 1 use
		count := ac.usedUsers[normalizedID]
		if count >= 1 {
			return false
		}
		ac.usedUsers[normalizedID] = count + 1
		return true
	}

	// Case 2: Anonymous User (limit by Client IP)
	ip := c.ClientIP()
	if ip == "" {
		ip = "unknown"
	}

	ac.mu.Lock()
	defer ac.mu.Unlock()

	count := ac.usedIPs[ip]
	if count >= 1 {
		return false
	}
	ac.usedIPs[ip] = count + 1
	return true
}

// GetAICountInfo is a helper for testing to inspect usage state.
func (ac *AICreditManager) GetAICountInfo(key string, isUser bool) (count int) {
	ac.mu.Lock()
	defer ac.mu.Unlock()
	if isUser {
		return ac.usedUsers[strings.ToLower(key)]
	}
	return ac.usedIPs[key]
}

// AICreditMiddleware limits AI calls to exactly 1 request for general/anonymous users, and unlimited for whitelisted User IDs.
func AICreditMiddleware(manager *AICreditManager) gin.HandlerFunc {
	return func(c *gin.Context) {
		path := c.Request.URL.Path
		// Intercept AI explain and Translate routes
		if path == "/api/v1/explain" || path == "/api/v1/translate" {
			if !manager.AllowAI(c) {
				errLimit := errors.New("ai credit limit exceeded")
				c.JSON(http.StatusPaymentRequired, dto.Response{
					Succeeded: false,
					Title:     "ai credit limit exceeded",
					Message:   "AI explanation credit limit exceeded. Contact admin or upgrade to premium.",
					SttCode:   http.StatusPaymentRequired,
					Errors:    []string{errLimit.Error()},
				})
				c.Abort()
				return
			}
		}
		c.Next()
	}
}
