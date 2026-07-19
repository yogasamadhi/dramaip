package server

import (
	"github.com/dramaip/dramaip-platform/services/app/admin/interface/internal/conf"
	adminsvc "github.com/dramaip/dramaip-platform/services/app/admin/interface/internal/service"
	"github.com/go-kratos/kratos/v3/middleware/recovery"
	khttp "github.com/go-kratos/kratos/v3/transport/http"
)

func NewHTTPServer(cfg *conf.Bootstrap, svc *adminsvc.HTTPService) *khttp.Server {
	server := khttp.NewServer(khttp.Address(cfg.Server.HTTP.Addr), khttp.Middleware(recovery.Recovery()))
	server.HandlePrefix("/", svc.Router())
	return server
}
