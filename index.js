(async function () {
    await new Promise(r => setTimeout(r, 2000));

    // ── 状态 ──────────────────────────────────────────
    let phoneActive = false;
    let phoneMesIndex = null;

    // ── 工具函数 ──────────────────────────────────────

    function getCurrentCharName() {
        try {
            const ctx = SillyTavern.getContext();
            return ctx.characters?.[ctx.characterId]?.name ?? '未知';
        } catch { return '未知'; }
    }

    function splitUserParts(text) {
        return text.split('/').map(s => s.trim()).filter(Boolean);
    }

    function splitAISentences(text) {
        return text.split(/(?<=[。！？!?\n])\s*/).map(s => s.trim()).filter(Boolean).slice(0, 8);
    }

    function escapeHtml(str) {
        return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    function renderBubbleContent(text) {
        const parts = [];
        const re = /[（(](转账|图片)[+\s：:]*([\d.]+|[^）)]+)[）)]/g;
        let last = 0, m;
        while ((m = re.exec(text)) !== null) {
            if (m.index > last) parts.push({ type: 'text', value: text.slice(last, m.index) });
            if (m[1] === '转账') parts.push({ type: 'transfer', value: parseFloat(m[2]) || 0 });
            else parts.push({ type: 'image', value: m[2].trim() });
            last = m.index + m[0].length;
        }
        if (last < text.length) parts.push({ type: 'text', value: text.slice(last) });
        return parts.map(p => {
            if (p.type === 'transfer') return `<div class="pm-card pm-transfer">💸 转账 ¥${p.value.toFixed(2)}</div>`;
            if (p.type === 'image') return `<div class="pm-card pm-image">🖼️ ${escapeHtml(p.value)}</div>`;
            const safe = escapeHtml(p.value).replace(/\n/g,'<br>');
            return safe ? `<span class="pm-text">${safe}</span>` : '';
        }).join('');
    }

    // ── DOM 操作 ──────────────────────────────────────

    function getMessagesDiv() {
        if (phoneMesIndex === null) return null;
        return document.querySelector(`.mes[mesid="${phoneMesIndex}"] .pm-messages`);
    }

    function appendBubble(text, side) {
        const div = getMessagesDiv();
        if (!div) return;
        const b = document.createElement('div');
        b.className = `pm-bubble pm-${side}`;
        b.innerHTML = renderBubbleContent(text);
        div.appendChild(b);
        div.scrollTop = div.scrollHeight;
    }

    function appendNote(text) {
        const div = getMessagesDiv();
        if (!div) return;
        const n = document.createElement('div');
        n.className = 'pm-system-note';
        n.textContent = text;
        div.appendChild(n);
        div.scrollTop = div.scrollHeight;
    }

    // ── 手机 UI ───────────────────────────────────────

    window.__pmSend = function () {
        const input = document.querySelector(`.mes[mesid="${phoneMesIndex}"] .pm-input`);
        const raw = input?.value?.trim();
        if (!raw) return;
        input.value = '';
        splitUserParts(raw).forEach(p => appendBubble(p, 'right'));
        const ta = document.getElementById('send_textarea');
        const btn = document.getElementById('send_but');
        if (ta && btn) { ta.value = raw; btn.click(); }
    };

    window.__pmEnd = function () {
        endPhoneMode(true);
    };

    function buildPhoneHTML(charName) {
        return `
<div class="pm-wrapper">
  <div class="pm-header">
    <span class="pm-char-name">${escapeHtml(charName)}</span>
    <button class="pm-end-btn" onclick="__pmEnd()">结束通话</button>
  </div>
  <div class="pm-messages"></div>
  <div class="pm-input-row">
    <textarea class="pm-input" rows="2" placeholder="输入消息…用 / 分隔多条（Enter发送，Shift+Enter换行）"></textarea>
    <button class="pm-send-btn" onclick="__pmSend()">发送</button>
  </div>
</div>`;
    }

    // ── 核心流程 ──────────────────────────────────────

    async function startPhoneMode() {
        if (phoneActive) { toastr.warning('手机模式已在运行中'); return; }
        const charName = getCurrentCharName();

        // 找到聊天容器，直接插入一个 div
        const chat = document.getElementById('chat');
        if (!chat) { toastr.error('找不到聊天容器'); return; }

        const wrapper = document.createElement('div');
        wrapper.className = 'mes';
        wrapper.style.cssText = 'padding:8px;background:transparent;border:none;';
        const mesText = document.createElement('div');
        mesText.className = 'mes_text';
        mesText.innerHTML = buildPhoneHTML(charName);
        wrapper.appendChild(mesText);
        chat.appendChild(wrapper);

        // 记录这个元素（不用 mesid，直接存引用）
        window.__pmElement = wrapper;
        phoneActive = true;

        // 绑定 Enter 键
        const input = mesText.querySelector('.pm-input');
        input?.addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); window.__pmSend(); }
        });

        // 滚动到底部
        chat.scrollTop = chat.scrollHeight;
        toastr.success('📱 手机模式已开启');
    }

    // 覆盖 getMessagesDiv，改用直接引用
    function getMessagesDivDirect() {
        return window.__pmElement?.querySelector('.pm-messages') ?? null;
    }

    // 重新绑定 appendBubble 使用直接引用
    window.__pmSend = function () {
        const input = window.__pmElement?.querySelector('.pm-input');
        const raw = input?.value?.trim();
        if (!raw) return;
        input.value = '';
        const div = getMessagesDivDirect();
        splitUserParts(raw).forEach(p => {
            if (!div) return;
            const b = document.createElement('div');
            b.className = 'pm-bubble pm-right';
            b.innerHTML = renderBubbleContent(p);
            div.appendChild(b);
            div.scrollTop = div.scrollHeight;
        });
        const ta = document.getElementById('send_textarea');
        const btn = document.getElementById('send_but');
        if (ta && btn) { ta.value = raw; btn.click(); }
    };

    window.__pmEnd = function () {
        endPhoneMode(true);
    };

    function endPhoneMode(showToast = true) {
        if (!phoneActive) return;
        const div = getMessagesDivDirect();
        if (div) {
            const n = document.createElement('div');
            n.className = 'pm-system-note';
            n.textContent = '── 通话已结束 ──';
            div.appendChild(n);
        }
        window.__pmElement?.querySelectorAll('.pm-input,.pm-send-btn,.pm-end-btn')
            .forEach(el => el.setAttribute('disabled', ''));
        phoneActive = false;
        window.__pmElement = null;
        if (showToast) toastr.info('手机模式已结束');
    }

    // ── 监听 AI 回复 ──────────────────────────────────

    const observer = new MutationObserver(() => {
        if (!phoneActive) return;
        const messages = document.querySelectorAll('#chat .mes:not(.pm-phone-mes)');
        const last = messages[messages.length - 1];
        if (!last) return;
        const isAI = !last.classList.contains('is_user') && last !== window.__pmElement;
        if (!isAI) return;
        // 防止重复处理
        if (last.dataset.pmProcessed) return;
        last.dataset.pmProcessed = 'true';
        const text = last.querySelector('.mes_text')?.innerText?.trim();
        if (!text) return;
        const div = getMessagesDivDirect();
        if (!div) return;
        splitAISentences(text).forEach(s => {
            const b = document.createElement('div');
            b.className = 'pm-bubble pm-left';
            b.innerHTML = renderBubbleContent(s);
            div.appendChild(b);
            div.scrollTop = div.scrollHeight;
        });
    });
    observer.observe(document.getElementById('chat') ?? document.body, { childList: true, subtree: true });

    // ── 拦截输入框的 /phone 命令 ──────────────────────

    document.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' || e.shiftKey) return;
        const ta = document.getElementById('send_textarea');
        if (!ta || document.activeElement !== ta) return;
        const val = ta.value.trim();
        if (val === '/phone') {
            e.preventDefault();
            e.stopImmediatePropagation();
            ta.value = '';
            startPhoneMode();
        }
    }, true);

    // ── 样式注入 ──────────────────────────────────────

    if (!document.getElementById('pm-styles')) {
        const s = document.createElement('style');
        s.id = 'pm-styles';
        s.textContent = `
.pm-wrapper{display:flex;flex-direction:column;width:100%;max-width:420px;margin:8px auto;background:#f0f2f5;border-radius:20px;overflow:hidden;font-family:system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.12)}
.pm-header{background:#fff;padding:12px 16px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #e5e5e5}
.pm-char-name{font-size:15px;font-weight:600;color:#111}
.pm-end-btn{background:#ff3b30;color:#fff;border:none;border-radius:14px;padding:4px 14px;font-size:12px;cursor:pointer}
.pm-end-btn:disabled,.pm-send-btn:disabled{background:#ccc;cursor:default}
.pm-messages{height:380px;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:10px}
.pm-bubble{max-width:78%;padding:8px 12px;border-radius:18px;font-size:14px;line-height:1.45;word-break:break-word}
.pm-right{align-self:flex-end;background:#007aff;color:#fff;border-bottom-right-radius:5px}
.pm-left{align-self:flex-start;background:#fff;color:#111;border-bottom-left-radius:5px}
.pm-text{white-space:pre-wrap}
.pm-card{display:inline-block;border-radius:10px;padding:5px 10px;font-size:13px;font-weight:500;margin:2px 0}
.pm-transfer{background:#fff3e0;color:#e65100}
.pm-image{background:#e3f2fd;color:#0277bd}
.pm-system-note{text-align:center;font-size:12px;color:#888;padding:4px}
.pm-input-row{background:#fff;padding:10px 12px;display:flex;gap:8px;align-items:flex-end;border-top:1px solid #e5e5e5}
.pm-input{flex:1;border:1px solid #ddd;border-radius:18px;padding:7px 12px;font-size:13px;resize:none;outline:none;font-family:inherit}
.pm-input:disabled{background:#f5f5f5}
.pm-send-btn{background:#007aff;color:#fff;border:none;border-radius:18px;padding:8px 16px;font-size:13px;cursor:pointer;font-weight:600}
        `;
        document.head.appendChild(s);
    }

    console.log('[phone-mode] 加载完成，在输入框输入 /phone 然后按 Enter');
})();
