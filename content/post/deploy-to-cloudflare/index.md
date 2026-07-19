---
title: "Hugo 博客部署到 Cloudflare  Workers 踩坑记"
description: "从 Hello World 到正常显示，记录部署过程中的问题与解决方案"
date: 2026-07-18
slug: "deploy-to-cloudflare"
tags: ["hugo", "cloudflare", "deploy"]
categories: ["技术"]
---

## 前言

这个博客使用 [Hugo](https://gohugo.io/) + [Stack 主题](https://github.com/CaiJimmy/hugo-theme-stack) 构建，部署到 Cloudflare 的 Workers + Pages 统一平台。部署过程遇到几个坑，记录一下。

## 问题一：部署后只看到 "Hello World"

用 `wrangler deploy` 部署后，访问分配的 `.workers.dev` 域名，页面只有一行 "Hello World"，而不是 Hugo 生成的博客页面。

**原因：** Cloudflare 统一了 Workers 和 Pages 平台，默认部署方式创建的是一个 Worker，不会自动托管静态资源。Hugo 生成的 `public/` 目录需要作为静态资产提供。

**解决：** 创建 `wrangler.toml` 配置静态资产目录：

```toml
name = "qifuhe"
compatibility_date = "2026-07-18"

[assets]
    directory = "public"
    not_found_handling = "404-page"
```

然后用 `--assets` 标志部署：

```bash
wrangler deploy --assets public/ --name qifuhe
```

## 问题二：wrangler.toml 的 [build] command 在 Windows 上失败

最开始在 `wrangler.toml` 里加了构建命令：

```toml
[build]
command = "curl -sL https://github.com/gohugoio/hugo/releases/download/v0.164.0/hugo_extended_0.164.0_linux-amd64.tar.gz -o hugo.tar.gz && tar xzf hugo.tar.gz && rm hugo.tar.gz && ./hugo --gc --minify"
```

这在 Linux/Mac 上没问题，但 Windows 跑不了 Linux 二进制。更坑的是，Wrangler **一定会执行** `[build]` 里的命令，即使加了 `--assets` 参数也无法跳过。

**解决：** 删掉 `[build]` 段，在本地手动构建：

```bash
/tmp/hugo.exe --gc --minify
wrangler deploy --assets public/ --name qifuhe
```

## 问题三：Cloudflare 统一平台后的域名认知

2025 年底 Cloudflare 统一了 Workers 和 Pages，合并为一个平台。之前 Pages 用 `.pages.dev`，Workers 用 `.workers.dev`。统一后仍然使用 `.workers.dev` 域名，文档里有些旧教程提到的 `.pages.dev` 已不存在。

## 完整的部署流程

在本地开发：

```bash
# 本地预览（含草稿文章）
/tmp/hugo.exe server -D

# 写完后构建并部署
/tmp/hugo.exe --gc --minify
wrangler deploy --assets public/ --name qifuhe
```

## 小结

- Hugp 构建必须在本地完成，Wrangler 的 `[build]` 命令在 Windows 上不适配
- `wrangler.toml` 只需要 `[assets]` 配置，不用加 `[build]`
- `.workers.dev` 是正确的域名
