# 启付盒 — 个人博客

基于 [Hugo](https://gohugo.io/) + [Stack 主题](https://github.com/CaiJimmy/hugo-theme-stack)，部署在 Cloudflare Pages。

## 本地开发

```bash
# 1. 下载主题
curl -sL https://github.com/CaiJimmy/hugo-theme-stack/archive/refs/tags/v4.0.3.tar.gz | tar xz
mv hugo-theme-stack-4.0.3 themes/hugo-theme-stack

# 2. 启动本地预览
hugo server -D
```

## 部署到 Cloudflare Workers + Pages（统一平台）

项目包含 `wrangler.toml` 配置，Cloudflare 会自动使用其中的构建命令和输出目录设置。

| 配置项 | 值 |
|--------|-----|
| **框架** | `wrangler.toml` 自动配置 |
| **构建命令** | 由 `wrangler.toml` 中的 `[build].command` 指定 |
| **输出目录** | `public` |
| **环境变量** | 无需设置 |

> 主题已提交到仓库，构建时无需额外下载。
