package user

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"github.com/1Vewton/OMOPredict/server/internal/store"
	"golang.org/x/crypto/bcrypt"
)

func newTestStore(t *testing.T) *GORMStore {
	t.Helper()
	db, err := store.Open(store.Config{
		Driver: store.DriverSQLite,
		DSN:    filepath.Join(t.TempDir(), "test.db"),
	})
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	if err := store.Migrate(db, &User{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	t.Cleanup(func() {
		if sqlDB, cerr := db.DB(); cerr == nil {
			_ = sqlDB.Close()
		}
	})
	return NewGORMStore(db)
}

func newTestService(t *testing.T) *Service {
	t.Helper()
	return NewService(newTestStore(t), []byte("test-secret"), time.Hour)
}

func TestRegisterHashesPassword(t *testing.T) {
	svc := newTestService(t)
	u, err := svc.Register(context.Background(), "alice", "supersecret")
	if err != nil {
		t.Fatalf("register: %v", err)
	}
	if u.Username != "alice" || u.ID == "" {
		t.Fatalf("unexpected user: %+v", u)
	}
	if u.PasswordHash == "supersecret" {
		t.Fatal("密码以明文存储")
	}
	if err := bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte("supersecret")); err != nil {
		t.Fatalf("bcrypt 校验失败: %v", err)
	}
}

func TestRegisterDuplicate(t *testing.T) {
	svc := newTestService(t)
	ctx := context.Background()
	if _, err := svc.Register(ctx, "alice", "supersecret"); err != nil {
		t.Fatalf("first register: %v", err)
	}
	if _, err := svc.Register(ctx, "alice", "otherpass1"); !errors.Is(err, ErrUserExists) {
		t.Fatalf("duplicate register: got %v, want ErrUserExists", err)
	}
}

func TestRegisterValidation(t *testing.T) {
	svc := newTestService(t)
	ctx := context.Background()
	if _, err := svc.Register(ctx, "ab", "supersecret"); !errors.Is(err, ErrInvalidUsername) {
		t.Fatalf("short username: got %v", err)
	}
	if _, err := svc.Register(ctx, "bad name!", "supersecret"); !errors.Is(err, ErrInvalidUsername) {
		t.Fatalf("bad username: got %v", err)
	}
	if _, err := svc.Register(ctx, "alice", "short"); !errors.Is(err, ErrWeakPassword) {
		t.Fatalf("weak password: got %v", err)
	}
}

func TestLogin(t *testing.T) {
	svc := newTestService(t)
	ctx := context.Background()
	if _, err := svc.Register(ctx, "alice", "supersecret"); err != nil {
		t.Fatalf("register: %v", err)
	}
	token, u, err := svc.Login(ctx, "alice", "supersecret")
	if err != nil {
		t.Fatalf("login: %v", err)
	}
	if token == "" || u.Username != "alice" {
		t.Fatalf("unexpected login result: token=%q user=%+v", token, u)
	}
	if _, _, err := svc.Login(ctx, "alice", "wrongpass1"); !errors.Is(err, ErrBadCredentials) {
		t.Fatalf("wrong password: got %v", err)
	}
	if _, _, err := svc.Login(ctx, "nobody", "supersecret"); !errors.Is(err, ErrBadCredentials) {
		t.Fatalf("unknown user: got %v", err)
	}
}

func TestVerifyToken(t *testing.T) {
	svc := newTestService(t)
	ctx := context.Background()
	registered, err := svc.Register(ctx, "alice", "supersecret")
	if err != nil {
		t.Fatalf("register: %v", err)
	}
	token, _, err := svc.Login(ctx, "alice", "supersecret")
	if err != nil {
		t.Fatalf("login: %v", err)
	}

	u, err := svc.VerifyToken(ctx, token)
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if u.ID != registered.ID {
		t.Fatalf("verify user id = %q, want %q", u.ID, registered.ID)
	}

	if _, err := svc.VerifyToken(ctx, token+"tampered"); !errors.Is(err, ErrBadCredentials) {
		t.Fatalf("tampered token: got %v", err)
	}
	if _, err := svc.VerifyToken(ctx, "not-a-jwt"); !errors.Is(err, ErrBadCredentials) {
		t.Fatalf("garbage token: got %v", err)
	}
}

func TestTokenExpiry(t *testing.T) {
	store := newTestStore(t)
	svc := NewService(store, []byte("test-secret"), -time.Minute) // 已过期
	ctx := context.Background()
	if _, err := svc.Register(ctx, "alice", "supersecret"); err != nil {
		t.Fatalf("register: %v", err)
	}
	token, _, err := svc.Login(ctx, "alice", "supersecret")
	if err != nil {
		t.Fatalf("login: %v", err)
	}
	if _, err := svc.VerifyToken(ctx, token); !errors.Is(err, ErrBadCredentials) {
		t.Fatalf("expired token: got %v", err)
	}
}
