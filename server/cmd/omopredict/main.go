// omopredict —— OMOPredict 中间层：数据存储 / 仿真任务编排 / 对外 API。
//
// 两种运行形态（docs/desktop.md）：
//   - HTTP（默认）：Web 部署形态，REST + JWT（`OMO_AUTH_MODE=jwt`）；
//   - stdio（`--stdio`）：桌面形态，JSON-RPC over stdin/stdout，单用户本地模式（`OMO_AUTH_MODE=none`）。
//
// 职责边界（AGENTS.md §6 分层纪律）：
//   - 本服务只做编排与存储，不包含物理公式（物理逻辑只在 Python 引擎层）；
//   - 引擎调用当前通过 HTTP（OMO_ENGINE_URL）；stdio 引擎传输见 docs/desktop.md T4。
package main

import (
	"context"
	"errors"
	"flag"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/1Vewton/OMOPredict/server/internal/api"
	"github.com/1Vewton/OMOPredict/server/internal/model"
	"github.com/1Vewton/OMOPredict/server/internal/rpc"
	"github.com/1Vewton/OMOPredict/server/internal/store"
	"github.com/1Vewton/OMOPredict/server/internal/task"
	"github.com/1Vewton/OMOPredict/server/internal/user"
)

func main() {
	stdio := flag.Bool("stdio", false,
		"以 stdio JSON-RPC 模式运行（桌面版；需 OMO_AUTH_MODE=none）")
	flag.Parse()

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

	taskSvc := task.NewService(
		task.NewGORMStore(db),
		task.NewEngineClient(engineURL()),
	)
	if engineTransport == api.EngineTransportStdio {
		log.Println("warning: OMO_ENGINE_TRANSPORT=stdio 尚未实现（docs/desktop.md T4），" +
			"当前仍以 HTTP 调用引擎")
	}

	if *stdio {
		runStdio(taskSvc, authMode, engineTransport)
		return
	}

	userSvc := user.NewService(user.NewGORMStore(db), jwtSecret(authMode), jwtTTL())
	addr := os.Getenv("OMO_SERVER_ADDR")
	if addr == "" {
		addr = ":8080"
	}
	srv := &http.Server{
		Addr: addr,
		Handler: api.NewRouter(userSvc, taskSvc, api.Config{
			AuthMode:        authMode,
			Version:         api.Version(),
			EngineTransport: engineTransport,
		}),
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 30 * time.Second,
	}

	go func() {
		logAuthMode(authMode)
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

// runStdio 以 stdio JSON-RPC 形态运行（桌面版）：协议走 stdout，日志走 stderr。
func runStdio(tasks *task.Service, authMode api.AuthMode, transport string) {
	srv, err := rpc.NewServer(tasks, rpc.Config{
		AuthMode:        authMode,
		Version:         api.Version(),
		EngineTransport: transport,
	})
	if err != nil {
		log.Fatalf("stdio: %v", err)
	}
	logAuthMode(authMode)
	log.Printf("engine transport: %s", transport)
	log.Println("rpc mode: stdio（JSON-RPC over stdin/stdout；日志输出到 stderr）")
	if err := srv.Serve(context.Background(), os.Stdin, os.Stdout); err != nil {
		log.Fatalf("rpc: %v", err)
	}
	log.Println("stdin 已结束，退出")
}

// logAuthMode 显式打印运行模式：none 表示认证已关闭（仅桌面本地模式应使用）。
func logAuthMode(authMode api.AuthMode) {
	if authMode == api.AuthModeNone {
		log.Printf("auth mode: none —— 单用户本地模式（不做认证，任务归属 %q）", user.LocalUserID)
		return
	}
	log.Printf("auth mode: jwt")
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
