# 一、教程目标

本教程在现有 Kubernetes 高可用集群和配套设施基础上，构建以下完整 CI/CD 流程：

```text
开发人员
   │
   │ Git Push / Merge Request
   ▼
GitLab
   │
   ▼
GitLab Runner
   ├── 单元测试
   ├── SonarQube 代码质量分析
   ├── Docker BuildKit 构建镜像
   └── Trivy 镜像漏洞扫描
          │
          ▼
       Harbor
          │
          ▼
GitLab GitOps 仓库
          │
          ▼
       Argo CD
          │
          ▼
     Kubernetes
```

各组件职责如下：

|组件|主要职责|
|---|---|
|GitLab|代码托管、用户权限、Merge Request、CI 配置|
|GitLab Runner|执行测试、构建、扫描和镜像推送|
|SonarQube|静态代码分析、覆盖率和 Quality Gate|
|Trivy|在镜像进入 Harbor 前进行漏洞扫描|
|Harbor|保存业务镜像和 CI 基础镜像|
|GitOps 仓库|保存 Kubernetes 期望部署状态|
|Argo CD|根据 GitOps 仓库同步 Kubernetes|
|Kubernetes|运行应用|
|backup01|保存 GitLab、GitLab Runner、SonarQube、Harbor 和集群备份|

核心原则：

```text
CI 负责测试和构建
CD 负责部署
Git 保存部署配置
Harbor 保存容器镜像
Argo CD 是正式部署入口
```

CI 流水线不直接执行：

```bash
kubectl apply
```

而是执行：

```text
构建镜像
→ 推送 Harbor
→ 更新 GitOps 仓库
→ Argo CD 自动部署
```

---

# 二、当前整体主机规划

## 2.1 Kubernetes 集群

现有 Kubernetes 集群不重新安装：

|主机名|IP|角色|配置|
|---|--:|---|--:|
|k8s-api|192.168.2.200|Keepalived API 虚拟 IP|不对应独立主机|
|k8s-master01|192.168.2.201|Control Plane + etcd，物理主机1|2C3G|
|k8s-master02|192.168.2.202|Control Plane + etcd，物理主机2|2C3G|
|k8s-master03|192.168.2.203|Control Plane + etcd，物理主机3|2C3G|
|k8s-worker01|192.168.2.101|Worker，物理主机1|4C8G|
|k8s-worker02|192.168.2.102|Worker，物理主机2|6C16G|
|k8s-worker03|192.168.2.103|Worker，物理主机3|4C8G|

当前集群采用：

```text
Kubernetes：v1.36.2
Docker Engine：Docker CE
CRI：cri-dockerd v0.4.6
CNI：Calico v3.32.1
Pod CIDR：10.244.0.0/16
Service CIDR：10.96.0.0/12
API VIP：192.168.2.200:8443
```

这些参数与现有 Kubernetes 安装文档一致。

三台 Master 当前均为 `2C3G`，属于家庭学习环境的紧凑型高可用控制平面配置。它们只运行 Control Plane、etcd、HAProxy 和 Keepalived，不承载普通业务 Pod；应保留控制平面默认污点，并持续关注内存余量和 etcd 状态。当前三台 Worker 合计为 `14C32G`，足以运行本教程中的 Argo CD、三个示例应用副本以及少量学习型工作负载。

现有三台 Worker 已经分别设置：

```text
k8s-worker01 → physical-host-1
k8s-worker02 → physical-host-2
k8s-worker03 → physical-host-3
```

后续业务 Deployment 会利用这些标签分散副本。

---

## 2.2 配套设施主机

本教程固定使用你填写的配置：

|主机名|IP|角色|配置|
|---|--:|---|--:|
|harbor01|192.168.2.211|容器镜像仓库|2C4G|
|nfs-storage01|192.168.2.221|NFS 外部数据卷服务器|2C2G|
|backup01|192.168.2.231|集中备份与历史恢复|2C2G|
|gitlab01|192.168.2.241|自建 GitLab 代码托管与研发管理|4C9G|
|runner01|192.168.2.242|GitLab Runner，执行测试、构建、扫描和镜像推送|4C6G|
|sonarqube01|192.168.2.243|SonarQube 代码质量分析与 PostgreSQL|4C6G|

建议磁盘规划：

|主机名|建议磁盘|
|---|--:|
|harbor01|160GB 以上|
|nfs-storage01|200GB 以上，按 PVC 数据量调整|
|backup01|500GB 以上，按备份量调整|
|gitlab01|150GB～250GB SSD|
|runner01|120GB～200GB SSD|
|sonarqube01|80GB～100GB SSD|

Harbor 的官方最低资源基线为 2 CPU、4GB 内存和 40GB 磁盘，因此当前 `2C4G` 可以满足学习最低要求，但漏洞扫描和垃圾回收期间速度会较慢。

GitLab 单节点通常需要更多内存；当前 `4C9G` 环境保留 GitLab、KAS、Prometheus、Alertmanager 和 Exporter 等功能，继续使用两个 Puma Worker、Sidekiq 并发 10 和受限的 Gitaly 子进程数量，适合个人学习和低并发使用，并比原 `4C8G` 配置多出一定的系统缓存和突发任务余量。

Runner 当前为 `4C6G`，继续使用双并发配置。相较原 `2C4G`，它更适合同时执行两个单元测试、镜像构建或扫描 Job；但两个 Docker Build 或 Trivy Job 同时运行时仍应关注磁盘 I/O 和内存占用。

SonarQube 与 PostgreSQL 当前使用 `4C6G`，已高于最低学习配置。教程相应提高 Web、Compute Engine 和 Search JVM 的内存上限，适合少量项目和低并发分析，同时继续保留低优先级 Swap 作为异常峰值兜底。

---

## 2.3 各主机运行方式

```text
harbor01
└── Docker Compose
    ├── Harbor
    ├── Registry
    ├── PostgreSQL
    ├── Redis
    └── Trivy Adapter

gitlab01
└── GitLab Linux Package
    ├── GitLab Rails
    ├── PostgreSQL
    ├── Redis
    ├── Gitaly
    └── NGINX

runner01
├── Docker Engine
└── GitLab Runner Docker Executor

sonarqube01
├── NGINX
└── Docker Compose
    ├── SonarQube Community Build
    └── PostgreSQL

Kubernetes
└── Argo CD
```

不要把以下数据放到 NFS：

```text
GitLab PostgreSQL 数据
GitLab Git Repository
SonarQube PostgreSQL 数据
Harbor Registry 数据
数据库业务数据
```

当前 NFS 主要用于 Kubernetes 普通 PVC 和共享文件学习场景。

---

# 三、软件版本规划

本教程固定：

| 组件 | 版本 |
|---|---|
| GitLab CE | 19.2.0-ce.0 |
| GitLab Runner | 19.2.0-1 |
| SonarQube Community Build | 26.7.0.124771 |
| PostgreSQL | 17-alpine |
| Trivy | 0.72.0 |
| Argo CD | v3.4.2 |
| Docker CLI Job 镜像 | 29.6.1-cli |
| Node.js Job 镜像 | 24.18.0 |
| GitOps Job 镜像 | `1.0.0-alpine3.22` |
| Helm 校验 Job 镜像 | `3.19.0` |
| Harbor | 现有 v2.15.2 |
| Kubernetes | 现有 v1.36.2 |

不要使用 `latest` 作为正式环境版本。

---

# 第一阶段：准备域名和网络

## 4.1 域名规划

固定地址：

```text
gitlab.home.arpa       → 192.168.2.241
sonarqube.home.arpa    → 192.168.2.243
harbor.home.arpa       → 192.168.2.211
```

Ingress 域名统一指向实际业务入口：

```text
argocd.home.arpa       → <INGRESS_IP>
demo.home.arpa         → <INGRESS_IP>
```

`<INGRESS_IP>` 必须替换为当前 Ingress NGINX 的实际入口，例如独立 Ingress VIP、MetalLB 地址或外部负载均衡地址。

```text
192.168.2.200:8443
```

只用于 Kubernetes API，不用于 Argo CD 和业务 Ingress。

---

## 4.2 检查新增 IP 是否被占用

在任意局域网 Linux 主机执行：

```bash
sudo apt-get update
sudo apt-get install -y arping
```

查看实际网卡：

```bash
ip -br -4 addr
```

假设局域网网卡是 `ens18`：

```bash
for ip in \
  192.168.2.241 \
  192.168.2.242 \
  192.168.2.243
do
  echo "===== 检查 ${ip} ====="

  sudo arping \
    -D \
    -I ens18 \
    -c 3 \
    "$ip"
done
```

如果收到其他设备响应，说明 IP 已被使用。

---

## 4.3 配置静态 IP

三台新增主机建议统一安装：

```text
Ubuntu Server 24.04 LTS
```

GitLab 官方 Linux Package 当前明确支持 Ubuntu 20.04、22.04 和 24.04。

以 `gitlab01` 为例：

```bash
sudo vim /etc/netplan/01-static.yaml
```

假设实际网卡名为 `ens18`：

```yaml
network:
  version: 2

  ethernets:
    ens18:
      dhcp4: false

      addresses:
        - 192.168.2.241/24

      routes:
        - to: default
          via: 192.168.2.1

      nameservers:
        addresses:
          - 192.168.2.1
          - 223.5.5.5
```

应用：

```bash
sudo chmod 600 \
  /etc/netplan/01-static.yaml

sudo netplan generate
sudo netplan try
sudo netplan apply
```

其他两台分别使用：

```text
runner01：    192.168.2.242
sonarqube01：192.168.2.243
```

检查：

```bash
ip -br -4 addr
ip route
ping -c 3 192.168.2.1
```

---

## 4.4 设置主机名

### gitlab01

```bash
sudo hostnamectl set-hostname gitlab01
```

### runner01

```bash
sudo hostnamectl set-hostname runner01
```

### sonarqube01

```bash
sudo hostnamectl set-hostname sonarqube01
```

重新登录后检查：

```bash
hostname
hostnamectl
```

---

## 4.5 批量更新 Ubuntu 主机的 hosts

### 【管理电脑】

先把 `<INGRESS_IP>` 替换为实际 Ingress 地址：

```bash
mkdir -p "$HOME/platform-pki"

cat > "$HOME/platform-pki/distribute-cicd-hosts.sh" <<'EOF'
#!/usr/bin/env bash

set -Eeuo pipefail

SSH_USER="ys"
INGRESS_IP="<INGRESS_IP>"

HOSTS=(
  192.168.2.201 192.168.2.202 192.168.2.203
  192.168.2.101 192.168.2.102 192.168.2.103
  192.168.2.211 192.168.2.221 192.168.2.231
  192.168.2.241 192.168.2.242 192.168.2.243
)

if [[ "$INGRESS_IP" == "<INGRESS_IP>" ]]; then
  echo "请先修改脚本中的 INGRESS_IP"
  exit 1
fi

BLOCK_FILE="$(mktemp)"

cat > "$BLOCK_FILE" <<BLOCK
# BEGIN CICD FACILITIES
192.168.2.211 harbor01 harbor.home.arpa
192.168.2.221 nfs-storage01
192.168.2.231 backup01
192.168.2.241 gitlab01 gitlab.home.arpa
192.168.2.242 runner01
192.168.2.243 sonarqube01 sonarqube.home.arpa
${INGRESS_IP} argocd.home.arpa demo.home.arpa
# END CICD FACILITIES
BLOCK

for HOST_IP in "${HOSTS[@]}"
do
  echo "===== ${HOST_IP} ====="

  scp \
    "$BLOCK_FILE" \
    "${SSH_USER}@${HOST_IP}:/tmp/cicd-hosts.block"

  ssh \
    -t \
    "${SSH_USER}@${HOST_IP}" \
    '
      set -e

      sudo sed -i \
        "/# BEGIN CICD FACILITIES/,/# END CICD FACILITIES/d" \
        /etc/hosts

      cat /tmp/cicd-hosts.block \
        | sudo tee -a /etc/hosts \
        >/dev/null

      rm -f /tmp/cicd-hosts.block
    '
done

rm -f "$BLOCK_FILE"
EOF

chmod 700 \
  "$HOME/platform-pki/distribute-cicd-hosts.sh"

"$HOME/platform-pki/distribute-cicd-hosts.sh"
```

### 【管理 Mac】

编辑：

```bash
sudo vim /etc/hosts
```

追加同一配置块，并将 `<INGRESS_IP>` 替换为实际地址。

---

## 4.6 同步时间

在三台新增主机执行：

```bash
sudo timedatectl set-timezone Asia/Shanghai
sudo timedatectl set-ntp true
```

检查：

```bash
timedatectl status
```

应看到：

```text
System clock synchronized: yes
```

---

# 第二阶段：创建并分发平台私有 CA

## 5.1 证书体系

现有 Harbor 继续使用：

```text
/opt/harbor/certs/ca.crt
```

新建 Platform Root CA，用于：

```text
gitlab.home.arpa
sonarqube.home.arpa
argocd.home.arpa
demo.home.arpa
```

Runner 需要同时信任 Harbor CA 和 Platform Root CA。

---

## 5.2 创建 Platform Root CA

### 【管理电脑】

```bash
mkdir -p "$HOME/platform-pki"
cd "$HOME/platform-pki"

openssl genrsa \
  -out platform-root-ca.key \
  4096

chmod 600 \
  platform-root-ca.key

openssl req \
  -x509 \
  -new \
  -nodes \
  -key platform-root-ca.key \
  -sha256 \
  -days 3650 \
  -out platform-root-ca.crt \
  -subj "/C=CN/ST=Chongqing/L=Chongqing/O=HomeLab/OU=Platform/CN=HomeLab Platform Root CA" \
  -addext "basicConstraints=critical,CA:TRUE" \
  -addext "keyUsage=critical,keyCertSign,cRLSign"
```

`platform-root-ca.key` 只保存在管理电脑，不得分发。

---

## 5.3 签发服务证书

### 【管理电脑】

```bash
cat > "$HOME/platform-pki/issue-platform-cert.sh" <<'EOF'
#!/usr/bin/env bash

set -Eeuo pipefail

NAME="${1:?Usage: issue-platform-cert.sh <hostname>}"
BASE_DIR="$(cd "$(dirname "$0")" && pwd)"

cat > "${BASE_DIR}/${NAME}.cnf" <<CONF
[req]
prompt = no
distinguished_name = dn
req_extensions = req_ext

[dn]
C = CN
ST = Chongqing
L = Chongqing
O = HomeLab
OU = Platform
CN = ${NAME}

[req_ext]
subjectAltName = @alt_names
keyUsage = critical,digitalSignature,keyEncipherment
extendedKeyUsage = serverAuth

[alt_names]
DNS.1 = ${NAME}
CONF

openssl genrsa \
  -out "${BASE_DIR}/${NAME}.key" \
  4096

openssl req \
  -new \
  -key "${BASE_DIR}/${NAME}.key" \
  -out "${BASE_DIR}/${NAME}.csr" \
  -config "${BASE_DIR}/${NAME}.cnf"

if [[ -f "${BASE_DIR}/platform-root-ca.srl" ]]; then
  SERIAL_ARGS=(
    -CAserial "${BASE_DIR}/platform-root-ca.srl"
  )
else
  SERIAL_ARGS=(
    -CAcreateserial
  )
fi

openssl x509 \
  -req \
  -in "${BASE_DIR}/${NAME}.csr" \
  -CA "${BASE_DIR}/platform-root-ca.crt" \
  -CAkey "${BASE_DIR}/platform-root-ca.key" \
  "${SERIAL_ARGS[@]}" \
  -out "${BASE_DIR}/${NAME}.crt" \
  -days 825 \
  -sha256 \
  -extfile "${BASE_DIR}/${NAME}.cnf" \
  -extensions req_ext

chmod 600 \
  "${BASE_DIR}/${NAME}.key"
EOF

chmod 700 \
  "$HOME/platform-pki/issue-platform-cert.sh"

cd "$HOME/platform-pki"

./issue-platform-cert.sh gitlab.home.arpa
./issue-platform-cert.sh sonarqube.home.arpa
./issue-platform-cert.sh argocd.home.arpa
./issue-platform-cert.sh demo.home.arpa
```

---

## 5.4 创建 SonarScanner TrustStore

SonarScanner for NPM 使用 Java 连接 SonarQube，需要 PKCS#12 TrustStore：

```bash
cd "$HOME/platform-pki"

openssl pkcs12 \
  -export \
  -nokeys \
  -in platform-root-ca.crt \
  -name platform-root-ca \
  -out sonar-truststore.p12 \
  -passout pass:changeit

chmod 600 \
  sonar-truststore.p12
```

该文件只包含公钥证书，密码 `changeit` 用于读取 TrustStore。

---

## 5.5 批量分发 Platform Root CA

### 【管理电脑】

```bash
cat > "$HOME/platform-pki/distribute-platform-ca.sh" <<'EOF'
#!/usr/bin/env bash

set -Eeuo pipefail

SSH_USER="ys"
CA_FILE="$HOME/platform-pki/platform-root-ca.crt"

HOSTS=(
  192.168.2.201 192.168.2.202 192.168.2.203
  192.168.2.101 192.168.2.102 192.168.2.103
  192.168.2.211 192.168.2.221 192.168.2.231
  192.168.2.241 192.168.2.242 192.168.2.243
)

test -f "$CA_FILE"

for HOST_IP in "${HOSTS[@]}"
do
  echo "===== ${HOST_IP} ====="

  scp \
    "$CA_FILE" \
    "${SSH_USER}@${HOST_IP}:/tmp/platform-root-ca.crt"

  ssh \
    -t \
    "${SSH_USER}@${HOST_IP}" \
    '
      set -e

      sudo install \
        -o root \
        -g root \
        -m 0644 \
        /tmp/platform-root-ca.crt \
        /usr/local/share/ca-certificates/platform-root-ca.crt

      sudo update-ca-certificates

      rm -f /tmp/platform-root-ca.crt
    '
done
EOF

chmod 700 \
  "$HOME/platform-pki/distribute-platform-ca.sh"

"$HOME/platform-pki/distribute-platform-ca.sh"
```

---

## 5.6 分发服务证书

### 【管理电脑】

```bash
cat > "$HOME/platform-pki/distribute-service-certs.sh" <<'EOF'
#!/usr/bin/env bash

set -Eeuo pipefail

SSH_USER="ys"
PKI_DIR="$HOME/platform-pki"

install_remote_cert() {
  local host_ip="$1"
  local cert_name="$2"
  local target_dir="$3"

  scp \
    "${PKI_DIR}/${cert_name}.crt" \
    "${PKI_DIR}/${cert_name}.key" \
    "${SSH_USER}@${host_ip}:/tmp/"

  ssh \
    -t \
    "${SSH_USER}@${host_ip}" \
    "
      set -e

      sudo install \
        -d \
        -m 0755 \
        '${target_dir}'

      sudo install \
        -o root \
        -g root \
        -m 0644 \
        '/tmp/${cert_name}.crt' \
        '${target_dir}/${cert_name}.crt'

      sudo install \
        -o root \
        -g root \
        -m 0600 \
        '/tmp/${cert_name}.key' \
        '${target_dir}/${cert_name}.key'

      rm -f \
        '/tmp/${cert_name}.crt' \
        '/tmp/${cert_name}.key'
    "
}

install_remote_cert \
  192.168.2.241 \
  gitlab.home.arpa \
  /etc/gitlab/ssl

install_remote_cert \
  192.168.2.243 \
  sonarqube.home.arpa \
  /etc/nginx/ssl

ssh \
  "${SSH_USER}@192.168.2.201" \
  'mkdir -p "$HOME/platform-k8s-certs" && chmod 700 "$HOME/platform-k8s-certs"'

scp \
  "${PKI_DIR}/argocd.home.arpa.crt" \
  "${PKI_DIR}/argocd.home.arpa.key" \
  "${PKI_DIR}/demo.home.arpa.crt" \
  "${PKI_DIR}/demo.home.arpa.key" \
  "${SSH_USER}@192.168.2.201:/home/ys/platform-k8s-certs/"

ssh \
  "${SSH_USER}@192.168.2.201" \
  'chmod 600 "$HOME"/platform-k8s-certs/*.key'
EOF

chmod 700 \
  "$HOME/platform-pki/distribute-service-certs.sh"

"$HOME/platform-pki/distribute-service-certs.sh"
```

---

## 5.7 macOS 信任 Platform Root CA

### 【管理 Mac】

```bash
sudo security add-trusted-cert \
  -d \
  -r trustRoot \
  -k /Library/Keychains/System.keychain \
  "$HOME/platform-pki/platform-root-ca.crt"
```

重新打开浏览器后生效。

---

## 5.8 macOS 信任 Harbor CA

Harbor 使用独立于 Platform Root CA 的 Harbor CA。管理 Mac 后续需要使用浏览器和 Docker Desktop 访问：

```text
harbor.home.arpa
```

因此还必须单独信任 Harbor CA。

### 【管理 Mac】

复制 Harbor CA：

```bash
scp \
  ys@192.168.2.211:/opt/harbor/certs/ca.crt \
  "$HOME/platform-pki/harbor-root-ca.crt"
```

检查证书：

```bash
openssl x509 \
  -in "$HOME/platform-pki/harbor-root-ca.crt" \
  -noout \
  -subject \
  -issuer \
  -dates \
  -fingerprint \
  -sha256
```

导入 macOS 系统钥匙串：

```bash
sudo security add-trusted-cert \
  -d \
  -r trustRoot \
  -k /Library/Keychains/System.keychain \
  "$HOME/platform-pki/harbor-root-ca.crt"
```

重启 Docker Desktop，使 Docker Desktop 虚拟机重新加载系统信任链：

```bash
osascript \
  -e 'quit app "Docker"' \
  2>/dev/null \
  || true

open -a Docker
```

等待 Docker Desktop 启动后验证：

```bash
curl -I \
  https://harbor.home.arpa

docker version
```

检查 Harbor 当前服务器证书：

```bash
echo \
  | openssl s_client \
      -connect harbor.home.arpa:443 \
      -servername harbor.home.arpa \
      2>/dev/null \
  | openssl x509 \
      -noout \
      -subject \
      -issuer \
      -dates \
      -ext subjectAltName \
      -ext extendedKeyUsage
```

服务器证书应包含：

```text
DNS:harbor.home.arpa
TLS Web Server Authentication
```

Harbor 服务器证书有效期不应超过 825 天；Harbor 根 CA 可以使用更长有效期。

---

## 5.9 加密离线备份两套 CA

Platform Root CA 和 Harbor CA 的私钥用于签发内部服务证书。私钥丢失后，现有证书可以继续使用到过期，但无法继续沿用原信任链签发新证书。

至少保存两份加密备份：

```text
一份保存在密码管理器支持的加密文件库或加密磁盘
一份保存在平时不连接主机的离线移动存储介质
```

不要把 CA 私钥上传到普通 Git 仓库、聊天工具、公共网盘或未加密的备份目录。

### 一、备份 Platform Root CA

### 【管理 Mac】

进入证书目录：

```bash
cd \
  "$HOME/platform-pki"
```

确认关键文件：

```bash
ls -l \
  platform-root-ca.key \
  platform-root-ca.crt \
  platform-root-ca.srl \
  issue-platform-cert.sh
```

创建加密归档。命令会交互式要求输入归档密码：

```bash
PLATFORM_CA_BACKUP="$HOME/platform-ca-backup-$(date +%F).tar.enc"

tar \
  -cf - \
  platform-root-ca.key \
  platform-root-ca.crt \
  platform-root-ca.srl \
  issue-platform-cert.sh \
  ./*.cnf \
  2>/dev/null \
  | openssl enc \
      -aes-256-cbc \
      -salt \
      -pbkdf2 \
      -out "$PLATFORM_CA_BACKUP"
```

设置权限：

```bash
chmod 600 \
  "$PLATFORM_CA_BACKUP"
```

验证加密文件可以读取。该命令只列出归档，不会把内容写回磁盘：

```bash
openssl enc \
  -d \
  -aes-256-cbc \
  -pbkdf2 \
  -in "$PLATFORM_CA_BACKUP" \
  | tar -tf -
```

归档密码必须保存到密码管理器，不能只保存在当前 Mac。

### 二、备份 Harbor CA 和服务证书

### 【harbor01】

确认 Harbor 证书目录：

```bash
sudo find \
  /opt/harbor/certs \
  -maxdepth 1 \
  -type f \
  -printf '%f\n'
```

创建加密归档：

```bash
HARBOR_CA_BACKUP="/tmp/harbor-ca-backup-$(date +%F).tar.enc"

sudo tar \
  -C /opt/harbor \
  -cf - \
  certs \
  | sudo openssl enc \
      -aes-256-cbc \
      -salt \
      -pbkdf2 \
      -out "$HARBOR_CA_BACKUP"
```

把加密文件交给当前管理用户读取：

```bash
sudo chown \
  "$USER":"$USER" \
  "$HARBOR_CA_BACKUP"

chmod 600 \
  "$HARBOR_CA_BACKUP"
```

### 【管理 Mac】

复制加密归档：

```bash
scp \
  ys@192.168.2.211:/tmp/harbor-ca-backup-$(date +%F).tar.enc \
  "$HOME/"
```

验证后删除 Harbor 主机上的临时归档：

```bash
ssh \
  ys@192.168.2.211 \
  'rm -f /tmp/harbor-ca-backup-*.tar.enc'
```

将两份加密归档复制到离线介质后，至少执行一次解密和目录检查。不要等到证书过期或主机故障时才首次验证备份。

---

# 第三阶段：安装 GitLab CE

## 6.1 GitLab 部署信息

```text
主机：gitlab01
IP：192.168.2.241
域名：gitlab.home.arpa
配置：4C9G
系统：Ubuntu Server 24.04
安装方式：GitLab Linux Package
```

---

## 6.2 安装基础依赖

### 【gitlab01】

```bash
sudo apt-get update
```

```bash
sudo apt-get install -y \
  curl \
  ca-certificates \
  openssh-server \
  tzdata \
  perl \
  postfix
```

启动 SSH：

```bash
sudo systemctl enable --now ssh
```

Postfix 安装时选择：

```text
Internet Site
```

邮件名称填写：

```text
gitlab.home.arpa
```

暂时没有配置外部 SMTP 不会影响代码托管和 CI，但密码重置、用户邀请和邮件通知暂时不可用。

---

## 6.3 检查 GitLab 证书

### 【gitlab01】

证书已由第五章安装到：

```text
/etc/gitlab/ssl/gitlab.home.arpa.crt
/etc/gitlab/ssl/gitlab.home.arpa.key
```

检查：

```bash
sudo ls -l \
  /etc/gitlab/ssl/gitlab.home.arpa.crt \
  /etc/gitlab/ssl/gitlab.home.arpa.key
```

预期权限：

```text
gitlab.home.arpa.crt：644
gitlab.home.arpa.key：600
```

---

## 6.4 添加 GitLab 官方仓库

### 【gitlab01】

下载仓库配置脚本：

```bash
curl -fsSL \
  https://packages.gitlab.com/install/repositories/gitlab/gitlab-ce/script.deb.sh \
  -o /tmp/gitlab-ce-repository.sh
```

检查脚本：

```bash
less /tmp/gitlab-ce-repository.sh
```

执行：

```bash
sudo bash \
  /tmp/gitlab-ce-repository.sh
```

更新软件索引：

```bash
sudo apt-get update
```

查看可安装版本：

```bash
apt-cache madison gitlab-ce \
  | head -n 20
```

固定本教程使用的 GitLab CE 软件包版本：

```bash
GITLAB_PACKAGE_VERSION="19.2.0-ce.0"
```

确认官方仓库中存在该版本：

```bash
apt-cache madison gitlab-ce \
  | awk '{print $3}' \
  | grep -Fx \
    "$GITLAB_PACKAGE_VERSION"
```

检查变量：

```bash
echo "$GITLAB_PACKAGE_VERSION"

test -n "$GITLAB_PACKAGE_VERSION"
```

应输出：

```text
19.2.0-ce.0
```

该变量只在当前 Shell 会话中有效。重新登录后如需继续使用，应重新执行本节的变量赋值命令。

---

## 6.5 下载并安装 GitLab

GitLab 安装包接近 1GB，直接通过 APT 下载可能较慢。本节使用 `aria2` 多线程下载官方 `.deb` 文件，再通过 `dpkg` 明确安装本地软件包，避免再次从 GitLab 仓库下载。

### 一、安装 aria2

### 【gitlab01】

```bash
sudo apt-get update

sudo apt-get install -y \
  aria2
```

### 二、获取 GitLab 官方软件包地址

### 【gitlab01】

```bash
GITLAB_DEB_URL="$(
  apt-get \
    --print-uris \
    --yes \
    --download-only \
    install \
    "gitlab-ce=${GITLAB_PACKAGE_VERSION}" \
  | awk -F"'" \
      '/gitlab-ce_[^/]*_amd64\.deb/ {
        print $2
        exit
      }'
)"
```

检查：

```bash
printf '%s\n' \
  "$GITLAB_DEB_URL"

test -n "$GITLAB_DEB_URL"

case "$GITLAB_DEB_URL" in
  *gitlab-ce*_amd64.deb*)
    ;;

  *)
    echo "没有提取到 GitLab CE 软件包地址"
    exit 1
    ;;
esac
```

应输出 GitLab 官方 `gitlab-ce` `.deb` 下载地址。

### 三、使用 aria2 多线程下载

### 【gitlab01】

```bash
cd /tmp
```

```bash
aria2c \
  --continue=true \
  --max-connection-per-server=16 \
  --split=16 \
  --min-split-size=10M \
  --file-allocation=none \
  --out="gitlab-ce_${GITLAB_PACKAGE_VERSION}_amd64.deb" \
  "$GITLAB_DEB_URL"
```

如果 16 个连接没有明显提速，可以改为 8 个连接继续下载：

```bash
aria2c \
  --continue=true \
  --max-connection-per-server=8 \
  --split=8 \
  --min-split-size=10M \
  --file-allocation=none \
  --out="gitlab-ce_${GITLAB_PACKAGE_VERSION}_amd64.deb" \
  "$GITLAB_DEB_URL"
```

`--continue=true` 支持断点续传，重复执行不会从头开始。

### 四、检查软件包

### 【gitlab01】

查看文件：

```bash
ls -lh \
  "/tmp/gitlab-ce_${GITLAB_PACKAGE_VERSION}_amd64.deb"
```

检查软件包信息：

```bash
dpkg-deb \
  --info \
  "/tmp/gitlab-ce_${GITLAB_PACKAGE_VERSION}_amd64.deb" \
  | grep -E \
    'Package:|Version:|Architecture:'
```

应看到类似：

```text
Package: gitlab-ce
Version: 19.2.0-ce.0
Architecture: amd64
```

确认版本一致：

```bash
echo "$GITLAB_PACKAGE_VERSION"
```

检查软件包是否可以完整读取：

```bash
dpkg-deb \
  --contents \
  "/tmp/gitlab-ce_${GITLAB_PACKAGE_VERSION}_amd64.deb" \
  >/dev/null
```

没有报错表示软件包结构完整。

### 五、安装本地 GitLab 软件包

### 【gitlab01】

使用 `dpkg -i` 明确安装本地文件：

```bash
sudo env \
  EXTERNAL_URL="https://gitlab.home.arpa" \
  dpkg -i \
  "/tmp/gitlab-ce_${GITLAB_PACKAGE_VERSION}_amd64.deb"
```

安装过程中不要按 `Ctrl+C` 中断。

安装成功时，末尾通常会出现：

```text
gitlab Reconfigured!
```

检查软件包状态：

```bash
dpkg -l \
  | grep '^ii.*gitlab-ce'
```

应显示类似：

```text
ii  gitlab-ce  19.2.0-ce.0  amd64
```

检查 GitLab 服务：

```bash
sudo gitlab-ctl status
```

如果 `dpkg` 提示缺少系统依赖，执行：

```bash
sudo apt-get -f install -y
```

然后再次执行：

```bash
sudo env \
  EXTERNAL_URL="https://gitlab.home.arpa" \
  dpkg -i \
  "/tmp/gitlab-ce_${GITLAB_PACKAGE_VERSION}_amd64.deb"
```

### 六、锁定 GitLab 版本

### 【gitlab01】

防止普通系统升级自动升级 GitLab：

```bash
sudo apt-mark hold \
  gitlab-ce
```

检查：

```bash
apt-mark showhold \
  | grep '^gitlab-ce$'
```

应输出：

```text
gitlab-ce
```

确认 GitLab 安装正常后，可以删除本地安装包：

```bash
rm -f \
  "/tmp/gitlab-ce_${GITLAB_PACKAGE_VERSION}_amd64.deb"
```

---

## 6.6 针对 4C9G 调整 GitLab 运行内存

本节只调整 GitLab 进程数量和内存阈值，不关闭 GitLab、KAS、Prometheus、Alertmanager 或 Exporter 等功能。

### 【gitlab01】

编辑：

```bash
sudo vim \
  /etc/gitlab/gitlab.rb
```

安装过程中已经根据 `EXTERNAL_URL` 自动生成：

```ruby
external_url 'https://gitlab.home.arpa'
```

如果该行已经存在，不要再添加一条双引号版本。

确认基础配置：

```ruby
external_url 'https://gitlab.home.arpa'

letsencrypt['enable'] = false

nginx['redirect_http_to_https'] = true

nginx['ssl_certificate'] =
  "/etc/gitlab/ssl/gitlab.home.arpa.crt"

nginx['ssl_certificate_key'] =
  "/etc/gitlab/ssl/gitlab.home.arpa.key"

gitlab_rails['time_zone'] =
  "Asia/Shanghai"

gitlab_rails['backup_keep_time'] =
  604800
```

增加适合 `4C9G` 的运行参数：

```ruby
# 固定两个 Puma Worker，避免自动创建过多 Web 进程。
puma['worker_processes'] = 2

# 单个 Puma Worker 达到约 1.3GB RSS 后自动重启。
puma['per_worker_max_memory_mb'] = 1300

# 降低后台任务并发，保留完整 Sidekiq 功能。
sidekiq['concurrency'] = 10

# 让 Ruby 进程更快归还空闲内存。
gitlab_rails['env'] = {
  'MALLOC_CONF' =>
    'dirty_decay_ms:1000,muzzy_decay_ms:1000'
}

# 限制 Gitaly 同时派生的 Git 子进程数量。
gitaly['env'] = {
  'MALLOC_CONF' =>
    'dirty_decay_ms:1000,muzzy_decay_ms:1000',

  'GITALY_COMMAND_SPAWN_MAX_PARALLEL' =>
    '2'
}
```

应用配置：

```bash
sudo gitlab-ctl reconfigure
```

该过程可能需要几分钟，不要中途终止。

检查服务：

```bash
sudo gitlab-ctl status
```

所有组件均应显示：

```text
run:
```

精确检查 SSH、HTTP 和 HTTPS 端口：

```bash
sudo ss -lntp \
  | grep -E ':(22|80|443)[[:space:]]'
```

检查内存：

```bash
free -h
```

查看占用较高的进程：

```bash
ps -eo \
  pid,comm,rss,%mem \
  --sort=-rss \
  | head -n 20
```

如果运行一段时间后频繁出现 OOM，可以把：

```ruby
sidekiq['concurrency'] = 10
```

调整为：

```ruby
sidekiq['concurrency'] = 5
```

然后重新执行：

```bash
sudo gitlab-ctl reconfigure
```

---

## 6.7 首次登录

### 【gitlab01】

查看初始 root 密码：

```bash
sudo cat \
  /etc/gitlab/initial_root_password
```

### 【管理 Mac 浏览器】

访问：

```text
https://gitlab.home.arpa
```

用户名：

```text
root
```

使用初始密码登录后：

```text
1. 修改 root 密码
2. 修改 root 邮箱
3. 创建普通管理员账号
4. 确认公开注册已关闭
5. 为管理员账号开启两步验证
```

日常管理不建议一直使用 root 账号。

---

## 6.8 创建 Group 和项目

### 【GitLab 网页】

创建顶级 Group：

```text
platform
```

创建三个 `Private` 项目，并勾选初始化 README：

```text
platform/demo-api
platform/demo-gitops
platform/ci-images
```

默认分支统一为：

```text
main
```

用途：

|项目|作用|
|---|---|
|demo-api|业务代码、Dockerfile、单元测试和业务 CI|
|demo-gitops|Helm Chart、环境配置、Argo CD Application 和 GitOps 校验 CI|
|ci-images|保存自定义 CI 镜像 Dockerfile、Runner 脚本和 systemd 单元模板|

`ci-images` 项目不保存 CA 私钥、Robot Token、GitLab Token 或 Restic Repository 密码。

---

## 6.9 配置管理 Mac 的 GitLab SSH

### 一、生成 SSH 密钥

### 【管理 Mac】

```bash
test -f "$HOME/.ssh/id_ed25519_gitlab" \
  || ssh-keygen \
    -t ed25519 \
    -f "$HOME/.ssh/id_ed25519_gitlab" \
    -C "h@gitlab.home.arpa"
```

### 二、把公钥添加到 GitLab

### 【管理 Mac】

复制公钥：

```bash
pbcopy < \
  "$HOME/.ssh/id_ed25519_gitlab.pub"
```

### 【GitLab 网页】

登录：

```text
https://gitlab.home.arpa
```

进入：

```text
右上角头像
→ Edit profile
→ Access
→ SSH keys
→ Add new key
```

填写：

```text
Key：粘贴刚才复制的公钥
Title：HdeMac-mini
Usage type：Authentication & Signing
```

点击：

```text
Add key
```

### 三、配置 SSH

### 【管理 Mac】

先删除教程此前可能写入的 GitLab SSH 配置块：

```bash
touch "$HOME/.ssh/config"

sed -i '' \
  '/# BEGIN GITLAB SSH/,/# END GITLAB SSH/d' \
  "$HOME/.ssh/config"
```

追加配置：

```bash
cat >> "$HOME/.ssh/config" <<'EOF'

# BEGIN GITLAB SSH
Host gitlab.home.arpa
    HostName gitlab.home.arpa
    User git
    IdentityFile ~/.ssh/id_ed25519_gitlab
    IdentitiesOnly yes
    AddKeysToAgent yes
    UseKeychain yes
# END GITLAB SSH
EOF
```

设置权限：

```bash
chmod 600 \
  "$HOME/.ssh/config"
```

将私钥加入 macOS 钥匙串：

```bash
ssh-add \
  --apple-use-keychain \
  "$HOME/.ssh/id_ed25519_gitlab"
```

### 四、验证

### 【管理 Mac】

```bash
ssh -T \
  git@gitlab.home.arpa
```

成功时应看到：

```text
Welcome to GitLab, <GitLab用户名>!
```

GitLab SSH 固定使用：

```text
git
```

不是 Ubuntu 登录用户 `ys`。

---

## 6.10 配置分支保护

### 一、保护 demo-api 的 main 分支

### 【GitLab 网页】

进入：

```text
platform
→ demo-api
→ Settings
→ Repository
→ Branch rules
```

找到 `main` 分支，点击：

```text
View details
```

设置：

```text
Allowed to merge：
Maintainers

Allowed to push and merge：
No one
```

进入：

```text
platform
→ demo-api
→ Settings
→ Merge requests
→ Merge checks
```

开启：

```text
Pipelines must succeed
```

最终效果：

```text
功能分支通过 Merge Request 合并
Pipeline 成功后才允许合并
人工账号不能直接 Push main
```

### 二、创建并保护 demo-gitops 的 dev 分支

开发环境与生产配置使用不同分支：

```text
dev：
GitOps Bot 可以更新开发环境镜像
demo-dev Application 读取 dev

main：
保存经过 Merge Request 审核的基础配置和未来生产配置
禁止直接 Push
App of Apps 根 Application 读取 main
```

### 【GitLab 网页】

进入：

```text
platform
→ demo-gitops
→ Code
→ Branches
→ New branch
```

创建：

```text
Branch name：dev
Create from：main
```

然后进入：

```text
Settings
→ Repository
→ Branch rules
```

设置 `main`：

```text
Allowed to merge：
Maintainers

Allowed to push and merge：
No one
```

设置 `dev`：

```text
Allowed to merge：
Maintainers

Allowed to push and merge：
Maintainers
```

进入：

```text
Settings
→ Merge requests
→ Merge checks
```

开启：

```text
Pipelines must succeed
```

GitOps Bot 后续只直接 Push `dev`，不直接 Push `main`。

### 三、保护 ci-images 的 main 分支

### 【GitLab 网页】

进入：

```text
platform
→ ci-images
→ Settings
→ Repository
→ Branch rules
```

设置：

```text
Allowed to merge：
Maintainers

Allowed to push and merge：
No one
```

开启：

```text
Pipelines must succeed
```

自定义 CI 镜像、Trivy 更新脚本、systemd 单元和 Runner 模板必须通过 Merge Request 审核。

### 四、最终效果

```text
demo-api/main：
只允许 Merge Request 合并
必须通过 Pipeline

demo-gitops/dev：
GitOps Bot 可以自动更新 values-dev.yaml
Argo CD 开发 Application 读取 dev

demo-gitops/main：
禁止直接 Push
保存基础配置和未来生产配置
通过 Merge Request 修改

ci-images/main：
禁止直接 Push
自定义 CI 工具链必须经过 Merge Request
```

---

## 6.11 GitLab 资源检查

### 【gitlab01】

检查内存和磁盘：

```bash
free -h

df -h
```

查看 GitLab 服务：

```bash
sudo gitlab-ctl status
```

查看实时日志：

```bash
sudo gitlab-ctl tail
```

检查是否发生 OOM：

```bash
sudo journalctl \
  -k \
  | grep -i oom \
  || true
```

当前 `4C9G` 配置用于个人学习和低并发项目可以正常运行。如果经常出现 OOM、页面长时间无响应或后台任务明显积压，应优先扩展到：

```text
6C12G
```
---

# 第四阶段：安装 GitLab Runner

## 7.1 Runner 部署信息

```text
主机：runner01
IP：192.168.2.242
配置：4C6G
Executor：Docker
最大并发：2
```

Runner 必须部署在 GitLab 之外的独立主机，Runner Authentication Token 使用 `glrt-` 前缀。

当前 `4C6G` 主机继续使用双并发配置。相较原 `2C4G`，CPU 和内存余量更充足，可以较稳定地同时执行两个测试、构建或扫描 Job；两个 Docker Build 或 Trivy Job 同时运行时仍应观察磁盘 I/O、Docker 缓存和内存峰值，不建议继续提高并发。

---

## 7.2 安装 Docker Engine

### 【runner01】

删除冲突软件包：

```bash
sudo apt-get remove -y \
  docker.io \
  docker-doc \
  docker-compose \
  docker-compose-v2 \
  podman-docker \
  containerd \
  runc \
  || true
```

配置仓库：

```bash
sudo install -m 0755 -d \
  /etc/apt/keyrings
```

```bash
sudo curl -fsSL \
  https://download.docker.com/linux/ubuntu/gpg \
  -o /etc/apt/keyrings/docker.asc
```

```bash
sudo chmod a+r \
  /etc/apt/keyrings/docker.asc
```

```bash
sudo tee \
  /etc/apt/sources.list.d/docker.sources \
  >/dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
```

安装：

```bash
sudo apt-get update
```

```bash
sudo apt-get install -y \
  docker-ce \
  docker-ce-cli \
  containerd.io \
  docker-buildx-plugin \
  docker-compose-plugin
```

启动：

```bash
sudo systemctl enable --now docker
```

---

## 7.3 配置 Docker 日志轮转

### 【runner01】

```bash
sudo mkdir -p /etc/docker
```

```bash
sudo tee \
  /etc/docker/daemon.json \
  >/dev/null <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "100m",
    "max-file": "3"
  }
}
EOF
```

检查：

```bash
python3 -m json.tool \
  /etc/docker/daemon.json
```

重启：

```bash
sudo systemctl restart docker
```

---

## 7.4 Runner 信任 Harbor CA

Runner 访问 Harbor 涉及三层 TLS 信任：

```text
runner01 Ubuntu 系统
runner01 Docker Engine / BuildKit
GitLab CI Job 容器
```

Harbor 使用默认 HTTPS 端口 `443`，因此 Docker Registry 证书目录使用：

```text
/etc/docker/certs.d/harbor.home.arpa
```

不要写成：

```text
/etc/docker/certs.d/harbor.home.arpa:443
```

### 【runner01】

从 Harbor 复制当前根 CA：

```bash
scp \
  ys@192.168.2.211:/opt/harbor/certs/ca.crt \
  /tmp/harbor-ca.crt
```

检查证书：

```bash
openssl x509 \
  -in /tmp/harbor-ca.crt \
  -noout \
  -subject \
  -issuer \
  -dates \
  -fingerprint \
  -sha256
```

安装到 Ubuntu 系统信任库：

```bash
sudo install \
  -o root \
  -g root \
  -m 0644 \
  /tmp/harbor-ca.crt \
  /usr/local/share/ca-certificates/harbor-ca.crt
```

安装到 Docker Registry 专用证书目录：

```bash
sudo install \
  -d \
  -o root \
  -g root \
  -m 0755 \
  /etc/docker/certs.d/harbor.home.arpa
```

```bash
sudo install \
  -o root \
  -g root \
  -m 0644 \
  /tmp/harbor-ca.crt \
  /etc/docker/certs.d/harbor.home.arpa/ca.crt
```

更新系统证书：

```bash
sudo update-ca-certificates
```

出现：

```text
0 added, 0 removed
```

不表示失败，只表示系统信任库中已经存在相同证书。

重启 Docker：

```bash
sudo systemctl restart \
  docker
```

检查：

```bash
sudo systemctl is-active \
  docker
```

应返回：

```text
active
```

验证 Harbor 服务器证书：

```bash
echo \
  | openssl s_client \
      -connect harbor.home.arpa:443 \
      -servername harbor.home.arpa \
      -CAfile /tmp/harbor-ca.crt \
      2>/dev/null \
  | grep \
      'Verify return code'
```

应返回：

```text
Verify return code: 0 (ok)
```

验证 Registry：

```bash
curl \
  --cacert /tmp/harbor-ca.crt \
  -sS \
  -o /dev/null \
  -w 'HTTP %{http_code}\n' \
  https://harbor.home.arpa/v2/
```

返回：

```text
HTTP 200
```

或：

```text
HTTP 401
```

都说明 DNS、网络和 TLS 正常。`401` 只表示当前请求没有提供 Registry 登录凭据。

验证 Docker Engine 可以拉取 Harbor 基础镜像：

```bash
sudo docker pull \
  harbor.home.arpa/ci-tools/node:24.18.0-alpine3.24
```

删除临时文件：

```bash
rm -f \
  /tmp/harbor-ca.crt
```

---

## 7.5 安装 GitLab Runner

GitLab Runner 安装时会同时下载：

```text
gitlab-runner
gitlab-runner-helper-images
```

其中 `gitlab-runner-helper-images` 体积较大，直接通过 APT 下载可能非常慢。本节使用 `aria2` 下载官方 `.deb` 文件，再通过 `dpkg` 本地安装。

### 一、添加 GitLab Runner 官方仓库

### 【runner01】

```bash
curl -fsSL \
  https://packages.gitlab.com/install/repositories/runner/gitlab-runner/script.deb.sh \
  -o /tmp/gitlab-runner-repository.sh
```

```bash
sudo bash \
  /tmp/gitlab-runner-repository.sh
```

```bash
sudo apt-get update
```

### 二、确定安装版本

固定本教程使用的 GitLab Runner 软件包版本：

```bash
GITLAB_RUNNER_VERSION="19.2.0-1"
```

确认官方仓库中存在该版本：

```bash
apt-cache madison gitlab-runner \
  | awk '{print $3}' \
  | grep -Fx \
    "$GITLAB_RUNNER_VERSION"
```

检查：

```bash
echo "$GITLAB_RUNNER_VERSION"

test -n "$GITLAB_RUNNER_VERSION"
```

应输出：

```text
19.2.0-1
```

### 三、获取官方软件包地址

```bash
APT_URIS="$(
  apt-get \
    --print-uris \
    --yes \
    --download-only \
    install \
    "gitlab-runner=${GITLAB_RUNNER_VERSION}" \
    "gitlab-runner-helper-images=${GITLAB_RUNNER_VERSION}"
)"
```

提取两个软件包地址：

```bash
RUNNER_DEB_URL="$(
  printf '%s\n' "$APT_URIS" \
    | awk -F"'" \
      '/gitlab-runner_[^/]*_amd64\.deb/ {
        print $2
        exit
      }'
)"
```

```bash
HELPER_DEB_URL="$(
  printf '%s\n' "$APT_URIS" \
    | awk -F"'" \
      '/gitlab-runner-helper-images_[^/]*_all\.deb/ {
        print $2
        exit
      }'
)"
```

检查：

```bash
printf 'Runner:\n%s\n\nHelper Images:\n%s\n' \
  "$RUNNER_DEB_URL" \
  "$HELPER_DEB_URL"

test -n "$RUNNER_DEB_URL"
test -n "$HELPER_DEB_URL"
```

### 四、使用 aria2 下载

安装 `aria2`：

```bash
sudo apt-get install -y \
  aria2
```

进入临时目录：

```bash
cd /tmp
```

下载 Helper Images：

```bash
aria2c \
  --continue=true \
  --max-connection-per-server=16 \
  --split=16 \
  --min-split-size=10M \
  --file-allocation=none \
  --out="gitlab-runner-helper-images_${GITLAB_RUNNER_VERSION}_all.deb" \
  "$HELPER_DEB_URL"
```

下载 GitLab Runner：

```bash
aria2c \
  --continue=true \
  --max-connection-per-server=16 \
  --split=16 \
  --min-split-size=2M \
  --file-allocation=none \
  --out="gitlab-runner_${GITLAB_RUNNER_VERSION}_amd64.deb" \
  "$RUNNER_DEB_URL"
```

如果 16 个连接没有明显提速，可以把：

```text
--max-connection-per-server=16
--split=16
```

改成：

```text
--max-connection-per-server=8
--split=8
```

`--continue=true` 支持断点续传。

### 五、检查软件包

```bash
ls -lh \
  "/tmp/gitlab-runner_${GITLAB_RUNNER_VERSION}_amd64.deb" \
  "/tmp/gitlab-runner-helper-images_${GITLAB_RUNNER_VERSION}_all.deb"
```

检查软件包信息：

```bash
dpkg-deb \
  --info \
  "/tmp/gitlab-runner_${GITLAB_RUNNER_VERSION}_amd64.deb" \
  | grep -E \
    'Package:|Version:|Architecture:'
```

```bash
dpkg-deb \
  --info \
  "/tmp/gitlab-runner-helper-images_${GITLAB_RUNNER_VERSION}_all.deb" \
  | grep -E \
    'Package:|Version:|Architecture:'
```

检查软件包是否可以完整读取：

```bash
dpkg-deb \
  --contents \
  "/tmp/gitlab-runner_${GITLAB_RUNNER_VERSION}_amd64.deb" \
  >/dev/null
```

```bash
dpkg-deb \
  --contents \
  "/tmp/gitlab-runner-helper-images_${GITLAB_RUNNER_VERSION}_all.deb" \
  >/dev/null
```

### 六、本地安装 GitLab Runner

先安装 Helper Images：

```bash
sudo dpkg -i \
  "/tmp/gitlab-runner-helper-images_${GITLAB_RUNNER_VERSION}_all.deb"
```

再安装 GitLab Runner：

```bash
sudo dpkg -i \
  "/tmp/gitlab-runner_${GITLAB_RUNNER_VERSION}_amd64.deb"
```

如果提示缺少系统依赖：

```bash
sudo apt-get -f install -y
```

然后重新执行上面的两个 `dpkg -i` 命令。

### 七、配置 Docker 权限并启动 Runner

将 `gitlab-runner` 用户加入 Docker 用户组：

```bash
sudo usermod -aG docker \
  gitlab-runner
```

启动并设置开机自启：

```bash
sudo systemctl enable --now \
  gitlab-runner
```

检查服务：

```bash
sudo systemctl status \
  gitlab-runner \
  --no-pager
```

检查版本：

```bash
gitlab-runner --version
```

### 八、锁定版本

```bash
sudo apt-mark hold \
  gitlab-runner \
  gitlab-runner-helper-images
```

检查：

```bash
apt-mark showhold \
  | grep '^gitlab-runner'
```

确认安装正常后，可以删除本地安装包：

```bash
rm -f \
  "/tmp/gitlab-runner_${GITLAB_RUNNER_VERSION}_amd64.deb" \
  "/tmp/gitlab-runner-helper-images_${GITLAB_RUNNER_VERSION}_all.deb"
```
---

## 7.6 创建 Group Runner

Group Runner 可以供 `platform` Group 下的所有项目使用，例如：

```text
platform/demo-api
platform/demo-gitops
```

### 一、进入 platform Group

### 【GitLab 网页】

登录：

```text
https://gitlab.home.arpa
```

点击页面顶部：

```text
Search or go to
```

搜索：

```text
platform
```

在搜索结果中点击类型为 `Group` 的：

```text
platform
```

也可以直接访问：

```text
https://gitlab.home.arpa/groups/platform
```

### 二、进入 Runner 页面

进入 `platform` Group 后，在左侧菜单点击：

```text
Build
→ Runners
```

然后点击：

```text
Create group runner
```

如果左侧没有看到 `Build`，可以展开左侧菜单，或者直接访问：

```text
https://gitlab.home.arpa/groups/platform/-/runners
```

### 三、填写 Runner 配置

```text
Description：runner01-docker
Tags：docker,private
Run untagged jobs：关闭
Protected：关闭
```

本教程需要让普通 `feature/*` 分支和 Merge Request Pipeline 运行 `test` Job，因此该 Runner 的 `Protected` 必须关闭。

安全边界由以下措施保证：

```text
Runner 只绑定 platform 私有 Group
只允许可信成员创建和修改 Pipeline
秘密变量保持 Protected
SonarQube、构建、Harbor Push 和 GitOps 更新只在 main 运行
不允许外部 Fork 使用该 Runner
```

创建后复制：

```text
glrt-xxxxxxxxxxxxxxxx
```

旧的 Runner Registration Token 已弃用，后续应使用 Runner Authentication Token。

---

## 7.7 注册 Runner

### 【runner01】

```bash
sudo gitlab-runner register \
  --non-interactive \
  --url "https://gitlab.home.arpa" \
  --token "glrt-xxxxxxxxxxxxxxxx" \
  --executor "docker" \
  --docker-image "alpine:3.22" \
  --description "runner01-docker"
```

---

## 7.8 配置 Runner 证书和缓存

Runner Job 需要使用：

```text
Platform Root CA
Harbor Root CA
SonarScanner PKCS#12 TrustStore
Trivy 持久化数据库缓存
```

### 一、复制 SonarScanner TrustStore

### 【管理电脑】

```bash
scp \
  "$HOME/platform-pki/sonar-truststore.p12" \
  ys@192.168.2.242:/tmp/sonar-truststore.p12
```

### 二、安装证书和 TrustStore

### 【runner01】

创建证书目录：

```bash
sudo install \
  -d \
  -o root \
  -g root \
  -m 0755 \
  /etc/gitlab-runner/certs
```

创建 Trivy 缓存目录：

```bash
sudo install \
  -d \
  -o gitlab-runner \
  -g gitlab-runner \
  -m 0755 \
  /var/lib/gitlab-runner/trivy-cache
```

安装 GitLab Runner 连接 GitLab 时使用的 CA：

```bash
sudo install \
  -o root \
  -g root \
  -m 0644 \
  /usr/local/share/ca-certificates/platform-root-ca.crt \
  /etc/gitlab-runner/certs/gitlab.home.arpa.crt
```

安装供 Job 容器使用的 Platform Root CA：

```bash
sudo install \
  -o root \
  -g root \
  -m 0644 \
  /usr/local/share/ca-certificates/platform-root-ca.crt \
  /etc/gitlab-runner/certs/platform-root-ca.crt
```

安装供 Job 容器使用的 Harbor CA：

```bash
sudo install \
  -o root \
  -g root \
  -m 0644 \
  /usr/local/share/ca-certificates/harbor-ca.crt \
  /etc/gitlab-runner/certs/harbor-ca.crt
```

安装 SonarScanner TrustStore：

```bash
sudo install \
  -o root \
  -g root \
  -m 0644 \
  /tmp/sonar-truststore.p12 \
  /etc/gitlab-runner/certs/sonar-truststore.p12
```

清理临时文件：

```bash
rm -f \
  /tmp/sonar-truststore.p12
```

检查：

```bash
sudo ls -l \
  /etc/gitlab-runner/certs/gitlab.home.arpa.crt \
  /etc/gitlab-runner/certs/platform-root-ca.crt \
  /etc/gitlab-runner/certs/harbor-ca.crt \
  /etc/gitlab-runner/certs/sonar-truststore.p12
```

检查三张 PEM CA：

```bash
for FILE in \
  /etc/gitlab-runner/certs/gitlab.home.arpa.crt \
  /etc/gitlab-runner/certs/platform-root-ca.crt \
  /etc/gitlab-runner/certs/harbor-ca.crt
do
  echo "===== ${FILE} ====="

  sudo openssl x509 \
    -in "$FILE" \
    -noout \
    -subject \
    -issuer \
    -fingerprint \
    -sha256
done
```

检查 TrustStore：

```bash
sudo openssl pkcs12 \
  -in /etc/gitlab-runner/certs/sonar-truststore.p12 \
  -passin pass:changeit \
  -nokeys \
  -info
```

能够看到：

```text
HomeLab Platform Root CA
```

说明 TrustStore 内容正确。

---

## 7.9 修改 config.toml

Runner 宿主机的 `/etc/hosts` 不会自动成为 Docker Job 和 Helper 容器的 `/etc/hosts`。

因此必须使用：

```toml
extra_hosts
```

向 Runner 创建的容器写入 GitLab、SonarQube 和 Harbor 的内部域名。

### 【runner01】

本教程不使用 GitLab Runner Web Terminal，因此不配置 `[session_server]`。

编辑：

```bash
sudo vim \
  /etc/gitlab-runner/config.toml
```

调整为：

```toml
concurrent = 2
check_interval = 0
shutdown_timeout = 0

[[runners]]
  name = "runner01-docker"
  url = "https://gitlab.home.arpa"
  token = "glrt-xxxxxxxxxxxxxxxx"
  executor = "docker"
  limit = 2
  request_concurrency = 2

  [runners.docker]
    tls_verify = false
    image = "harbor.home.arpa/ci-tools/alpine:3.22"
    privileged = false
    disable_entrypoint_overwrite = false
    oom_kill_disable = false
    disable_cache = false
    pull_policy = "if-not-present"
    shm_size = 0

    extra_hosts = [
      "gitlab.home.arpa:192.168.2.241",
      "sonarqube.home.arpa:192.168.2.243",
      "harbor.home.arpa:192.168.2.211"
    ]

    allowed_images = [
      "harbor.home.arpa/ci-tools/*:*"
    ]

    volumes = [
      "/var/run/docker.sock:/var/run/docker.sock",
      "/cache",
      "/etc/gitlab-runner/certs/platform-root-ca.crt:/usr/local/share/ca-certificates/platform-root-ca.crt:ro",
      "/etc/gitlab-runner/certs/harbor-ca.crt:/usr/local/share/ca-certificates/harbor-ca.crt:ro",
      "/etc/gitlab-runner/certs/sonar-truststore.p12:/opt/sonar-truststore/truststore.p12:ro",
      "/var/lib/gitlab-runner/trivy-cache:/var/lib/gitlab-runner/trivy-cache"
    ]
```

其中：

```text
concurrent = 2
```

限制整个 Runner 服务最多同时执行两个 Job。

```text
limit = 2
```

限制当前注册 Runner 最多同时执行两个 Job。

```text
request_concurrency = 2
```

允许同时发起两个获取任务的请求。

检查关键配置：

```bash
sudo grep -nE \
  'concurrent|limit|request_concurrency|extra_hosts|gitlab.home.arpa|sonarqube.home.arpa|harbor.home.arpa' \
  /etc/gitlab-runner/config.toml
```

重启：

```bash
sudo systemctl restart \
  gitlab-runner
```

验证：

```bash
sudo gitlab-runner verify
```

检查服务：

```bash
sudo systemctl status \
  gitlab-runner \
  --no-pager
```

查看完整日志：

```bash
sudo journalctl \
  -u gitlab-runner \
  -n 100 \
  --no-pager \
  -l
```

应看到 Runner 验证成功，运行日志中应包含：

```text
max_builds=2
```

---

## 7.10 Docker Socket 风险

本教程将：

```text
/var/run/docker.sock
```

挂载到 Job 容器。

这意味着可信 Pipeline 可以控制 Runner 主机上的 Docker。因此：

```text
Runner 必须使用独立虚拟机
Runner 只能服务 platform 私有 Group 中的可信项目
Runner 的 Protected 关闭，仅用于支持可信功能分支和 MR 测试
不要允许不可信成员修改 .gitlab-ci.yml
不要让外部 Fork 使用该 Runner
Runner 主机不运行其他重要业务
秘密变量只提供给 Protected 分支
```

---

# 第五阶段：部署 SonarQube

## 8.1 SonarQube 部署信息

```text
主机：sonarqube01
IP：192.168.2.243
配置：4C6G
域名：sonarqube.home.arpa
运行方式：Docker Compose
数据库：PostgreSQL 17
```

---

## 8.2 安装 Docker

### 【sonarqube01】

在 `sonarqube01` 按第 7.2～7.3 节安装 Docker Engine，然后执行：

```bash
sudo usermod -aG docker \
  ys
```

重新登录 `sonarqube01` 后检查：

```bash
docker version
docker compose version
```

---

## 8.3 配置应急 Swap

### 【sonarqube01】

SonarQube 与 PostgreSQL 共用 6GB 内存，继续保留 4GB 低优先级 Swap 作为异常峰值下的 OOM 兜底：

```bash
if [[ ! -f /swapfile ]]; then
  sudo fallocate \
    -l 4G \
    /swapfile

  sudo chmod 600 \
    /swapfile

  sudo mkswap \
    /swapfile
fi

sudo swapon \
  /swapfile \
  2>/dev/null \
  || true

grep -q '^/swapfile ' \
  /etc/fstab \
  || echo '/swapfile none swap sw 0 0' \
    | sudo tee -a /etc/fstab

sudo tee \
  /etc/sysctl.d/98-swap.conf \
  >/dev/null <<'EOF'
vm.swappiness=10
EOF

sudo sysctl --system
```

Swap 只用于应急，不替代内存。

---

## 8.4 配置 Elasticsearch 系统参数

### 【sonarqube01】

```bash
sudo tee \
  /etc/sysctl.d/99-sonarqube.conf \
  >/dev/null <<'EOF'
vm.max_map_count=524288
fs.file-max=131072
EOF
```

应用：

```bash
sudo sysctl --system
```

检查：

```bash
sysctl vm.max_map_count
sysctl fs.file-max
```

SonarQube 官方要求 `vm.max_map_count` 至少为 524288、`fs.file-max` 至少为 131072，同时运行用户需支持至少 131072 个文件描述符和 8192 个线程。

---

## 8.5 创建目录和密码

### 【sonarqube01】

```bash
sudo mkdir -p \
  /opt/sonarqube
```

```bash
sudo chown \
  "$USER":"$USER" \
  /opt/sonarqube
```

```bash
cd /opt/sonarqube
```

生成数据库密码：

```bash
SONAR_DB_PASSWORD="$(
  openssl rand -hex 32
)"
```

生成 JWT Secret：

```bash
SONAR_JWT_SECRET="$(
  openssl rand -base64 32 \
    | tr -d '\n'
)"
```

写入：

```bash
cat > .env <<EOF
SONAR_DB_PASSWORD=${SONAR_DB_PASSWORD}
SONAR_JWT_SECRET=${SONAR_JWT_SECRET}
EOF
```

```bash
chmod 600 .env
```

---

## 8.6 创建 Docker Compose

### 【sonarqube01】

```bash
cat > compose.yaml <<'EOF'
services:
  db:
    image: postgres:17-alpine
    container_name: sonarqube-db
    restart: unless-stopped

    environment:
      POSTGRES_DB: sonarqube
      POSTGRES_USER: sonarqube
      POSTGRES_PASSWORD: "${SONAR_DB_PASSWORD}"

    volumes:
      - postgres_data:/var/lib/postgresql/data

    healthcheck:
      test:
        - CMD-SHELL
        - pg_isready -U sonarqube -d sonarqube
      interval: 10s
      timeout: 5s
      retries: 20

  sonarqube:
    image: sonarqube:26.7.0.124771-community
    container_name: sonarqube
    restart: unless-stopped

    depends_on:
      db:
        condition: service_healthy

    environment:
      SONAR_JDBC_URL: jdbc:postgresql://db:5432/sonarqube
      SONAR_JDBC_USERNAME: sonarqube
      SONAR_JDBC_PASSWORD: "${SONAR_DB_PASSWORD}"
      SONAR_AUTH_JWTBASE64HS256SECRET: "${SONAR_JWT_SECRET}"

      SONAR_WEB_JAVAADDITIONALOPTS: "-Xms256m -Xmx768m"
      SONAR_CE_JAVAADDITIONALOPTS: "-Xms256m -Xmx768m"
      SONAR_SEARCH_JAVAADDITIONALOPTS: "-Xms512m -Xmx1024m"

    ports:
      - "127.0.0.1:9000:9000"

    ulimits:
      nofile:
        soft: 131072
        hard: 131072
      nproc: 8192

    volumes:
      - sonarqube_data:/opt/sonarqube/data
      - sonarqube_extensions:/opt/sonarqube/extensions
      - sonarqube_logs:/opt/sonarqube/logs
      - sonarqube_temp:/opt/sonarqube/temp

volumes:
  postgres_data:
  sonarqube_data:
  sonarqube_extensions:
  sonarqube_logs:
  sonarqube_temp:
EOF
```

当前 `4C6G` 配置为 SonarQube JVM 设置的最大堆内存约为：

```text
Web：768MB
Compute Engine：768MB
Search：1024MB
```

其余内存留给 PostgreSQL、容器运行时、文件缓存和操作系统。

检查并启动：

```bash
docker compose config \
  --quiet

docker compose pull
docker compose up -d
```

查看状态：

```bash
docker compose ps

curl \
  http://127.0.0.1:9000/api/system/status
```

等待返回：

```json
{"status":"UP"}
```

---

## 8.7 配置 NGINX HTTPS

### 【sonarqube01】

```bash
sudo apt-get update
sudo apt-get install -y nginx
```

证书已由第 5.6 节安装到：

```text
/etc/nginx/ssl/sonarqube.home.arpa.crt
/etc/nginx/ssl/sonarqube.home.arpa.key
```

### 创建 SonarQube Nginx 反向代理配置

部分 zsh / Oh My Zsh 粘贴环境可能把以分号结尾的 URL 指令自动改写，例如：

```nginx
return 301 https://$host$request_uri\;
proxy_pass http://127.0.0.1:9000\;
```

因此对 `return` 和 `proxy_pass` 两条包含 URL 的指令都使用占位符，再通过 `sed` 替换为真实地址。

```bash
sudo tee \
  /etc/nginx/sites-available/sonarqube.conf \
  >/dev/null <<'EOF'
server {
    listen 80;
    listen [::]:80;

    server_name sonarqube.home.arpa;

    return 301 __SONARQUBE_REDIRECT__;
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;

    server_name sonarqube.home.arpa;

    ssl_certificate
        /etc/nginx/ssl/sonarqube.home.arpa.crt;

    ssl_certificate_key
        /etc/nginx/ssl/sonarqube.home.arpa.key;

    client_max_body_size 100m;

    location / {
        proxy_pass __SONARQUBE_BACKEND__;

        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;

        proxy_set_header X-Forwarded-For
            $proxy_add_x_forwarded_for;

        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Port $server_port;
        proxy_set_header X-Forwarded-Proto https;

        proxy_connect_timeout 10s;
        proxy_send_timeout 300s;
        proxy_read_timeout 300s;

        proxy_buffering off;
    }
}
EOF
```

将两个占位符替换为真实地址：

```bash
sudo sed -i \
  's#__SONARQUBE_REDIRECT__#https://$host$request_uri#' \
  /etc/nginx/sites-available/sonarqube.conf

sudo sed -i \
  's#__SONARQUBE_BACKEND__#http://127.0.0.1:9000#' \
  /etc/nginx/sites-available/sonarqube.conf
```

检查关键行：

```bash
sudo grep -nE \
  'return 301|proxy_pass' \
  /etc/nginx/sites-available/sonarqube.conf
```

必须输出：

```nginx
return 301 https://$host$request_uri;
proxy_pass http://127.0.0.1:9000;
```

检查整个文件中是否存在被错误转义的分号：

```bash
if sudo grep -nF \
  '\;' \
  /etc/nginx/sites-available/sonarqube.conf
then
  echo "检测到错误的反斜杠分号，请先修正"
  exit 1
fi
```

只有没有发现 `\;` 时，才能继续执行 `nginx -t`。

创建站点软链接：

```bash
sudo ln -sf \
  /etc/nginx/sites-available/sonarqube.conf \
  /etc/nginx/sites-enabled/sonarqube.conf
```

删除默认站点：

```bash
sudo rm -f \
  /etc/nginx/sites-enabled/default
```

检查配置：

```bash
sudo nginx -t
```

正常应显示：

```text
syntax is ok
test is successful
```

启动并重启 Nginx：

```bash
sudo systemctl enable --now nginx

sudo systemctl restart nginx
```

检查：

```bash
sudo systemctl status \
  nginx \
  --no-pager
```

验证：

```bash
curl -I \
  https://sonarqube.home.arpa
```

访问：

```text
https://sonarqube.home.arpa
```

首次使用默认账号 `admin/admin` 登录，并立即设置新的强密码。新密码保存到密码管理器，不要写入教程、聊天记录或 Git 仓库。

---

## 8.8 创建 SonarQube 项目

### 【管理 Mac 浏览器】

首次登录后设置：

```text
Administration
→ Configuration
→ General
→ Server base URL
→ https://sonarqube.home.arpa
```

创建项目：

```text
Project Key：demo-api
Display Name：demo-api
Main Branch：main
```

创建分析 Token：

```text
My Account
→ Security
→ Generate Token
→ demo-api-ci
```

保存生成的 Token。

本教程只在 `main` 分支执行 SonarQube 分析，Merge Request 阶段只执行单元测试。

---

# 第六阶段：配置 Harbor

## 9.1 验证现有 Harbor

Harbor 当前配置为：

```text
主机：harbor01
IP：192.168.2.211
域名：harbor.home.arpa
端口：443
版本：v2.15.2
安装目录：/opt/harbor
数据目录：/data
Trivy：已启用
```

### 【harbor01】

检查 Harbor 容器：

```bash
cd /opt/harbor

sudo docker compose ps
```

所有核心容器都应处于运行状态。

检查健康状态：

```bash
curl -fsS \
  https://harbor.home.arpa/api/v2.0/health \
  | jq
```

正常应看到：

```json
{
  "status": "healthy"
}
```

如果只查看总状态：

```bash
curl -fsS \
  https://harbor.home.arpa/api/v2.0/health \
  | jq -r '.status'
```

应返回：

```text
healthy
```

---

## 9.2 创建 Harbor 项目

项目在 Harbor 网页中创建，不是在命令行中创建。

### 一、登录 Harbor

### 【管理 Mac 浏览器】

访问：

```text
https://harbor.home.arpa
```

使用 Harbor 管理员账号登录：

```text
用户名：admin
密码：harbor.yml 中配置的 harbor_admin_password
```

### 二、创建 ci-tools 项目

### 【Harbor 网页】

进入：

```text
Projects
→ New Project
```

填写：

```text
Project Name：
ci-tools

Access Level：
Public
```

其他选项保持默认，然后点击：

```text
OK
```

该项目用于保存 CI 流程需要的公共工具镜像，例如：

```text
Node.js 基础镜像
Docker CLI
Alpine
Trivy
GitOps 专用镜像
```

设置为 `Public` 后，Runner 在执行 Job 前拉取这些镜像时，不需要先登录 Harbor。

### 三、创建 demo 项目

### 【Harbor 网页】

再次进入：

```text
Projects
→ New Project
```

填写：

```text
Project Name：
demo

Access Level：
Private
```

其他选项保持默认，然后点击：

```text
OK
```

该项目用于保存业务镜像，例如：

```text
demo-api
```

后续镜像地址类似：

```text
harbor.home.arpa/demo/demo-api:<版本标签>
```

由于 `demo` 是私有项目，GitLab CI 推送镜像时必须使用 Harbor 用户名和密码登录。

### 四、检查项目

### 【Harbor 网页】

返回：

```text
Projects
```

应看到：

```text
ci-tools    Public
demo        Private
```
---

## 9.3 同步 CI 基础镜像、版本化自定义工具并配置 Trivy DB

本节完成：

```text
同步公共 CI 基础镜像到 Harbor
把自定义 CI 工具链纳入 platform/ci-images
构建版本化 GitOps Job 镜像
验证 BuildKit 对 Harbor CA 的信任
预下载 Trivy 漏洞数据库
记录数据库最后成功更新时间
创建 Trivy DB 自动更新任务
```

自定义文件先进入 Git，再复制到 Runner 安装。不要只把 Dockerfile 和 systemd 文件保存在 `runner01` 的个人目录中。

### 一、在 ci-images 仓库中保存工具链

### 【管理 Mac】

进入工作目录：

```bash
mkdir -p \
  "$HOME/workspace/cicd-demo"

cd \
  "$HOME/workspace/cicd-demo"
```

克隆仓库：

```bash
git clone \
  git@gitlab.home.arpa:platform/ci-images.git

cd \
  "$HOME/workspace/cicd-demo/ci-images"
```

创建功能分支：

```bash
git switch \
  -c feature/initialize-ci-images
```

创建目录：

```bash
mkdir -p \
  gitops \
  runner \
  pki \
  backup
```

把前面已经使用的 PKI 和 hosts 分发脚本复制进仓库。这里只提交脚本，不提交任何 CA 私钥、服务私钥、证书包或密码文件：

```bash
cp \
  "$HOME/platform-pki/issue-platform-cert.sh" \
  "$HOME/platform-pki/distribute-platform-ca.sh" \
  "$HOME/platform-pki/distribute-service-certs.sh" \
  "$HOME/platform-pki/distribute-cicd-hosts.sh" \
  pki/
```

创建严格的忽略规则：

```bash
cat > .gitignore <<'EOF'
*.key
*.csr
*.crt
*.cer
*.pem
*.p12
*.pfx
*.srl
*.env
*password*
*token*
*.age
*.gpg
*.enc
.DS_Store
EOF
```

检查没有私钥被加入工作区：

```bash
if find . \
  -path './.git' \
  -prune \
  -o \
  -type f \
  \( \
    -name '*.key' \
    -o -name '*.p12' \
    -o -name '*.env' \
  \) \
  -print \
  | grep -q .
then
  echo "错误：ci-images 工作区中检测到私钥、TrustStore 或环境文件"
  exit 1
fi
```

`backup/` 目录先保留，完成第十七阶段后再把最终运行过的备份脚本和 systemd 单元同步回来。

创建版本化 GitOps Job 镜像：

```bash
cat > gitops/Dockerfile <<'EOF'
FROM harbor.home.arpa/ci-tools/alpine:3.22

RUN printf '%s\n' \
      'https://mirrors.tuna.tsinghua.edu.cn/alpine/v3.22/main' \
      'https://mirrors.tuna.tsinghua.edu.cn/alpine/v3.22/community' \
      > /etc/apk/repositories \
    && apk add \
      --no-cache \
      ca-certificates \
      git \
    && update-ca-certificates \
    && git --version

CMD ["/bin/sh"]
EOF
```

创建 Trivy DB 更新脚本：

```bash
cat > runner/update-trivy-db.sh <<'EOF'
#!/usr/bin/env bash

set -Eeuo pipefail

CACHE_DIR="/var/lib/gitlab-runner/trivy-cache"
TRIVY_IMAGE="harbor.home.arpa/ci-tools/trivy:0.72.0"

DB_REPOSITORIES=(
  "public.ecr.aws/aquasecurity/trivy-db:2"
  "ghcr.io/aquasecurity/trivy-db:2"
  "docker.io/aquasec/trivy-db:2"
)

install -d \
  -o gitlab-runner \
  -g gitlab-runner \
  -m 0755 \
  "$CACHE_DIR"

SUCCESS=0

for REPOSITORY in "${DB_REPOSITORIES[@]}"
do
  echo "尝试从 ${REPOSITORY} 更新 Trivy DB"

  if docker run \
    --rm \
    --volume \
    "${CACHE_DIR}:/root/.cache/trivy" \
    "$TRIVY_IMAGE" \
    image \
    --cache-dir \
    /root/.cache/trivy \
    --db-repository \
    "$REPOSITORY" \
    --download-db-only
  then
    SUCCESS=1
    break
  fi
done

if [[ "$SUCCESS" -ne 1 ]]; then
  echo "所有 Trivy DB Repository 均更新失败"
  exit 1
fi

test -s \
  "${CACHE_DIR}/db/trivy.db"

test -s \
  "${CACHE_DIR}/db/metadata.json"

date -u +%s \
  > "${CACHE_DIR}/last-successful-update"

chown -R \
  gitlab-runner:gitlab-runner \
  "$CACHE_DIR"

chmod -R \
  u+rwX,go+rX \
  "$CACHE_DIR"

chmod 0644 \
  "${CACHE_DIR}/last-successful-update"

echo "Trivy vulnerability DB updated successfully"
EOF
```

创建 Service：

```bash
cat > runner/update-trivy-db.service <<'EOF'
[Unit]
Description=Update Trivy vulnerability database
After=network-online.target docker.service
Wants=network-online.target
Requires=docker.service

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/update-trivy-db.sh
Nice=10
IOSchedulingClass=best-effort
IOSchedulingPriority=7
EOF
```

创建 Timer：

```bash
cat > runner/update-trivy-db.timer <<'EOF'
[Unit]
Description=Daily Trivy vulnerability database update

[Timer]
OnCalendar=*-*-* 02:30:00
Persistent=true
RandomizedDelaySec=15m
Unit=update-trivy-db.service

[Install]
WantedBy=timers.target
EOF
```

创建 Runner 配置模板。真实 Token 不得提交：

```bash
cat > runner/config.toml.example <<'EOF'
concurrent = 2
check_interval = 0
shutdown_timeout = 0

[[runners]]
  name = "runner01-docker"
  url = "https://gitlab.home.arpa"
  token = "REPLACE_WITH_RUNNER_AUTHENTICATION_TOKEN"
  executor = "docker"
  limit = 2
  request_concurrency = 2

  [runners.docker]
    image = "harbor.home.arpa/ci-tools/alpine:3.22"
    privileged = false
    pull_policy = "if-not-present"

    extra_hosts = [
      "gitlab.home.arpa:192.168.2.241",
      "sonarqube.home.arpa:192.168.2.243",
      "harbor.home.arpa:192.168.2.211"
    ]
EOF
```

创建说明：

```bash
cat > README.md <<'EOF'
# CI Images and Platform Automation

本仓库保存：

- GitOps Job 自定义镜像 Dockerfile
- Runner Trivy DB 更新脚本
- Runner systemd Service 和 Timer
- 不含真实 Token 的 Runner 配置模板
- PKI 与 hosts 分发脚本
- GitLab、SonarQube 和 Runner 备份自动化文件

禁止提交：

- CA 私钥和服务私钥
- PKCS#12 TrustStore
- Harbor Robot Token
- GitLab Token
- SonarQube Token
- Restic Repository 密码
- 任何真实 `.env` 文件

真实密钥、Token 和密码只保存在密码管理器、受保护的主机配置或加密离线介质中。
EOF
```

检查占位符和敏感文件：

```bash
git diff \
  --check

find . \
  -type f \
  -not -path './.git/*' \
  -maxdepth 3 \
  -print
```

提交：

```bash
git add .

git commit \
  -m "feat: initialize versioned CI toolchain"

git push \
  -u \
  origin \
  feature/initialize-ci-images
```

### 【GitLab 网页】

创建 Merge Request：

```text
feature/initialize-ci-images
→ main
```

检查后合并。

### 【管理 Mac】

获取合并后的内容：

```bash
cd \
  "$HOME/workspace/cicd-demo/ci-images"

git switch \
  main

git pull \
  --ff-only
```

复制到 Runner 临时目录：

```bash
ssh \
  ys@192.168.2.242 \
  'rm -rf /tmp/ci-images && mkdir -p /tmp/ci-images'

scp \
  -r \
  gitops \
  runner \
  ys@192.168.2.242:/tmp/ci-images/
```

### 二、同步公共基础镜像

### 【runner01】

登录 Harbor：

```bash
sudo docker login \
  harbor.home.arpa
```

批量同步：

```bash
IMAGES=(
  "node:24.18.0-bookworm-slim|harbor.home.arpa/ci-tools/node:24.18.0-bookworm-slim"
  "node:24.18.0-alpine3.24|harbor.home.arpa/ci-tools/node:24.18.0-alpine3.24"
  "docker:29.6.1-cli|harbor.home.arpa/ci-tools/docker:29.6.1-cli"
  "alpine:3.22|harbor.home.arpa/ci-tools/alpine:3.22"
  "aquasec/trivy:0.72.0|harbor.home.arpa/ci-tools/trivy:0.72.0"
  "alpine/helm:3.19.0|harbor.home.arpa/ci-tools/helm:3.19.0"
)

for ITEM in "${IMAGES[@]}"
do
  SOURCE_IMAGE="${ITEM%%|*}"
  TARGET_IMAGE="${ITEM##*|}"

  sudo docker pull \
    "$SOURCE_IMAGE"

  sudo docker tag \
    "$SOURCE_IMAGE" \
    "$TARGET_IMAGE"

  sudo docker push \
    "$TARGET_IMAGE"
done
```

SonarQube Job 使用 Debian 系 Node 镜像，不使用 Alpine Node 镜像运行 SonarScanner。

### 三、构建版本化 GitOps Job 镜像

不要反复覆盖同一个可变 Tag。本教程固定首个版本：

```text
harbor.home.arpa/ci-tools/gitops:1.0.0-alpine3.22
```

构建：

```bash
cd \
  /tmp/ci-images/gitops

sudo docker build \
  --pull \
  --tag \
  harbor.home.arpa/ci-tools/gitops:1.0.0-alpine3.22 \
  .
```

推送：

```bash
sudo docker push \
  harbor.home.arpa/ci-tools/gitops:1.0.0-alpine3.22
```

验证：

```bash
sudo docker run \
  --rm \
  harbor.home.arpa/ci-tools/gitops:1.0.0-alpine3.22 \
  git \
  --version
```

以后修改 Dockerfile 时发布新版本，例如：

```text
1.0.1-alpine3.22
1.1.0-alpine3.22
```

不要覆盖 `1.0.0-alpine3.22`。

### 四、验证 Docker BuildKit 信任 Harbor

创建测试目录：

```bash
sudo rm -rf \
  /tmp/harbor-build-test

mkdir -p \
  /tmp/harbor-build-test

cd \
  /tmp/harbor-build-test
```

创建测试 Dockerfile：

```bash
cat > Dockerfile <<'EOF'
FROM harbor.home.arpa/ci-tools/node:24.18.0-alpine3.24

RUN node --version
EOF
```

执行：

```bash
sudo DOCKER_BUILDKIT=1 \
  docker build \
  --pull \
  --no-cache \
  --tag harbor-build-test:local \
  .
```

必须成功经过：

```text
load metadata for harbor.home.arpa/ci-tools/node
[auth] ci-tools/node:pull token for harbor.home.arpa
RUN node --version
exporting to image
```

清理：

```bash
sudo docker image rm \
  harbor-build-test:local

rm -rf \
  /tmp/harbor-build-test
```

### 五、安装 Trivy DB 更新脚本

```bash
sudo install \
  -o root \
  -g root \
  -m 0700 \
  /tmp/ci-images/runner/update-trivy-db.sh \
  /usr/local/sbin/update-trivy-db.sh
```

安装 systemd 单元：

```bash
sudo install \
  -o root \
  -g root \
  -m 0644 \
  /tmp/ci-images/runner/update-trivy-db.service \
  /etc/systemd/system/update-trivy-db.service

sudo install \
  -o root \
  -g root \
  -m 0644 \
  /tmp/ci-images/runner/update-trivy-db.timer \
  /etc/systemd/system/update-trivy-db.timer
```

清理此前失败下载留下的数据库：

```bash
sudo rm -rf \
  /var/lib/gitlab-runner/trivy-cache/db
```

执行第一次下载：

```bash
sudo /usr/local/sbin/update-trivy-db.sh
```

检查：

```bash
sudo ls -lh \
  /var/lib/gitlab-runner/trivy-cache/db/trivy.db \
  /var/lib/gitlab-runner/trivy-cache/db/metadata.json \
  /var/lib/gitlab-runner/trivy-cache/last-successful-update
```

查看最后成功更新时间：

```bash
LAST_UPDATE="$(
  sudo cat \
    /var/lib/gitlab-runner/trivy-cache/last-successful-update
)"

date \
  -d "@${LAST_UPDATE}"
```

### 六、启用 Trivy DB Timer

```bash
sudo systemctl daemon-reload

sudo systemctl enable --now \
  update-trivy-db.timer
```

检查：

```bash
systemctl list-timers \
  update-trivy-db.timer
```

查看最近日志：

```bash
sudo journalctl \
  -u update-trivy-db.service \
  -n 100 \
  --no-pager
```

### 七、检查 Harbor 工具镜像

```bash
for IMAGE in \
  harbor.home.arpa/ci-tools/node:24.18.0-bookworm-slim \
  harbor.home.arpa/ci-tools/node:24.18.0-alpine3.24 \
  harbor.home.arpa/ci-tools/docker:29.6.1-cli \
  harbor.home.arpa/ci-tools/trivy:0.72.0 \
  harbor.home.arpa/ci-tools/helm:3.19.0 \
  harbor.home.arpa/ci-tools/gitops:1.0.0-alpine3.22
do
  sudo docker manifest inspect \
    "$IMAGE" \
    >/dev/null

  echo "OK: ${IMAGE}"
done
```

退出 Harbor并清理临时文件：

```bash
sudo docker logout \
  harbor.home.arpa

rm -rf \
  /tmp/ci-images
```

---

## 9.4 创建 CI Robot Account

该账号用于 GitLab CI 向 Harbor 的 `demo` 项目推送和拉取镜像。

### 一、进入 demo 项目

### 【管理 Mac 浏览器】

访问：

```text
https://harbor.home.arpa
```

使用 Harbor 管理员账号登录后，进入：

```text
Projects
→ demo
→ Robot Accounts
```

点击：

```text
New Robot Account
```

### 二、创建 CI Robot

填写：

```text
Name：
ci-demo

Description：
GitLab CI push and pull images
```

权限选择：

```text
Repository
→ Pull Repository

Repository
→ Push Repository
```

其他权限不要勾选，然后点击：

```text
Add
```

创建后，Harbor 会显示 Robot Account 的完整用户名和 Token。

用户名可能类似：

```text
robot$demo+ci-demo
```

实际值必须以 Harbor 页面显示为准。

立即记录：

```text
HARBOR_CI_USERNAME
HARBOR_CI_TOKEN
```

Token 通常只在创建时显示一次，不要关闭页面后再寻找，也不要写入教程或提交到 Git 仓库。

后续在 GitLab 中将这两个值保存为 CI/CD Variables。

---

## 9.5 创建 Kubernetes Pull Robot Account

该账号只供 Kubernetes 从 Harbor 的 `demo` 项目拉取镜像，不授予 Push 权限。

### 一、进入 demo 项目

### 【管理 Mac 浏览器】

进入：

```text
https://harbor.home.arpa
→ Projects
→ demo
→ Robot Accounts
```

点击：

```text
New Robot Account
```

### 二、创建 Pull Robot

填写：

```text
Name：
pull-demo

Description：
Kubernetes image pull
```

只勾选：

```text
Repository
→ Pull Repository
```

不要勾选：

```text
Push Repository
```

点击：

```text
Add
```

创建后，立即记录 Harbor 页面显示的完整用户名和 Token，例如：

```text
用户名：
robot$demo+pull-demo

Token：
以 Harbor 页面实际显示为准
```

后续在 Kubernetes 中使用该账号创建：

```text
imagePullSecret
```

Kubernetes 不使用具有 Push 权限的 CI Robot Account。

---

# 第七阶段：创建示例应用

本阶段全部操作默认在：

```text
【管理 Mac】
```

执行。

不要在 `gitlab01`、`runner01`、`sonarqube01` 或 Kubernetes 节点上编写业务代码。

建议将两个 Git 仓库统一放在：

```text
~/workspace/cicd-demo/
```

管理 Mac 需要已经安装：

```text
Git
Node.js 24
npm
Docker Desktop
Helm
```

检查：

```bash
git --version
node --version
npm --version
docker version
helm version
```

如果尚未安装 Helm：

```bash
brew install \
  helm
```

---

## 10.1 克隆 demo-api

### 【管理 Mac】

创建工作目录：

```bash
mkdir -p \
  "$HOME/workspace/cicd-demo"

cd \
  "$HOME/workspace/cicd-demo"
```

通过 SSH 克隆：

```bash
git clone \
  git@gitlab.home.arpa:platform/demo-api.git
```

进入仓库：

```bash
cd \
  "$HOME/workspace/cicd-demo/demo-api"
```

由于 `main` 分支已经设置为禁止直接 Push，因此创建功能分支：

```bash
git switch \
  -c feature/initialize-demo-api
```

初始化 Node.js 项目：

```bash
npm init -y
```

安装运行依赖：

```bash
npm install \
  express
```

安装开发和测试依赖：

```bash
npm install \
  --save-dev \
  supertest \
  c8 \
  @sonar/scan
```

配置运行和测试命令：

```bash
npm pkg set \
  scripts.start="node src/server.js"

npm pkg set \
  scripts.test="c8 --reporter=lcov --reporter=text node --test"

npm pkg set \
  private=true \
  --json
```

创建目录：

```bash
mkdir -p \
  src \
  test
```

---

## 10.2 创建应用代码

### 【管理 Mac】

确认当前目录：

```bash
cd \
  "$HOME/workspace/cicd-demo/demo-api"
```

创建 `src/app.js`：

```bash
cat > src/app.js <<'EOF'
"use strict";

const express = require("express");

const app = express();

app.disable("x-powered-by");

app.get("/", (_request, response) => {
  response.json({
    name: "demo-api",
    version: process.env.APP_VERSION || "development",
  });
});

app.get("/healthz", (_request, response) => {
  response.json({
    status: "ok",
  });
});

module.exports = app;
EOF
```

创建 `src/server.js`：

```bash
cat > src/server.js <<'EOF'
"use strict";

const app = require("./app");

const port = Number.parseInt(
  process.env.PORT || "3000",
  10,
);

const server = app.listen(
  port,
  "0.0.0.0",
  () => {
    console.log(
      `demo-api listening on port ${port}`,
    );
  },
);

function shutdown(signal) {
  console.log(`Received ${signal}`);

  server.close((error) => {
    if (error) {
      console.error(error);
      process.exit(1);
    }

    process.exit(0);
  });
}

process.on(
  "SIGTERM",
  () => shutdown("SIGTERM"),
);

process.on(
  "SIGINT",
  () => shutdown("SIGINT"),
);
EOF
```

---

## 10.3 创建单元测试

### 【管理 Mac】

创建 `test/app.test.js`：

```bash
cat > test/app.test.js <<'EOF'
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const app = require("../src/app");

test(
  "GET /healthz returns healthy status",
  async () => {
    const response = await request(app)
      .get("/healthz");

    assert.equal(
      response.status,
      200,
    );

    assert.deepEqual(
      response.body,
      {
        status: "ok",
      },
    );
  },
);

test(
  "GET / returns service information",
  async () => {
    const response = await request(app)
      .get("/");

    assert.equal(
      response.status,
      200,
    );

    assert.equal(
      response.body.name,
      "demo-api",
    );
  },
);
EOF
```

运行测试：

```bash
npm test
```

测试应全部通过，并生成：

```text
coverage/lcov.info
```

---

## 10.4 创建 Dockerfile

原始 Node.js 基础镜像包含：

```text
npm
npx
Corepack
Yarn
```

这些包管理工具只在构建依赖时使用，生产运行阶段不需要。将它们保留在最终镜像中，会扩大镜像体积和漏洞扫描面。

最终运行镜像只保留：

```text
Node.js Runtime
生产依赖
应用代码
```

### 【管理 Mac】

创建 `Dockerfile`：

```bash
cat > Dockerfile <<'EOF'
FROM harbor.home.arpa/ci-tools/node:24.18.0-alpine3.24 AS dependencies

WORKDIR /app

COPY package*.json ./

RUN npm ci \
      --omit=dev \
      --no-audit \
      --no-fund \
    && npm cache clean --force


FROM harbor.home.arpa/ci-tools/node:24.18.0-alpine3.24

ENV NODE_ENV=production
ENV PORT=3000

WORKDIR /app

USER root

RUN rm -rf \
      /usr/local/lib/node_modules/npm \
      /usr/local/lib/node_modules/corepack \
      /opt/yarn-v1.22.22 \
      /usr/local/bin/npm \
      /usr/local/bin/npx \
      /usr/local/bin/corepack \
      /usr/local/bin/yarn \
      /usr/local/bin/yarnpkg \
      /root/.npm \
      /home/node/.npm

COPY --from=dependencies \
     --chown=node:node \
     /app/node_modules \
     ./node_modules

COPY --chown=node:node \
     src \
     ./src

USER node

EXPOSE 3000

CMD ["node", "src/server.js"]
EOF
```

创建 `.dockerignore`：

```bash
cat > .dockerignore <<'EOF'
.git
.gitlab-ci.yml
node_modules
coverage
test
npm-debug.log
README.md
EOF
```

确认已经完成第 5.8 节的 Harbor CA 信任和 Docker Desktop 重启，然后检查 Dockerfile 使用的基础镜像是否存在于 Harbor：

```bash
docker manifest inspect \
  harbor.home.arpa/ci-tools/node:24.18.0-alpine3.24 \
  >/dev/null
```

本地构建：

```bash
docker build \
  -t demo-api:local \
  .
```

确认 Node.js 正常，同时 npm 已从运行镜像删除：

```bash
docker run \
  --rm \
  demo-api:local \
  sh -ec '
    node --version

    test ! -e /usr/local/bin/npm
    test ! -e /usr/local/bin/npx
    test ! -d /usr/local/lib/node_modules/npm

    echo "Runtime image does not contain npm or npx"
  '
```

本地运行：

```bash
docker run \
  --rm \
  -p 3000:3000 \
  demo-api:local
```

打开另一个终端测试：

```bash
curl \
  http://127.0.0.1:3000/healthz
```

应返回：

```json
{"status":"ok"}
```

测试完成后按 `Ctrl+C` 停止容器。

---

## 10.5 创建 SonarQube 配置

### 【管理 Mac】

创建 `sonar-project.properties`：

```bash
cat > sonar-project.properties <<'EOF'
sonar.projectKey=demo-api
sonar.projectName=demo-api
sonar.sourceEncoding=UTF-8

sonar.sources=src
sonar.tests=test

sonar.javascript.lcov.reportPaths=coverage/lcov.info
EOF
```

---

## 10.6 提交示例应用代码

### 【管理 Mac】

检查文件：

```bash
git status
```

提交：

```bash
git add .

git commit \
  -m "feat: initialize demo API"
```

暂时不要执行：

```bash
git push
```

后续还需要在该分支中添加：

```text
.gitlab-ci.yml
```

等 GitLab CI/CD Variables 和流水线配置完成后，再把整个功能分支推送到 GitLab，并通过 Merge Request 合并到 `main`。

当前分支应为：

```bash
git branch --show-current
```

预期：

```text
feature/initialize-demo-api
```

---

# 第八阶段：创建 GitOps 仓库

本阶段全部操作默认在：

```text
【管理 Mac】
```

执行。

GitOps 仓库只保存：

```text
Helm Chart
环境配置
Argo CD Application
```

不保存业务源代码、Harbor 密码、Robot Token 或 Kubernetes 管理员凭据。

---

## 11.1 克隆 demo-gitops 并初始化目录

### 【管理 Mac】

进入统一工作目录：

```bash
cd \
  "$HOME/workspace/cicd-demo"
```

通过 SSH 克隆：

```bash
git clone \
  git@gitlab.home.arpa:platform/demo-gitops.git
```

进入仓库：

```bash
cd \
  "$HOME/workspace/cicd-demo/demo-gitops"
```

从最新 `main` 创建初始化分支：

```bash
git switch \
  main

git pull \
  --ff-only

git switch \
  -c feature/initialize-gitops
```

创建目录：

```bash
mkdir -p \
  argocd \
  helm/demo-app/templates
```

最终目录结构：

```text
demo-gitops
├── .gitlab-ci.yml
├── argocd
│   ├── platform-bootstrap.yaml
│   ├── demo-project.yaml
│   └── demo-dev.yaml
└── helm
    └── demo-app
        ├── Chart.yaml
        ├── values.yaml
        ├── values-dev.yaml
        └── templates
            ├── deployment.yaml
            ├── ingress.yaml
            ├── pdb.yaml
            ├── service.yaml
            └── serviceaccount.yaml
```

本阶段先创建 Helm Chart 和 GitOps 校验 CI。

`argocd/` 下的三个 Bootstrap 文件将在第十六阶段创建。

---

## 11.2 创建 Chart.yaml

### 【管理 Mac】

创建：

```bash
cat > helm/demo-app/Chart.yaml <<'EOF'
apiVersion: v2
name: demo-app
description: Demo API Helm chart
type: application
version: 0.1.0
appVersion: "1.0.0"
EOF
```

---

## 11.3 创建默认 values.yaml

### 【管理 Mac】

```bash
cat > helm/demo-app/values.yaml <<'EOF'
replicaCount: 3

image:
  repository: harbor.home.arpa/demo/demo-api
  tag: "sha-bootstrap"
  pullPolicy: IfNotPresent

imagePullSecrets:
  - name: harbor-pull

service:
  type: ClusterIP
  port: 80
  targetPort: 3000

ingress:
  enabled: true
  className: nginx
  host: demo.home.arpa

  tls:
    enabled: true
    secretName: demo-tls

resources:
  requests:
    cpu: 50m
    memory: 64Mi

  limits:
    cpu: 500m
    memory: 256Mi

podSecurityContext:
  runAsNonRoot: true
  runAsUser: 1000
  runAsGroup: 1000
  fsGroup: 1000

  seccompProfile:
    type: RuntimeDefault

containerSecurityContext:
  allowPrivilegeEscalation: false
  readOnlyRootFilesystem: true

  capabilities:
    drop:
      - ALL

probes:
  readiness:
    path: /healthz
    initialDelaySeconds: 3
    periodSeconds: 5

  liveness:
    path: /healthz
    initialDelaySeconds: 10
    periodSeconds: 10
EOF
```

---

## 11.4 创建开发环境 values-dev.yaml

### 【管理 Mac】

```bash
cat > helm/demo-app/values-dev.yaml <<'EOF'
replicaCount: 3

image:
  repository: harbor.home.arpa/demo/demo-api
  tag: "sha-bootstrap"

ingress:
  host: demo.home.arpa
EOF
```

后续 GitLab Pipeline 会自动修改：

```yaml
image:
  tag: "sha-完整40位CommitSHA"
```

---

## 11.5 创建 ServiceAccount 模板

### 【管理 Mac】

创建：

```bash
cat > helm/demo-app/templates/serviceaccount.yaml <<'EOF'
apiVersion: v1
kind: ServiceAccount

metadata:
  name: {{ .Release.Name }}

  labels:
    app.kubernetes.io/name: {{ .Chart.Name }}
    app.kubernetes.io/instance: {{ .Release.Name }}

automountServiceAccountToken: false
EOF
```

---

## 11.6 创建 Deployment 模板

### 【管理 Mac】

```bash
cat > helm/demo-app/templates/deployment.yaml <<'EOF'
apiVersion: apps/v1
kind: Deployment

metadata:
  name: {{ .Release.Name }}

  labels:
    app.kubernetes.io/name: {{ .Chart.Name }}
    app.kubernetes.io/instance: {{ .Release.Name }}

spec:
  replicas: {{ .Values.replicaCount }}

  minReadySeconds: 5

  strategy:
    type: RollingUpdate

    rollingUpdate:
      maxUnavailable: 0
      maxSurge: 1

  selector:
    matchLabels:
      app.kubernetes.io/name: {{ .Chart.Name }}
      app.kubernetes.io/instance: {{ .Release.Name }}

  template:
    metadata:
      labels:
        app.kubernetes.io/name: {{ .Chart.Name }}
        app.kubernetes.io/instance: {{ .Release.Name }}

    spec:
      serviceAccountName: {{ .Release.Name }}

      nodeSelector:
        node-role.kubernetes.io/worker: worker

      topologySpreadConstraints:
        - maxSkew: 1
          topologyKey: physical-host
          whenUnsatisfiable: ScheduleAnyway

          labelSelector:
            matchLabels:
              app.kubernetes.io/name: {{ .Chart.Name }}
              app.kubernetes.io/instance: {{ .Release.Name }}

        - maxSkew: 1
          topologyKey: kubernetes.io/hostname
          whenUnsatisfiable: ScheduleAnyway

          labelSelector:
            matchLabels:
              app.kubernetes.io/name: {{ .Chart.Name }}
              app.kubernetes.io/instance: {{ .Release.Name }}

      affinity:
        podAntiAffinity:
          preferredDuringSchedulingIgnoredDuringExecution:
            - weight: 100

              podAffinityTerm:
                topologyKey: kubernetes.io/hostname

                labelSelector:
                  matchLabels:
                    app.kubernetes.io/name: {{ .Chart.Name }}
                    app.kubernetes.io/instance: {{ .Release.Name }}

      {{- with .Values.imagePullSecrets }}
      imagePullSecrets:
        {{- toYaml . | nindent 8 }}
      {{- end }}

      securityContext:
        {{- toYaml .Values.podSecurityContext | nindent 8 }}

      terminationGracePeriodSeconds: 30

      containers:
        - name: demo-api

          image: >-
            {{ .Values.image.repository }}:{{ .Values.image.tag }}

          imagePullPolicy:
            {{ .Values.image.pullPolicy }}

          securityContext:
            {{- toYaml .Values.containerSecurityContext | nindent 12 }}

          env:
            - name: APP_VERSION
              value: {{ .Values.image.tag | quote }}

          ports:
            - name: http
              containerPort:
                {{ .Values.service.targetPort }}

          readinessProbe:
            httpGet:
              path:
                {{ .Values.probes.readiness.path }}
              port: http

            initialDelaySeconds:
              {{ .Values.probes.readiness.initialDelaySeconds }}

            periodSeconds:
              {{ .Values.probes.readiness.periodSeconds }}

          livenessProbe:
            httpGet:
              path:
                {{ .Values.probes.liveness.path }}
              port: http

            initialDelaySeconds:
              {{ .Values.probes.liveness.initialDelaySeconds }}

            periodSeconds:
              {{ .Values.probes.liveness.periodSeconds }}

          resources:
            {{- toYaml .Values.resources | nindent 12 }}

          volumeMounts:
            - name: tmp
              mountPath: /tmp

      volumes:
        - name: tmp
          emptyDir: {}
EOF
```

---

## 11.7 创建 Service 模板

### 【管理 Mac】

```bash
cat > helm/demo-app/templates/service.yaml <<'EOF'
apiVersion: v1
kind: Service

metadata:
  name: {{ .Release.Name }}

  labels:
    app.kubernetes.io/name: {{ .Chart.Name }}
    app.kubernetes.io/instance: {{ .Release.Name }}

spec:
  type: {{ .Values.service.type }}

  selector:
    app.kubernetes.io/name: {{ .Chart.Name }}
    app.kubernetes.io/instance: {{ .Release.Name }}

  ports:
    - name: http
      protocol: TCP
      port: {{ .Values.service.port }}
      targetPort: http
EOF
```

---

## 11.8 创建 Ingress 模板

### 【管理 Mac】

```bash
cat > helm/demo-app/templates/ingress.yaml <<'EOF'
{{- if .Values.ingress.enabled }}
apiVersion: networking.k8s.io/v1
kind: Ingress

metadata:
  name: {{ .Release.Name }}

spec:
  ingressClassName:
    {{ .Values.ingress.className }}

  {{- if .Values.ingress.tls.enabled }}
  tls:
    - hosts:
        - {{ .Values.ingress.host }}

      secretName:
        {{ .Values.ingress.tls.secretName }}
  {{- end }}

  rules:
    - host: {{ .Values.ingress.host }}

      http:
        paths:
          - path: /
            pathType: Prefix

            backend:
              service:
                name: {{ .Release.Name }}

                port:
                  number:
                    {{ .Values.service.port }}
{{- end }}
EOF
```

---

## 11.9 创建 PodDisruptionBudget 模板

### 【管理 Mac】

```bash
cat > helm/demo-app/templates/pdb.yaml <<'EOF'
apiVersion: policy/v1
kind: PodDisruptionBudget

metadata:
  name: {{ .Release.Name }}

spec:
  minAvailable: 2

  selector:
    matchLabels:
      app.kubernetes.io/name: {{ .Chart.Name }}
      app.kubernetes.io/instance: {{ .Release.Name }}
EOF
```

---

## 11.10 验证 Helm Chart

### 【管理 Mac】

确认已经安装 Helm：

```bash
helm version
```

进入 GitOps 仓库：

```bash
cd \
  "$HOME/workspace/cicd-demo/demo-gitops"
```

检查 Chart：

```bash
helm lint \
  helm/demo-app
```

成功时应看到：

```text
1 chart(s) linted, 0 chart(s) failed
```

渲染开发环境清单：

```bash
helm template \
  demo-dev \
  helm/demo-app \
  -f helm/demo-app/values-dev.yaml \
  > /tmp/demo-dev-rendered.yaml
```

查看渲染结果：

```bash
less \
  /tmp/demo-dev-rendered.yaml
```

确认模板中不存在未渲染的 Helm 表达式：

```bash
grep -n '{{' \
  /tmp/demo-dev-rendered.yaml \
  || echo "Helm 模板已全部渲染"
```

---

## 11.11 创建 GitOps 仓库 CI 校验

GitOps 仓库本身也必须通过 CI 验证。这样 Helm 模板、Values、Ingress、PDB 或 Deployment 出现语法问题时，会在合并前被阻断。

### 【管理 Mac】

创建 `.gitlab-ci.yml`：

```bash
cat > .gitlab-ci.yml <<'EOF'
stages:
  - validate

default:
  tags:
    - docker
    - private

  interruptible: true

validate_helm:
  stage: validate

  image:
    name: harbor.home.arpa/ci-tools/helm:3.19.0
    entrypoint:
      - ""

  script:
    - >
      helm lint
      helm/demo-app
      -f helm/demo-app/values-dev.yaml

    - >
      helm template
      demo-dev
      helm/demo-app
      -f helm/demo-app/values-dev.yaml
      > /tmp/demo-dev-rendered.yaml

    - >
      test
      -s
      /tmp/demo-dev-rendered.yaml

    - |
      if grep -n '{{' /tmp/demo-dev-rendered.yaml; then
        echo "发现未渲染的 Helm 表达式"
        exit 1
      fi

  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'

    - if: '$CI_COMMIT_BRANCH == "main"'

    - if: '$CI_COMMIT_BRANCH == "dev"'
EOF
```

检查：

```bash
git diff \
  --check

helm lint \
  helm/demo-app \
  -f helm/demo-app/values-dev.yaml
```

自动部署提交不再使用 `[skip ci]`，因此 GitOps Bot 更新 `dev` 后，也会触发一次 Helm 校验 Pipeline。

---

## 11.12 提交 GitOps 仓库

### 【管理 Mac】

检查：

```bash
git status

git diff \
  --check
```

提交：

```bash
git add .

git commit \
  -m "feat: initialize demo GitOps repository"
```

推送功能分支：

```bash
git push \
  -u \
  origin \
  feature/initialize-gitops
```

### 【GitLab 网页】

创建 Merge Request：

```text
feature/initialize-gitops
→ main
```

等待 `validate_helm` 成功后合并。

### 【管理 Mac】

获取合并后的 `main`：

```bash
git switch \
  main

git pull \
  --ff-only
```

将初始配置同步到开发分支：

```bash
git switch \
  dev

git pull \
  --ff-only \
  origin \
  dev

git merge \
  --ff-only \
  main

git push \
  origin \
  dev
```

切回 `main`：

```bash
git switch \
  main
```

在 GitLab 网页确认：

```text
main：
包含 Helm Chart 和 .gitlab-ci.yml

dev：
与 main 初始内容一致
后续由 GitOps Bot 自动更新 values-dev.yaml
```

当前 `argocd/` 还是空目录，而 Git 不跟踪空目录。第十六阶段创建并提交 App of Apps 配置后，该目录才会出现在仓库中。

---

# 第九阶段：配置 Kubernetes Secret

## 12.1 检查并补齐 Worker 标签

### 【任意 Master】

Deployment 模板同时使用：

```text
node-role.kubernetes.io/worker=worker
physical-host=physical-host-1/2/3
```

先为三台 Worker 补齐角色标签：

```bash
for NODE in \
  k8s-worker01 \
  k8s-worker02 \
  k8s-worker03
do
  kubectl label node \
    "$NODE" \
    node-role.kubernetes.io/worker=worker \
    --overwrite
done
```

检查：

```bash
kubectl get nodes \
  -L node-role.kubernetes.io/worker,physical-host \
  -o wide
```

应确认：

```text
k8s-worker01：node-role.kubernetes.io/worker=worker，physical-host=physical-host-1
k8s-worker02：node-role.kubernetes.io/worker=worker，physical-host=physical-host-2
k8s-worker03：node-role.kubernetes.io/worker=worker，physical-host=physical-host-3
```

如果 `physical-host` 标签缺失，应按实际物理故障域补齐后再继续。

---

## 12.2 创建 Namespace

### 【k8s-master01】

```bash
kubectl create namespace \
  demo-dev \
  --dry-run=client \
  -o yaml \
  | kubectl apply -f -
```

---

## 12.3 创建并验证 Harbor Pull Secret

不要把教程占位符直接写进 Kubernetes Secret。曾经出现过把：

```text
<HARBOR_PULL_ROBOT_USERNAME>
```

原样保存到 Secret，导致所有 Worker 拉取私有镜像时返回 `401 Unauthorized`。

### 【k8s-master01】

交互式输入 Harbor 页面显示的完整 Pull Robot 用户名：

```bash
read \
  "HARBOR_PULL_USERNAME?Harbor Pull Robot Username: "
```

交互式输入 Token，终端不会显示内容：

```bash
read -s \
  "HARBOR_PULL_TOKEN?Harbor Pull Robot Token: "

echo
```

确认用户名：

```bash
printf 'Harbor Pull Username: %s\n' \
  "$HARBOR_PULL_USERNAME"
```

用户名应类似：

```text
robot$demo+pull-demo
```

禁止继续执行的情况：

```text
用户名为空
用户名仍包含 < 和 >
用户名只是 pull-demo
```

创建或更新 Secret：

```bash
kubectl \
  -n demo-dev \
  create secret docker-registry \
  harbor-pull \
  --docker-server=harbor.home.arpa \
  --docker-username="$HARBOR_PULL_USERNAME" \
  --docker-password="$HARBOR_PULL_TOKEN" \
  --docker-email='devnull@home.arpa' \
  --dry-run=client \
  -o yaml \
  | kubectl apply -f -
```

清除变量：

```bash
unset \
  HARBOR_PULL_USERNAME \
  HARBOR_PULL_TOKEN
```

检查 Secret 类型：

```bash
kubectl \
  -n demo-dev \
  get secret \
  harbor-pull \
  -o jsonpath='{.type}{"\n"}'
```

必须输出：

```text
kubernetes.io/dockerconfigjson
```

检查 Registry：

```bash
kubectl \
  -n demo-dev \
  get secret \
  harbor-pull \
  -o jsonpath='{.data.\.dockerconfigjson}' \
  | base64 -d \
  | jq -r \
      '.auths | keys[]'
```

必须输出：

```text
harbor.home.arpa
```

只检查用户名，不显示 Token：

```bash
SECRET_USERNAME="$(
  kubectl \
    -n demo-dev \
    get secret \
    harbor-pull \
    -o jsonpath='{.data.\.dockerconfigjson}' \
    | base64 -d \
    | jq -r \
        '.auths["harbor.home.arpa"].auth' \
    | base64 -d \
    | cut -d ':' -f 1
)"
```

执行防占位符检查：

```bash
case "$SECRET_USERNAME" in
  *'<'*'>'*|'')
    echo "错误：harbor-pull 中仍然是占位符或空用户名"
    exit 1
    ;;

  *)
    printf 'Secret Username: %s\n' \
      "$SECRET_USERNAME"
    ;;
esac
```

该步骤通过后才能继续创建 Argo CD Application。

---

## 12.4 创建应用 TLS Secret

### 【k8s-master01】

```bash
kubectl \
  -n demo-dev \
  create secret tls \
  demo-tls \
  --cert="$HOME/platform-k8s-certs/demo.home.arpa.crt" \
  --key="$HOME/platform-k8s-certs/demo.home.arpa.key" \
  --dry-run=client \
  -o yaml \
  | kubectl apply -f -
```

---

# 第十阶段：安装 Argo CD

## 13.1 创建 Namespace

### 【k8s-master01】

```bash
kubectl create namespace \
  argocd \
  --dry-run=client \
  -o yaml \
  | kubectl apply -f -
```

---

## 13.2 安装 v3.4.2

### 【k8s-master01】

```bash
kubectl apply \
  -n argocd \
  --server-side \
  --force-conflicts \
  -f https://raw.githubusercontent.com/argoproj/argo-cd/v3.4.2/manifests/install.yaml
```

等待：

```bash
kubectl \
  -n argocd \
  wait \
  --for=condition=Available \
  deployment \
  --all \
  --timeout=10m
```

检查：

```bash
kubectl \
  -n argocd \
  get pods \
  -o wide
```

当前只有一个集群，标准版足够；Argo CD 本身短暂离线不会停止已经运行的 Kubernetes 工作负载。

---

## 13.3 配置 Argo CD 内部 HTTP

### 【k8s-master01】

由 Ingress NGINX 终止 TLS：

```bash
kubectl \
  -n argocd \
  patch configmap \
  argocd-cmd-params-cm \
  --type merge \
  -p '{
    "data": {
      "server.insecure": "true"
    }
  }'
```

重启：

```bash
kubectl \
  -n argocd \
  rollout restart \
  deployment/argocd-server
```

```bash
kubectl \
  -n argocd \
  rollout status \
  deployment/argocd-server
```

---

## 13.4 创建 Argo CD TLS Secret

### 【k8s-master01】

```bash
kubectl \
  -n argocd \
  create secret tls \
  argocd-tls \
  --cert="$HOME/platform-k8s-certs/argocd.home.arpa.crt" \
  --key="$HOME/platform-k8s-certs/argocd.home.arpa.key" \
  --dry-run=client \
  -o yaml \
  | kubectl apply -f -
```

---

## 13.5 创建 Argo CD Ingress

### 【k8s-master01】

```bash
cat > "$HOME/argocd-ingress.yaml" <<'EOF'
apiVersion: networking.k8s.io/v1
kind: Ingress

metadata:
  name: argocd-server
  namespace: argocd

  annotations:
    nginx.ingress.kubernetes.io/backend-protocol: "HTTP"
    nginx.ingress.kubernetes.io/ssl-redirect: "true"

spec:
  ingressClassName: nginx

  tls:
    - hosts:
        - argocd.home.arpa
      secretName: argocd-tls

  rules:
    - host: argocd.home.arpa
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: argocd-server
                port:
                  number: 80
EOF
```

应用：

```bash
kubectl apply \
  -f "$HOME/argocd-ingress.yaml"
```

检查：

```bash
kubectl \
  -n argocd \
  get ingress
```

---

## 13.6 让 Argo CD 信任 GitLab CA

### 【k8s-master01】

```bash
kubectl \
  -n argocd \
  create configmap \
  argocd-tls-certs-cm \
  --from-file=gitlab.home.arpa=/usr/local/share/ca-certificates/platform-root-ca.crt \
  --dry-run=client \
  -o yaml \
  | kubectl apply -f -

kubectl \
  -n argocd \
  rollout restart \
  deployment/argocd-repo-server

kubectl \
  -n argocd \
  rollout status \
  deployment/argocd-repo-server
```

GitLab 仓库接入完成后，可以删除 Master01 上的临时服务私钥：

```bash
rm -rf \
  "$HOME/platform-k8s-certs"
```

---

## 13.7 安装 Argo CD CLI 并完成首次登录

本节涉及两台主机：

```text
k8s-master01：
使用 kubectl 获取初始密码、删除初始密码 Secret。

管理 Mac：
安装 Argo CD CLI、登录 Argo CD、修改 admin 密码。
```

执行流程：

```text
k8s-master01 获取初始密码
→ 管理 Mac 安装 CLI
→ 管理 Mac 登录
→ 管理 Mac 修改密码
→ 验证新密码
→ k8s-master01 删除初始密码 Secret
```

Argo CD 的初始 `admin` 密码保存在 `argocd-initial-admin-secret` 中。修改密码后，该 Secret 不再有保留价值，可以安全删除。

---

### 一、确认 Argo CD 可以访问

### 【管理 Mac】

检查域名解析：

```bash
getent hosts argocd.home.arpa 2>/dev/null \
  || dscacheutil \
    -q host \
    -a name argocd.home.arpa
```

也可以检查：

```bash
ping -c 1 \
  argocd.home.arpa
```

检查 HTTPS：

```bash
curl -I \
  https://argocd.home.arpa
```

不能出现：

```text
certificate verify failed
Could not resolve host
Connection refused
```

如果证书不受信任，应先确认 Platform Root CA 已导入 Mac 系统钥匙串。

---

### 二、获取初始 admin 密码

### 【k8s-master01】

确认初始密码 Secret 存在：

```bash
kubectl \
  -n argocd \
  get secret \
  argocd-initial-admin-secret
```

获取密码：

```bash
ARGOCD_INITIAL_PASSWORD="$(
  kubectl \
    -n argocd \
    get secret \
    argocd-initial-admin-secret \
    -o jsonpath='{.data.password}' \
  | base64 -d
)"
```

显示密码：

```bash
printf '%s\n' \
  "$ARGOCD_INITIAL_PASSWORD"
```

复制该密码，下一步在管理 Mac 登录时使用。

不要把密码：

```text
写入教程
提交到 Git 仓库
发送到公开聊天
长期保存在普通文本文件中
```

---

### 三、安装 Argo CD CLI

### 【管理 Mac】

使用 Homebrew 安装：

```bash
brew install \
  argocd
```

检查版本：

```bash
argocd version \
  --client
```

Homebrew 同时支持 Intel Mac 和 Apple Silicon Mac 安装 Argo CD CLI。

---

### 四、配置 gRPC-Web

当前 Argo CD 通过：

```text
Ingress NGINX
→ argocd-server
```

对外提供服务，因此 CLI 使用 `gRPC-Web`。

### 【管理 Mac】

当前终端临时设置：

```bash
export ARGOCD_OPTS="--grpc-web"
```

检查：

```bash
printf '%s\n' \
  "$ARGOCD_OPTS"
```

应输出：

```text
--grpc-web
```

`--grpc-web` 适合 Argo CD Server 位于不支持原生 HTTP/2 gRPC 的反向代理后面的场景。

如果需要让以后打开的 zsh 终端自动生效，执行：

```bash
sed -i '' \
  '/# BEGIN ARGOCD CLI/,/# END ARGOCD CLI/d' \
  "$HOME/.zshrc"

cat >> "$HOME/.zshrc" <<'EOF'

# BEGIN ARGOCD CLI
export ARGOCD_OPTS="--grpc-web"
# END ARGOCD CLI
EOF
```

重新加载：

```bash
source \
  "$HOME/.zshrc"
```

---

### 五、首次登录 Argo CD

### 【管理 Mac】

执行：

```bash
argocd login \
  argocd.home.arpa \
  --username admin
```

出现密码提示后，粘贴刚才从 `k8s-master01` 获取的初始密码：

```text
Password:
```

登录成功后应看到类似：

```text
Logged in as 'admin'
Context 'argocd.home.arpa' updated
```

这里不建议把密码直接写在命令参数中，例如：

```text
--password "初始密码"
```

交互式输入可以避免密码进入终端历史和命令参数。

不要添加：

```text
--insecure
```

当前 `argocd.home.arpa` 使用 Platform Root CA 签发的有效证书，管理 Mac 应正常验证该证书。

---

### 六、确认当前登录身份

### 【管理 Mac】

```bash
argocd account \
  get-user-info
```

应看到当前账号为：

```text
admin
```

也可以检查服务器版本：

```bash
argocd version
```

此时应同时显示：

```text
argocd CLI 版本
argocd-server 版本
```

---

### 七、修改 admin 密码

### 【管理 Mac】

执行：

```bash
argocd account \
  update-password
```

依次输入：

```text
Current password：
刚才使用的初始密码

New password：
新的强密码

Confirm new password：
再次输入新密码
```

新密码建议满足：

```text
长度至少 16 位
同时包含大小写字母、数字和特殊字符
不要与 GitLab、Harbor、SonarQube 密码相同
保存到密码管理器
```

`argocd account update-password` 默认修改当前已登录用户的密码。

成功后应看到：

```text
Password updated
```

---

### 八、验证新密码

### 【管理 Mac】

退出当前 CLI 会话：

```bash
argocd logout \
  argocd.home.arpa
```

使用新密码重新登录：

```bash
argocd login \
  argocd.home.arpa \
  --username admin
```

输入刚才设置的新密码。

再次检查：

```bash
argocd account \
  get-user-info
```

只有确认新密码可以正常登录后，才能删除初始密码 Secret。

---

### 九、删除初始密码 Secret

### 【k8s-master01】

确认当前 Secret 存在：

```bash
kubectl \
  -n argocd \
  get secret \
  argocd-initial-admin-secret
```

删除：

```bash
kubectl \
  -n argocd \
  delete secret \
  argocd-initial-admin-secret
```

正常返回：

```text
secret "argocd-initial-admin-secret" deleted
```

确认已经删除：

```bash
kubectl \
  -n argocd \
  get secret \
  argocd-initial-admin-secret \
  2>/dev/null \
  || echo "初始密码 Secret 已删除"
```

清除当前 Shell 中保存的初始密码变量：

```bash
unset \
  ARGOCD_INITIAL_PASSWORD
```

官方说明指出，`argocd-initial-admin-secret` 只用于保存自动生成的初始密码；修改密码后可以安全删除。

---

# 第十一阶段：创建访问 Token

## 14.0 执行位置说明

本阶段涉及：

```text
【管理 Mac 浏览器】
创建 GitLab Deploy Token、Project Access Token 和 CI/CD Variables。

【管理 Mac 终端】
使用 Argo CD CLI 添加 GitOps 仓库。

【runner01】
本阶段暂时不执行操作。
```

Token 用途：

```text
Argo CD Deploy Token：
只允许 Argo CD 读取 demo-gitops 仓库。

GitOps Project Access Token：
允许 GitLab CI 更新 demo-gitops 的 values-dev.yaml。

Harbor Robot Token：
允许 GitLab CI 推送业务镜像。

SonarQube Token：
允许 GitLab CI 执行代码分析。
```

---

## 14.1 创建 Argo CD 只读 Deploy Token

Deploy Token 由用户名和 Token 组成，可以为 Git 仓库授予最小化的 `read_repository` 权限，不与个人用户密码绑定。

### 一、进入 demo-gitops 项目

### 【管理 Mac 浏览器】

访问：

```text
https://gitlab.home.arpa
```

点击顶部：

```text
Search or go to
```

搜索并进入：

```text
platform/demo-gitops
```

进入：

```text
Settings
→ Repository
→ Deploy tokens
```

展开：

```text
Deploy tokens
```

### 二、创建 Token

填写：

```text
Name：
argocd-read

Username：
留空，使用 GitLab 自动生成的用户名

Expiration date：
根据实际维护周期设置，建议不超过一年

Scopes：
只勾选 read_repository
```

不要勾选：

```text
write_registry
read_registry
read_package_registry
write_package_registry
```

点击：

```text
Create deploy token
```

创建后，立即记录：

```text
DEPLOY_TOKEN_USERNAME
DEPLOY_TOKEN
```

用户名通常类似：

```text
gitlab+deploy-token-1
```

Token 只在创建时完整显示一次，不要刷新页面后再查找。

---
## 14.2 将 demo-gitops 添加到 Argo CD

本节涉及两台设备：

```text
【k8s-master01】
确认 Argo CD repo-server 能解析并访问 gitlab.home.arpa。

【管理 Mac】
使用 Argo CD CLI 添加 demo-gitops 私有仓库。
```

需要特别注意：

```text
argocd repo add 命令虽然在管理 Mac 执行，
但真正连接 GitLab 的是 Kubernetes 集群中的：

argocd-repo-server Pod
```

因此：

```text
管理 Mac 能访问 gitlab.home.arpa
不代表 Argo CD Pod 也能访问。
```

---

### 一、确认 Argo CD repo-server 可以解析 GitLab

### 【k8s-master01】

先测试 Kubernetes 集群内部 DNS：

```bash
kubectl run \
  gitlab-dns-test \
  --rm \
  -it \
  --restart=Never \
  --image=busybox:1.36 \
  -- nslookup \
  gitlab.home.arpa
```

正常应解析到：

```text
192.168.2.241
```

如果返回：

```text
no such host
```

说明 CoreDNS 尚未配置 `gitlab.home.arpa`。

检查当前 CoreDNS 配置：

```bash
kubectl \
  -n kube-system \
  get configmap \
  coredns \
  -o yaml
```

备份：

```bash
kubectl \
  -n kube-system \
  get configmap \
  coredns \
  -o yaml \
  > "$HOME/coredns-before-cicd.yaml"
```

编辑：

```bash
kubectl \
  -n kube-system \
  edit configmap \
  coredns
```

在 `Corefile` 的：

```text
.:53 {
```

内部增加：

```text
hosts {
    192.168.2.211 harbor.home.arpa harbor01
    192.168.2.241 gitlab.home.arpa gitlab01
    192.168.2.243 sonarqube.home.arpa sonarqube01
    fallthrough
}
```

结构应类似：

```text
Corefile: |
  .:53 {
      errors

      health {
          lameduck 5s
      }

      ready

      hosts {
          192.168.2.211 harbor.home.arpa harbor01
          192.168.2.241 gitlab.home.arpa gitlab01
          192.168.2.243 sonarqube.home.arpa sonarqube01
          fallthrough
      }

      kubernetes cluster.local in-addr.arpa ip6.arpa {
          pods insecure
          fallthrough in-addr.arpa ip6.arpa
          ttl 30
      }

      prometheus :9153

      forward . /etc/resolv.conf {
          max_concurrent 1000
      }

      cache 30
      loop
      reload
      loadbalance
  }
```

不要删除现有的：

```text
kubernetes
forward
cache
loop
reload
loadbalance
```

保存后重启 CoreDNS：

```bash
kubectl \
  -n kube-system \
  rollout restart \
  deployment/coredns
```

等待：

```bash
kubectl \
  -n kube-system \
  rollout status \
  deployment/coredns
```

再次测试：

```bash
kubectl run \
  gitlab-dns-test \
  --rm \
  -it \
  --restart=Never \
  --image=busybox:1.36 \
  -- nslookup \
  gitlab.home.arpa
```

应看到：

```text
Name:      gitlab.home.arpa
Address:   192.168.2.241
```

---

### 二、确认 repo-server 信任 GitLab CA

### 【k8s-master01】

检查 Platform Root CA ConfigMap：

```bash
kubectl \
  -n argocd \
  get configmap \
  argocd-tls-certs-cm \
  -o yaml
```

其中应存在：

```text
gitlab.home.arpa
```

检查 repo-server：

```bash
kubectl \
  -n argocd \
  get pods \
  -l app.kubernetes.io/name=argocd-repo-server
```

如果前面刚更新过 CA ConfigMap，重启 repo-server：

```bash
kubectl \
  -n argocd \
  rollout restart \
  deployment/argocd-repo-server
```

等待：

```bash
kubectl \
  -n argocd \
  rollout status \
  deployment/argocd-repo-server
```

直接从 repo-server 测试域名解析：

```bash
kubectl \
  -n argocd \
  exec \
  deployment/argocd-repo-server \
  -- getent hosts \
  gitlab.home.arpa
```

应返回：

```text
192.168.2.241 gitlab.home.arpa
```

---

### 三、确认 Argo CD CLI 已登录

### 【管理 Mac】

设置 gRPC-Web：

```bash
export ARGOCD_OPTS="--grpc-web"
```

确认当前登录状态：

```bash
argocd account \
  get-user-info
```

正常应看到：

```text
Logged In: true
Username: admin
```

如果未登录，执行：

```bash
argocd login \
  argocd.home.arpa \
  --username admin
```

输入已经修改后的 Argo CD `admin` 密码。

---

### 四、输入 GitLab Deploy Token

### 【管理 Mac】

交互式输入用户名：

```bash
read \
  "ARGOCD_REPO_USERNAME?Deploy Token Username: "
```

交互式输入 Token：

```bash
read -s \
  "ARGOCD_REPO_TOKEN?Deploy Token: "
```


检查用户名变量是否有值：

```bash
test -n "$ARGOCD_REPO_USERNAME" \
  && echo "Deploy Token 用户名已设置"
```

检查 Token 是否有值，但不要打印内容：

```bash
test -n "$ARGOCD_REPO_TOKEN" \
  && echo "Deploy Token 已设置"
```

Deploy Token 用户名通常类似：

```text
gitlab+deploy-token-3
```

实际值必须以 GitLab 页面显示为准。

---

### 五、添加 demo-gitops 仓库

### 【管理 Mac】

执行：

```bash
argocd repo add \
  https://gitlab.home.arpa/platform/demo-gitops.git \
  --username "$ARGOCD_REPO_USERNAME" \
  --password "$ARGOCD_REPO_TOKEN"
```

成功时通常返回：

```text
Repository 'https://gitlab.home.arpa/platform/demo-gitops.git' added
```

---

### 六、检查仓库状态

### 【管理 Mac】

```bash
argocd repo list
```

预期包含：

```text
TYPE  NAME  REPO                                                  STATUS
git         https://gitlab.home.arpa/platform/demo-gitops.git     Successful
```

查看详细信息：

```bash
argocd repo get \
  https://gitlab.home.arpa/platform/demo-gitops.git
```

状态应为：

```text
Successful
```

---

### 七、清除临时变量

### 【管理 Mac】

```bash
unset \
  ARGOCD_REPO_USERNAME \
  ARGOCD_REPO_TOKEN
```

确认已经清除：

```bash
test -z "${ARGOCD_REPO_USERNAME:-}" \
  && echo "用户名变量已清除"

test -z "${ARGOCD_REPO_TOKEN:-}" \
  && echo "Token 变量已清除"
```

---

### 八、常见错误处理

#### 1. Kubernetes DNS 无法解析

错误：

```text
lookup gitlab.home.arpa on 10.96.0.10:53: no such host
```

原因：

```text
argocd-repo-server 使用 Kubernetes CoreDNS，
而 CoreDNS 不认识 gitlab.home.arpa。
```

处理：

```text
在 CoreDNS 中添加 gitlab.home.arpa → 192.168.2.241。
```

#### 2. 证书不受信任

错误可能包含：

```text
x509: certificate signed by unknown authority
```

处理：

```text
检查 argocd-tls-certs-cm 中是否存在 gitlab.home.arpa。
重启 argocd-repo-server。
不要使用 --insecure-skip-server-verification。
```

#### 3. Deploy Token 认证失败

错误可能包含：

```text
authentication required
HTTP Basic: Access denied
```

检查：

```text
Deploy Token Username 是否完整
Deploy Token 是否复制完整
Token 是否过期
是否授予 read_repository
```

#### 4. 仓库路径错误

错误可能包含：

```text
repository not found
```

确认 URL：

```text
https://gitlab.home.arpa/platform/demo-gitops.git
```

并确认 Deploy Token 创建在：

```text
platform/demo-gitops
```

项目中，而不是 `demo-api` 项目中。

---

### 九、最终验收

### 【管理 Mac】

```bash
argocd repo list
```

必须满足：

```text
仓库地址正确
类型为 git
状态为 Successful
```

### 【k8s-master01】

```bash
kubectl \
  -n argocd \
  get pods \
  -l app.kubernetes.io/name=argocd-repo-server
```

必须处于：

```text
Running
```

至此，Argo CD 已经可以通过只读 Deploy Token 访问：

```text
platform/demo-gitops
```

---

## 14.3 创建 GitOps 写入 Project Access Token

Project Access Token 可以限定到单个项目，并通过 HTTPS Git 使用。GitLab Self-Managed 的 Free 版本也支持 Project Access Token。

该 Token 只用于：

```text
GitLab CI
→ 克隆 demo-gitops
→ 修改 values-dev.yaml
→ 推送 main
```

### 一、进入 Access Token 页面

### 【管理 Mac 浏览器】

进入：

```text
platform/demo-gitops
→ Settings
→ Access tokens
```

点击：

```text
Add new token
```

### 二、填写 Token

设置：

```text
Token name：
gitops-writer

Description：
GitLab CI updates development image tag

Expiration date：
根据实际轮换周期设置，建议不超过一年

Role：
Maintainer

Scopes：
只勾选 write_repository
```

不需要勾选：

```text
api
read_api
create_runner
manage_runner
```

点击：

```text
Create project access token
```

创建后立即记录 GitLab 页面显示的：

```text
Bot Username → GITOPS_USERNAME
Project Access Token → GITOPS_TOKEN
```

`GITOPS_USERNAME` 必须使用页面显示的完整 Bot Username，不要使用 Token 名称 `gitops-writer` 代替。

通过 HTTPS Git 认证时：

```text
Bot Username 作为用户名
Project Access Token 作为密码
```

Token 只在创建时显示一次。

---

## 14.4 确认 demo-gitops 允许 Bot 推送 dev

GitOps Bot 以 `Maintainer` 身份更新开发分支：

```text
demo-gitops/dev
```

它不直接修改 `main`。

### 【管理 Mac 浏览器】

进入：

```text
platform/demo-gitops
→ Settings
→ Repository
→ Branch rules
```

确认 `dev`：

```text
Allowed to merge：
Maintainers

Allowed to push and merge：
Maintainers
```

确认 `main`：

```text
Allowed to merge：
Maintainers

Allowed to push and merge：
No one
```

GitOps Bot 只自动更新：

```text
dev
→ helm/demo-app/values-dev.yaml
```

基础配置、AppProject、Application 和未来生产配置继续通过 Merge Request 合并到 `main`。

---

## 14.5 创建 GitLab CI/CD Variables

### 一、进入 Variables 页面

### 【管理 Mac 浏览器】

进入：

```text
platform/demo-api
→ Settings
→ CI/CD
→ Variables
```

展开：

```text
Variables
```

点击：

```text
Add variable
```

每个变量使用：

```text
Type：
Variable

Environment scope：
*

Expand variable reference：
关闭
```

特别是 Harbor Robot 用户名可能包含：

```text
$
```

例如：

```text
robot$demo+ci-demo
```

关闭变量展开可以避免 `$demo` 被当成另一个变量引用。

### 二、添加变量

|变量|值|Visibility|Protected|
|---|---|---|--:|
|`HARBOR_REGISTRY`|`harbor.home.arpa`|Visible|开启|
|`HARBOR_PROJECT`|`demo`|Visible|开启|
|`HARBOR_USERNAME`|CI Robot 完整用户名|Visible|开启|
|`HARBOR_PASSWORD`|CI Robot Token|Masked and hidden|开启|
|`SONAR_HOST_URL`|`https://sonarqube.home.arpa`|Visible|开启|
|`SONAR_TOKEN`|SonarQube Token|Masked and hidden|开启|
|`GITOPS_REPO_URL`|`https://gitlab.home.arpa/platform/demo-gitops.git`|Visible|开启|
|`GITOPS_USERNAME`|Project Access Token 的完整 Bot Username|Visible|开启|
|`GITOPS_TOKEN`|Project Access Token|Masked and hidden|开启|

对于以下变量：

```text
HARBOR_PASSWORD
SONAR_TOKEN
GITOPS_TOKEN
```

同时确保：

```text
Masked：开启
Hidden：开启
Expand variable reference：关闭
Protected：开启
```

### 三、确认 main 是 Protected Branch

进入：

```text
platform/demo-api
→ Settings
→ Repository
→ Branch rules
→ main
```

确认 `main` 是受保护分支。

Protected Variables 只会提供给受保护分支或受保护标签的 Pipeline。

当前流水线设计为：

```text
功能分支和 Merge Request：
只运行 test，不需要秘密变量。

main：
运行 SonarQube、镜像构建、Harbor Push 和 GitOps 更新，
需要 Protected Variables。
```

---

## 14.6 执行上线前置检查

在创建 `.gitlab-ci.yml` 和第一次完整 Pipeline 前，先验证依赖条件。大多数 CI/CD 故障都应该在这一阶段被发现，而不是等到流水线运行后再排查。

### 一、检查本地仓库占位符

### 【管理 Mac】

检查业务仓库：

```bash
cd \
  "$HOME/workspace/cicd-demo/demo-api"

grep -RInE \
  '<[A-Z0-9_]+>|xxxxxxxxxxxxxxxx|REPLACE_WITH_' \
  . \
  --exclude-dir=.git \
  || echo "demo-api 未发现未替换占位符"
```

检查 GitOps 仓库：

```bash
cd \
  "$HOME/workspace/cicd-demo/demo-gitops"

grep -RInE \
  '<[A-Z0-9_]+>|xxxxxxxxxxxxxxxx|REPLACE_WITH_' \
  . \
  --exclude-dir=.git \
  || echo "demo-gitops 未发现未替换占位符"
```

`sha-bootstrap` 在第一次业务 Pipeline 前可以存在，但在 Bootstrap Application 前必须已经被实际镜像版本替换。

### 二、检查 Runner

### 【runner01】

```bash
sudo gitlab-runner verify

sudo systemctl is-active \
  gitlab-runner

sudo systemctl is-active \
  docker
```

检查内部域名：

```bash
getent hosts \
  gitlab.home.arpa

getent hosts \
  sonarqube.home.arpa

getent hosts \
  harbor.home.arpa
```

检查 Runner 配置：

```bash
sudo grep -nE \
  'concurrent|limit|request_concurrency|extra_hosts' \
  /etc/gitlab-runner/config.toml
```

### 三、检查 CA

```bash
echo \
  | openssl s_client \
      -connect harbor.home.arpa:443 \
      -servername harbor.home.arpa \
      -CAfile /etc/docker/certs.d/harbor.home.arpa/ca.crt \
      2>/dev/null \
  | grep \
      'Verify return code: 0'
```

检查 Job 挂载源文件：

```bash
sudo test -s \
  /etc/gitlab-runner/certs/platform-root-ca.crt

sudo test -s \
  /etc/gitlab-runner/certs/harbor-ca.crt

sudo test -s \
  /etc/gitlab-runner/certs/sonar-truststore.p12
```

### 四、检查工具镜像

```bash
for IMAGE in \
  harbor.home.arpa/ci-tools/node:24.18.0-bookworm-slim \
  harbor.home.arpa/ci-tools/node:24.18.0-alpine3.24 \
  harbor.home.arpa/ci-tools/docker:29.6.1-cli \
  harbor.home.arpa/ci-tools/trivy:0.72.0 \
  harbor.home.arpa/ci-tools/helm:3.19.0 \
  harbor.home.arpa/ci-tools/gitops:1.0.0-alpine3.22
do
  sudo docker manifest inspect \
    "$IMAGE" \
    >/dev/null

  echo "OK: ${IMAGE}"
done
```

检查 GitOps 镜像：

```bash
sudo docker run \
  --rm \
  harbor.home.arpa/ci-tools/gitops:1.0.0-alpine3.22 \
  git \
  --version
```

### 五、检查 Trivy DB 新鲜度

```bash
sudo test -s \
  /var/lib/gitlab-runner/trivy-cache/db/trivy.db

sudo test -s \
  /var/lib/gitlab-runner/trivy-cache/db/metadata.json

sudo test -s \
  /var/lib/gitlab-runner/trivy-cache/last-successful-update
```

计算数据库年龄：

```bash
CURRENT_TIME="$(date +%s)"

LAST_UPDATE="$(
  sudo cat \
    /var/lib/gitlab-runner/trivy-cache/last-successful-update
)"

DB_AGE="$((CURRENT_TIME - LAST_UPDATE))"

echo "Trivy DB age: ${DB_AGE} seconds"

test "$DB_AGE" -le 172800
```

### 六、检查 Kubernetes Pull Secret

### 【k8s-master01】

```bash
kubectl \
  -n demo-dev \
  get secret \
  harbor-pull
```

检查用户名：

```bash
SECRET_USERNAME="$(
  kubectl \
    -n demo-dev \
    get secret \
    harbor-pull \
    -o jsonpath='{.data.\.dockerconfigjson}' \
    | base64 -d \
    | jq -r \
        '.auths["harbor.home.arpa"].auth' \
    | base64 -d \
    | cut -d ':' -f 1
)"

case "$SECRET_USERNAME" in
  *'<'*'>'*|'')
    echo "错误：Harbor Pull Secret 仍然包含占位符"
    exit 1
    ;;

  *)
    printf 'Harbor Pull Username: %s\n' \
      "$SECRET_USERNAME"
    ;;
esac
```

全部检查通过后，才能进入第十二阶段。

---

# 第十二阶段：编写 GitLab CI

## 15.0 执行位置说明

本阶段涉及：

```text
【runner01】
确认已经完成：
- 内部域名 extra_hosts
- Platform Root CA 挂载
- Harbor Root CA 挂载
- SonarScanner TrustStore 挂载
- Trivy DB 首次下载
- Trivy DB Timer 启用
- GitOps Job 镜像推送到 Harbor

【管理 Mac 终端】
在 demo-api 功能分支中创建 .gitlab-ci.yml。

【管理 Mac 浏览器】
创建 Merge Request，并观察 Pipeline。

【GitLab Runner】
自动执行：
- npm 单元测试
- SonarQube 分析
- Docker BuildKit 构建
- 本地 Trivy DB 漏洞扫描
- Harbor Push
- GitOps 仓库更新
```

不要在 `runner01` 上手工克隆和修改业务代码。

---

## 15.1 为 SonarScanner 配置 TrustStore

前面的教程已经完成：

```text
第 5.4 节：
在管理 Mac 生成 sonar-truststore.p12

第 7.8 节：
把该文件复制到 runner01
```

因此本节**不再重新生成 TrustStore**，只检查现有文件并确认 Runner 已正确挂载。

SonarScanner Job 使用：

```text
/opt/sonar-truststore/truststore.p12
```

作为容器内 TrustStore 路径。

---

### 一、检查现有 TrustStore

### 【runner01】

确认文件存在：

```bash
sudo ls -l \
  /etc/gitlab-runner/certs/sonar-truststore.p12
```

预期文件为：

```text
/etc/gitlab-runner/certs/sonar-truststore.p12
```

该文件只包含公开 CA 证书，不包含私钥，权限应为 `0644`，以确保未来使用非 root Job 用户时仍可读取。

检查文件类型：

```bash
sudo file \
  /etc/gitlab-runner/certs/sonar-truststore.p12
```

验证 PKCS#12 内容：

```bash
sudo openssl pkcs12 \
  -in /etc/gitlab-runner/certs/sonar-truststore.p12 \
  -passin pass:changeit \
  -nokeys \
  -info
```

能够显示以下内容即表示正常：

```text
HomeLab Platform Root CA
```

检查证书主题和指纹：

```bash
sudo openssl pkcs12 \
  -in /etc/gitlab-runner/certs/sonar-truststore.p12 \
  -passin pass:changeit \
  -nokeys \
  2>/dev/null \
  | openssl x509 \
      -noout \
      -subject \
      -issuer \
      -fingerprint \
      -sha256
```

---

### 二、确认 Runner 挂载 TrustStore

### 【runner01】

编辑：

```bash
sudo vim \
  /etc/gitlab-runner/config.toml
```

在：

```toml
[runners.docker]
```

最终相关配置应类似：

```toml
volumes = [
  "/var/run/docker.sock:/var/run/docker.sock",
  "/cache",
  "/etc/gitlab-runner/certs/platform-root-ca.crt:/usr/local/share/ca-certificates/platform-root-ca.crt:ro",
  "/etc/gitlab-runner/certs/harbor-ca.crt:/usr/local/share/ca-certificates/harbor-ca.crt:ro",
  "/etc/gitlab-runner/certs/sonar-truststore.p12:/opt/sonar-truststore/truststore.p12:ro",
  "/var/lib/gitlab-runner/trivy-cache:/var/lib/gitlab-runner/trivy-cache"
]
```

---

### 三、重启并验证 Runner

### 【runner01】

```bash
sudo systemctl restart \
  gitlab-runner
```

验证 Runner 注册状态：

```bash
sudo gitlab-runner verify
```

检查服务：

```bash
sudo systemctl status \
  gitlab-runner \
  --no-pager
```

检查最近日志：

```bash
sudo journalctl \
  -u gitlab-runner \
  -n 100 \
  --no-pager
```

---
## 15.2 创建 .gitlab-ci.yml

### 【管理 Mac】

进入业务代码仓库：

```bash
cd \
  "$HOME/workspace/cicd-demo/demo-api"
```

确认当前分支：

```bash
git branch \
  --show-current
```

首次创建流水线时，当前应为：

```text
feature/initialize-demo-api
```

创建 `.gitlab-ci.yml`：

```bash
cat > .gitlab-ci.yml <<'EOF'
stages:
  - test
  - quality
  - build
  - gitops

default:
  tags:
    - docker
    - private

  interruptible: true

workflow:
  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'

    - if: '$CI_COMMIT_BRANCH && $CI_OPEN_MERGE_REQUESTS'
      when: never

    - if: '$CI_COMMIT_BRANCH'

variables:
  GIT_DEPTH: "0"
  GIT_TERMINAL_PROMPT: "0"
  DOCKER_BUILDKIT: "1"

  NPM_CONFIG_CACHE:
    "${CI_PROJECT_DIR}/.npm"

  SONAR_USER_HOME:
    "${CI_PROJECT_DIR}/.sonar"

  SONAR_BINARY_CACHE:
    "${CI_PROJECT_DIR}/.sonar/native-sonar-scanner"

  NODE_EXTRA_CA_CERTS:
    "/usr/local/share/ca-certificates/platform-root-ca.crt"

test:
  stage: test

  image:
    harbor.home.arpa/ci-tools/node:24.18.0-bookworm-slim

  cache:
    key:
      prefix: "npm-test-${CI_PROJECT_ID}"

      files:
        - package-lock.json

    paths:
      - .npm/

  before_script:
    - >
      npm ci
      --prefer-offline
      --no-audit
      --no-fund

  script:
    - npm test

  artifacts:
    when: always

    paths:
      - coverage/

    expire_in: 1 day

  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'

    - if: '$CI_COMMIT_BRANCH'

sonarqube:
  stage: quality

  image:
    harbor.home.arpa/ci-tools/node:24.18.0-bookworm-slim

  needs:
    - job: test
      artifacts: true

  cache:
    key:
      prefix: "npm-sonar-${CI_PROJECT_ID}"

      files:
        - package-lock.json

    paths:
      - .npm/
      - .sonar/

  before_script:
    - >
      npm ci
      --prefer-offline
      --no-audit
      --no-fund

  script:
    - >
      npx @sonar/scan
      -Dsonar.host.url="${SONAR_HOST_URL}"
      -Dsonar.token="${SONAR_TOKEN}"
      -Dsonar.qualitygate.wait=true
      -Dsonar.qualitygate.timeout=300
      -Dsonar.scanner.truststorePath=/opt/sonar-truststore/truststore.p12
      -Dsonar.scanner.truststorePassword=changeit

  rules:
    - if: '$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH'

build_scan_push:
  stage: build

  interruptible: false

  image:
    harbor.home.arpa/ci-tools/docker:29.6.1-cli

  needs:
    - job: sonarqube

  before_script:
    - >
      test
      -s
      /usr/local/share/ca-certificates/harbor-ca.crt

    - update-ca-certificates

    - >
      test
      -s
      /var/lib/gitlab-runner/trivy-cache/db/trivy.db

    - >
      test
      -s
      /var/lib/gitlab-runner/trivy-cache/db/metadata.json

    - >
      test
      -s
      /var/lib/gitlab-runner/trivy-cache/last-successful-update

    - |
      CURRENT_TIME="$(date +%s)"

      LAST_UPDATE="$(
        cat \
          /var/lib/gitlab-runner/trivy-cache/last-successful-update
      )"

      DB_AGE="$((CURRENT_TIME - LAST_UPDATE))"

      echo "Trivy DB age: ${DB_AGE} seconds"

      if [ "$DB_AGE" -gt 172800 ]; then
        echo "Trivy DB 超过 48 小时未成功更新"
        exit 1
      fi

    - >
      echo "${HARBOR_PASSWORD}"
      | docker login
      "${HARBOR_REGISTRY}"
      --username "${HARBOR_USERNAME}"
      --password-stdin

  script:
    - |
      export IMAGE_REPOSITORY="${HARBOR_REGISTRY}/${HARBOR_PROJECT}/${CI_PROJECT_NAME}"
      export IMAGE_TAG="sha-${CI_COMMIT_SHA}"

      printf \
        "IMAGE_REPOSITORY=%s\nIMAGE_TAG=%s\n" \
        "${IMAGE_REPOSITORY}" \
        "${IMAGE_TAG}" \
        > build.env

    - >
      docker build
      --pull
      --label
      "org.opencontainers.image.revision=${CI_COMMIT_SHA}"
      --label
      "org.opencontainers.image.source=${CI_PROJECT_URL}"
      --tag
      "${IMAGE_REPOSITORY}:${IMAGE_TAG}"
      .

    - >
      docker run
      --rm
      --volume
      /var/run/docker.sock:/var/run/docker.sock
      --volume
      /var/lib/gitlab-runner/trivy-cache:/root/.cache/trivy
      harbor.home.arpa/ci-tools/trivy:0.72.0
      image
      --cache-dir
      /root/.cache/trivy
      --skip-db-update
      --scanners
      vuln
      --format
      json
      --output
      /dev/stdout
      --severity
      HIGH,CRITICAL
      --ignore-unfixed
      "${IMAGE_REPOSITORY}:${IMAGE_TAG}"
      > trivy-report.json

    - >
      docker run
      --rm
      --volume
      /var/run/docker.sock:/var/run/docker.sock
      --volume
      /var/lib/gitlab-runner/trivy-cache:/root/.cache/trivy
      harbor.home.arpa/ci-tools/trivy:0.72.0
      image
      --cache-dir
      /root/.cache/trivy
      --skip-db-update
      --scanners
      vuln
      --exit-code
      1
      --severity
      HIGH,CRITICAL
      --ignore-unfixed
      "${IMAGE_REPOSITORY}:${IMAGE_TAG}"

    - >
      docker push
      "${IMAGE_REPOSITORY}:${IMAGE_TAG}"

  after_script:
    - >
      docker logout
      "${HARBOR_REGISTRY}"
      || true

  artifacts:
    when: always

    paths:
      - trivy-report.json

    reports:
      dotenv: build.env

    expire_in: 7 days

  rules:
    - if: '$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH'

update_gitops:
  stage: gitops

  interruptible: false

  image:
    harbor.home.arpa/ci-tools/gitops:1.0.0-alpine3.22

  resource_group:
    demo-dev-gitops

  needs:
    - job: build_scan_push
      artifacts: true

  before_script:
    - >
      test
      -s
      /usr/local/share/ca-certificates/platform-root-ca.crt

    - update-ca-certificates

    - >
      git config
      --global
      user.name
      "gitops-bot"

    - >
      git config
      --global
      user.email
      "gitops-bot@home.arpa"

  script:
    - |
      umask 077

      printf \
        'machine gitlab.home.arpa\nlogin %s\npassword %s\n' \
        "${GITOPS_USERNAME}" \
        "${GITOPS_TOKEN}" \
        > "${HOME}/.netrc"

    - >
      git clone
      --branch
      dev
      --single-branch
      "${GITOPS_REPO_URL}"
      gitops

    - cd gitops/helm/demo-app

    - >
      sed
      -i
      -E
      "s|^  tag:.*$|  tag: \"${IMAGE_TAG}\"|"
      values-dev.yaml

    - git add values-dev.yaml

    - |
      if git diff --cached --quiet; then
        echo "GitOps dev branch already uses ${IMAGE_TAG}"
      else
        git commit \
          -m "chore(dev): deploy ${CI_PROJECT_NAME} ${IMAGE_TAG}"

        git push origin dev
      fi

  after_script:
    - rm -f "${HOME}/.netrc"

  retry: 2

  rules:
    - if: '$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH'
EOF
```

关键调整：

```text
npm 缓存 Key 绑定 package-lock.json
镜像 Tag 使用完整 CI_COMMIT_SHA
build_scan_push 和 update_gitops 不允许中途自动取消
Trivy DB 超过 48 小时未更新时阻断流水线
GitOps Job 使用版本化镜像
GitOps Bot 只更新 dev 分支
GitOps 自动提交会触发 demo-gitops 的 Helm 校验 CI
```

---

## 15.3 检查并提交 CI 配置

### 【管理 Mac】

检查空白和缩进问题：

```bash
git diff \
  --check
```

查看修改内容：

```bash
git diff \
  -- .gitlab-ci.yml
```

查看 Git 状态：

```bash
git status
```

首次提交流水线时执行：

```bash
git add \
  .gitlab-ci.yml

git commit \
  -m "feat: add GitLab CI pipeline"
```

推送当前功能分支：

```bash
git push \
  -u \
  origin \
  feature/initialize-demo-api
```

不要执行：

```text
git push origin main
```

因为 `demo-api/main` 已受保护，人工代码必须通过 Merge Request 合并。

如果 `.gitlab-ci.yml` 已经合并到 `main`，本次是在修复已有流水线，应从最新 `main` 创建新的修复分支：

```bash
git switch \
  main

git pull \
  --ff-only

git switch \
  -c fix/stabilize-cicd-pipeline
```

修改并检查 `.gitlab-ci.yml` 后提交：

```bash
git add \
  .gitlab-ci.yml

git commit \
  -m "fix: stabilize Harbor, Trivy and GitOps CI jobs"
```

推送：

```bash
git push \
  -u \
  origin \
  fix/stabilize-cicd-pipeline
```

---

## 15.4 创建 Merge Request

### 【管理 Mac 浏览器】

首次创建流水线时，进入：

```text
platform/demo-api
→ Merge requests
→ New merge request
```

设置：

```text
Source branch：
feature/initialize-demo-api

Target branch：
main
```

如果是在修复已经存在的流水线，则设置：

```text
Source branch：
fix/stabilize-cicd-pipeline

Target branch：
main
```

创建 Merge Request。

MR Pipeline 只运行：

```text
test
```

新的 `test` Job 应直接进入：

```text
npm ci
→ npm test
```

不再执行：

```text
apt-get update
```

测试通过后合并到：

```text
main
```

合并后，`main` Pipeline 才会执行：

```text
test
→ sonarqube
→ build_scan_push
→ update_gitops
```

---

## 15.5 检查第一次完整 Pipeline

### 【管理 Mac 浏览器】

进入：

```text
platform/demo-api
→ Build
→ Pipelines
```

打开 `main` 分支最新 Pipeline。

第一次完整 Pipeline 应依次完成：

```text
test
→ sonarqube
→ build_scan_push
→ update_gitops
```

### 一、test

应完成：

```text
恢复或创建以 package-lock.json 为 Key 的 npm 缓存
npm ci
npm test
生成 coverage/lcov.info
```

不应再出现：

```text
apt-get update
deb.debian.org
```

### 二、sonarqube

应完成：

```text
恢复 npm 和 SonarScanner 缓存
加载 PKCS#12 TrustStore
连接 sonarqube.home.arpa
执行代码分析
等待 Quality Gate
```

最终应看到：

```text
QUALITY GATE STATUS: PASSED
```

### 三、build_scan_push

应完成：

```text
更新 Job 容器 Harbor CA
检查 Trivy DB 和最后成功更新时间
使用完整 Commit SHA 生成镜像 Tag
Docker BuildKit 构建镜像
使用本地 Trivy DB 扫描
HIGH/CRITICAL 为 0
推送镜像到 Harbor
上传 trivy-report.json
上传 build.env
```

Trivy 日志中不应出现：

```text
Need to update DB
Downloading vulnerability DB
mirror.gcr.io
```

镜像 Tag 应类似：

```text
sha-e1100317xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

实际值为：

```text
sha-${CI_COMMIT_SHA}
```

### 四、update_gitops

应使用：

```text
harbor.home.arpa/ci-tools/gitops:1.0.0-alpine3.22
```

不应出现：

```text
apk add
dl-cdn.alpinelinux.org
```

应执行：

```text
克隆 demo-gitops/dev
修改 helm/demo-app/values-dev.yaml
提交到 dev
推送 dev
```

`build_scan_push` 和 `update_gitops` 均设置：

```yaml
interruptible: false
```

即使新的 `main` Pipeline 已创建，也不会在镜像推送或 GitOps 写入过程中被自动取消。

### 五、检查 GitOps dev 分支

### 【管理 Mac】

进入 GitOps 仓库：

```bash
cd \
  "$HOME/workspace/cicd-demo/demo-gitops"

git fetch \
  origin

git switch \
  dev

git pull \
  --ff-only \
  origin \
  dev
```

检查镜像 Tag：

```bash
grep -A 3 \
  '^image:' \
  helm/demo-app/values-dev.yaml
```

应类似：

```yaml
image:
  repository: harbor.home.arpa/demo/demo-api
  tag: "sha-完整40位CommitSHA"
```

不能仍然是：

```text
sha-bootstrap
```

### 六、检查 demo-gitops 校验 Pipeline

### 【管理 Mac 浏览器】

进入：

```text
platform/demo-gitops
→ Build
→ Pipelines
```

应看到由 GitOps Bot 提交触发的 `dev` Pipeline，并且：

```text
validate_helm：Passed
```

完成检查后可以切回：

```bash
git switch \
  main
```

---

# 第十三阶段：创建 Argo CD App of Apps

## 16.0 执行位置说明

本阶段把 Argo CD 配置改为 App of Apps：

```text
platform-bootstrap：
读取 demo-gitops/main
管理 argocd/ 目录中的 AppProject 和 Application

demo-dev：
读取 demo-gitops/dev
管理 helm/demo-app
```

第一次只需要手工 `kubectl apply` 根 Application。以后修改 `argocd/` 下的 AppProject 或 Application 并合并到 `main` 后，由根 Application 自动同步，不再重复手工复制和 Apply 每个文件。

第一次 Bootstrap 前必须确认：

```text
1. demo-gitops 已成功添加到 Argo CD
2. demo-gitops/dev 的 values-dev.yaml 已经是实际完整 SHA 镜像
3. Harbor 中存在对应镜像
4. demo-dev Namespace 中已存在 harbor-pull 和 demo-tls
5. harbor-pull 用户名不是教程占位符
```

---

## 16.1 创建功能分支

### 【管理 Mac】

```bash
cd \
  "$HOME/workspace/cicd-demo/demo-gitops"

git switch \
  main

git pull \
  --ff-only

git switch \
  -c feature/add-argocd-app-of-apps
```

创建目录：

```bash
mkdir -p \
  argocd
```

---

## 16.2 创建 AppProject

### 【管理 Mac】

创建：

```bash
cat > argocd/demo-project.yaml <<'EOF'
apiVersion: argoproj.io/v1alpha1
kind: AppProject

metadata:
  name: demo
  namespace: argocd

spec:
  description: Demo applications

  sourceRepos:
    - https://gitlab.home.arpa/platform/demo-gitops.git

  destinations:
    - namespace: demo-dev
      server: https://kubernetes.default.svc

  namespaceResourceWhitelist:
    - group: "*"
      kind: "*"

  orphanedResources:
    warn: true

    ignore:
      - kind: Secret
        name: demo-tls

      - kind: Secret
        name: harbor-pull
EOF
```

仍然保留：

```yaml
warn: true
```

因此其他未知孤儿资源仍会产生告警，只忽略两个明确由管理员或外部 Secret 系统管理的 Secret。

---

## 16.3 创建开发环境 Application

### 【管理 Mac】

创建：

```bash
cat > argocd/demo-dev.yaml <<'EOF'
apiVersion: argoproj.io/v1alpha1
kind: Application

metadata:
  name: demo-dev
  namespace: argocd

spec:
  project: demo

  source:
    repoURL: >-
      https://gitlab.home.arpa/platform/demo-gitops.git

    targetRevision: dev

    path: helm/demo-app

    helm:
      valueFiles:
        - values-dev.yaml

  destination:
    server: https://kubernetes.default.svc
    namespace: demo-dev

  syncPolicy:
    automated:
      prune: true
      selfHeal: true

    syncOptions:
      - CreateNamespace=true
      - PruneLast=true
EOF
```

`demo-dev` 读取：

```text
demo-gitops/dev
```

而不是 `main`。

---

## 16.4 创建根 Application

### 【管理 Mac】

创建：

```bash
cat > argocd/platform-bootstrap.yaml <<'EOF'
apiVersion: argoproj.io/v1alpha1
kind: Application

metadata:
  name: platform-bootstrap
  namespace: argocd

spec:
  project: default

  source:
    repoURL: >-
      https://gitlab.home.arpa/platform/demo-gitops.git

    targetRevision: main

    path: argocd

    directory:
      recurse: true

  destination:
    server: https://kubernetes.default.svc
    namespace: argocd

  syncPolicy:
    automated:
      prune: true
      selfHeal: true

    syncOptions:
      - PruneLast=true
EOF
```

根 Application 读取 `main`，并管理：

```text
argocd/platform-bootstrap.yaml
argocd/demo-project.yaml
argocd/demo-dev.yaml
```

---

## 16.5 提交并合并配置

### 【管理 Mac】

检查：

```bash
git diff \
  --check

git status
```

提交：

```bash
git add \
  argocd/platform-bootstrap.yaml \
  argocd/demo-project.yaml \
  argocd/demo-dev.yaml

git commit \
  -m "feat: add Argo CD app of apps"
```

推送：

```bash
git push \
  -u \
  origin \
  feature/add-argocd-app-of-apps
```

### 【GitLab 网页】

创建：

```text
feature/add-argocd-app-of-apps
→ main
```

等待 `validate_helm` 成功后合并。

### 【管理 Mac】

获取合并后的配置：

```bash
git switch \
  main

git pull \
  --ff-only
```

---

## 16.6 首次 Bootstrap

第一次只手工应用根 Application。

### 【管理 Mac】

复制根 Application：

```bash
scp \
  argocd/platform-bootstrap.yaml \
  ys@192.168.2.201:/tmp/platform-bootstrap.yaml
```

### 【k8s-master01】

检查：

```bash
grep -RInE \
  '<[A-Z0-9_]+>' \
  /tmp/platform-bootstrap.yaml \
  && exit 1 \
  || true
```

应用：

```bash
kubectl apply \
  -f /tmp/platform-bootstrap.yaml
```

检查：

```bash
kubectl \
  -n argocd \
  get application \
  platform-bootstrap
```

清理：

```bash
rm -f \
  /tmp/platform-bootstrap.yaml
```

---

## 16.7 等待根 Application 同步

### 【管理 Mac】

```bash
export ARGOCD_OPTS="--grpc-web"
```

等待：

```bash
argocd app wait \
  platform-bootstrap \
  --sync \
  --health \
  --timeout 600
```

检查：

```bash
argocd app get \
  platform-bootstrap
```

应显示：

```text
Sync Status: Synced
Health Status: Healthy
```

根 Application 同步后，应自动创建：

```text
AppProject/demo
Application/demo-dev
```

---

## 16.8 等待开发 Application 同步

主动刷新：

```bash
argocd app get \
  demo-dev \
  --hard-refresh
```

等待：

```bash
argocd app wait \
  demo-dev \
  --sync \
  --health \
  --timeout 600
```

预期：

```text
Sync Status: Synced
Health Status: Healthy
```

检查资源：

```bash
argocd app resources \
  demo-dev
```

`demo-tls` 和 `harbor-pull` 不应再显示为需要告警的孤儿资源。

---

## 16.9 后续修改规则

以后修改：

```text
argocd/demo-project.yaml
argocd/demo-dev.yaml
argocd/platform-bootstrap.yaml
```

应通过功能分支和 Merge Request 合并到：

```text
main
```

根 Application 会自动同步，不需要再次手工执行：

```bash
kubectl apply
```

开发镜像版本继续由业务 Pipeline 自动写入：

```text
dev
→ helm/demo-app/values-dev.yaml
```

---

# 第十四阶段：验收完整链路

## 17.0 执行位置说明

```text
【管理 Mac 浏览器】
检查 GitLab Pipeline、Harbor 镜像和 Argo CD 页面。

【管理 Mac 终端】
检查 main/dev 分支、运行 argocd CLI 和 curl。

【k8s-master01】
检查 Kubernetes 资源、Pod 分布和滚动发布。
```

---

## 17.1 检查 GitLab Pipeline

### 【管理 Mac 浏览器】

进入：

```text
platform/demo-api
→ Build
→ Pipelines
```

确认 `main` 最新 Pipeline 为：

```text
Passed
```

四个 Job 全部成功：

```text
test
sonarqube
build_scan_push
update_gitops
```

再进入：

```text
platform/demo-gitops
→ Build
→ Pipelines
```

确认由 GitOps Bot 提交触发的 `dev` Pipeline 中：

```text
validate_helm：Passed
```

---

## 17.2 检查 Harbor 镜像和 GitOps dev 分支

### 【管理 Mac 浏览器】

进入：

```text
https://harbor.home.arpa
→ Projects
→ demo
→ Repositories
→ demo-api
```

应看到使用完整 Commit SHA 的 Tag。

### 【管理 Mac】

```bash
cd \
  "$HOME/workspace/cicd-demo/demo-gitops"

git fetch \
  origin

git switch \
  dev

git pull \
  --ff-only \
  origin \
  dev
```

检查：

```bash
grep -A 3 \
  '^image:' \
  helm/demo-app/values-dev.yaml
```

Harbor 中的 Tag、`values-dev.yaml` 中的 Tag 和业务提交 SHA 必须一致。

---

## 17.3 检查 Argo CD

### 【管理 Mac】

```bash
export ARGOCD_OPTS="--grpc-web"

argocd app get \
  platform-bootstrap

argocd app get \
  demo-dev
```

两个 Application 都应显示：

```text
Sync Status: Synced
Health Status: Healthy
```

检查资源：

```bash
argocd app resources \
  demo-dev
```

应包含：

```text
ServiceAccount
Deployment
Service
Ingress
PodDisruptionBudget
```

不应再出现两个已知 Secret 的 `OrphanedResourceWarning`。

---

## 17.4 检查 Kubernetes

### 【k8s-master01】

```bash
kubectl \
  -n demo-dev \
  get \
  deployment,pod,service,ingress,pdb \
  -o wide
```

检查 Pod 分布：

```bash
kubectl \
  -n demo-dev \
  get pods \
  -o custom-columns='POD:.metadata.name,NODE:.spec.nodeName,POD-IP:.status.podIP,IMAGE:.spec.containers[0].image'
```

三个 Pod 应优先分布在：

```text
k8s-worker01
k8s-worker02
k8s-worker03
```

检查 Deployment 镜像：

```bash
kubectl \
  -n demo-dev \
  get deployment \
  demo-dev \
  -o jsonpath='{.spec.template.spec.containers[0].image}{"\n"}'
```

检查滚动发布状态：

```bash
kubectl \
  -n demo-dev \
  rollout status \
  deployment/demo-dev
```

---

## 17.5 访问应用

### 【管理 Mac】

```bash
curl \
  https://demo.home.arpa/healthz

echo
```

应返回：

```json
{"status":"ok"}
```

检查版本：

```bash
curl \
  https://demo.home.arpa/

echo
```

返回的 `version` 应为完整 SHA Tag。

zsh 在响应没有换行时显示的 `%` 不是接口返回内容。教程中的命令额外执行 `echo`，便于阅读输出。

---

## 17.6 验证自动发布

### 一、创建功能分支

### 【管理 Mac】

```bash
cd \
  "$HOME/workspace/cicd-demo/demo-api"

git switch \
  main

git pull \
  --ff-only

git switch \
  -c feature/update-api-response
```

编辑：

```bash
vim \
  src/app.js
```

将根接口修改为：

```javascript
app.get("/", (_request, response) => {
  response.json({
    name: "demo-api",
    version: process.env.APP_VERSION || "development",
    message: "GitOps deployment succeeded",
  });
});
```

运行测试：

```bash
npm test
```

提交并推送：

```bash
git add \
  src/app.js

git commit \
  -m "feat: update API response"

git push \
  -u \
  origin \
  feature/update-api-response
```

### 二、创建 Merge Request

### 【管理 Mac 浏览器】

创建：

```text
feature/update-api-response
→ main
```

MR 测试通过后合并。

### 三、观察发布

业务 Pipeline 应执行：

```text
test
→ sonarqube
→ build_scan_push
→ update_gitops
```

GitOps Bot 随后更新：

```text
demo-gitops/dev
```

`demo-gitops` 的 Helm 校验 Pipeline 应通过，Argo CD 随后同步新版本。

### 【k8s-master01】

```bash
kubectl \
  -n demo-dev \
  get pods \
  -w
```

另一个终端：

```bash
kubectl \
  -n demo-dev \
  rollout status \
  deployment/demo-dev \
  --timeout=10m
```

### 【管理 Mac】

```bash
argocd app wait \
  demo-dev \
  --sync \
  --health \
  --timeout 600
```

检查新响应：

```bash
curl \
  https://demo.home.arpa/

echo
```

应包含：

```json
"message": "GitOps deployment succeeded"
```

完整链路：

```text
功能分支 Push
→ Merge Request Test
→ 合并 demo-api/main
→ Unit Test
→ SonarQube
→ Docker Build
→ Trivy
→ Harbor
→ GitOps Bot 更新 demo-gitops/dev
→ GitOps Helm 校验
→ Argo CD
→ Kubernetes RollingUpdate
```

---

# 第十五阶段：开发、测试和生产环境

## 18.1 当前实际环境

当前教程实际部署：

```text
demo-dev
```

开发配置来自：

```text
demo-gitops/dev
→ helm/demo-app/values-dev.yaml
```

根 App of Apps 配置来自：

```text
demo-gitops/main
→ argocd/
```

当前不需要立即创建：

```text
demo-test
demo-prod
```

---

## 18.2 分支和环境边界

当前分支职责：

|分支|允许的自动写入|用途|
|---|---|---|
|`dev`|GitOps Bot 可以直接 Push|开发环境镜像版本|
|`main`|禁止直接 Push|基础配置、App of Apps、未来 Test/Prod 配置|

开发环境 Application 使用：

```yaml
targetRevision: dev
```

根 Application 使用：

```yaml
targetRevision: main
```

这样 GitOps Bot 无法直接修改未来生产配置。

---

## 18.3 后续扩展结构

最终可以扩展为：

```text
helm/demo-app
├── values.yaml
├── values-dev.yaml
├── values-test.yaml
└── values-prod.yaml
```

对应：

```text
demo-dev
demo-test
demo-prod
```

发布规则：

|环境|Git 分支和配置|发布方式|
|---|---|---|
|Dev|`dev/values-dev.yaml`|业务 `main` Pipeline 自动更新|
|Test|`main/values-test.yaml`|人工创建 GitOps Merge Request|
|Prod|`main/values-prod.yaml`|负责人审核 GitOps Merge Request|

Test 和 Prod 的 Application 均应读取：

```text
main
```

---

## 18.4 镜像只构建一次

假设 CI 生成：

```text
harbor.home.arpa/demo/demo-api:sha-完整CommitSHA
```

环境晋级应复用同一个镜像：

```text
同一个 SHA 镜像
├── Dev
├── Test
└── Prod
```

从 Dev 晋级到 Test 或 Prod 时，只修改对应环境配置，不重新构建。

禁止：

```text
Dev 构建一次
Test 再构建一次
Prod 再构建一次
```

否则三个环境即使版本名称相同，也可能运行不同内容。

---

## 18.5 生产环境进一步收紧

生产环境建议额外启用：

```text
main 禁止所有直接 Push
生产配置必须通过 Merge Request
生产 Application 可以关闭 automated 或增加 Sync Window
镜像使用 Digest 而不只使用 Tag
部署前校验镜像签名
Secret 使用 External Secrets 或 Sealed Secrets
```

这些增强在第二十一阶段给出。

---

# 第十六阶段：GitOps 回滚

## 19.0 执行位置说明

开发环境回滚修改：

```text
demo-gitops/dev
```

不修改业务代码仓库，也不直接执行 `kubectl rollout undo`。

---

## 19.1 查看开发部署历史

### 【管理 Mac】

```bash
cd \
  "$HOME/workspace/cicd-demo/demo-gitops"

git fetch \
  origin

git switch \
  dev

git pull \
  --ff-only \
  origin \
  dev
```

查看历史：

```bash
git log \
  --oneline \
  -- helm/demo-app/values-dev.yaml
```

查看某次提交：

```bash
DEPLOY_COMMIT="请替换为提交ID"

git show \
  "$DEPLOY_COMMIT" \
  -- helm/demo-app/values-dev.yaml
```

GitOps Bot 提交通常类似：

```text
chore(dev): deploy demo-api sha-完整CommitSHA
```

---

## 19.2 使用 Git Revert 回滚最近一次部署

记录错误部署提交：

```bash
BAD_DEPLOY_COMMIT="请替换为错误部署提交ID"
```

创建回滚分支：

```bash
git switch \
  -c rollback/demo-dev \
  dev
```

执行：

```bash
git revert \
  --no-edit \
  "$BAD_DEPLOY_COMMIT"
```

检查：

```bash
git diff \
  HEAD~1 \
  -- helm/demo-app/values-dev.yaml
```

推送：

```bash
git push \
  -u \
  origin \
  rollback/demo-dev
```

---

## 19.3 创建回滚 Merge Request

### 【管理 Mac 浏览器】

创建：

```text
rollback/demo-dev
→ dev
```

检查 `values-dev.yaml` 中的镜像版本后合并。

虽然 GitOps Bot 可以直接 Push `dev`，人工回滚仍通过 Merge Request 留下审核记录。

---

## 19.4 同步并验证回滚

### 【管理 Mac】

```bash
export ARGOCD_OPTS="--grpc-web"

argocd app wait \
  demo-dev \
  --sync \
  --health \
  --timeout 600
```

### 【k8s-master01】

```bash
kubectl \
  -n demo-dev \
  get deployment \
  demo-dev \
  -o jsonpath='{.spec.template.spec.containers[0].image}{"\n"}'
```

```bash
kubectl \
  -n demo-dev \
  rollout status \
  deployment/demo-dev \
  --timeout=10m
```

### 【管理 Mac】

```bash
curl \
  https://demo.home.arpa/

echo
```

---

## 19.5 回滚到指定已知稳定镜像

如果需要回滚的不是最近一次提交，直接创建分支：

```bash
git switch \
  dev

git pull \
  --ff-only \
  origin \
  dev

git switch \
  -c rollback/demo-dev-to-known-good
```

编辑：

```bash
vim \
  helm/demo-app/values-dev.yaml
```

修改为已知稳定的完整 SHA Tag：

```yaml
image:
  repository: harbor.home.arpa/demo/demo-api
  tag: "sha-已知稳定完整CommitSHA"
```

提交并推送：

```bash
git add \
  helm/demo-app/values-dev.yaml

git commit \
  -m "revert(dev): deploy known-good demo-api image"

git push \
  -u \
  origin \
  rollback/demo-dev-to-known-good
```

创建：

```text
rollback/demo-dev-to-known-good
→ dev
```

Merge Request。

---

## 19.6 为什么不直接使用 rollout undo

不建议只执行：

```bash
kubectl \
  -n demo-dev \
  rollout undo \
  deployment/demo-dev
```

因为 Argo CD 已启用：

```yaml
automated:
  prune: true
  selfHeal: true
```

`rollout undo` 只改变集群实际状态，没有改变 `demo-gitops/dev` 中的期望状态。Argo CD 随后会再次恢复 Git 声明的错误版本。

正确路径：

```text
修改或 Revert demo-gitops/dev
→ GitOps Helm 校验
→ Argo CD 同步
→ Kubernetes 滚动恢复
```

---

# 第十七阶段：接入 backup01

## 20.0 执行位置和备份方式

本阶段使用现有：

```text
backup01：192.168.2.231
传输方式：SFTP
备份工具：Restic
远程用户：restic
```

备份由源主机主动推送到 `backup01`：

```text
gitlab01    → /srv/restic/gitlab
sonarqube01 → /srv/restic/sonarqube
runner01    → /srv/restic/runner
```

由于 `backup01` 只有 `2C2G`，所有备份任务必须错峰运行。建议顺序：

```text
Kubernetes
→ NFS
→ GitLab
→ SonarQube
→ Runner
→ Harbor
```

下面给出的时间是示例。若现有 Kubernetes、NFS 或 Harbor 备份时间不同，应调整 `OnCalendar`，确保任务不重叠。

---

## 20.1 创建 Restic Repository 目录

### 【backup01】

确认现有 `restic` 用户：

```bash
id restic
```

创建目录：

```bash
sudo mkdir -p \
  /srv/restic/gitlab \
  /srv/restic/sonarqube \
  /srv/restic/runner
```

设置权限：

```bash
sudo chown -R \
  restic:restic \
  /srv/restic/gitlab \
  /srv/restic/sonarqube \
  /srv/restic/runner

sudo chmod 0700 \
  /srv/restic/gitlab \
  /srv/restic/sonarqube \
  /srv/restic/runner
```

确认 SSH 服务：

```bash
sudo systemctl enable --now ssh

sudo systemctl status \
  ssh \
  --no-pager
```

---

## 20.2 配置 gitlab01 的 Restic Repository

### 一、安装 Restic 并配置 SFTP 密钥

### 【gitlab01】

```bash
sudo apt-get update

sudo apt-get install -y \
  restic \
  openssh-client
```

为 root 创建专用密钥：

```bash
sudo install -d \
  -o root \
  -g root \
  -m 0700 \
  /root/.ssh

sudo test -f \
  /root/.ssh/id_ed25519_backup01 \
  || sudo ssh-keygen \
    -t ed25519 \
    -f /root/.ssh/id_ed25519_backup01 \
    -N '' \
    -C 'gitlab01-restic@backup01'
```

将公钥安装到 `backup01` 的 `restic` 用户：

```bash
sudo ssh-copy-id \
  -i /root/.ssh/id_ed25519_backup01.pub \
  restic@192.168.2.231
```

配置 SSH Host：

```bash
sudo touch \
  /root/.ssh/config

sudo sed -i \
  '/# BEGIN BACKUP01 RESTIC/,/# END BACKUP01 RESTIC/d' \
  /root/.ssh/config

sudo tee -a \
  /root/.ssh/config \
  >/dev/null <<'EOF'

# BEGIN BACKUP01 RESTIC
Host backup01-restic
    HostName 192.168.2.231
    User restic
    IdentityFile /root/.ssh/id_ed25519_backup01
    IdentitiesOnly yes
# END BACKUP01 RESTIC
EOF

sudo chmod 600 \
  /root/.ssh/config
```

验证：

```bash
sudo ssh \
  backup01-restic \
  'hostname && test -d /srv/restic/gitlab'
```

### 二、创建 Repository 密码和环境文件

### 【gitlab01】

```bash
sudo install -d \
  -o root \
  -g root \
  -m 0700 \
  /etc/restic \
  /var/cache/restic
```

仅在密码文件不存在时生成：

```bash
if ! sudo test -s \
  /etc/restic/gitlab-repository-password
then
  openssl rand -base64 48 \
    | sudo tee \
        /etc/restic/gitlab-repository-password \
        >/dev/null
fi

sudo chmod 600 \
  /etc/restic/gitlab-repository-password
```

创建环境文件：

```bash
sudo tee \
  /etc/restic/gitlab.env \
  >/dev/null <<'EOF'
RESTIC_REPOSITORY=sftp:backup01-restic:/srv/restic/gitlab
RESTIC_PASSWORD_FILE=/etc/restic/gitlab-repository-password
RESTIC_CACHE_DIR=/var/cache/restic
EOF

sudo chmod 600 \
  /etc/restic/gitlab.env
```

初始化 Repository：

```bash
sudo bash -lc '
  set -a
  source /etc/restic/gitlab.env
  set +a

  if restic snapshots >/dev/null 2>&1; then
    echo "GitLab Restic Repository 已存在"
  else
    restic init
  fi
'
```

必须把：

```text
/etc/restic/gitlab-repository-password
```

中的密码保存到离线密码管理介质。Restic Repository 密码丢失后无法恢复备份。

---

## 20.3 GitLab 每日备份和定时任务

GitLab 官方应用备份命令：

```bash
sudo gitlab-backup create
```

同时必须备份：

```text
/etc/gitlab/gitlab.rb
/etc/gitlab/gitlab-secrets.json
/etc/gitlab/ssl
```

GitLab 恢复必须使用完全相同的 GitLab 版本和 CE/EE 类型，并恢复 `gitlab-secrets.json`。

### 一、创建完整备份脚本

### 【gitlab01】

```bash
sudo tee \
  /usr/local/sbin/backup-gitlab.sh \
  >/dev/null <<'EOF'
#!/usr/bin/env bash

set -Eeuo pipefail

set -a
source /etc/restic/gitlab.env
set +a

gitlab-backup create
gitlab-ctl backup-etc

restic backup \
  /var/opt/gitlab/backups \
  /etc/gitlab/config_backup \
  /etc/gitlab/gitlab.rb \
  /etc/gitlab/gitlab-secrets.json \
  /etc/gitlab/ssl

echo "GitLab Restic backup completed"
EOF

sudo chmod 700 \
  /usr/local/sbin/backup-gitlab.sh
```

手工执行：

```bash
sudo /usr/local/sbin/backup-gitlab.sh
```

检查快照：

```bash
sudo bash -lc '
  set -a
  source /etc/restic/gitlab.env
  set +a
  restic snapshots
'
```

### 二、创建 systemd 定时任务

### 【gitlab01】

```bash
sudo tee \
  /etc/systemd/system/backup-gitlab.service \
  >/dev/null <<'EOF'
[Unit]
Description=Backup GitLab to backup01 with Restic
After=network-online.target gitlab-runsvdir.service
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/backup-gitlab.sh
Nice=10
IOSchedulingClass=best-effort
IOSchedulingPriority=7
EOF
```

示例时间为每天 `03:00`：

```bash
sudo tee \
  /etc/systemd/system/backup-gitlab.timer \
  >/dev/null <<'EOF'
[Unit]
Description=Daily GitLab Restic backup

[Timer]
OnCalendar=*-*-* 03:00:00
Persistent=true
Unit=backup-gitlab.service

[Install]
WantedBy=timers.target
EOF
```

启用：

```bash
sudo systemctl daemon-reload

sudo systemctl enable --now \
  backup-gitlab.timer

systemctl list-timers \
  backup-gitlab.timer
```

---

## 20.4 SonarQube Repository、每日备份和定时任务

### 一、配置 SFTP 和 Repository

### 【sonarqube01】

安装：

```bash
sudo apt-get update

sudo apt-get install -y \
  restic \
  openssh-client
```

创建专用密钥：

```bash
sudo install -d \
  -o root \
  -g root \
  -m 0700 \
  /root/.ssh

sudo test -f \
  /root/.ssh/id_ed25519_backup01 \
  || sudo ssh-keygen \
    -t ed25519 \
    -f /root/.ssh/id_ed25519_backup01 \
    -N '' \
    -C 'sonarqube01-restic@backup01'

sudo ssh-copy-id \
  -i /root/.ssh/id_ed25519_backup01.pub \
  restic@192.168.2.231
```

配置 Host：

```bash
sudo touch \
  /root/.ssh/config

sudo sed -i \
  '/# BEGIN BACKUP01 RESTIC/,/# END BACKUP01 RESTIC/d' \
  /root/.ssh/config

sudo tee -a \
  /root/.ssh/config \
  >/dev/null <<'EOF'

# BEGIN BACKUP01 RESTIC
Host backup01-restic
    HostName 192.168.2.231
    User restic
    IdentityFile /root/.ssh/id_ed25519_backup01
    IdentitiesOnly yes
# END BACKUP01 RESTIC
EOF

sudo chmod 600 \
  /root/.ssh/config
```

创建目录、密码和环境文件：

```bash
sudo install -d \
  -o root \
  -g root \
  -m 0700 \
  /etc/restic \
  /var/cache/restic \
  /var/backups/sonarqube

if ! sudo test -s \
  /etc/restic/sonarqube-repository-password
then
  openssl rand -base64 48 \
    | sudo tee \
        /etc/restic/sonarqube-repository-password \
        >/dev/null
fi

sudo chmod 600 \
  /etc/restic/sonarqube-repository-password

sudo tee \
  /etc/restic/sonarqube.env \
  >/dev/null <<'EOF'
RESTIC_REPOSITORY=sftp:backup01-restic:/srv/restic/sonarqube
RESTIC_PASSWORD_FILE=/etc/restic/sonarqube-repository-password
RESTIC_CACHE_DIR=/var/cache/restic
EOF

sudo chmod 600 \
  /etc/restic/sonarqube.env
```

初始化：

```bash
sudo bash -lc '
  set -a
  source /etc/restic/sonarqube.env
  set +a

  if restic snapshots >/dev/null 2>&1; then
    echo "SonarQube Restic Repository 已存在"
  else
    restic init
  fi
'
```

离线保存 Repository 密码。

### 二、创建 SonarQube 备份脚本

### 【sonarqube01】

```bash
sudo tee \
  /usr/local/sbin/backup-sonarqube.sh \
  >/dev/null <<'EOF'
#!/usr/bin/env bash

set -Eeuo pipefail

set -a
source /etc/restic/sonarqube.env
set +a

STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="/var/backups/sonarqube"
DUMP_FILE="${BACKUP_DIR}/sonarqube-${STAMP}.dump"
TEMP_FILE="${DUMP_FILE}.tmp"

install -d \
  -o root \
  -g root \
  -m 0700 \
  "$BACKUP_DIR"

cd /opt/sonarqube

docker compose exec \
  -T db \
  pg_dump \
  -U sonarqube \
  -d sonarqube \
  -Fc \
  > "$TEMP_FILE"

mv \
  "$TEMP_FILE" \
  "$DUMP_FILE"

chmod 600 \
  "$DUMP_FILE"

restic backup \
  "$DUMP_FILE" \
  /opt/sonarqube/compose.yaml \
  /opt/sonarqube/.env \
  /etc/nginx/sites-available/sonarqube.conf \
  /etc/nginx/ssl

find "$BACKUP_DIR" \
  -type f \
  -name 'sonarqube-*.dump' \
  -mtime +2 \
  -delete

echo "SonarQube Restic backup completed"
EOF

sudo chmod 700 \
  /usr/local/sbin/backup-sonarqube.sh
```

手工执行：

```bash
sudo /usr/local/sbin/backup-sonarqube.sh
```

检查快照：

```bash
sudo bash -lc '
  set -a
  source /etc/restic/sonarqube.env
  set +a
  restic snapshots
'
```

### 三、创建定时任务

### 【sonarqube01】

```bash
sudo tee \
  /etc/systemd/system/backup-sonarqube.service \
  >/dev/null <<'EOF'
[Unit]
Description=Backup SonarQube to backup01 with Restic
After=network-online.target docker.service
Wants=network-online.target
Requires=docker.service

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/backup-sonarqube.sh
Nice=10
IOSchedulingClass=best-effort
IOSchedulingPriority=7
EOF
```

示例时间为每天 `04:00`：

```bash
sudo tee \
  /etc/systemd/system/backup-sonarqube.timer \
  >/dev/null <<'EOF'
[Unit]
Description=Daily SonarQube Restic backup

[Timer]
OnCalendar=*-*-* 04:00:00
Persistent=true
Unit=backup-sonarqube.service

[Install]
WantedBy=timers.target
EOF

sudo systemctl daemon-reload

sudo systemctl enable --now \
  backup-sonarqube.timer

systemctl list-timers \
  backup-sonarqube.timer
```

---

## 20.5 Runner Repository、每日配置备份和定时任务

Runner 不保存业务代码，故障后可以重新安装和注册，但以下内容包含恢复 Runner 所需的配置和证书：

```text
/etc/gitlab-runner/config.toml
/etc/gitlab-runner/certs
/etc/docker/daemon.json
/etc/docker/certs.d/harbor.home.arpa
/usr/local/sbin/update-trivy-db.sh
/etc/systemd/system/update-trivy-db.service
/etc/systemd/system/update-trivy-db.timer
```

`config.toml` 含有 Runner Authentication Token，必须使用加密的 Restic Repository 保存。

### 一、配置 Repository

### 【runner01】

```bash
sudo apt-get update

sudo apt-get install -y \
  restic \
  openssh-client

sudo install -d \
  -o root \
  -g root \
  -m 0700 \
  /root/.ssh \
  /etc/restic \
  /var/cache/restic

sudo test -f \
  /root/.ssh/id_ed25519_backup01 \
  || sudo ssh-keygen \
    -t ed25519 \
    -f /root/.ssh/id_ed25519_backup01 \
    -N '' \
    -C 'runner01-restic@backup01'

sudo ssh-copy-id \
  -i /root/.ssh/id_ed25519_backup01.pub \
  restic@192.168.2.231
```

配置 Host：

```bash
sudo touch \
  /root/.ssh/config

sudo sed -i \
  '/# BEGIN BACKUP01 RESTIC/,/# END BACKUP01 RESTIC/d' \
  /root/.ssh/config

sudo tee -a \
  /root/.ssh/config \
  >/dev/null <<'EOF'

# BEGIN BACKUP01 RESTIC
Host backup01-restic
    HostName 192.168.2.231
    User restic
    IdentityFile /root/.ssh/id_ed25519_backup01
    IdentitiesOnly yes
# END BACKUP01 RESTIC
EOF

sudo chmod 600 \
  /root/.ssh/config
```

创建密码和环境文件：

```bash
if ! sudo test -s \
  /etc/restic/runner-repository-password
then
  openssl rand -base64 48 \
    | sudo tee \
        /etc/restic/runner-repository-password \
        >/dev/null
fi

sudo chmod 600 \
  /etc/restic/runner-repository-password

sudo tee \
  /etc/restic/runner.env \
  >/dev/null <<'EOF'
RESTIC_REPOSITORY=sftp:backup01-restic:/srv/restic/runner
RESTIC_PASSWORD_FILE=/etc/restic/runner-repository-password
RESTIC_CACHE_DIR=/var/cache/restic
EOF

sudo chmod 600 \
  /etc/restic/runner.env

sudo bash -lc '
  set -a
  source /etc/restic/runner.env
  set +a

  if restic snapshots >/dev/null 2>&1; then
    echo "Runner Restic Repository 已存在"
  else
    restic init
  fi
'
```

离线保存 Repository 密码。

### 二、创建备份脚本和定时任务

### 【runner01】

```bash
sudo tee \
  /usr/local/sbin/backup-gitlab-runner.sh \
  >/dev/null <<'EOF'
#!/usr/bin/env bash

set -Eeuo pipefail

set -a
source /etc/restic/runner.env
set +a

restic backup \
  /etc/gitlab-runner/config.toml \
  /etc/gitlab-runner/certs \
  /etc/docker/daemon.json \
  /etc/docker/certs.d/harbor.home.arpa \
  /usr/local/sbin/update-trivy-db.sh \
  /etc/systemd/system/update-trivy-db.service \
  /etc/systemd/system/update-trivy-db.timer

echo "GitLab Runner Restic backup completed"
EOF

sudo chmod 700 \
  /usr/local/sbin/backup-gitlab-runner.sh
```

手工执行：

```bash
sudo /usr/local/sbin/backup-gitlab-runner.sh
```

创建定时任务，示例时间为每天 `05:00`：

```bash
sudo tee \
  /etc/systemd/system/backup-gitlab-runner.service \
  >/dev/null <<'EOF'
[Unit]
Description=Backup GitLab Runner to backup01 with Restic
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/backup-gitlab-runner.sh
Nice=10
IOSchedulingClass=best-effort
IOSchedulingPriority=7
EOF

sudo tee \
  /etc/systemd/system/backup-gitlab-runner.timer \
  >/dev/null <<'EOF'
[Unit]
Description=Daily GitLab Runner Restic backup

[Timer]
OnCalendar=*-*-* 05:00:00
Persistent=true
Unit=backup-gitlab-runner.service

[Install]
WantedBy=timers.target
EOF

sudo systemctl daemon-reload

sudo systemctl enable --now \
  backup-gitlab-runner.timer

systemctl list-timers \
  backup-gitlab-runner.timer
```

---

## 20.6 每周执行 Restic 保留策略和完整性检查

每日备份脚本只执行：

```text
restic backup
```

不要在每个每日任务中同时执行：

```text
restic forget --prune
restic check
```

`backup01` 只有 `2C2G`，频繁 Prune 和完整检查会产生不必要的 CPU、内存和磁盘 I/O 压力。

每台源主机为自己的 Repository 创建每周维护任务。

### 一、创建通用维护脚本

分别在 `gitlab01`、`sonarqube01` 和 `runner01` 执行：

```bash
sudo tee \
  /usr/local/sbin/maintain-restic-repository.sh \
  >/dev/null <<'EOF'
#!/usr/bin/env bash

set -Eeuo pipefail

ENV_FILE="${1:?Usage: maintain-restic-repository.sh <env-file>}"

set -a
source "$ENV_FILE"
set +a

restic forget \
  --keep-daily 7 \
  --keep-weekly 4 \
  --keep-monthly 6 \
  --prune

restic check

echo "Restic repository maintenance completed"
EOF

sudo chmod 700 \
  /usr/local/sbin/maintain-restic-repository.sh
```

### 二、GitLab 每周维护

### 【gitlab01】

```bash
sudo tee \
  /etc/systemd/system/maintain-restic-gitlab.service \
  >/dev/null <<'EOF'
[Unit]
Description=Maintain GitLab Restic repository
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/maintain-restic-repository.sh /etc/restic/gitlab.env
Nice=10
IOSchedulingClass=best-effort
IOSchedulingPriority=7
EOF
```

```bash
sudo tee \
  /etc/systemd/system/maintain-restic-gitlab.timer \
  >/dev/null <<'EOF'
[Unit]
Description=Weekly GitLab Restic maintenance

[Timer]
OnCalendar=Sun *-*-* 06:00:00
Persistent=true
RandomizedDelaySec=30m
Unit=maintain-restic-gitlab.service

[Install]
WantedBy=timers.target
EOF
```

### 三、SonarQube 每周维护

### 【sonarqube01】

```bash
sudo tee \
  /etc/systemd/system/maintain-restic-sonarqube.service \
  >/dev/null <<'EOF'
[Unit]
Description=Maintain SonarQube Restic repository
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/maintain-restic-repository.sh /etc/restic/sonarqube.env
Nice=10
IOSchedulingClass=best-effort
IOSchedulingPriority=7
EOF
```

```bash
sudo tee \
  /etc/systemd/system/maintain-restic-sonarqube.timer \
  >/dev/null <<'EOF'
[Unit]
Description=Weekly SonarQube Restic maintenance

[Timer]
OnCalendar=Sun *-*-* 07:00:00
Persistent=true
RandomizedDelaySec=30m
Unit=maintain-restic-sonarqube.service

[Install]
WantedBy=timers.target
EOF
```

### 四、Runner 每周维护

### 【runner01】

```bash
sudo tee \
  /etc/systemd/system/maintain-restic-runner.service \
  >/dev/null <<'EOF'
[Unit]
Description=Maintain Runner Restic repository
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/maintain-restic-repository.sh /etc/restic/runner.env
Nice=10
IOSchedulingClass=best-effort
IOSchedulingPriority=7
EOF
```

```bash
sudo tee \
  /etc/systemd/system/maintain-restic-runner.timer \
  >/dev/null <<'EOF'
[Unit]
Description=Weekly Runner Restic maintenance

[Timer]
OnCalendar=Sun *-*-* 08:00:00
Persistent=true
RandomizedDelaySec=30m
Unit=maintain-restic-runner.service

[Install]
WantedBy=timers.target
EOF
```

### 五、启用

在对应主机启用本机的 Timer。

GitLab：

```bash
sudo systemctl daemon-reload

sudo systemctl enable --now \
  maintain-restic-gitlab.timer
```

SonarQube：

```bash
sudo systemctl daemon-reload

sudo systemctl enable --now \
  maintain-restic-sonarqube.timer
```

Runner：

```bash
sudo systemctl daemon-reload

sudo systemctl enable --now \
  maintain-restic-runner.timer
```

每周维护时间仍需与 Kubernetes、NFS 和 Harbor 的现有维护任务错开。

---

## 20.7 Argo CD 备份

Argo CD 配置主要保存在：

```text
GitOps 仓库
Kubernetes etcd
```

现有 Kubernetes 备份方案已经包含 etcd 快照和 Kubernetes 资源导出。

Argo CD 损坏时可以：

```text
重新安装 Argo CD
→ 恢复 GitLab CA
→ 重新添加 GitOps 仓库
→ Apply platform-bootstrap 根 Application
→ 由 App of Apps 恢复 AppProject 和 demo-dev Application
```

还必须确保以下凭据可以重新生成或从密码管理器取得：

```text
Argo CD admin 密码
GitLab Deploy Token
Platform Root CA 公钥证书
```

---

## 20.8 验证快照和执行恢复测试

只看到定时任务成功不代表备份可恢复。正式验收前必须至少执行一次文件级恢复测试。

### 一、GitLab 恢复测试

### 【gitlab01】

```bash
sudo rm -rf \
  /tmp/restic-restore-gitlab

sudo bash -lc '
  set -a
  source /etc/restic/gitlab.env
  set +a

  restic restore latest \
    --target /tmp/restic-restore-gitlab \
    --include /etc/gitlab/gitlab.rb \
    --include /etc/gitlab/gitlab-secrets.json
'

sudo ls -l \
  /tmp/restic-restore-gitlab/etc/gitlab

sudo rm -rf \
  /tmp/restic-restore-gitlab
```

### 二、SonarQube 恢复测试

### 【sonarqube01】

```bash
sudo rm -rf \
  /tmp/restic-restore-sonarqube

sudo bash -lc '
  set -a
  source /etc/restic/sonarqube.env
  set +a

  restic restore latest \
    --target /tmp/restic-restore-sonarqube \
    --include /opt/sonarqube/compose.yaml \
    --include /opt/sonarqube/.env
'

sudo ls -la \
  /tmp/restic-restore-sonarqube/opt/sonarqube

sudo rm -rf \
  /tmp/restic-restore-sonarqube
```

### 三、Runner 恢复测试

### 【runner01】

```bash
sudo rm -rf \
  /tmp/restic-restore-runner

sudo bash -lc '
  set -a
  source /etc/restic/runner.env
  set +a

  restic restore latest \
    --target /tmp/restic-restore-runner \
    --include /etc/gitlab-runner/config.toml \
    --include /etc/gitlab-runner/certs \
    --include /etc/docker/daemon.json \
    --include /etc/docker/certs.d/harbor.home.arpa \
    --include /usr/local/sbin/update-trivy-db.sh \
    --include /etc/systemd/system/update-trivy-db.service \
    --include /etc/systemd/system/update-trivy-db.timer
'

sudo test -s \
  /tmp/restic-restore-runner/etc/gitlab-runner/config.toml

sudo test -s \
  /tmp/restic-restore-runner/etc/docker/daemon.json

sudo test -s \
  /tmp/restic-restore-runner/usr/local/sbin/update-trivy-db.sh

sudo find \
  /tmp/restic-restore-runner/etc/gitlab-runner \
  /tmp/restic-restore-runner/etc/docker \
  /tmp/restic-restore-runner/usr/local/sbin \
  /tmp/restic-restore-runner/etc/systemd/system \
  -maxdepth 3 \
  -type f \
  -print

sudo rm -rf \
  /tmp/restic-restore-runner
```

完整的应用恢复仍应在独立测试主机中演练，不能直接覆盖正在运行的生产或学习实例。

---

## 20.9 将备份自动化文件纳入 ci-images

完成备份实际运行和恢复测试后，把最终验证过的脚本及 systemd 单元同步回：

```text
platform/ci-images
```

这样 Runner 或应用主机重装时，不需要从教程中手工重新拼接配置。

不要提交：

```text
/etc/restic/*.env
/etc/restic/*password*
/root/.ssh
任何 Repository 密码
任何私钥
```

### 【管理 Mac】

进入仓库：

```bash
cd \
  "$HOME/workspace/cicd-demo/ci-images"

git switch \
  main

git pull \
  --ff-only

git switch \
  -c chore/track-backup-automation
```

创建目录：

```bash
mkdir -p \
  backup/common \
  backup/gitlab \
  backup/sonarqube \
  backup/runner
```

创建只读取指定 root 文件的辅助函数：

```bash
copy_root_file() {
  local host_ip="$1"
  local remote_file="$2"
  local local_file="$3"

  mkdir -p \
    "$(dirname "$local_file")"

  ssh \
    "ys@${host_ip}" \
    "sudo cat '${remote_file}'" \
    > "$local_file"
}
```

复制通用维护脚本：

```bash
copy_root_file \
  192.168.2.241 \
  /usr/local/sbin/maintain-restic-repository.sh \
  backup/common/maintain-restic-repository.sh
```

复制 GitLab 自动化文件：

```bash
copy_root_file \
  192.168.2.241 \
  /usr/local/sbin/backup-gitlab.sh \
  backup/gitlab/backup-gitlab.sh

copy_root_file \
  192.168.2.241 \
  /etc/systemd/system/backup-gitlab.service \
  backup/gitlab/backup-gitlab.service

copy_root_file \
  192.168.2.241 \
  /etc/systemd/system/backup-gitlab.timer \
  backup/gitlab/backup-gitlab.timer

copy_root_file \
  192.168.2.241 \
  /etc/systemd/system/maintain-restic-gitlab.service \
  backup/gitlab/maintain-restic-gitlab.service

copy_root_file \
  192.168.2.241 \
  /etc/systemd/system/maintain-restic-gitlab.timer \
  backup/gitlab/maintain-restic-gitlab.timer
```

复制 SonarQube 自动化文件：

```bash
copy_root_file \
  192.168.2.243 \
  /usr/local/sbin/backup-sonarqube.sh \
  backup/sonarqube/backup-sonarqube.sh

copy_root_file \
  192.168.2.243 \
  /etc/systemd/system/backup-sonarqube.service \
  backup/sonarqube/backup-sonarqube.service

copy_root_file \
  192.168.2.243 \
  /etc/systemd/system/backup-sonarqube.timer \
  backup/sonarqube/backup-sonarqube.timer

copy_root_file \
  192.168.2.243 \
  /etc/systemd/system/maintain-restic-sonarqube.service \
  backup/sonarqube/maintain-restic-sonarqube.service

copy_root_file \
  192.168.2.243 \
  /etc/systemd/system/maintain-restic-sonarqube.timer \
  backup/sonarqube/maintain-restic-sonarqube.timer
```

复制 Runner 自动化文件：

```bash
copy_root_file \
  192.168.2.242 \
  /usr/local/sbin/backup-gitlab-runner.sh \
  backup/runner/backup-gitlab-runner.sh

copy_root_file \
  192.168.2.242 \
  /etc/systemd/system/backup-gitlab-runner.service \
  backup/runner/backup-gitlab-runner.service

copy_root_file \
  192.168.2.242 \
  /etc/systemd/system/backup-gitlab-runner.timer \
  backup/runner/backup-gitlab-runner.timer

copy_root_file \
  192.168.2.242 \
  /etc/systemd/system/maintain-restic-runner.service \
  backup/runner/maintain-restic-runner.service

copy_root_file \
  192.168.2.242 \
  /etc/systemd/system/maintain-restic-runner.timer \
  backup/runner/maintain-restic-runner.timer
```

清除辅助函数：

```bash
unfunction \
  copy_root_file
```

恢复文件权限：

```bash
chmod 700 \
  backup/common/maintain-restic-repository.sh \
  backup/gitlab/backup-gitlab.sh \
  backup/sonarqube/backup-sonarqube.sh \
  backup/runner/backup-gitlab-runner.sh

find backup \
  -type f \
  \( -name '*.service' -o -name '*.timer' \) \
  -exec chmod 644 {} +
```

检查没有凭据文件：

```bash
if find backup \
  -type f \
  \( \
    -name '*.env' \
    -o -iname '*password*' \
    -o -name '*.key' \
  \) \
  -print \
  | grep -q .
then
  echo "错误：backup 目录中出现凭据或私钥"
  exit 1
fi
```

检查脚本：

```bash
bash -n \
  backup/common/maintain-restic-repository.sh \
  backup/gitlab/backup-gitlab.sh \
  backup/sonarqube/backup-sonarqube.sh \
  backup/runner/backup-gitlab-runner.sh

git diff \
  --check

git status
```

提交：

```bash
git add \
  backup

git commit \
  -m "chore: track tested backup automation"

git push \
  -u \
  origin \
  chore/track-backup-automation
```

### 【GitLab 网页】

创建并合并：

```text
chore/track-backup-automation
→ main
```

至此，自定义 CI 镜像、PKI 分发、Runner 配置模板、Trivy 更新和备份自动化均已进入 Git 管理，真实密钥和密码仍保留在 Git 之外。

---
# 第十八阶段：常见故障

## 21.1 Runner Pending 或无法拉取源码

### 【runner01】

检查 Runner：

```bash
sudo gitlab-runner verify
```

检查服务：

```bash
sudo systemctl status \
  gitlab-runner \
  --no-pager
```

检查日志：

```bash
sudo journalctl \
  -u gitlab-runner \
  -n 200 \
  --no-pager \
  -l
```

检查 Job Tags：

```text
docker
private
```

如果 Job 停在：

```text
Getting source from Git repository
```

并出现：

```text
Could not resolve host: gitlab.home.arpa
```

说明 Runner 宿主机可以解析 GitLab，但 Docker Job 或 Helper 容器无法解析内部域名。

检查：

```bash
sudo grep -nA 5 \
  'extra_hosts' \
  /etc/gitlab-runner/config.toml
```

必须包含：

```toml
extra_hosts = [
  "gitlab.home.arpa:192.168.2.241",
  "sonarqube.home.arpa:192.168.2.243",
  "harbor.home.arpa:192.168.2.211"
]
```

重启：

```bash
sudo systemctl restart \
  gitlab-runner
```

---

## 21.2 GitLab 内存不足

### 【gitlab01】

```bash
free -h
```

```bash
sudo journalctl \
  -k \
  | grep -i oom
```

如果频繁 OOM：

```text
先确认低内存配置已生效
减少同时访问用户
减少仓库和后台任务
升级至 6C12G
```

---

## 21.3 SonarQube 无法启动

### 【sonarqube01】

```bash
sysctl vm.max_map_count
sysctl fs.file-max
```

```bash
cd /opt/sonarqube
docker compose logs \
  --tail=300 \
  sonarqube
```

检查：

```bash
free -h
docker stats
```

---

## 21.4 SonarScanner 在 Alpine 失败

不要使用：

```text
node:24.18.0-alpine3.24
```

运行 SonarScanner。

使用：

```text
node:24.18.0-bookworm-slim
```

---

## 21.5 Harbor Push 或 Docker BuildKit 出现 x509

错误可能出现在：

```text
docker login
docker pull
docker build
docker push
Harbor Token Service
```

典型错误：

```text
x509: certificate signed by unknown authority
failed to fetch oauth token
```

### 一、检查 Runner 上的 Harbor CA

### 【runner01】

```bash
sudo ls -l \
  /usr/local/share/ca-certificates/harbor-ca.crt \
  /etc/docker/certs.d/harbor.home.arpa/ca.crt \
  /etc/gitlab-runner/certs/harbor-ca.crt
```

比较指纹：

```bash
for FILE in \
  /usr/local/share/ca-certificates/harbor-ca.crt \
  /etc/docker/certs.d/harbor.home.arpa/ca.crt \
  /etc/gitlab-runner/certs/harbor-ca.crt
do
  echo "===== ${FILE} ====="

  sudo openssl x509 \
    -in "$FILE" \
    -noout \
    -fingerprint \
    -sha256
done
```

三处指纹必须相同。

### 二、验证服务器证书

```bash
echo \
  | openssl s_client \
      -connect harbor.home.arpa:443 \
      -servername harbor.home.arpa \
      -CAfile /etc/docker/certs.d/harbor.home.arpa/ca.crt \
      2>/dev/null \
  | grep \
      'Verify return code'
```

应返回：

```text
Verify return code: 0 (ok)
```

### 三、重启 Docker 和 Runner

```bash
sudo systemctl restart \
  docker

sudo systemctl restart \
  gitlab-runner
```

### 四、验证 Docker Engine

```bash
sudo docker pull \
  harbor.home.arpa/ci-tools/node:24.18.0-alpine3.24
```

### 五、验证 BuildKit

```bash
rm -rf \
  /tmp/harbor-build-test

mkdir -p \
  /tmp/harbor-build-test

cat > /tmp/harbor-build-test/Dockerfile <<'EOF'
FROM harbor.home.arpa/ci-tools/node:24.18.0-alpine3.24

RUN node --version
EOF
```

```bash
sudo DOCKER_BUILDKIT=1 \
  docker build \
  --pull \
  --no-cache \
  --tag harbor-build-test:local \
  /tmp/harbor-build-test
```

如果宿主机 BuildKit 成功，但 Pipeline 仍然报 `x509`，检查 `build_scan_push` 是否执行：

```yaml
- update-ca-certificates
```

并确认 Job 容器挂载了：

```text
/etc/gitlab-runner/certs/harbor-ca.crt
→
/usr/local/share/ca-certificates/harbor-ca.crt
```

---

## 21.6 ImagePullBackOff

### 【k8s-master01】

先取得一个 Pod：

```bash
POD_NAME="$(
  kubectl \
    -n demo-dev \
    get pods \
    -l app.kubernetes.io/instance=demo-dev \
    -o jsonpath='{.items[0].metadata.name}'
)"
```

查看准确错误：

```bash
kubectl \
  -n demo-dev \
  describe pod \
  "$POD_NAME" \
  | sed -n '/Events:/,$p'
```

根据错误分类处理：

```text
401 Unauthorized：
harbor-pull 用户名或 Token 错误

x509: certificate signed by unknown authority：
Worker 的 Docker Engine 不信任 Harbor CA

manifest unknown：
GitOps 声明的 Tag 在 Harbor 中不存在

no such host：
Worker 无法解析 harbor.home.arpa
```

### 一、检查 Secret 是否仍是占位符

```bash
SECRET_USERNAME="$(
  kubectl \
    -n demo-dev \
    get secret \
    harbor-pull \
    -o jsonpath='{.data.\.dockerconfigjson}' \
    | base64 -d \
    | jq -r \
        '.auths["harbor.home.arpa"].auth' \
    | base64 -d \
    | cut -d ':' -f 1
)"

printf 'Secret Username: %s\n' \
  "$SECRET_USERNAME"
```

如果输出：

```text
<HARBOR_PULL_ROBOT_USERNAME>
```

或任何包含 `<`、`>` 的值，说明教程占位符被原样写入 Secret。重新执行第 12.3 节。

### 二、检查 Registry 地址

```bash
kubectl \
  -n demo-dev \
  get secret \
  harbor-pull \
  -o jsonpath='{.data.\.dockerconfigjson}' \
  | base64 -d \
  | jq -r \
      '.auths | keys[]'
```

必须是：

```text
harbor.home.arpa
```

### 三、检查 Deployment 引用

```bash
kubectl \
  -n demo-dev \
  get deployment \
  demo-dev \
  -o jsonpath='{.spec.template.spec.imagePullSecrets[*].name}{"\n"}'
```

必须包含：

```text
harbor-pull
```

### 四、检查镜像是否存在

```bash
kubectl \
  -n demo-dev \
  get deployment \
  demo-dev \
  -o jsonpath='{.spec.template.spec.containers[0].image}{"\n"}'
```

在 Harbor 网页确认对应完整 SHA Tag 存在。

修复 Secret 后主动重建 Pod：

```bash
kubectl \
  -n demo-dev \
  delete pods \
  -l app.kubernetes.io/instance=demo-dev
```

等待：

```bash
kubectl \
  -n demo-dev \
  rollout status \
  deployment/demo-dev \
  --timeout=10m
```

---

## 21.7 Argo CD 无法读取 GitLab

### 【k8s-master01】

先检查 Kubernetes 内部 DNS：

```bash
kubectl run \
  gitlab-dns-test \
  --rm \
  -it \
  --restart=Never \
  --image=busybox:1.36 \
  -- nslookup \
  gitlab.home.arpa
```

必须解析到：

```text
192.168.2.241
```

再检查 CA ConfigMap：

```bash
kubectl \
  -n argocd \
  get configmap \
  argocd-tls-certs-cm \
  -o yaml
```

重启 repo-server：

```bash
kubectl \
  -n argocd \
  rollout restart \
  deployment/argocd-repo-server
```

### 【管理 Mac】

```bash
export ARGOCD_OPTS="--grpc-web"

argocd repo list
```

---

## 21.8 Argo CD CLI 报 gRPC 错误

### 【管理 Mac】

设置：

```bash
export ARGOCD_OPTS="--grpc-web"
```

重新登录：

```bash
argocd login \
  argocd.home.arpa
```

---

## 21.9 GitOps Push 返回 403

### 【管理 Mac 浏览器】

检查：

```text
GITOPS_USERNAME 是否为 Bot 完整用户名
GITOPS_TOKEN 是否过期
Token 是否有 write_repository
Bot 是否为 Maintainer
main 是否允许 Maintainer Push
```

---

## 21.10 argocd.home.arpa 无法访问

### 【管理 Mac】

```bash
getent hosts \
  argocd.home.arpa \
  2>/dev/null \
  || dscacheutil \
    -q host \
    -a name argocd.home.arpa
```

### 【k8s-master01】

```bash
kubectl get ingress \
  -A
```

`argocd.home.arpa` 必须解析到实际 `<INGRESS_IP>`，不能解析到 Kubernetes API VIP `192.168.2.200`。

---

## 21.11 Trivy 漏洞数据库下载失败

典型错误：

```text
Need to update DB
Downloading artifact
mirror.gcr.io
connect: connection timed out
```

### 【runner01】

检查本地数据库：

```bash
sudo ls -lh \
  /var/lib/gitlab-runner/trivy-cache/db/trivy.db \
  /var/lib/gitlab-runner/trivy-cache/db/metadata.json
```

手工更新：

```bash
sudo /usr/local/sbin/update-trivy-db.sh
```

检查 Timer：

```bash
systemctl list-timers \
  update-trivy-db.timer
```

查看日志：

```bash
sudo journalctl \
  -u update-trivy-db.service \
  -n 200 \
  --no-pager
```

CI 扫描命令必须包含：

```text
--skip-db-update
```

该参数只跳过本次 Job 的数据库下载，不会跳过漏洞扫描。数据库由 `update-trivy-db.timer` 独立维护。

---

## 21.12 Trivy 阻断基础镜像自带漏洞

如果 Trivy 报告中的漏洞路径位于：

```text
/usr/local/lib/node_modules/npm
/usr/local/lib/node_modules/corepack
/opt/yarn-v1.22.22
```

而业务目录：

```text
/app/node_modules
```

没有 HIGH 或 CRITICAL 漏洞，说明漏洞来自 Node 基础镜像自带的包管理工具，而不是 Express 应用依赖。

处理方式：

```text
保留多阶段构建
在 dependencies 阶段使用 npm
在最终运行阶段删除 npm、npx、Corepack 和 Yarn
重新构建
重新执行 Trivy
```

不要通过以下方式绕过：

```text
关闭 HIGH/CRITICAL 阻断
删除 Trivy Job
使用 --exit-code 0
长期加入忽略规则
```

应修复最终运行镜像，使不需要的工具不进入生产镜像。

---

## 21.13 GitOps Job 下载 APK 过慢

如果 Job 长时间停在：

```text
apk add --no-cache ca-certificates git
fetch https://dl-cdn.alpinelinux.org
```

说明业务仓库仍然使用旧版 `.gitlab-ci.yml`。

检查：

```yaml
update_gitops:
  image:
    harbor.home.arpa/ci-tools/gitops:1.0.0-alpine3.22
```

`before_script` 中不应包含：

```yaml
- apk add --no-cache ca-certificates git
```

### 【runner01】

验证版本化镜像：

```bash
sudo docker manifest inspect \
  harbor.home.arpa/ci-tools/gitops:1.0.0-alpine3.22 \
  >/dev/null
```

```bash
sudo docker run \
  --rm \
  harbor.home.arpa/ci-tools/gitops:1.0.0-alpine3.22 \
  git \
  --version
```

如果曾经覆盖过旧 Tag，不要继续依赖本地缓存。发布新版本 Tag，并同步修改 `.gitlab-ci.yml`。

## 21.14 Trivy DB 过期

如果流水线提示：

```text
Trivy DB 超过 48 小时未成功更新
```

### 【runner01】

检查 Timer：

```bash
systemctl list-timers \
  update-trivy-db.timer
```

手工更新：

```bash
sudo /usr/local/sbin/update-trivy-db.sh
```

检查最后成功时间：

```bash
LAST_UPDATE="$(
  sudo cat \
    /var/lib/gitlab-runner/trivy-cache/last-successful-update
)"

date \
  -d "@${LAST_UPDATE}"
```

查看日志：

```bash
sudo journalctl \
  -u update-trivy-db.service \
  -n 200 \
  --no-pager
```

---

# 第十九阶段：安全检查

正式使用前确认：

```text
[ ] GitLab 已关闭公开注册
[ ] root 不作为日常账号
[ ] 管理员已开启两步验证
[ ] demo-api/main 禁止直接 Push
[ ] demo-api Merge Request 必须通过 Pipeline

[ ] demo-gitops/dev 只允许 Maintainer 和 GitOps Bot Push
[ ] demo-gitops/main 禁止直接 Push
[ ] ci-images/main 禁止直接 Push
[ ] 自定义 CI 工具链已经纳入 Git
[ ] PKI 分发和备份自动化脚本已经纳入 ci-images

[ ] Runner 使用独立虚拟机
[ ] Runner concurrent=2
[ ] Runner limit=2
[ ] Runner request_concurrency=2
[ ] Runner Protected 已关闭但只服务可信私有 Group
[ ] Runner 不允许外部 Fork
[ ] 不可信成员不能修改 .gitlab-ci.yml
[ ] Runner extra_hosts 已配置三个内部域名

[ ] Runner Ubuntu 系统信任 Harbor CA
[ ] Runner Docker Engine 信任 Harbor CA
[ ] Runner Job 容器挂载 Harbor CA
[ ] Runner Job 容器挂载 Platform Root CA
[ ] SonarScanner TrustStore 已正确挂载
[ ] Platform Root CA 私钥已加密离线备份
[ ] Harbor CA 私钥和服务证书已加密离线备份
[ ] 两套 CA 备份已执行解密验证

[ ] CI Secret 已设置 Masked、Hidden、Protected
[ ] Token 已设置过期时间
[ ] Argo CD 使用只读 Deploy Token
[ ] CI 使用独立 GitOps 写入 Token
[ ] Harbor CI Robot 只有 demo 项目 Push/Pull 权限
[ ] Kubernetes Robot 只有 Pull 权限
[ ] harbor-pull 中不存在教程占位符

[ ] Harbor ci-tools 只保存可信基础镜像
[ ] GitOps Job 使用版本化固定镜像
[ ] 不覆盖已经发布的 GitOps 镜像 Tag
[ ] 正式业务镜像不使用 latest
[ ] 业务镜像 Tag 使用完整 Git Commit SHA
[ ] 最终 Node 运行镜像不包含 npm、npx、Corepack 和 Yarn

[ ] Trivy DB 已预下载
[ ] update-trivy-db.timer 已启用
[ ] last-successful-update 存在
[ ] Trivy DB 超过 48 小时会阻断流水线
[ ] CI 使用 --skip-db-update
[ ] Trivy HIGH/CRITICAL 可以阻断流水线
[ ] SonarQube Quality Gate 可以阻断流水线

[ ] build_scan_push interruptible=false
[ ] update_gitops interruptible=false
[ ] npm 缓存 Key 绑定 package-lock.json
[ ] demo-gitops 自动执行 Helm lint 和 template

[ ] platform-bootstrap 为 Synced 和 Healthy
[ ] demo-dev 为 Synced 和 Healthy
[ ] demo-tls 和 harbor-pull 不产生孤儿资源告警
[ ] Argo CD App of Apps 可以自动同步 argocd/ 配置

[ ] 每日 Restic 任务只执行 backup
[ ] Restic forget --prune 和 check 改为每周执行
[ ] GitLab 已执行备份
[ ] SonarQube PostgreSQL 已备份
[ ] Runner Docker、CA、Trivy 脚本和 systemd 文件已备份
[ ] Harbor 继续执行原有冷备份
[ ] Kubernetes 继续执行 etcd 快照
[ ] Restic Repository 密码已离线保存
[ ] GitLab、SonarQube 和 Runner 已完成文件级恢复测试
```

---

# 第二十阶段：最终验收

## GitLab

### 【gitlab01】

```bash
sudo gitlab-ctl status
```

所有服务应显示：

```text
run:
```

## Runner

### 【runner01】

```bash
sudo gitlab-runner verify
```

检查双并发和内部域名配置：

```bash
sudo grep -nE \
  'concurrent|limit|request_concurrency|extra_hosts' \
  /etc/gitlab-runner/config.toml
```

## Harbor CA 和 BuildKit

```bash
echo \
  | openssl s_client \
      -connect harbor.home.arpa:443 \
      -servername harbor.home.arpa \
      -CAfile /etc/docker/certs.d/harbor.home.arpa/ca.crt \
      2>/dev/null \
  | grep \
      'Verify return code: 0'
```

```bash
sudo docker pull \
  harbor.home.arpa/ci-tools/node:24.18.0-alpine3.24
```

## Trivy DB

```bash
sudo ls -lh \
  /var/lib/gitlab-runner/trivy-cache/db/trivy.db \
  /var/lib/gitlab-runner/trivy-cache/db/metadata.json \
  /var/lib/gitlab-runner/trivy-cache/last-successful-update
```

```bash
systemctl list-timers \
  update-trivy-db.timer
```

## 自定义 CI 镜像

```bash
sudo docker run \
  --rm \
  harbor.home.arpa/ci-tools/gitops:1.0.0-alpine3.22 \
  git \
  --version
```

```bash
sudo docker run \
  --rm \
  --entrypoint="" \
  harbor.home.arpa/ci-tools/helm:3.19.0 \
  helm \
  version
```

## SonarQube

### 【管理 Mac】

```bash
curl -fsS \
  https://sonarqube.home.arpa/api/system/status
```

应包含：

```json
{"status":"UP"}
```

## Harbor

```bash
curl -fsS \
  https://harbor.home.arpa/api/v2.0/health \
  | jq -r '.status'
```

应返回：

```text
healthy
```

## GitLab Pipeline

### 【管理 Mac 浏览器】

确认：

```text
demo-api/main Pipeline：Passed
test：Passed
sonarqube：Passed
build_scan_push：Passed
update_gitops：Passed

demo-gitops/dev Pipeline：Passed
validate_helm：Passed
```

日志中确认：

```text
test 不访问 Debian APT
build_scan_push 不下载 Trivy DB
Trivy DB 年龄小于等于 48 小时
Trivy HIGH/CRITICAL 为 0
update_gitops 不执行 apk add
GitOps Bot 更新 dev 而不是 main
```

## Argo CD

### 【管理 Mac】

```bash
export ARGOCD_OPTS="--grpc-web"

argocd app get \
  platform-bootstrap

argocd app get \
  demo-dev
```

两个 Application 都应显示：

```text
Sync Status: Synced
Health Status: Healthy
```

## Kubernetes

### 【k8s-master01】

```bash
kubectl \
  -n demo-dev \
  get deployment,pod,service,ingress,pdb \
  -o wide
```

检查镜像和 Pod 分布：

```bash
kubectl \
  -n demo-dev \
  get pods \
  -o custom-columns='POD:.metadata.name,NODE:.spec.nodeName,IMAGE:.spec.containers[0].image'
```

三个副本应优先分布在三台 Worker，镜像 Tag 应为完整 Commit SHA。

## 应用

### 【管理 Mac】

```bash
curl \
  https://demo.home.arpa/healthz

echo

curl \
  https://demo.home.arpa/

echo
```

应返回健康状态和当前完整 SHA 版本。

## 备份

分别检查每日备份 Timer 和每周维护 Timer：

```text
GitLab：
backup-gitlab.timer
maintain-restic-gitlab.timer

SonarQube：
backup-sonarqube.timer
maintain-restic-sonarqube.timer

Runner：
backup-gitlab-runner.timer
maintain-restic-runner.timer
```

## 完整验收项

```text
1. GitLab HTTPS 可以访问
2. GitLab 资源调优生效
3. Runner Online 且双并发生效
4. Job 容器可解析三个内部域名
5. 两套 CA 信任和离线备份正常
6. SonarQube UP
7. Harbor healthy
8. CI 工具镜像已同步并版本化
9. Trivy DB 已预下载、定时更新并检查新鲜度
10. npm 缓存绑定锁文件
11. 单元测试通过
12. SonarQube Quality Gate 通过
13. Docker 镜像构建成功
14. Trivy HIGH/CRITICAL 扫描通过
15. 运行镜像不包含 npm 等构建工具
16. 镜像 Tag 使用完整 Commit SHA
17. 镜像成功 Push Harbor
18. GitOps Bot 只更新 dev
19. GitOps Helm 校验通过
20. platform-bootstrap Synced + Healthy
21. demo-dev Synced + Healthy
22. Kubernetes 完成滚动更新
23. 三个副本优先分布在三台 Worker
24. 应用 HTTPS 正常
25. GitOps 回滚验证成功
26. 每日备份和每周 Restic 维护已分离
27. GitLab、SonarQube、Runner 文件级恢复测试成功
28. PKI、Trivy 和备份自动化文件已纳入 ci-images
```

---

# 第二十一阶段：生产化增强

本阶段不影响当前已经跑通的学习环境。进入正式生产前，建议逐项实施。

## 22.1 使用镜像 Digest 部署

Tag 便于阅读，但理论上可以被重新指向其他内容。Digest 与镜像内容一一对应。

在 `build_scan_push` 推送后取得 Registry Digest，并写入 `build.env`。具体命令应在当前 Docker CLI 版本中验证后固定，例如使用：

```bash
docker buildx imagetools inspect \
  "${IMAGE_REPOSITORY}:${IMAGE_TAG}"
```

GitOps Values 扩展为：

```yaml
image:
  repository: harbor.home.arpa/demo/demo-api
  tag: "sha-完整CommitSHA"
  digest: "sha256:完整镜像Digest"
```

Deployment 模板优先使用 Digest：

```yaml
image: >-
  {{- if .Values.image.digest }}
  {{ .Values.image.repository }}@{{ .Values.image.digest }}
  {{- else }}
  {{ .Values.image.repository }}:{{ .Values.image.tag }}
  {{- end }}
```

Tag 继续用于版本展示和审计，真正拉取使用 Digest。

---

## 22.2 生成 SBOM

可以使用现有 Trivy 镜像生成 CycloneDX SBOM：

```bash
docker run \
  --rm \
  --volume \
  /var/run/docker.sock:/var/run/docker.sock \
  --volume \
  /var/lib/gitlab-runner/trivy-cache:/root/.cache/trivy \
  harbor.home.arpa/ci-tools/trivy:0.72.0 \
  image \
  --cache-dir \
  /root/.cache/trivy \
  --skip-db-update \
  --format \
  cyclonedx \
  --output \
  /dev/stdout \
  "${IMAGE_REPOSITORY}:${IMAGE_TAG}" \
  > sbom.cdx.json
```

将其加入 Artifact：

```yaml
artifacts:
  paths:
    - trivy-report.json
    - sbom.cdx.json
```

SBOM 不替代漏洞扫描，两者都应保留。

---

## 22.3 使用 Cosign 签名

生产环境可以在镜像 Push 后使用 Cosign 签名。

要求：

```text
固定经过验证的 Cosign 版本
将 Cosign 工具镜像同步到内部 Harbor
签名私钥保存在 Protected、Masked、Hidden 的 File Variable 或外部密钥系统
Kubernetes 准入策略校验签名
```

不要使用 `latest`，不要把签名私钥提交到 Git。

推荐链路：

```text
Build
→ Trivy
→ SBOM
→ Push
→ Cosign Sign
→ GitOps
→ Kubernetes Verify
```

---

## 22.4 使用 External Secrets 或 Sealed Secrets

当前主线中：

```text
demo-tls
harbor-pull
```

由管理员手工创建，并在 AppProject 中精确忽略。

生产环境需要完全 GitOps 化时，可以迁移到：

```text
External Secrets Operator + Vault
或
Sealed Secrets
```

原则：

```text
Git 中不能出现明文 Robot Token
Git 中不能出现未加密 TLS 私钥
外部 Secret 控制器必须有独立备份和恢复方案
Secret 轮换后应验证 Pod 可以重新拉取镜像
```

迁移完成后，应删除 AppProject 中对已经由 Argo CD 管理的 Secret 的忽略规则。

---

## 22.5 生产同步策略

开发环境可以自动同步：

```yaml
automated:
  prune: true
  selfHeal: true
```

生产环境建议根据团队规模选择：

```text
人工 Sync
Sync Window
维护窗口
变更审批
渐进式发布
```

生产 Application 读取 `main`，GitOps Bot 不允许直接 Push `main`。

---

## 22.6 自定义 CI 镜像供应链

`platform/ci-images` 已保存 Dockerfile 和 Runner 脚本。进一步可以增加独立 CI：

```text
Dockerfile Lint
镜像构建
Trivy 扫描
SBOM
签名
推送 ci-tools
```

由于该流程可以修改所有业务 Pipeline 的执行环境，建议使用独立受保护 Runner 和专用 Harbor Robot，不与普通业务项目共享高权限凭据。

---

# 第二十二阶段：完整实施顺序

```text
第一步
创建 gitlab01、runner01、sonarqube01

第二步
配置静态 IP、主机名、hosts 和时间

第三步
创建 Platform Root CA 和服务证书

第四步
加密离线备份 Platform CA 与 Harbor CA

第五步
安装并调优 GitLab CE

第六步
创建 platform Group、demo-api、demo-gitops、ci-images

第七步
配置 demo-api/main、demo-gitops/main/dev、ci-images/main 分支保护

第八步
安装独立 GitLab Runner

第九步
配置 Runner 双并发、extra_hosts 和双 CA 信任

第十步
部署 SonarQube + PostgreSQL

第十一步
在 Harbor 创建 ci-tools 和 demo 项目

第十二步
把 GitOps Dockerfile、Trivy 脚本和 systemd 单元纳入 ci-images

第十三步
同步 CI 基础镜像并构建版本化 GitOps 镜像

第十四步
配置 Trivy DB 首次下载、最后成功时间和 Timer

第十五步
创建 Harbor CI Robot 和 Kubernetes Pull Robot

第十六步
创建示例 Node.js 项目和精简运行镜像

第十七步
创建 Helm GitOps 仓库和 GitOps 校验 CI

第十八步
创建并验证 Kubernetes Harbor Pull Secret 和 TLS Secret

第十九步
安装 Argo CD

第二十步
配置 Argo CD GitLab CA 和只读 Deploy Token

第二十一步
配置 GitOps 写入 Token 和 GitLab CI/CD Variables

第二十二步
执行上线前置检查

第二十三步
提交优化后的 demo-api .gitlab-ci.yml

第二十四步
执行第一条完整业务 Pipeline

第二十五步
确认 GitOps Bot 更新 dev，Helm 校验通过

第二十六步
创建并 Bootstrap platform-bootstrap App of Apps

第二十七步
验证自动发布、Pod 分布和应用 HTTPS

第二十八步
验证 GitOps dev 分支回滚

第二十九步
把每日 Restic Backup 与每周 Prune/Check 分离

第三十步
完成 GitLab、SonarQube、Runner 备份和恢复测试

第三十一步
把最终验证过的备份自动化文件同步回 ci-images

第三十二步
按需实施 Digest、SBOM、Cosign 和外部 Secret
```

最终架构：

```text
                    ┌─────────────────────┐
                    │ gitlab01            │
                    │ GitLab CE           │
                    └──────────┬──────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │ runner01            │
                    │ Docker / Runner     │
                    │ Trivy DB Timer      │
                    └──────┬───────┬──────┘
                           │       │
                SonarQube │       │ Harbor
                           ▼       ▼
           ┌──────────────────┐  ┌──────────────────┐
           │ sonarqube01      │  │ harbor01         │
           │ Sonar + Postgres │  │ Images / CI Tool│
           └──────────────────┘  └────────┬─────────┘
                                         │
                    ┌────────────────────┴──────────────┐
                    │ GitLab Repositories               │
                    │ demo-api                          │
                    │ demo-gitops main/dev              │
                    │ ci-images                         │
                    └────────────────────┬──────────────┘
                                         │
                                         ▼
                              ┌────────────────────┐
                              │ platform-bootstrap │
                              │ App of Apps        │
                              └─────────┬──────────┘
                                        │
                                        ▼
                              ┌────────────────────┐
                              │ demo-dev           │
                              │ Argo CD App        │
                              └─────────┬──────────┘
                                        │
                                        ▼
                           ┌────────────────────────┐
                           │ Kubernetes             │
                           │ 3 Master + 3 Worker    │
                           └────────────┬───────────┘
                                        │
                                        ▼
                              ┌────────────────────┐
                              │ backup01           │
                              │ Restic Repository  │
                              └────────────────────┘
```
