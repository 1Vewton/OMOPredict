// omopredict —— OMOPredict 中间层：用户管理 / 数据存储 / 仿真任务编排。
//
// 职责边界（AGENTS.md §6 分层纪律）：
//   - 本服务只做编排与存储，不包含物理公式（物理逻辑只在 Python 引擎层）；
//   - 前端只与本服务通信；本服务通过 HTTP 调用 Python 引擎（omo.api）。
package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/1Vewton/OMOPredict/server/internal/api"
	"github.com/1Vewton/OMOPredict/server/internal/store"
	"github.com/1Vewton/OMOPredict/server/internal/user"
)

func main() {
	cfg := store.LoadConfig()
	db, err := store.Open(cfg)
	if err != nil {
		log.Fatalf("open store: %v", err)
	}
	// 连接池生命周期 = *sql.DB 生命周期：必须显式关闭（查询连接才会自动归还池）
	defer func() {
		if err := store.Close(db); err != nil {
			log.Printf("close store: %v", err)
		}
	}()
	if err := store.Migrate(db, &user.User{}); err != nil {
		log.Fatalf("migrate: %v", err)
	}

	svc := user.NewService(user.NewGORMStore(db), jwtSecret(), jwtTTL())

	addr := os.Getenv("OMO_SERVER_ADDR")
	if addr == "" {
		addr = ":8080"
	}
	srv := &http.Server{
		Addr:         addr,
		Handler:      api.NewRouter(svc),
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 30 * time.Second,
	}

	go func() {
		log.Printf("omo server listening on %s", addr)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("server error: %v", err)
		}
	}()

	// 优雅退出：等待中断信号后关闭
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	<-ctx.Done()
	log.Println("shutting down...")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutdownCtx)
}

// jwtSecret JWT 签名密钥；生产环境必须通过 OMO_JWT_SECRET 设置。
func jwtSecret() []byte {
	if s := os.Getenv("OMO_JWT_SECRET"); s != "" {
		return []byte(s)
	}
	log.Println("warning: OMO_JWT_SECRET 未设置，使用开发默认密钥（生产必须设置）")
	return []byte("dev-secret-do-not-use-in-prod")
}

// jwtTTL 令牌有效期（默认 24h）。
func jwtTTL() time.Duration {
	if v := os.Getenv("OMO_JWT_TTL"); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
	}
	return 24 * time.Hour
}
