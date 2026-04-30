(async function () {
    await new Promise(r => setTimeout(r, 2000));

    let phoneActive = false;
    let phoneWindow = null;
    let conversationHistory = [];
    let isGenerating = false;
    let minimized = false;

    // ── 工具函数 ──────────────────────────────────────

    function getCurrentCharName() {
        try {
            const ctx = SillyTavern.getContext();
            return ctx.characters?.[ctx.characterId]?.name ?? '未知';
        } catch { return '未知'; }
    }

    function getCharPersona() {
        try {
            const ctx = SillyTavern.getContext();
            const char = ctx.characters?.[ctx.characterId];
            return char?.description ?? '';
        } catch { return ''; }
    }

    // 读取酒馆历史对话，转换为对话历史格式
    function loadChatHistory() {
        try {
            const ctx = SillyTavern.getContext();
            const chat = ctx.chat ?? [];
            const history = [];
            for (const msg of chat) {
                if (msg.is_system) continue;
                const role = msg.is_user ? 'user' : 'assistant';
                // 清理消息内容
                const content = cleanText(msg.mes ?? '');
                if (content) history.push({ role, content });
            }
            return history;
        } catch { return []; }
    }

    // 获取所有角色列表
    function getAllCharacters() {
        try {
            const ctx = SillyTavern.getContext();
            return ctx.characters ?? [];
        } catch { return []; }
    }

    // 切换角色
    function switchCharacter(index) {
        try {
            const ctx = SillyTavern.getContext();
            // 调用酒馆内部的角色切换
            if (typeof window.selectCharacterById === 'function') {
                window.selectCharacterById(index);
            } else {
                // 直接点击角色列表项
                const charItems = document.querySelectorAll('#rm_print_characters_block .character_select');
                if (charItems[index]) charItems[index].click();
            }
        } catch (e) {
            console.error('[phone-mode] 切换角色失败:', e);
        }
    }

    function splitUserParts(text) {
        return text.split('/').map(s => s.trim()).filter(Boolean);
    }

    function splitAISentences(text) {
        const clean = cleanText(text);
        return clean.split(/(?<=[。！？!?\n])\s*/)
            .map(s => s.trim()).filter(Boolean).slice(0, 8);
    }

    // 清理 AI 回复中的标签和 markdown
    function cleanText(text) {
        return (text ?? '')
            .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
            .replace(/<[^>]+>/g, '')
            .replace(/\*+([^*]+)\*+/g, '$1')
            .replace(/_+([^_]+)_+/g, '$1')
            .replace(/#{1,6}\s/g, '')
            .trim();
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

    // ── API 调用 ──────────────────────────────────────

    async function getAIReply(userMessage) {
        const charName = getCurrentCharName();
        const persona = getCharPersona();

        const systemPrompt = `你正在扮演"${charName}"通过手机短信与用户聊天。${persona ? `角色设定：${persona}` : ''}请用符合角色性格的方式简短回复，像真实发短信一样自然。不要输出任何思考过程、标签或格式符号。`;

        conversationHistory.push({ role: 'user', content: userMessage });

        try {
            const ctx = SillyTavern.getContext();

            // 构建完整消息列表（历史 + 本次）
            const messages = [
                { role: 'user', content: systemPrompt },
                { role: 'assistant', content: '好的，我明白了。' },
                ...conversationHistory
            ];

            // 使用 generateRaw（更底层，不经过预设）
            let reply = '';
            if (typeof ctx.generateRaw === 'function') {
                reply = await ctx.generateRaw(messages, '', false, false);
            } else if (typeof ctx.generateQuietPrompt === 'function') {
                reply = await ctx.generateQuietPrompt(userMessage, false, false, systemPrompt, charName);
            } else {
                reply = '（API调用失败）';
            }

            reply = cleanText(reply);
            conversationHistory.push({ role: 'assistant', content: reply });
            return reply;
        } catch (e) {
            console.error('[phone-mode] AI调用失败:', e);
            return '（网络异常，请稍后重试）';
        }
    }

    // ── 气泡操作 ──────────────────────────────────────

    function getMessagesDiv() {
        return phoneWindow?.querySelector('.pm-messages');
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

    function showTyping() {
        const div = getMessagesDiv();
        if (!div || document.getElementById('pm-typing')) return;
        const t = document.createElement('div');
        t.className = 'pm-bubble pm-left pm-typing';
        t.id = 'pm-typing';
        t.innerHTML = '<span></span><span></span><span></span>';
        div.appendChild(t);
        div.scrollTop = div.scrollHeight;
    }

    function hideTyping() {
        document.getElementById('pm-typing')?.remove();
    }

    // ── 角色选择弹窗 ──────────────────────────────────

    function showCharacterPicker() {
        document.getElementById('pm-char-picker')?.remove();
        const chars = getAllCharacters();
        if (!chars.length) { toastr.warning('没有找到角色'); return; }

        const picker = document.createElement('div');
        picker.id = 'pm-char-picker';

        const list = chars.map((c, i) =>
            `<div class="pm-char-item" onclick="__pmSelectChar(${i})">
                <div class="pm-char-item-avatar">${escapeHtml((c.name ?? '?')[0])}</div>
                <span class="pm-char-item-name">${escapeHtml(c.name ?? '未知')}</span>
            </div>`
        ).join('');

        picker.innerHTML = `
<div class="pm-picker-overlay" onclick="document.getElementById('pm-char-picker').remove()"></div>
<div class="pm-picker-box">
  <div class="pm-picker-title">选择聊天对象</div>
  <div class="pm-picker-list">${list}</div>
</div>`;
        document.body.appendChild(picker);
    }

    window.__pmSelectChar = function(index) {
        document.getElementById('pm-char-picker')?.remove();
        const chars = getAllCharacters();
        const char = chars[index];
        if (!char) return;

        // 切换酒馆角色
        switchCharacter(index);

        // 更新手机界面顶部名字和头像
        setTimeout(() => {
            const newName = getCurrentCharName();
            if (phoneWindow) {
                const nameEl = phoneWindow.querySelector('.pm-char-name');
                const avatarEl = phoneWindow.querySelector('.pm-avatar');
                if (nameEl) nameEl.textContent = newName;
                if (avatarEl) avatarEl.textContent = newName[0] ?? '?';
            }
            // 重置对话历史，加载新角色的历史
            conversationHistory = loadChatHistory();
            appendNote(`已切换至 ${newName}`);
        }, 500);
    };

    // ── 发送消息 ──────────────────────────────────────

    window.__pmSend = async function () {
        if (!phoneActive || isGenerating) return;
        const input = phoneWindow?.querySelector('.pm-input');
        const raw = input?.value?.trim();
        if (!raw) return;
        input.value = '';

        splitUserParts(raw).forEach(p => appendBubble(p, 'right'));

        isGenerating = true;
        const sendBtn = phoneWindow?.querySelector('.pm-send-btn');
        if (sendBtn) sendBtn.disabled = true;
        if (input) input.disabled = true;

        showTyping();
        const reply = await getAIReply(raw);
        hideTyping();

        splitAISentences(reply).forEach(s => appendBubble(s, 'left'));

        isGenerating = false;
        if (sendBtn) sendBtn.disabled = false;
        if (input) { input.disabled = false; input.focus(); }
    };

    window.__pmEnd = function () { endPhoneMode(true); };
    window.__pmToggle = function () {
        if (!phoneWindow) return;
        const body = phoneWindow.querySelector('.pm-body');
        minimized = !minimized;
        body.style.display = minimized ? 'none' : 'flex';
        phoneWindow.querySelector('.pm-minimize-btn').textContent = minimized ? '▢' : '─';
    };
    window.__pmPickChar = function () { showCharacterPicker(); };

    // ── 拖拽（固定尺寸版）────────────────────────────

    function makeDraggable(el, handle) {
        let startX, startY, startLeft, startTop;
        handle.addEventListener('mousedown', function (e) {
            if (e.target.tagName === 'BUTTON') return;
            e.preventDefault();
            const rect = el.getBoundingClientRect();
            startX = e.clientX;
            startY = e.clientY;
            startLeft = rect.left;
            startTop = rect.top;
            document.addEventListener('mousemove', onDrag);
            document.addEventListener('mouseup', stopDrag);
        });
        function onDrag(e) {
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            el.style.left = (startLeft + dx) + 'px';
            el.style.top = (startTop + dy) + 'px';
            el.style.right = 'auto';
            el.style.bottom = 'auto';
        }
        function stopDrag() {
            document.removeEventListener('mousemove', onDrag);
            document.removeEventListener('mouseup', stopDrag);
        }
    }

    // ── 构建窗口 ──────────────────────────────────────

    function buildPhoneWindow(charName) {
        const win = document.createElement('div');
        win.id = 'pm-phone-window';
        win.innerHTML = `
<div class="pm-titlebar">
  <div class="pm-header-left">
    <div class="pm-avatar">${escapeHtml(charName[0] ?? '?')}</div>
    <div class="pm-header-info">
      <span class="pm-char-name">${escapeHtml(charName)}</span>
      <span class="pm-status">● 短信对话中</span>
    </div>
  </div>
  <div class="pm-header-btns">
    <button class="pm-switch-btn" onclick="__pmPickChar()" title="切换角色">⇄</button>
    <button class="pm-minimize-btn" onclick="__pmToggle()" title="最小化">─</button>
    <button class="pm-end-btn" onclick="__pmEnd()" title="结束">✕</button>
  </div>
</div>
<div class="pm-body">
  <div class="pm-messages"></div>
  <div class="pm-input-row">
    <textarea class="pm-input" rows="2" placeholder="输入消息… / 分隔多条&#10;Enter发送  Shift+Enter换行"></textarea>
    <button class="pm-send-btn" onclick="__pmSend()">发送</button>
  </div>
</div>`;

        win.querySelector('.pm-input').addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                e.stopPropagation();
                window.__pmSend();
            }
        });

        makeDraggable(win, win.querySelector('.pm-titlebar'));
        document.body.appendChild(win);
        return win;
    }

    // ── 核心流程 ──────────────────────────────────────

    async function startPhoneMode() {
        if (phoneActive) {
            phoneWindow && (phoneWindow.style.display = 'flex');
            toastr.info('手机模式已在运行');
            return;
        }

        const charName = getCurrentCharName();
        // 加载历史对话
        conversationHistory = loadChatHistory();

        phoneWindow = buildPhoneWindow(charName);
        phoneActive = true;

        // 显示历史消息提示
        const histCount = conversationHistory.length;
        appendNote(histCount > 0
            ? `与 ${charName} 的对话（已加载 ${histCount} 条历史记录）`
            : `与 ${charName} 的对话开始`);

        toastr.success(`📱 已开启 | ${charName}${histCount > 0 ? ` | 加载了${histCount}条历史` : ''}`);
    }

    function endPhoneMode(showToast = true) {
        if (!phoneActive) return;
        appendNote('── 通话已结束 ──');
        setTimeout(() => { phoneWindow?.remove(); phoneWindow = null; }, 1500);
        phoneActive = false;
        conversationHistory = [];
        isGenerating = false;
        minimized = false;
        if (showToast) toastr.info('📴 手机模式已结束');
    }

    // ── 拦截 /phone ───────────────────────────────────

    document.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' || e.shiftKey) return;
        const ta = document.getElementById('send_textarea');
        if (!ta || document.activeElement !== ta) return;
        if (ta.value.trim() === '/phone') {
            e.preventDefault();
            e.stopImmediatePropagation();
            ta.value = '';
            startPhoneMode();
        }
    }, true);

    // ── 样式 ──────────────────────────────────────────

    if (!document.getElementById('pm-styles')) {
        const s = document.createElement('style');
        s.id = 'pm-styles';
        s.textContent = `
#pm-phone-window {
    position: fixed !important;
    bottom: 80px !important;
    right: 24px !important;
    width: 340px !important;
    height: auto !important;
    display: flex !important;
    flex-direction: column !important;
    background: #e5e9f0 !important;
    border-radius: 20px !important;
    overflow: hidden !important;
    font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif !important;
    box-shadow: 0 12px 40px rgba(0,0,0,0.3) !important;
    z-index: 99999 !important;
    min-width: 0 !important;
    max-width: 340px !important;
    box-sizing: border-box !important;
}
.pm-titlebar {
    background: #f7f7f7 !important;
    padding: 10px 12px !important;
    display: flex !important;
    justify-content: space-between !important;
    align-items: center !important;
    border-bottom: 1px solid #ddd !important;
    cursor: grab !important;
    user-select: none !important;
    flex-shrink: 0 !important;
    box-sizing: border-box !important;
    width: 100% !important;
}
.pm-titlebar:active { cursor: grabbing !important; }
.pm-header-left {
    display: flex !important;
    align-items: center !important;
    gap: 8px !important;
    min-width: 0 !important;
    flex: 1 !important;
}
.pm-avatar {
    width: 32px !important;
    height: 32px !important;
    min-width: 32px !important;
    border-radius: 50% !important;
    background: #007aff !important;
    color: #fff !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    font-size: 14px !important;
    font-weight: 700 !important;
}
.pm-header-info {
    display: flex !important;
    flex-direction: column !important;
    min-width: 0 !important;
}
.pm-char-name {
    font-size: 13px !important;
    font-weight: 600 !important;
    color: #111 !important;
    white-space: nowrap !important;
    overflow: hidden !important;
    text-overflow: ellipsis !important;
}
.pm-status { font-size: 10px !important; color: #4cd964 !important; }
.pm-header-btns {
    display: flex !important;
    gap: 5px !important;
    flex-shrink: 0 !important;
}
.pm-switch-btn, .pm-minimize-btn, .pm-end-btn {
    border: none !important;
    border-radius: 50% !important;
    width: 24px !important;
    height: 24px !important;
    font-size: 11px !important;
    cursor: pointer !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    flex-shrink: 0 !important;
    padding: 0 !important;
    line-height: 1 !important;
}
.pm-switch-btn { background: #34c759 !important; color: #fff !important; font-size: 13px !important; }
.pm-minimize-btn { background: #ffbd2e !important; color: #7a5800 !important; }
.pm-end-btn { background: #ff5f57 !important; color: #fff !important; }
.pm-body {
    display: flex !important;
    flex-direction: column !important;
    width: 100% !important;
    box-sizing: border-box !important;
}
.pm-messages {
    height: 340px !important;
    overflow-y: auto !important;
    padding: 12px !important;
    display: flex !important;
    flex-direction: column !important;
    gap: 7px !important;
    background: #e5e9f0 !important;
    box-sizing: border-box !important;
    width: 100% !important;
}
.pm-bubble {
    max-width: 72% !important;
    padding: 8px 12px !important;
    border-radius: 16px !important;
    font-size: 13px !important;
    line-height: 1.5 !important;
    word-break: break-word !important;
    box-shadow: 0 1px 2px rgba(0,0,0,0.08) !important;
    box-sizing: border-box !important;
}
.pm-right {
    align-self: flex-end !important;
    background: #007aff !important;
    color: #fff !important;
    border-bottom-right-radius: 3px !important;
}
.pm-left {
    align-self: flex-start !important;
    background: #fff !important;
    color: #111 !important;
    border-bottom-left-radius: 3px !important;
}
.pm-typing {
    display: flex !important;
    gap: 4px !important;
    align-items: center !important;
    padding: 10px 14px !important;
    width: fit-content !important;
}
.pm-typing span {
    width: 6px !important; height: 6px !important;
    border-radius: 50% !important; background: #aaa !important;
    display: inline-block !important;
    animation: pm-bounce 1.2s infinite !important;
}
.pm-typing span:nth-child(2) { animation-delay: 0.2s !important; }
.pm-typing span:nth-child(3) { animation-delay: 0.4s !important; }
@keyframes pm-bounce {
    0%,60%,100% { transform: translateY(0); }
    30% { transform: translateY(-5px); }
}
.pm-text { white-space: pre-wrap !important; }
.pm-card { display: inline-block !important; border-radius: 9px !important; padding: 4px 9px !important; font-size: 12px !important; font-weight: 500 !important; }
.pm-transfer { background: #fff3e0 !important; color: #e65100 !important; }
.pm-image { background: #e3f2fd !important; color: #0277bd !important; }
.pm-system-note { text-align: center !important; font-size: 11px !important; color: #999 !important; padding: 3px !important; }
.pm-input-row {
    background: #f7f7f7 !important;
    padding: 8px 10px !important;
    display: flex !important;
    gap: 7px !important;
    align-items: flex-end !important;
    border-top: 1px solid #ddd !important;
    box-sizing: border-box !important;
    width: 100% !important;
    flex-shrink: 0 !important;
}
.pm-input {
    flex: 1 !important;
    min-width: 0 !important;
    border: 1px solid #ccc !important;
    border-radius: 16px !important;
    padding: 7px 12px !important;
    font-size: 13px !important;
    resize: none !important;
    outline: none !important;
    font-family: inherit !important;
    background: #fff !important;
    color: #111 !important;
    line-height: 1.4 !important;
    box-sizing: border-box !important;
}
.pm-input:disabled { background: #f0f0f0 !important; color: #999 !important; }
.pm-send-btn {
    background: #007aff !important; color: #fff !important; border: none !important;
    border-radius: 16px !important; padding: 7px 14px !important; font-size: 13px !important;
    cursor: pointer !important; font-weight: 600 !important; font-family: inherit !important;
    white-space: nowrap !important; flex-shrink: 0 !important;
}
.pm-send-btn:disabled { background: #ccc !important; cursor: default !important; }
.pm-picker-overlay {
    position: fixed !important; inset: 0 !important;
    background: rgba(0,0,0,0.4) !important; z-index: 100000 !important;
}
.pm-picker-box {
    position: fixed !important; top: 50% !important; left: 50% !important;
    transform: translate(-50%,-50%) !important;
    background: #fff !important; border-radius: 16px !important;
    width: 280px !important; max-height: 400px !important;
    overflow: hidden !important; z-index: 100001 !important;
    box-shadow: 0 8px 32px rgba(0,0,0,0.2) !important;
    display: flex !important; flex-direction: column !important;
}
.pm-picker-title {
    padding: 14px 16px !important; font-size: 14px !important;
    font-weight: 600 !important; color: #111 !important;
    border-bottom: 1px solid #eee !important;
}
.pm-picker-list { overflow-y: auto !important; padding: 8px !important; }
.pm-char-item {
    display: flex !important; align-items: center !important; gap: 10px !important;
    padding: 10px 12px !important; border-radius: 10px !important;
    cursor: pointer !important; transition: background 0.15s !important;
}
.pm-char-item:hover { background: #f0f0f0 !important; }
.pm-char-item-avatar {
    width: 36px !important; height: 36px !important; border-radius: 50% !important;
    background: #007aff !important; color: #fff !important;
    display: flex !important; align-items: center !important; justify-content: center !important;
    font-size: 14px !important; font-weight: 700 !important; flex-shrink: 0 !important;
}
.pm-char-item-name { font-size: 14px !important; color: #111 !important; }
        `;
        document.head.appendChild(s);
    }

    console.log('[phone-mode] 加载完成，输入 /phone 然后按 Enter');
})();
