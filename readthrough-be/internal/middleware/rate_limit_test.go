package middleware

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"readthrough-be/internal/handler/rest/dto"
	"readthrough-be/pkg/security"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

func TestRateLimiter_Allow(t *testing.T) {
	limiter := NewRateLimiter(3, 1, 1*time.Hour)

	// Consume 3 tokens
	if !limiter.Allow("user-1") {
		t.Fatal("Expected request 1 to be allowed")
	}
	if !limiter.Allow("user-1") {
		t.Fatal("Expected request 2 to be allowed")
	}
	if !limiter.Allow("user-1") {
		t.Fatal("Expected request 3 to be allowed")
	}

	// 4th request should be blocked
	if limiter.Allow("user-1") {
		t.Fatal("Expected request 4 to be blocked")
	}

	// Different user should be allowed
	if !limiter.Allow("user-2") {
		t.Fatal("Expected request for user-2 to be allowed")
	}

	// Wait 1.1 second to refill 1 token
	time.Sleep(1100 * time.Millisecond)

	if !limiter.Allow("user-1") {
		t.Fatal("Expected request to be allowed after token refill")
	}

	if limiter.Allow("user-1") {
		t.Fatal("Expected subsequent request to be blocked")
	}
}

func TestRateLimiter_Cleanup(t *testing.T) {
	limiter := NewRateLimiter(5, 5, 50*time.Millisecond)

	limiter.Allow("user-1")
	limiter.Allow("user-2")

	if _, exists := limiter.GetBucketInfo("user-1"); !exists {
		t.Fatal("Expected user-1 bucket to exist")
	}

	time.Sleep(100 * time.Millisecond)
	limiter.cleanupExpired()

	if _, exists := limiter.GetBucketInfo("user-1"); exists {
		t.Fatal("Expected user-1 bucket to be cleaned up")
	}
}

func TestRateLimitMiddleware_IPFallback(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()

	limiter := NewRateLimiter(2, 10, 1*time.Hour)
	r.Use(RateLimitMiddleware(limiter))

	r.GET("/test", func(c *gin.Context) {
		c.String(http.StatusOK, "OK")
	})

	for i := 0; i < 2; i++ {
		w := httptest.NewRecorder()
		req, _ := http.NewRequest(http.MethodGet, "/test", nil)
		req.RemoteAddr = "192.168.1.100:1234"
		r.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("Expected status 200, got %d", w.Code)
		}
	}

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/test", nil)
	req.RemoteAddr = "192.168.1.100:1234"
	r.ServeHTTP(w, req)
	if w.Code != http.StatusTooManyRequests {
		t.Fatalf("Expected status 429, got %d", w.Code)
	}

	var resp dto.Response
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("Failed to parse response JSON: %v", err)
	}

	if resp.Succeeded {
		t.Fatal("Expected succeeded to be false")
	}
	if resp.Title != "too many requests" {
		t.Fatalf("Expected title 'too many requests', got '%s'", resp.Title)
	}
}

func TestRateLimitMiddleware_JWTAuth(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()

	limiter := NewRateLimiter(2, 10, 1*time.Hour)
	r.Use(RateLimitMiddleware(limiter))

	r.GET("/test", func(c *gin.Context) {
		c.String(http.StatusOK, "OK")
	})

	security.Init("test_secret_key_at_least_32_characters_long_12345")
	userID := uuid.New()
	token, err := security.GenerateAccessToken(userID)
	if err != nil {
		t.Fatalf("Failed to generate access token: %v", err)
	}

	for i := 0; i < 2; i++ {
		w := httptest.NewRecorder()
		req, _ := http.NewRequest(http.MethodGet, "/test", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		req.RemoteAddr = "192.168.1.200:1234"
		r.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("Expected status 200, got %d", w.Code)
		}
	}

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/test", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	req.RemoteAddr = "192.168.1.201:1234"
	r.ServeHTTP(w, req)
	if w.Code != http.StatusTooManyRequests {
		t.Fatalf("Expected status 429, got %d", w.Code)
	}
}

func TestRateLimitMiddleware_HealthCheckBypass(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()

	// Capacity is 1, refill is 0 (no refill)
	limiter := NewRateLimiter(1, 0, 1*time.Hour)
	r.Use(RateLimitMiddleware(limiter))

	r.GET("/api/v1/health", func(c *gin.Context) {
		c.String(http.StatusOK, "OK")
	})

	r.GET("/api/v1/other", func(c *gin.Context) {
		c.String(http.StatusOK, "OK")
	})

	// 1st request to /api/v1/other should succeed
	wOther1 := httptest.NewRecorder()
	reqOther1, _ := http.NewRequest(http.MethodGet, "/api/v1/other", nil)
	reqOther1.RemoteAddr = "192.168.1.1:1234"
	r.ServeHTTP(wOther1, reqOther1)
	if wOther1.Code != http.StatusOK {
		t.Fatalf("Expected status 200 for first request to other route, got %d", wOther1.Code)
	}

	// 2nd request to /api/v1/other from same IP should get 429
	wOther2 := httptest.NewRecorder()
	reqOther2, _ := http.NewRequest(http.MethodGet, "/api/v1/other", nil)
	reqOther2.RemoteAddr = "192.168.1.1:1234"
	r.ServeHTTP(wOther2, reqOther2)
	if wOther2.Code != http.StatusTooManyRequests {
		t.Fatalf("Expected status 429 for second request to other route, got %d", wOther2.Code)
	}

	// /api/v1/health from same IP should STILL succeed (bypassed)
	for i := 0; i < 5; i++ {
		wHealth := httptest.NewRecorder()
		reqHealth, _ := http.NewRequest(http.MethodGet, "/api/v1/health", nil)
		reqHealth.RemoteAddr = "192.168.1.1:1234"
		r.ServeHTTP(wHealth, reqHealth)
		if wHealth.Code != http.StatusOK {
			t.Fatalf("Expected status 200 for health check, got %d", wHealth.Code)
		}
	}
}

func TestAICreditMiddleware(t *testing.T) {
	gin.SetMode(gin.TestMode)
	security.Init("test_secret_key_at_least_32_characters_long_12345")

	whitelistedUUID := uuid.New().String()
	normalUUID := uuid.New().String()

	manager := NewAICreditManager([]string{whitelistedUUID})
	r := gin.New()
	r.Use(AICreditMiddleware(manager))

	r.POST("/api/v1/explain", func(c *gin.Context) {
		c.String(http.StatusOK, "AI OK")
	})

	r.POST("/api/v1/translate", func(c *gin.Context) {
		c.String(http.StatusOK, "TRANSLATE OK")
	})

	r.POST("/api/v1/other", func(c *gin.Context) {
		c.String(http.StatusOK, "OTHER OK")
	})

	// 1. Verify that non-explain endpoints (like /translate and /other) are completely unaffected
	wOther := httptest.NewRecorder()
	reqOther, _ := http.NewRequest(http.MethodPost, "/api/v1/other", nil)
	r.ServeHTTP(wOther, reqOther)
	if wOther.Code != http.StatusOK {
		t.Fatalf("Expected 200, got %d", wOther.Code)
	}

	// Verify /translate is not blocked even on multiple requests from same IP
	for i := 0; i < 5; i++ {
		wTrans := httptest.NewRecorder()
		reqTrans, _ := http.NewRequest(http.MethodPost, "/api/v1/translate", nil)
		reqTrans.RemoteAddr = "1.2.3.4:1234"
		r.ServeHTTP(wTrans, reqTrans)
		if wTrans.Code != http.StatusOK {
			t.Fatalf("Expected 200 for translate, got %d on call %d", wTrans.Code, i+1)
		}
	}

	// 2. Anonymous User (IP tracking): 1st call OK, 2nd call 402
	ip := "1.2.3.4"
	wAnon1 := httptest.NewRecorder()
	reqAnon1, _ := http.NewRequest(http.MethodPost, "/api/v1/explain", nil)
	reqAnon1.RemoteAddr = ip + ":1234"
	r.ServeHTTP(wAnon1, reqAnon1)
	if wAnon1.Code != http.StatusOK {
		t.Fatalf("Expected 200 for anonymous first call, got %d", wAnon1.Code)
	}

	wAnon2 := httptest.NewRecorder()
	reqAnon2, _ := http.NewRequest(http.MethodPost, "/api/v1/explain", nil)
	reqAnon2.RemoteAddr = ip + ":1234"
	r.ServeHTTP(wAnon2, reqAnon2)
	if wAnon2.Code != http.StatusPaymentRequired {
		t.Fatalf("Expected 402 for anonymous second call, got %d", wAnon2.Code)
	}

	// Verify anonymous with different IP works
	wAnonDiff := httptest.NewRecorder()
	reqAnonDiff, _ := http.NewRequest(http.MethodPost, "/api/v1/explain", nil)
	reqAnonDiff.RemoteAddr = "1.2.3.5:1234"
	r.ServeHTTP(wAnonDiff, reqAnonDiff)
	if wAnonDiff.Code != http.StatusOK {
		t.Fatalf("Expected 200 for different anonymous IP first call, got %d", wAnonDiff.Code)
	}

	// 3. Normal User (JWT tracking): 1st call OK, 2nd call 402
	normalUserID, _ := uuid.Parse(normalUUID)
	normalToken, _ := security.GenerateAccessToken(normalUserID)

	wNormal1 := httptest.NewRecorder()
	reqNormal1, _ := http.NewRequest(http.MethodPost, "/api/v1/explain", nil)
	reqNormal1.Header.Set("Authorization", "Bearer "+normalToken)
	r.ServeHTTP(wNormal1, reqNormal1)
	if wNormal1.Code != http.StatusOK {
		t.Fatalf("Expected 200 for normal user first call, got %d", wNormal1.Code)
	}

	wNormal2 := httptest.NewRecorder()
	reqNormal2, _ := http.NewRequest(http.MethodPost, "/api/v1/explain", nil)
	reqNormal2.Header.Set("Authorization", "Bearer "+normalToken)
	r.ServeHTTP(wNormal2, reqNormal2)
	if wNormal2.Code != http.StatusPaymentRequired {
		t.Fatalf("Expected 402 for normal user second call, got %d", wNormal2.Code)
	}

	// 4. Whitelisted User (JWT tracking): multiple calls allowed
	whiteUserID, _ := uuid.Parse(whitelistedUUID)
	whiteToken, _ := security.GenerateAccessToken(whiteUserID)

	for i := 0; i < 5; i++ {
		wWhite := httptest.NewRecorder()
		reqWhite, _ := http.NewRequest(http.MethodPost, "/api/v1/explain", nil)
		reqWhite.Header.Set("Authorization", "Bearer "+whiteToken)
		r.ServeHTTP(wWhite, reqWhite)
		if wWhite.Code != http.StatusOK {
			t.Fatalf("Expected 200 for whitelisted user call %d, got %d", i+1, wWhite.Code)
		}
	}
}
