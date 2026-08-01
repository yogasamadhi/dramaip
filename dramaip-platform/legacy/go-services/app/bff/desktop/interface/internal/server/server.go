package server

import (
	"github.com/dramaip/dramaip-platform/services/app/bff/desktop/interface/internal/conf"
	bffsvc "github.com/dramaip/dramaip-platform/services/app/bff/desktop/interface/internal/service"
	"github.com/go-kratos/kratos/v3/middleware/recovery"
	khttp "github.com/go-kratos/kratos/v3/transport/http"
)

func NewHTTPServer(cfg *conf.Bootstrap, svc *bffsvc.HTTPService) *khttp.Server {
	server := khttp.NewServer(khttp.Address(cfg.Server.HTTP.Addr), khttp.Middleware(recovery.Recovery()))
	server.HandlePrefix("/", svc.Router())
	return server
}
