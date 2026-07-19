/**
 * QiFuHe RAG 助手 — 前端交互逻辑
 * 自动加载到所有页面，提供全局搜索 + 文章底部问答
 */

// ponytail: 后端地址，用户按实际部署修改
const API_BASE = 'https://qifuhe.natapp1.cc/api/rag';

// ========== 类型定义 ==========

interface AskResponse {
    answer: string;
    sources: { title: string; slug: string; score: number }[];
}

// ========== 工具函数 ==========

function $(id: string): HTMLElement | null {
    return document.getElementById(id);
}

function show(el: HTMLElement | null) {
    if (el) el.style.display = '';
}

function hide(el: HTMLElement | null) {
    if (el) el.style.display = 'none';
}

function scrollToBottom(el: HTMLElement | null) {
    if (el) el.scrollTop = el.scrollHeight;
}

// ========== 核心模块 ==========

const RAG = {
    /** 是否正在请求 */
    loading: false,

    /** 源头文章页 slug（仅文章页有值） */
    articleSlug: '',

    // -------- 初始化 --------

    init() {
        // 感知文章页 slug
        const slugEl = document.querySelector<HTMLMetaElement>('meta[name="article-slug"]');
        if (slugEl) this.articleSlug = slugEl.value;
    },

    // -------- 全局搜索对话框 --------

    openModal() {
        show($('rag-modal'));
        setTimeout(() => $('rag-input')?.focus(), 200);
    },

    closeModal() {
        hide($('rag-modal'));
    },

    async ask() {
        const input = $('rag-input') as HTMLInputElement | null;
        const question = input?.value.trim();
        if (!question || this.loading) return;

        this.loading = true;
        const sendBtn = $('rag-send') as HTMLButtonElement | null;
        if (sendBtn) sendBtn.disabled = true;

        // 显示用户问题
        this.appendMessage('user', question);
        if (input) input.value = '';
        scrollToBottom($('rag-messages'));

        // 显示 loading
        const loadingId = this.appendMessage('bot', '思考中...');

        try {
            const res = await fetch(`${API_BASE}/ask`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ question })
            });

            if (!res.ok) throw new Error(`HTTP ${res.status}`);

            const data: AskResponse = await res.json();

            // 替换 loading 为真实回答
            this.updateMessage(loadingId, 'bot', data.answer);

            // 显示来源
            this.showSources(data.sources);
        } catch (err) {
            this.updateMessage(loadingId, 'bot',
                '😅 抱歉，暂时无法连接到 AI 助手。请确保后端服务已启动。'
            );
            console.error('RAG ask error:', err);
        } finally {
            this.loading = false;
            if (sendBtn) sendBtn.disabled = false;
            scrollToBottom($('rag-messages'));
        }
    },

    appendMessage(role: 'user' | 'bot', text: string): string {
        const container = $('rag-messages');
        if (!container) return '';
        const id = `rag-msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const div = document.createElement('div');
        div.className = `rag-msg rag-${role}`;
        div.id = id;
        div.textContent = text;
        container.appendChild(div);
        scrollToBottom(container);
        return id;
    },

    updateMessage(id: string, role: 'user' | 'bot', text: string) {
        const el = document.getElementById(id);
        if (el) {
            el.className = `rag-msg rag-${role}`;
            el.textContent = text;
        }
    },

    showSources(sources: { title: string; slug: string; score: number }[]) {
        const container = $('rag-sources');
        if (!container) return;

        // 去重
        const seen = new Set<string>();
        const unique = sources.filter(s => {
            if (seen.has(s.slug)) return false;
            seen.add(s.slug);
            return true;
        });

        if (unique.length === 0) {
            container.innerHTML = '';
            return;
        }

        container.innerHTML = '<div class="rag-sources-label">📚 参考文章：</div>' +
            unique.map(s =>
                `<a class="rag-source-link" href="/post/${s.slug}/" target="_blank">📄 ${s.title}</a>`
            ).join('');
    },

    // -------- 文章底部问答 --------

    async askArticle() {
        const input = $('rag-article-input') as HTMLInputElement | null;
        const question = input?.value.trim();
        if (!question || this.loading) return;

        this.loading = true;
        const sendBtn = $('rag-article-send') as HTMLButtonElement | null;
        if (sendBtn) sendBtn.disabled = true;

        // 显示文章专属问答区域
        const answerArea = $('rag-article-qa');
        show(answerArea);

        const answerDiv = $('rag-article-answer');
        if (answerDiv) {
            answerDiv.innerHTML = '<div class="rag-msg rag-bot">🤔 正在查询...</div>';
        }
        if (input) input.value = '';

        try {
            const res = await fetch(`${API_BASE}/ask`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    question: `关于文章《${document.title}》的问题：${question}`,
                    topK: 3
                })
            });

            if (!res.ok) throw new Error(`HTTP ${res.status}`);

            const data: AskResponse = await res.json();

            if (answerDiv) {
                answerDiv.innerHTML = `<div class="rag-msg rag-bot">${data.answer}</div>`;
            }

            // 显示来源
            const sourcesDiv = $('rag-article-sources');
            if (sourcesDiv) {
                const seen = new Set<string>();
                const unique = data.sources.filter(s => {
                    if (seen.has(s.slug)) return false;
                    seen.add(s.slug);
                    return true;
                });
                if (unique.length > 0) {
                    sourcesDiv.innerHTML = '<div class="rag-sources-label">📚 参考来源：</div>' +
                        unique.map(s =>
                            `<a class="rag-source-link" href="/post/${s.slug}/" target="_blank">📄 ${s.title}</a>`
                        ).join('');
                }
            }
        } catch (err) {
            if (answerDiv) {
                answerDiv.innerHTML =
                    '<div class="rag-msg rag-bot">😅 连接 AI 服务失败，请确认后端已启动。</div>';
            }
            console.error('RAG article ask error:', err);
        } finally {
            this.loading = false;
            if (sendBtn) sendBtn.disabled = false;
        }
    }
};

// ========== 自动初始化 ==========

// DOM 加载完成后执行
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => RAG.init());
} else {
    RAG.init();
}

// 暴露到全局（方便 HTML onclick 调用）
(window as any).RAG = RAG;

// ========== 花瓣飘落动画 ==========

(function initPetals() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const COLORS = ['#f9a8d4', '#f472b6', '#fbcfe8', '#fce7f3', '#fff'];
    const COUNT = 25;
    const frag = document.createDocumentFragment();

    for (let i = 0; i < COUNT; i++) {
        const petal = document.createElement('div');
        petal.className = 'petal';

        const size = 6 + Math.random() * 10;
        const isTeardrop = Math.random() > 0.5;

        petal.style.cssText = [
            `width:${size}px`,
            `height:${size * 1.4}px`,
            `left:${Math.random() * 100}vw`,
            `background:${COLORS[Math.floor(Math.random() * COLORS.length)]}`,
            `--fall-dur:${8 + Math.random() * 12}s`,
            `--fall-delay:${Math.random() * 20}s`,
            `--fall-sway:${20 + Math.random() * 60}px`,
            `border-radius:${isTeardrop ? '50% 0 50% 0' : '50%'}`,
        ].join(';');

        frag.appendChild(petal);
    }

    document.body.appendChild(frag);
})();
