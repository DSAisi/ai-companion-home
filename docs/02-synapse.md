# 第二步：安装 Matrix 服务端 Synapse

> 目标：在你的服务器上跑起 Matrix 服务端。Synapse 是官方最主流的实现，文档全、坑好查。

## 安装（Debian/Ubuntu）

官方推荐用 Matrix 组织维护的安装脚本：

```bash
# 1. 装依赖
sudo apt update && sudo apt install -y lsb-release wget

# 2. 添加 Matrix 官方源并安装
sudo wget -O /usr/share/keyrings/matrix-org-archive-keyring.gpg \
  https://packages.matrix.org/debian/matrix-org-archive-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/matrix-org-archive-keyring.gpg] \
  https://packages.matrix.org/debian/ $(lsb_release -cs) main" | \
  sudo tee /etc/apt/sources.list.d/matrix-org.list
sudo apt update
sudo apt install -y matrix-synapse-py3
```

安装过程中会问你：
- **服务器名（server_name）**：填你准备用的域名（如 `matrix.example.com`）——**这个后面不好改，先想好**
- 是否要匿名统计：选 No 即可

## 生成配置文件

```bash
# 生成 homeserver.yaml（如果安装时没自动生成）
cd /etc/matrix-synapse
sudo -u matrix-synapse \
  python3 -m synapse.app.homeserver \
  --server-name matrix.example.com \
  --config-path /etc/matrix-synapse/homeserver.yaml \
  --generate-config \
  --report-stats=no
```

## 最小必改配置

编辑 `/etc/matrix-synapse/homeserver.yaml`：

```yaml
server_name: "matrix.example.com"   # 你的域名
# 允许注册（搭好家后建议关掉或加邀请制）：
enable_registration: true
# 新用户注册不需要邀请码（初期方便测试）：
registration_shared_secret: "一个很长的随机字符串"  # 用 openssl rand -hex 32 生成
```

**我们踩过的坑**：
- `server_name` 必须和你后面配的域名一致，不一致客户端会连不上
- 注册开关：先开 `enable_registration` 方便建号，**家搭好后一定关掉**（或改成仅邀请），不然陌生人能注册进你的服务器
- Synapse 默认监听 `localhost:8008`——后面用反代把 443 转给它

## 启动并验证

```bash
sudo systemctl enable matrix-synapse
sudo systemctl start matrix-synapse
# 验证服务在听
curl http://localhost:8008/_matrix/client/versions
# 应该返回一串 JSON（version 信息），说明服务起来了
```

## 下一步

→ [第三步：域名 + HTTPS 证书](03-domain-tls.md)
