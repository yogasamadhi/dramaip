import { Button } from '../../components/ui/Button'

const desktopReleaseURL = 'https://gitee.com/qq_connect_hkp/drama-ip/releases'
const desktopReleaseGuideURL = 'https://gitee.com/qq_connect_hkp/drama-ip/blob/main/dramaip-desktop/docs/release/RELEASE.md'

export default function DownloadPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-3xl font-semibold text-slate-950">下载 DramaIP 桌面端</h1>
      <p className="mt-4 leading-7 text-slate-600">桌面端是本地优先的创作工作台；订阅和云端额度会在账号中心统一管理。</p>
      <section className="mt-8 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-semibold text-slate-950">官方发布页</h2>
        <p className="mt-3 text-sm leading-6 text-slate-600">请从官方 Gitee Release 获取与你系统匹配的安装包。发布说明会标注版本、校验与回滚信息。</p>
        <div className="mt-5 flex flex-wrap gap-3">
          <a href={desktopReleaseURL} target="_blank" rel="noreferrer"><Button>打开官方下载页</Button></a>
          <a href={desktopReleaseGuideURL} target="_blank" rel="noreferrer"><Button variant="secondary">查看安装与发布说明</Button></a>
        </div>
      </section>
      <section className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-900">
        仅安装 Release 中提供的 macOS、Windows 或 Linux 安装包；不要从非官方镜像下载，也不要把账号密码或 API Key 提供给第三方安装器。
      </section>
    </main>
  )
}
