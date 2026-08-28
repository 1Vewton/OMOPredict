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
)

func main() {
	addr := os.Getenv("OMO_SERVER_ADDR")
	if addr == "" {
		addr = ":8080"
	}

	srv := &http.Server{
		Addr:         addr,
		Handler:      api.NewRouter(),
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
