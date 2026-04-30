(async function () {
    await new Promise(r => setTimeout(r, 1500));

    // ── 1. 状态中心 ──
    window.__pmHistories = window.__pmHistories || {};
    let phoneActive = false;
    let phoneWindow = null;
    let conversationHistory = [];
    let currentPersona = '';
    let isGenerating = false;
    let isMinimized = false;

    const ctx = () => typeof SillyTavern !== 'undefined' ? SillyTavern.getContext() : null;

    function getCurrentChatId() {
        const c = ctx();
        return c ? `${c.characterId}_${c.chat_file || 'default'}` : 'global_chat';
    }

    function saveToStore() {
        const id = getCurrentChatId();
        if (!window.__pmHistories[id]) window.__pmHistories[id] = {};
        window.__pmHistories[id][currentPersona] = [...conversationHistory.slice(-20)];
    }

    // ── 2. 强效清理与截断 ──
    function rigidClean(text) {
        let clean = (text ?? '')
            .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '') 
            .replace(/\*[^*]+\*/g, '') // 删动作
            .replace(/[（(][^）)]+[）)]/g, '') // 删括号旁白
            .replace(/当前风格[：:].*/gi, '')
            .replace(/[\n\r]+/g, ' ') // 短信不需要换行，合并为单行
            .trim();
        
        // 强行分句并只取前 6 句（留两句Buffer空间）
        const sentences = clean.split(/(?<=[。！？!?])\s*/).filter(s => s.length > 1);
        return sentences.length > 0 ? sentences.slice(0, 8).join(' ') : clean;
    }

    // ── 3. 核心 API 调用 ──
    async function fetchReply(userMsg) {
        const c = ctx();
        conversationHistory.push({ role: 'user', content: userMsg });
        
        const historyContext = conversationHistory.slice(-5).map(m => 
            `${m.role === 'user' ? 'Me' : currentPersona}: ${m.content}`).join('\n');

        // 极其强硬的指令，放在首部
        const prompt = `[IMPORTANT: ACT AS ${currentPersona} IN SMS MODE]
[CONSTRAINT: USE {{user}} INFO & {{persona}} PERSONALITY]
[RULES: NO ACTIONS, NO THOUGHTS, ONLY PLAIN TEXT. LENGTH: 3-8 SENTENCES.]
[EXAMPLE: "Hi! I just saw your message. Are you free tonight? I found a great place."]

Current Chat History:
${historyContext}

Reply to: "${userMsg}"
${currentPersona}:`;

        try {
            let res = await c.generateQuietPrompt(prompt, false, false);
            let final = rigidClean(res);
            conversationHistory.push({ role: 'assistant', content: final });
            saveToStore();
            return final;
        } catch (e) {
            return "Message failed to send. Check signal.";
        }
    }

    // ── 4. UI 渲染 ──
    function renderMsg(text, side) {
        const box = phoneWindow?.querySelector('.pm-msg-list');
        if (!box) return;
        const b = document.createElement('div');
        b.className = `pm-bubble pm-${side}`;
        b.textContent = text;
        box.appendChild(b);
        box.scrollTop = box.scrollHeight;
    }

    window.__pmSwitch = (name) => {
        const id = getCurrentChatId();
        currentPersona = name;
        conversationHistory = window.__pmHistories[id]?.[name] || [];
        if (phoneWindow) {
            phoneWindow.querySelector('.pm-name').textContent = name;
            const list = phoneWindow.querySelector('.pm-msg-list');
            list.innerHTML = '';
            conversationHistory.forEach(m => renderMsg(m.content, m.role === 'user' ? 'right' : 'left'));
        }
        document.getElementById('pm-overlay')?.remove();
    };

    window.__pmDelete = (name) => {
        const id = getCurrentChatId();
        if (confirm(`删除与 ${name} 的联系？`)) {
            delete window.__pmHistories[id][name];
            __pmShowManager();
        }
    };

    window.__pmShowManager = () => {
        document.getElementById('pm-overlay')?.remove();
        const id = getCurrentChatId();
        const list = Object.keys(window.__pmHistories[id] || {});
        const ov = document.createElement('div');
        ov.id = 'pm-overlay';
        ov.innerHTML = `
            <div class="pm-modal">
                <div style="font-weight:bold;margin-bottom:15px;display:flex;justify-content:space-between">
                    <span>联系人管理 (${list.length}/10)</span>
                    <span style="cursor:pointer" onclick="this.parentElement.parentElement.parentElement.remove()">✕</span>
                </div>
                <div style="max-height:200px;overflow-y:auto">
                    ${list.map(n => `
                        <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #eee">
                            <span onclick="__pmSwitch('${n}')" style="cursor:pointer;color:#007aff">${n}</span>
                            <span onclick="__pmDelete('${n}')" style="cursor:pointer;color:red">删除</span>
                        </div>
                    `).join('')}
                </div>
                <input id="pm-new-name" placeholder="添加新角色..." style="width:100%;margin-top:15px;padding:8px;box-sizing:border-box;border:1px solid #ddd;border-radius:8px">
                <button onclick="__pmSwitch(document.getElementById('pm-new-name').value)" style="width:100%;margin-top:10px;padding:8px;background:#007aff;color:#fff;border:none;border-radius:8px">呼叫</button>
            </div>
        `;
        document.body.appendChild(ov);
    };

    window.__pmToggleMin = () => {
        isMinimized = !isMinimized;
        phoneWindow.classList.toggle('minimized', isMinimized);
    };

    window.__pmSendMsg = async () => {
        if (isGenerating) return;
        const input = phoneWindow.querySelector('.pm-input');
        const val = input.value.trim();
        if (!val) return;
        input.value = '';

        renderMsg(val, 'right');
        isGenerating = true;
        const dots = document.createElement('div');
        dots.className = 'pm-bubble pm-left';
        dots.textContent = '...';
        phoneWindow.querySelector('.pm-msg-list').appendChild(dots);

        const reply = await fetchReply(val);
        dots.remove();
        renderMsg(reply, 'left');
        isGenerating = false;
    };

    // ── 5. 样式 ──
    const css = `
        #pm-phone {
            position: fixed; bottom: 30px; right: 30px; width: 340px; height: 580px;
            background: #ffffff; border: 10px solid #000; border-radius: 40px;
            z-index: 100000; display: flex; flex-direction: column; 
            box-shadow: 0 20px 40px rgba(0,0,0,0.3); transition: 0.4s cubic-bezier(0.18, 0.89, 0.32, 1.28);
        }
        #pm-phone.minimized { height: 40px; width: 120px; border-radius: 20px; overflow: hidden; transform: translateY(20px); }
        .pm-island { width: 100px; height: 25px; background: #000; margin: 10px auto 5px; border-radius: 15px; cursor: pointer; flex-shrink: 0; }
        .pm-bar { padding: 5px 15px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #f0f0f0; }
        .pm-name { font-weight: 600; font-size: 16px; color: #000; }
        .pm-msg-list { flex: 1; overflow-y: auto; padding: 15px; background: #fff; display: flex; flex-direction: column; gap: 10px; }
        .pm-bubble { max-width: 80%; padding: 10px 14px; border-radius: 18px; font-size: 14px; line-height: 1.4; word-wrap: break-word; }
        .pm-right { align-self: flex-end; background: #007aff; color: #fff; border-bottom-right-radius: 4px; }
        .pm-left { align-self: flex-start; background: #e9e9eb; color: #000; border-bottom-left-radius: 4px; }
        .pm-input-bar { padding: 10px 15px 25px; background: #fff; border-top: 1px solid #f0f0f0; display: flex; gap: 8px; }
        .pm-input { flex: 1; border: 1px solid #ddd; background:#fff !important; color:#000 !important; border-radius: 20px; padding: 8px 15px; outline: none; font-size: 14px; }
        #pm-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 100001; display: flex; align-items: center; justify-content: center; }
        .pm-modal { background: #fff; padding: 20px; border-radius: 20px; width: 280px; box-shadow: 0 10px 20px rgba(0,0,0,0.2); font-family: sans-serif; }
    `;

    // ── 6. 启动 ──
    window.__pmOpen = () => {
        if (phoneActive) return;
        const c = ctx();
        currentPersona = c?.characters?.[c.characterId]?.name ?? 'AI';
        const id = getCurrentChatId();
        if (!window.__pmHistories[id]) window.__pmHistories[id] = {};
        conversationHistory = window.__pmHistories[id][currentPersona] || [];

        phoneWindow = document.createElement('div');
        phoneWindow.id = 'pm-phone';
        phoneWindow.innerHTML = `
            <div class="pm-island" onclick="__pmToggleMin()"></div>
            <div class="pm-bar">
                <button onclick="__pmShowManager()" style="background:none;border:none;font-size:20px;cursor:pointer">≡</button>
                <div class="pm-name">${currentPersona}</div>
                <button onclick="window.__pmEnd()" style="background:none;border:none;color:red;cursor:pointer">✕</button>
            </div>
            <div class="pm-msg-list"></div>
            <div class="pm-input-bar">
                <input class="pm-input" placeholder="iMessage">
                <button onclick="__pmSendMsg()" style="background:#007aff;color:#fff;border:none;width:30px;height:30px;border-radius:50%;cursor:pointer">↑</button>
            </div>
        `;
        document.body.appendChild(phoneWindow);
        phoneActive = true;
        
        const list = phoneWindow.querySelector('.pm-msg-list');
        conversationHistory.forEach(m => renderMsg(m.content, m.role === 'user' ? 'right' : 'left'));

        phoneWindow.querySelector('.pm-input').onkeydown = e => { if(e.key==='Enter') __pmSendMsg(); };

        // 简易稳定拖拽
        let isDrag = false, ox, oy;
        phoneWindow.querySelector('.pm-bar').onmousedown = e => {
            isDrag = true; ox = e.clientX - phoneWindow.offsetLeft; oy = e.clientY - phoneWindow.offsetTop;
        };
        document.onmousemove = e => {
            if (!isDrag) return;
            phoneWindow.style.left = (e.clientX - ox) + 'px';
            phoneWindow.style.top = (e.clientY - oy) + 'px';
            phoneWindow.style.bottom = 'auto'; phoneWindow.style.right = 'auto';
        };
        document.onmouseup = () => isDrag = false;
    };

    window.__pmEnd = () => { phoneWindow?.remove(); phoneActive = false; };

    if (!document.getElementById('pm-css')) {
        const s = document.createElement('style'); s.id = 'pm-css'; s.innerHTML = css; document.head.appendChild(s);
    }

    document.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) {
            const ta = document.getElementById('send_textarea');
            if (ta && ta.value.trim() === '/phone') {
                e.preventDefault(); ta.value = ''; __pmOpen();
            }
        }
    }, true);

    console.log("iPhone SMS V5 Loaded. Type /phone to start.");
})();
