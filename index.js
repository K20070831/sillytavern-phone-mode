(async function () {
    await new Promise(r => setTimeout(r, 1000));

    // ── 1. 全局状态 ──
    window.__pmHistories = window.__pmHistories || {};
    let phoneActive = false;
    let phoneWindow = null;
    let currentPersona = '';
    let conversationHistory = [];
    let isGenerating = false;
    let isMinimized = false;

    const getCtx = () => typeof SillyTavern !== 'undefined' ? SillyTavern.getContext() : null;

    // ── 2. 文本处理与分句（实现多气泡） ──
    function splitToSentences(text) {
        if (!text) return [];
        // 过滤冗余内容
        let clean = text.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
                        .replace(/\*[^*]+\*/g, '')
                        .replace(/[\(（][^\)）]+[\)\）]/g, '')
                        .replace(/(当前风格|System|Assistant)[:：].*/gi, '')
                        .trim();
        
        // 按标点分句
        const sentences = clean.split(/(?<=[。！？!?\n])\s*/).filter(s => s.trim().length > 1);
        // 强制限制在3-8句
        return sentences.slice(0, 8);
    }

    // ── 3. 深度预设注入 ──
    async function fetchSMS(userMsg) {
        const c = getCtx();
        conversationHistory.push({ role: 'user', content: userMsg });

        // 自定义短信预设：强制读取角色信息和世界书
        const smsPreset = `[SYSTEM: SMS_OVERRIDE_ACTIVE]
- Roleplay Context: You are "${currentPersona}". Refer to {{persona}} for personality and {{worldbook}} for lore.
- Communication Style: Modern Smartphone SMS/iMessage.
- Format Rules: 
  1. NO Narrative descriptions. NO asterisks (*). NO internal monologues.
  2. Speak directly as the character would on a phone.
  3. Output 3 to 8 sentences. Each sentence should be its own line.
- Goal: Forget you are in a roleplay tavern; you are texting {{user}} right now.`;

        const prompt = `${smsPreset}\n\n[Context History]\n${conversationHistory.slice(-4).map(m => m.content).join('\n')}\n\n{{user}}: ${userMsg}\n${currentPersona}:`;

        try {
            let res = await c.generateQuietPrompt(prompt, false, false);
            const sentences = splitToSentences(res);
            
            if (sentences.length === 0) sentences.push("（网络连接延迟...）");
            
            // 保存到记录
            conversationHistory.push({ role: 'assistant', content: sentences.join(' ') });
            saveStore();
            return sentences;
        } catch (e) { return ["发送失败，请检查网络。"]; }
    }

    function saveStore() {
        const id = `${getCtx().characterId}_${getCtx().chat_file || 'default'}`;
        if (!window.__pmHistories[id]) window.__pmHistories[id] = {};
        window.__pmHistories[id][currentPersona] = [...conversationHistory.slice(-20)];
    }

    // ── 4. UI 渲染 ──
    function addBubble(text, side) {
        const list = phoneWindow?.querySelector('.pm-msg-list');
        if (!list) return;
        const b = document.createElement('div');
        b.className = `pm-bubble pm-${side}`;
        b.textContent = text;
        list.appendChild(b);
        list.scrollTop = list.scrollHeight;
    }

    window.__pmSend = async () => {
        if (isGenerating) return;
        const input = phoneWindow.querySelector('.pm-input');
        const val = input.value.trim();
        if (!val) return;
        input.value = '';

        addBubble(val, 'right');
        isGenerating = true;

        const sentenceList = await fetchSMS(val);
        
        // 逐个弹出文字泡，模拟打字感
        for (const sentence of sentenceList) {
            await new Promise(r => setTimeout(r, 600 + Math.random() * 400));
            addBubble(sentence, 'left');
        }
        
        isGenerating = false;
    };

    // ── 5. 交互：灵动岛拖拽与管理列表 ──
    function bindIsland(el, handle) {
        let isDragging = false, startX, startY, startL, startT, moved = false;
        handle.onmousedown = (e) => {
            isDragging = true; moved = false;
            startX = e.clientX; startY = e.clientY;
            startL = el.offsetLeft; startT = el.offsetTop;
            el.style.transition = 'none';
        };
        document.onmousemove = (e) => {
            if (!isDragging) return;
            let dx = e.clientX - startX;
            let dy = e.clientY - startY;
            if (Math.abs(dx) > 5 || Math.abs(dy) > 5) moved = true;
            el.style.left = (startL + dx) + 'px';
            el.style.top = (startT + dy) + 'px';
            el.style.bottom = 'auto'; el.style.right = 'auto';
        };
        document.onmouseup = () => {
            isDragging = false;
            el.style.transition = '0.3s cubic-bezier(0.18, 0.89, 0.32, 1.2)';
            // 如果没怎么移动，则视为点击，触发最小化切换
            if (!moved) __pmToggleMin();
        };
    }

    window.__pmShowList = () => {
        const id = `${getCtx().characterId}_${getCtx().chat_file || 'default'}`;
        const list = Object.keys(window.__pmHistories[id] || {});
        const ov = document.createElement('div');
        ov.id = 'pm-overlay';
        ov.innerHTML = `
            <div class="pm-modal">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:15px">
                    <b style="font-size:16px">联系人记录</b>
                    <span style="cursor:pointer;font-size:20px" onclick="this.closest('#pm-overlay').remove()">×</span>
                </div>
                <div style="max-height:180px;overflow-y:auto;margin-bottom:15px">
                    ${list.map(n => `<div class="pm-li"><span onclick="__pmSwitch('${n}')">${n}</span><i onclick="__pmDel('${n}')">移除</i></div>`).join('')}
                </div>
                <input id="pm-add" placeholder="新联系人名字..." style="width:100%;padding:10px;box-sizing:border-box;border:1px solid #ddd;border-radius:10px;margin-bottom:10px">
                <div style="display:flex;gap:10px">
                    <button onclick="document.getElementById('pm-overlay').remove()" style="flex:1;padding:10px;background:#eee;border:none;border-radius:10px;cursor:pointer">取消</button>
                    <button onclick="__pmSwitch(document.getElementById('pm-add').value)" style="flex:2;padding:10px;background:#007aff;color:#fff;border:none;border-radius:10px;cursor:pointer">呼叫</button>
                </div>
            </div>
        `;
        document.body.appendChild(ov);
    };

    window.__pmSwitch = (name) => {
        if (!name) return;
        const id = `${getCtx().characterId}_${getCtx().chat_file || 'default'}`;
        currentPersona = name;
        conversationHistory = window.__pmHistories[id]?.[currentPersona] || [];
        if (phoneWindow) {
            phoneWindow.querySelector('.pm-name').textContent = currentPersona;
            const list = phoneWindow.querySelector('.pm-msg-list');
            list.innerHTML = '';
            conversationHistory.forEach(m => {
                // 历史记录如果是合并的，重新拆分显示更美观
                const sents = m.content.split(/(?<=[。！？!?])\s*/);
                sents.forEach(s => addBubble(s, m.role === 'user' ? 'right' : 'left'));
            });
        }
        const ov = document.getElementById('pm-overlay');
        if(ov) ov.remove();
    };

    window.__pmDel = (n) => { 
        const id = `${getCtx().characterId}_${getCtx().chat_file || 'default'}`;
        delete window.__pmHistories[id][n]; 
        __pmShowList(); 
    };

    window.__pmToggleMin = () => {
        isMinimized = !isMinimized;
        phoneWindow.classList.toggle('is-min', isMinimized);
    };

    window.__pmEnd = () => { phoneWindow?.remove(); phoneActive = false; };

    // ── 6. 构造主窗口 ──
    window.__pmOpen = () => {
        if (phoneActive) return;
        const c = getCtx();
        const defaultChar = c?.characters?.[c.characterId]?.name ?? '白厄';
        
        phoneWindow = document.createElement('div');
        phoneWindow.id = 'pm-iphone-v7';
        phoneWindow.innerHTML = `
            <div class="pm-island"></div>
            <div class="pm-main-ui">
                <div class="pm-navbar">
                    <button onclick="__pmShowList()" class="pm-nav-btn">≡</button>
                    <div class="pm-name">${defaultChar}</div>
                    <button onclick="__pmEnd()" class="pm-nav-btn" style="color:#ff3b30">✕</button>
                </div>
                <div class="pm-msg-list"></div>
                <div class="pm-input-bar">
                    <input class="pm-input" placeholder="iMessage">
                    <button onclick="__pmSend()" class="pm-send-icon">↑</button>
                </div>
            </div>
        `;
        document.body.appendChild(phoneWindow);
        phoneActive = true;
        
        bindIsland(phoneWindow, phoneWindow.querySelector('.pm-island'));
        __pmSwitch(defaultChar);

        phoneWindow.querySelector('.pm-input').onkeydown = e => { if(e.key === 'Enter') __pmSend(); };
    };

    // ── 7. 样式（纯白设计/布局修复） ──
    const css = `
        #pm-iphone-v7 {
            position: fixed; bottom: 40px; right: 40px; width: 340px; height: 600px;
            background: #fff; border: 12px solid #111; border-radius: 50px;
            z-index: 100000; display: flex; flex-direction: column; 
            box-shadow: 0 30px 60px rgba(0,0,0,0.4); transition: 0.35s cubic-bezier(0.18, 0.89, 0.32, 1.2);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        }
        #pm-iphone-v7.is-min { height: 48px; width: 130px; border-radius: 24px; border-width: 6px; }
        #pm-iphone-v7.is-min .pm-main-ui { display: none; }
        
        .pm-island { 
            width: 110px; height: 28px; background: #000; margin: 10px auto; 
            border-radius: 15px; cursor: move; flex-shrink: 0; z-index: 10;
        }
        .pm-main-ui { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
        .pm-navbar { display: flex; align-items: center; justify-content: space-between; padding: 5px 15px; border-bottom: 0.5px solid #eee; }
        .pm-name { font-weight: 700; font-size: 16px; color: #000; }
        .pm-nav-btn { background: none; border: none; font-size: 22px; cursor: pointer; padding: 5px; }
        
        .pm-msg-list { flex: 1; overflow-y: auto; padding: 15px; display: flex; flex-direction: column; gap: 6px; background: #fff; }
        .pm-bubble { max-width: 75%; padding: 10px 15px; border-radius: 18px; font-size: 14.5px; line-height: 1.4; animation: pm-pop 0.3s ease-out; }
        @keyframes pm-pop { from { transform: scale(0.8); opacity: 0; } to { transform: scale(1); opacity: 1; } }
        
        .pm-right { align-self: flex-end; background: #007aff; color: #fff; border-bottom-right-radius: 4px; }
        .pm-left { align-self: flex-start; background: #e9e9eb; color: #000; border-bottom-left-radius: 4px; }
        
        .pm-input-bar { padding: 10px 15px 35px; display: flex; gap: 10px; border-top: 0.5px solid #eee; background: #fff; align-items: center; }
        .pm-input { flex: 1; background: #f2f2f7 !important; color: #000 !important; border: none; border-radius: 20px; padding: 10px 15px; outline: none; font-size: 14px; }
        .pm-send-icon { width: 32px; height: 32px; background: #007aff; color: #fff; border: none; border-radius: 50%; cursor: pointer; font-size: 18px; font-weight: bold; }
        
        #pm-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 100001; display: flex; align-items: center; justify-content: center; }
        .pm-modal { background: #fff; padding: 25px; border-radius: 30px; width: 280px; box-shadow: 0 15px 30px rgba(0,0,0,0.2); }
        .pm-li { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 0.5px solid #eee; }
        .pm-li span { color: #007aff; cursor: pointer; font-weight: 500; }
        .pm-li i { color: #ff3b30; font-style: normal; cursor: pointer; font-size: 12px; }
    `;

    if (!document.getElementById('pm-v7-css')) {
        const s = document.createElement('style'); s.id = 'pm-v7-css'; s.innerHTML = css; document.head.appendChild(s);
    }

    document.addEventListener('keydown', e => {
        if(e.key === 'Enter' && !e.shiftKey) {
            const ta = document.getElementById('send_textarea');
            if(ta && ta.value.trim() === '/phone') {
                e.preventDefault(); ta.value = ''; __pmOpen();
            }
        }
    }, true);

    console.log("iPhone SMS V7 (Multi-Bubble & Preset Fix) Loaded.");
})();
