# 第三步：域名 + HTTPS 证书

> 目标：让 `matrix.example.com` 能从公网访问，并且是 HTTPS（Matrix 客户端强制要求 HTTPS）。

## 1. 买域名

- 任何域名注册商都行（阿里云/腾讯云/Cloudflare/Namesilo…）
- `.xyz` 等便宜后缀就够用，一年几块到几十块
- **注意**：域名要实名认证（国内注册商必做）；如果用内地服务器，域名还要备案（见第一步）

## 2. 解析

在你的域名服务商后台加一条 DNS 记录：

```
类型: A
主机记录: matrix     # 结果：matrix.example.com
记录值: 你的服务器公网 IP
```

等几分钟到几小时（DNS 生效有延迟），用下面命令验证：

```bash
ping matrix.example.com
# 或
dig matrix.example.com +short
# 应该返回你的服务器 IP
```

## 3. 反向代理（Caddy 最省心）

Synapse 监听 `localhost:8008`，需要让公网 443 端口转给它。**推荐 Caddy**——它自动申请和续期 HTTPS 证书，不用手动碰证书。

```bash
# 安装 Caddy（官方脚本）
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | \
  sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
# ...（按官方文档加源）
sudo apt update && sudo apt install caddy
```

编辑 `/etc/caddy/Caddyfile`：

```
matrix.example.com {
    reverse_proxy localhost:8008
}
```

```bash
sudo systemctl reload caddy
```

**我们踩过的坑**：
- **`.well-known` 必须配**：Matrix 客户端找服务器分两步——先查 `https://你的域名/.well-known/matrix/client`，拿到 `m.homeserver` 指向哪。不配这个，客户端会连不上或用错服务器。Caddyfile 加：
  ```
  matrix.example.com {
      reverse_proxy localhost:8008
  }
  example.com {   # 你的裸域名（用于 .well-known）
      @wellknown path /.well-known/matrix/*
      handle @wellknown {
          respond `{"m.homeserver":{"base_url":"https://matrix.example.com"},"m.identity_server":{"base_url":"https://vector.im"}}` 200
      }
      handle { reverse_proxy localhost:8008 }
  }
  ```
  注意 .well-known 的 JSON 必须 Content-Type 正确且**不带换行外的多余字符**，否则客户端解析失败。
- **80 端口也要通**：Let's Encrypt 验证要走 80，安全组别只放 443。
- 改完 Caddy 用 `caddy validate` 检查配置，别让语法错误把服务搞挂。

## 4. 验证

```bash
# 从你自己电脑/手机（不是服务器上）访问：
curl https://matrix.example.com/_matrix/client/versions
# 能返回 JSON = HTTPS + 反代都通了
```

## 下一步

→ [第四步：手机/电脑客户端连接](04-element.md)
