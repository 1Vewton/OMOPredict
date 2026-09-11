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
	"github.com/1Vewton/OMOPredict/server/internal/model"
	"github.com/1Vewton/OMOPredict/server/internal/store"
	"github.com/1Vewton/OMOPredict/server/internal/task"
	"github.com/1Vewton/OMOPredict/server/internal/user"
)

func main() {
	cfg := store.LoadConfig()
	authMode, err := api.ParseAuthMode(os.Getenv("OMO_AUTH_MODE"))
	if err != nil {
		log.Fatalf("auth mode: %v", err)
	}
	engineTransport, err := api.ParseEngineTransport(os.Getenv("OMO_ENGINE_TRANSPORT"))
	if err != nil {
		log.Fatalf("engine transport: %v", err)
	}

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
	if err := store.Migrate(db, &user.User{}, &model.SimulationTask{}); err != nil {
		log.Fatalf("migrate: %v", err)
	}

	userSvc := user.NewService(user.NewGORMStore(db), jwtSecret(authMode), jwtTTL())
	engine := task.NewEngineClient(engineURL())
	taskSvc := task.NewService(task.NewGORMStore(db), engine)

	addr := os.Getenv("OMO_SERVER_ADDR")
	if addr == "" {
		addr = ":8080"
	}
	srv := &http.Server{
		Addr: addr,
		Handler: api.NewRouter(userSvc, taskSvc, api.Config{
			AuthMode:        authMode,
			EngineTransport: engineTransport,
		}),
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 30 * time.Second,
	}

	go func() {
		// 显式打印运行模式：none 表示认证已关闭（仅桌面本地模式应使用）
		if authMode == api.AuthModeNone {
			log.Printf("auth mode: none —— 单用户本地模式（不做认证，任务归属 %q）", user.LocalUserID)
		} else {
			log.Printf("auth mode: jwt")
		}
		log.Printf("engine transport: %s", engineTransport)
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
//
// 单用户模式（authMode = none）不需要 JWT，直接返回占位值且不告警。
func jwtSecret(authMode api.AuthMode) []byte {
	if authMode == api.AuthModeNone {
		return []byte("unused-in-local-mode")
	}
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

// engineURL Python 引擎地址（默认本机 8000 端口，配合 uvicorn 启动）。
func engineURL() string {
	if v := os.Getenv("OMO_ENGINE_URL"); v != "" {
		return v
	}
	return "http://127.0.0.1:8000"
}
