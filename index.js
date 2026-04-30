(async function () {
    await new Promise(r => setTimeout(r, 2000));

    // ── 1. 全局持久化与状态 ──
    window.__pmHistories = window.__pmHistories || {};
    let phoneActive = false;
    let phoneWindow = null;
    let conversationHistory = [];
    let currentPersona = '';
    let isGenerating = false;
    let minimized = false;

    // 事件监听：切换存档自动挂断
    if (!window.__pmEventHooked && typeof eventSource !== 'undefined') {
        eventSource.on('chat_changed', () => { if (phoneActive) window.__pmEnd(false); });
        eventSource.on('character_page_loaded', () => { if (phoneActive) window.__pmEnd(false); });
        window.__pmEventHooked = true;
    }

    // ── 2. 逻辑工具 ──
    function getCurrentChatId() {
        const ctx = SillyTavern.getContext();
        return `${ctx.characterId}_${ctx.chat_file || 'default'}`;
    }

    function getBaseCharName() {
        const ctx = SillyTavern.getContext();
        return ctx.characters?.[ctx.characterId]?.name ?? '未知角色';
    }

    function saveConversation() {
        if (conversationHistory.length > 30) conversationHistory = conversationHistory.slice(-30);
        const chatId = getCurrentChatId();
        if (!window.__pmHistories[chatId]) window.__pmHistories[chatId] = {};
        window.__pmHistories[chatId][currentPersona] = [...conversationHistory];
    }

    // 强效文本清理：物理截断 + 规则过滤
    function superClean(text) {
        let clean = (text ?? '')
            .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '') // 删掉思维链
            .replace(/<[^>]+>/g, '') // 删掉HTML
            .replace(/\*[^*]+\*/g, '') // 删掉 *动作描写*
            .replace(/\([^\)]+\)/g, '') // 删掉 (旁白)
            .replace(/（[^）]+）/g, '') // 删掉 （中文括号旁白）
            .replace(/当前风格[：:].*?(\n|$)/gi, '') // 删掉残留风格提示
            .replace(/^(.*?):/gm, '') // 删掉名字前缀
            .trim();
        
        // 物理截断：只取前8句
        const sentences = clean.split(/(?<=[。！？!?\n])\s*/).filter(s => s.length > 1);
        return sentences.slice(0, 8).join('\n');
    }

    // ── 3. API 调用（核心：人设注入） ──
    async function getAIReply(userMessage) {
        const ctx = SillyTavern.getContext();
        conversationHistory.push({ role: 'user', content: userMessage });
        saveConversation();

        try {
            const historyText = conversationHistory.slice(0, -1).map(m => 
                `${m.role === 'user' ? 'Me' : currentPersona}: ${m.content}`).join('\n');

            // 构造包含人设变量的最高权限Prompt
            const systemPrompt = `### [INTERNAL MODAL: IPHONE SMS MODE] ###
- You are now strictly acting as "${currentPersona}".
- Context: Reading User Persona ({{user}}) and Character Persona ({{persona}}).
- Goal: Send a short text message. 
- Rules: 
  1. NO actions, NO thoughts, NO asterisks.
  2. Length: 3 to 8 short sentences. 
  3. Format: Pure text only.
  4. NEVER say "Current Style" or metadata.`;

            const fullPrompt = `${systemPrompt}\n\n[History]\n${historyText}\n\n[New Message from {{user}}]\n{{user}}: ${userMessage}\n\n[Response as ${currentPersona}]`;

            let reply = await ctx.generateQuietPrompt(fullPrompt, false, false, systemPrompt, currentPersona);
            const finalReply = superClean(reply);
            
            conversationHistory.push({ role: 'assistant', content: finalReply });
            saveConversation();
            return finalReply;
        } catch (e) {
            console.error('[Phone] Error:', e);
            return "Connection Lost...";
        }
    }

    // ── 4. UI 组件 ──
    function appendBubble(text, side) {
        const div = phoneWindow?.querySelector('.pm-messages');
        if (!div || !text) return;
        const b = document.createElement('div');
        b.className = `pm-bubble pm-${side}`;
        b.innerHTML = text.replace(/\n/g, '<br>');
        div.appendChild(b);
        div.scrollTop = div.scrollHeight;
    }

    window.__pmConfirmPersona = function() {
        const input = document.getElementById('pm-persona-input');
        const newName = input.value.trim();
        if (!newName) return;
        
        const chatId = getCurrentChatId();
        if (!window.__pmHistories[chatId]) window.__pmHistories[chatId] = {};
        if (Object.keys(window.__pmHistories[chatId]).length >= 10 && !window.__pmHistories[chatId][newName]) {
            toastr.error('联系人列表已满(10人)'); return;
        }
        
        document.getElementById('pm-modal-overlay').remove();
        currentPersona = newName;
        conversationHistory = window.__pmHistories[chatId][currentPersona] || [];
        if (phoneWindow) {
            phoneWindow.querySelector('.pm-char-name').textContent = currentPersona;
            phoneWindow.querySelector('.pm-avatar').textContent = currentPersona[0];
            const msgDiv = phoneWindow.querySelector('.pm-messages');
            msgDiv.innerHTML = '';
            conversationHistory.forEach(m => appendBubble(m.content, m.role === 'user' ? 'right' : 'left'));
        }
    };

    window.__pmSend = async function() {
        if (isGenerating) return;
        const input = phoneWindow.querySelector('.pm-input');
        const text = input.value.trim();
        if (!text) return;
        input.value = '';

        appendBubble(text, 'right');
        isGenerating = true;
        phoneWindow.querySelector('.pm-send-btn').style.opacity = '0.5';

        const reply = await getAIReply(text);
        
        // 模拟打字间隔显示气泡
        const sents = reply.split('\n');
        for (let s of sents) {
            await new Promise(r => setTimeout(r, 400));
            appendBubble(s, 'left');
        }

        isGenerating = false;
        phoneWindow.querySelector('.pm-send-btn').style.opacity = '1';
    };

    // ── 5. 样式（iPhone 视觉重塑） ──
    const style = `
#pm-phone-window {
    position: fixed; bottom: 50px; right: 30px; width: 360px; height: 600px;
    background: rgba(242, 242, 247, 0.85); backdrop-filter: blur(20px);
    border: 8px solid #1c1c1e; border-radius: 45px; z-index: 99999;
    display: flex; flex-direction: column; box-shadow: 0 25px 50px rgba(0,0,0,0.4);
    font-family: -apple-system, system-ui, sans-serif; transition: 0.3s cubic-bezier(0.2, 0, 0.2, 1);
}
#pm-phone-window.pm-minimized { height: 100px; width: 200px; transform: translateY(400px); }

/* 灵动岛 */
.pm-dynamic-island {
    width: 110px; height: 28px; background: #000; margin: 12px auto;
    border-radius: 20px; flex-shrink: 0;
}

.pm-header { padding: 0 20px 10px; display: flex; align-items: center; justify-content: space-between; border-bottom: 0.5px solid #ccc; }
.pm-avatar { width: 40px; height: 40px; border-radius: 50%; background: #007aff; color: #fff; display: flex; align-items: center; justify-content: center; font-weight: bold; margin-right: 10px; }
.pm-char-name { font-size: 17px; font-weight: 600; flex: 1; }

.pm-messages { flex: 1; overflow-y: auto; padding: 15px; display: flex; flex-direction: column; gap: 8px; }
.pm-bubble { max-width: 75%; padding: 10px 16px; border-radius: 18px; font-size: 15px; line-height: 1.4; word-wrap: break-word; }
.pm-right { align-self: flex-end; background: #007aff; color: #fff; border-bottom-right-radius: 4px; }
.pm-left { align-self: flex-start; background: #e9e9eb; color: #000; border-bottom-left-radius: 4px; }

.pm-input-area { background: #fff; padding: 10px 15px 30px; border-top: 0.5px solid #ccc; display: flex; gap: 10px; align-items: center; }
.pm-input { 
    flex: 1; background: #fff !important; color: #000 !important; border: 1px solid #ddd; 
    border-radius: 20px; padding: 10px 15px; outline: none; transition: 0.2s;
}
.pm-input:focus { border-color: #007aff; box-shadow: 0 0 5px rgba(0,122,255,0.3); }
.pm-send-btn { width: 32px; height: 32px; border-radius: 50%; background: #007aff; color: #fff; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 18px; }

.pm-picker-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 100001; display: flex; align-items: center; justify-content: center; }
.pm-picker-box { background: #fff; border-radius: 20px; width: 300px; padding: 20px; box-shadow: 0 10px 25px rgba(0,0,0,0.2); }
    `;

    // ── 6. 初始化 ──
    if (!document.getElementById('pm-v4-style')) {
        const s = document.createElement('style'); s.id = 'pm-v4-style'; s.innerHTML = style; document.head.appendChild(s);
    }

    window.__pmEnd = (t) => { phoneWindow?.remove(); phoneActive = false; if(t) toastr.info('iPhone mode Off'); };
    window.__pmToggle = () => { minimized = !minimized; phoneWindow.classList.toggle('pm-minimized', minimized); };
    window.__pmCallNew = () => {
        const ov = document.createElement('div'); ov.id = 'pm-modal-overlay'; ov.className = 'pm-picker-overlay';
        ov.innerHTML = `<div class="pm-picker-box">
            <h3 style="margin-top:0">新联系人</h3>
            <input id="pm-persona-input" class="pm-input" style="width:100%;margin-bottom:15px" placeholder="输入名字..." />
            <div style="display:flex;gap:10px">
                <button class="pm-send-btn" style="flex:1;border-radius:10px;background:#8e8e93" onclick="document.getElementById('pm-modal-overlay').remove()">取消</button>
                <button class="pm-send-btn" style="flex:1;border-radius:10px" onclick="__pmConfirmPersona()">确认</button>
            </div>
        </div>`;
        document.body.appendChild(ov);
    };

    window.__pmStart = () => {
        if (phoneActive) return;
        currentPersona = getBaseCharName();
        const chatId = getCurrentChatId();
        conversationHistory = window.__pmHistories[chatId]?.[currentPersona] || [];
        
        phoneWindow = document.createElement('div');
        phoneWindow.id = 'pm-phone-window';
        phoneWindow.innerHTML = `
            <div class="pm-dynamic-island"></div>
            <div class="pm-header">
                <div class="pm-avatar">${currentPersona[0]}</div>
                <div class="pm-char-name">${currentPersona}</div>
                <div style="display:flex;gap:8px">
                    <button style="background:none;border:none;cursor:pointer;font-size:18px" onclick="__pmCallNew()">⇄</button>
                    <button style="background:none;border:none;cursor:pointer;font-size:18px" onclick="__pmToggle()">─</button>
                    <button style="background:none;border:none;cursor:pointer;font-size:18px;color:#ff3b30" onclick="__pmEnd(true)">✕</button>
                </div>
            </div>
            <div class="pm-messages"></div>
            <div class="pm-input-area">
                <textarea class="pm-input" rows="1" placeholder="iMessage"></textarea>
                <button class="pm-send-btn" onclick="__pmSend()">↑</button>
            </div>
        `;
        document.body.appendChild(phoneWindow);
        phoneActive = true;
        
        const msgDiv = phoneWindow.querySelector('.pm-messages');
        conversationHistory.forEach(m => appendBubble(m.content, m.role === 'user' ? 'right' : 'left'));
        
        // 绑定Enter发送
        phoneWindow.querySelector('.pm-input').addEventListener('keydown', e => {
            if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); __pmSend(); }
        });
        
        // 拖拽逻辑保持...
        let isDragging = false, startX, startY, startLeft, startTop;
        const header = phoneWindow.querySelector('.pm-header');
        header.onmousedown = (e) => {
            isDragging = true;
            startX = e.clientX; startY = e.clientY;
            startLeft = phoneWindow.offsetLeft; startTop = phoneWindow.offsetTop;
        };
        document.onmousemove = (e) => {
            if(!isDragging) return;
            phoneWindow.style.left = (startLeft + e.clientX - startX) + 'px';
            phoneWindow.style.top = (startTop + e.clientY - startY) + 'px';
            phoneWindow.style.right = 'auto'; phoneWindow.style.bottom = 'auto';
        };
        document.onmouseup = () => isDragging = false;
    };

    // 拦截命令行
    document.addEventListener('keydown', e => {
        if(e.key==='Enter' && !e.shiftKey){
            const ta = document.getElementById('send_textarea');
            if(ta && ta.value.trim()==='/phone'){
                e.preventDefault(); ta.value=''; __pmStart();
            }
        }
    }, true);

    console.log("iPhone Mode V4 Loaded. Use /phone to call.");
})();
