(async function () {
    // 等待 SillyTavern 初始化完成
    await new Promise(r => setTimeout(r, 1000));

    const ctx = SillyTavern.getContext();
    const { eventSource, event_types, SlashCommandParser, SlashCommand } = ctx;

    // ── 状态 ──────────────────────────────────────────
    let phoneActive = false;
    let phoneMesIndex = null;
    
    // ── 工具函数 ──────────────────────────────────────

    function getCurrentCharName() {
        const c = ctx.characters?.[ctx.characterId];
        return c?.name ?? '未知';
    }

    function splitUserParts(text) {
        return text.split('/').map(s => s.trim()).filter(Boolean);
    }

    function splitAISentences(text) {
        return text.split(/(?<=[。！？!?\n])\s*/).map(s => s.trim()).filter(Boolean).slice(0, 8);
    }

    function escapeHtml(str) {
        return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    function renderBubbleContent(text) {
        const parts = [];
        const specialRE = /[（(](转账|图片)[+\s：:]*([\d.]+|[^）)]+)[）)]/g;
        let last = 0, m;
        while ((m = specialRE.exec(text)) !== null) {
            if (m.index > last) parts.push({ type: 'text', value: text.slice(last, m.index) });
            if (m[1] === '转账') parts.push({ type: 'transfer', value: parseFloat(m[2]) || 0 });
            else parts.push({ type: 'image', value: m[2].trim() });
            last = m.index + m[0].length;
        }
        if (last < text.length) parts.push({ type: 'text', value: text.slice(last) });

        return parts.map(p => {
            if (p.type === 'transfer') return `<div class="pm-card pm-transfer">💸 转账 ¥${p.value.toFixed(2)}</div>`;
            if (p.type === 'image') return `<div class="pm-card pm-image">🖼️ ${escapeHtml(p.value)}</div>`;
            const safe = escapeHtml(p.value).replace(/\n/g, '<br>');
            return safe ? `<span class="pm-text">${safe}</span>` : '';
        }).join('');
    }

    // ── DOM 操作 ──────────────────────────────────────

    function getPhoneMessagesDiv() {
        if (phoneMesIndex === null) return null;
        return document.querySelector(`.mes[mesid="${phoneMesIndex}"] .pm-messages`);
    }

    function appendBubble(text, side) {
        const div = getPhoneMessagesDiv();
        if (!div) return;
        const b = document.createElement('div');
        b.className = `pm-bubble pm-${side}`;
        b.innerHTML = renderBubbleContent(text);
        div.appendChild(b);
        div.scrollTop = div.scrollHeight;
    }

    function appendSystemNote(text) {
        const div = getPhoneMessagesDiv();
        if (!div) return;
        const n = document.createElement('div');
        n.className = 'pm-system-note';
        n.textContent = text;
        div.appendChild(n);
        div.scrollTop = div.scrollHeight;
    }

    // ── 手机 UI ───────────────────────────────────────

    function buildPhoneHTML(charName) {
        return `
<div class="pm-wrapper">
  <div class="pm-header">
    <span class="pm-char-name">${escapeHtml(charName)}</span>
    <button class="pm-end-btn" onclick="window.__pmEnd()">结束通话</button>
  </div>
  <div class="pm-messages"></div>
  <div class="pm-input-row">
    <textarea class="pm-input" rows="2" placeholder="输入消息… 用 / 分隔多条（Enter发送，Shift+Enter换行）"></textarea>
    <button class="pm-send-btn" onclick="window.__pmSend()">发送</button>
  </div>
</div>`;
    }

    // 全局函数供 onclick 调用
    window.__pmSend = function () {
        const mesText = document.querySelector(`.mes[mesid="${phoneMesIndex}"] .mes_text`);
        if (!mesText) return;
        const input = mesText.querySelector('.pm-input');
        const raw = input?.value?.trim();
        if (!raw) return;
        input.value = '';
        splitUserParts(raw).forEach(p => appendBubble(p, 'right'));
        // 发送给 AI
        const ta = document.getElementById('send_textarea');
        const btn = document.getElementById('send_but');
        if (ta && btn) { ta.value = raw; btn.click(); }
    };

    window.__pmEnd = function () {
        endPhoneMode(true);
    };

    // ── 核心流程 ──────────────────────────────────────

    async function startPhoneMode() {
        if (phoneActive) { toastr.warning('手机模式已在运行中'); return; }

        const charName = getCurrentCharName();

        // 构造一条 system 消息插入 chat 数组
        const msg = {
            name: 'System',
            is_user: false,
            is_system: true,
            send_date: new Date().toISOString(),
            mes: '📱 手机模式',
            extra: {},
        };
        ctx.chat.push(msg);
        phoneMesIndex = ctx.chat.length - 1;

        // 渲染这条消息
        if (typeof window.addOneMessage === 'function') {
            await window.addOneMessage(msg, { scroll: true, showSwipes: false });
        } else {
            await window.reloadCurrentChat?.();
        }

        await new Promise(r => setTimeout(r, 150));

        const mesText = document.querySelector(`.mes[mesid="${phoneMesIndex}"] .mes_text`);
        if (!mesText) { toastr.error('手机模式初始化失败，请重试'); return; }

        mesText.innerHTML = buildPhoneHTML(charName);

        // Enter 键绑定
        const input = mesText.querySelector('.pm-input');
        input?.addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); window.__pmSend(); }
        });

        phoneActive = true;
        toastr.success(`📱 手机模式已开启`);
    }

    function endPhoneMode(showToast = true) {
        if (!phoneActive) return;
        appendSystemNote('── 通话已结束 ──');
        const mesText = document.querySelector(`.mes[mesid="${phoneMesIndex}"] .mes_text`);
        if (mesText) {
            mesText.querySelector('.pm-input')?.setAttribute('disabled', '');
            mesText.querySelector('.pm-send-btn')?.setAttribute('disabled', '');
            mesText.querySelector('.pm-end-btn')?.setAttribute('disabled', '');
        }
        phoneActive = false;
        phoneMesIndex = null;
        if (showToast) toastr.info('手机模式已结束');
    }

    // ── 事件监听 ──────────────────────────────────────

    eventSource.on(event_types.MESSAGE_RECEIVED, (mesIndex) => {
        if (!phoneActive) return;
        const msg = ctx.chat[mesIndex];
        if (!msg || msg.is_user || msg.is_system) return;
        splitAISentences(msg.mes || '').forEach(s => appendBubble(s, 'left'));
    });

    eventSource.on(event_types.CHAT_CHANGED, () => {
        if (phoneActive) { endPhoneMode(false); toastr.info('角色已切换，手机模式自动结束'); }
    });

    // ── 注册 /phone 命令 ───────────────────────────────

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'phone',
        helpString: '召唤手机聊天界面',
        callback: async () => { await startPhoneMode(); return ''; },
    }));

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

    console.log('[phone-mode] 加载完成，输入 /phone 召唤');
})();
