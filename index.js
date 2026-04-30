(async function () {
    if (window.__phoneModeLoaded) return;
    window.__phoneModeLoaded = true;

    await new Promise(r => setTimeout(r, 1000));

    let phoneActive = false;
    let phoneWindow = null;
    let conversationHistory = [];
    let isGenerating = false;
    let minimized = false;
    let currentRole = null;
    let lastChatId = null;

    // ── 工具 ─────────────────────────

    function getCtx() {
        try { return SillyTavern.getContext(); }
        catch { return null; }
    }

    function getChatKey() {
        const ctx = getCtx();
        return `pm_history_${ctx?.chatId ?? 'default'}`;
    }

    function saveHistory() {
        const key = getChatKey();
        const trimmed = conversationHistory.slice(-30);
        localStorage.setItem(key, JSON.stringify(trimmed));
    }

    function loadHistory() {
        try {
            return JSON.parse(localStorage.getItem(getChatKey()) || '[]');
        } catch { return []; }
    }

    function cleanText(text) {
        return (text ?? '')
            .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
            .replace(/<[^>]+>/g, '')
            .replace(/\*+([^*]+)\*+/g, '$1')
            .replace(/_+([^_]+)_+/g, '$1')
            .trim();
    }

    function escapeHtml(str) {
        return String(str)
            .replace(/&/g,'&amp;')
            .replace(/</g,'&lt;')
            .replace(/>/g,'&gt;');
    }

    function splitUserParts(text) {
        return text.split('/').map(s => s.trim()).filter(Boolean);
    }

    function splitAISentences(text) {
        return cleanText(text)
            .split(/(?<=[。！？!?])/)
            .map(s => s.trim())
            .filter(Boolean)
            .slice(0, 8);
    }

    // ── UI ─────────────────────────

    function appendBubble(text, side) {
        const div = phoneWindow?.querySelector('.pm-messages');
        if (!div) return;

        const b = document.createElement('div');
        b.className = `pm-bubble pm-${side}`;
        b.innerHTML = escapeHtml(text).replace(/\n/g, '<br>');
        div.appendChild(b);
        div.scrollTop = div.scrollHeight;
    }

    function appendNote(text) {
        const div = phoneWindow?.querySelector('.pm-messages');
        if (!div) return;

        const n = document.createElement('div');
        n.className = 'pm-system-note';
        n.textContent = text;
        div.appendChild(n);
        div.scrollTop = div.scrollHeight;
    }

    function showTyping() {
        const div = phoneWindow?.querySelector('.pm-messages');
        if (!div || document.getElementById('pm-typing')) return;

        const t = document.createElement('div');
        t.id = 'pm-typing';
        t.className = 'pm-bubble pm-left';
        t.innerHTML = '…';
        div.appendChild(t);
    }

    function hideTyping() {
        document.getElementById('pm-typing')?.remove();
    }

    // ── AI ─────────────────────────

    async function getAIReply(userMessage) {
        const ctx = getCtx();
        if (!ctx) return '（无上下文）';

        const charName = ctx.characters?.[ctx.characterId]?.name ?? '未知';
        const persona = ctx.characters?.[ctx.characterId]?.description ?? '';

        const roleText = currentRole ? `当前扮演角色：${currentRole}。` : '';

        const systemPrompt = `
你正在以手机短信形式聊天。
角色卡：${charName}
${roleText}
${persona}

要求：
- 像真实聊天
- 回复3-8句
- 自然，不要格式符号
`;

        conversationHistory.push({ role: 'user', content: userMessage });
        saveHistory();

        const messages = [
            { role: 'user', content: systemPrompt },
            { role: 'assistant', content: '好的' },
            ...conversationHistory
        ];

        let reply = '';

        try {
            if (ctx.generateRaw) {
                reply = await ctx.generateRaw(messages, '', false, false);
            } else {
                reply = await ctx.generateQuietPrompt(userMessage, false, false, systemPrompt, charName);
            }
        } catch {
            return '（生成失败）';
        }

        reply = cleanText(reply);
        conversationHistory.push({ role: 'assistant', content: reply });
        saveHistory();

        return reply;
    }

    // ── 操作 ─────────────────────────

    window.__pmSend = async function () {
        if (!phoneActive || isGenerating) return;

        const input = phoneWindow.querySelector('.pm-input');
        const raw = input.value.trim();
        if (!raw) return;

        input.value = '';

        splitUserParts(raw).forEach(p => appendBubble(p, 'right'));

        isGenerating = true;
        showTyping();

        const reply = await getAIReply(raw);

        hideTyping();
        splitAISentences(reply).forEach(s => appendBubble(s, 'left'));

        isGenerating = false;
        input.focus();
    };

    window.__pmToggle = function () {
        const body = phoneWindow.querySelector('.pm-body');
        minimized = !minimized;

        body.style.height = minimized ? '0px' : '';
        body.style.overflow = minimized ? 'hidden' : '';
    };

    window.__pmEnd = function () {
        endPhoneMode();
    };

    window.__pmPickChar = function () {
        const name = prompt('输入要扮演的角色名');
        if (!name) return;

        currentRole = name.trim();
        appendNote(`切换角色：${currentRole}`);
    };

    // ── 窗口 ─────────────────────────

    function buildWindow(name) {
        const win = document.createElement('div');
        win.id = 'pm-phone-window';

        win.innerHTML = `
<div class="pm-titlebar">
  <span>${escapeHtml(name)}</span>
  <div>
    <button onclick="__pmPickChar()">🎭</button>
    <button onclick="__pmToggle()">─</button>
    <button onclick="__pmEnd()">✕</button>
  </div>
</div>
<div class="pm-body">
  <div class="pm-messages"></div>
  <textarea class="pm-input"></textarea>
</div>`;

        win.querySelector('.pm-input').addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                window.__pmSend();
            }
        });

        document.body.appendChild(win);
        return win;
    }

    // ── 核心 ─────────────────────────

    function startPhoneMode() {
        if (phoneActive) return;

        const ctx = getCtx();
        const name = ctx?.characters?.[ctx.characterId]?.name ?? '未知';

        conversationHistory = loadHistory();

        phoneWindow = buildWindow(name);
        phoneActive = true;

        appendNote(`聊天已恢复（${conversationHistory.length}条）`);
    }

    function endPhoneMode() {
        phoneWindow?.remove();
        phoneWindow = null;
        phoneActive = false;
    }

    // ── 监听聊天切换 ─────────────────

    setInterval(() => {
        const ctx = getCtx();
        if (!ctx) return;

        if (lastChatId === null) {
            lastChatId = ctx.chatId;
        } else if (ctx.chatId !== lastChatId) {
            lastChatId = ctx.chatId;
            endPhoneMode();
        }
    }, 1000);

    // ── 指令 ─────────────────────────

    document.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter') return;

        const ta = document.getElementById('send_textarea');
        if (!ta || document.activeElement !== ta) return;

        if (ta.value.trim() === '/phone') {
            e.preventDefault();
            ta.value = '';
            startPhoneMode();
        }
    }, true);

    // ── 样式（完全固定） ─────────────

    const style = document.createElement('style');
    style.textContent = `
#pm-phone-window {
    position: fixed;
    right: 20px;
    bottom: 80px;
    width: 320px;
    height: 520px;
    background: #eee;
    display: flex;
    flex-direction: column;
    border-radius: 12px;
    overflow: hidden;
    z-index: 99999;
}
.pm-titlebar {
    background: #ddd;
    padding: 6px;
    display: flex;
    justify-content: space-between;
}
.pm-body {
    flex: 1;
    display: flex;
    flex-direction: column;
}
.pm-messages {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
}
.pm-input {
    height: 60px;
}
.pm-bubble {
    margin: 4px;
    padding: 6px;
    border-radius: 8px;
}
.pm-right { background:#007aff;color:#fff;align-self:flex-end; }
.pm-left { background:#fff; }
.pm-system-note {
    text-align:center;
    font-size:10px;
    color:#999;
}`;
    document.head.appendChild(style);

    console.log('phone mode loaded');
})();
