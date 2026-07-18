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

## 部署到 Cloudflare Pages

Cloudflare Pages 中设置：

| 配置项 | 值 |
|--------|-----|
| **构建命令** | `curl -sL https://github.com/gohugoio/hugo/releases/download/v0.164.0/hugo_extended_0.164.0_linux-amd64.tar.gz \| tar xz && ./hugo --gc --minify` |
| **输出目录** | `public` |
| **环境变量** | 无需设置 |

> 主题已提交到仓库，构建时无需额外下载。直接使用 Cloudflare Pages 提供的 Hugo 即可。
