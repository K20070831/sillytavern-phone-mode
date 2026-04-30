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

    // ── 2. 多重逻辑过滤器（拆分气泡 + 特殊渲染） ──
    function processResponse(text) {
        if (!text) return [];
        
        // 物理切除思考链和动作旁白
        let clean = text.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
                        .replace(/\*[^*]+\*/g, '')
                        .replace(/[\(（][^\)）]+[\)\）]/g, (match) => {
                            // 保留转账和图片格式，不作为旁白删掉
                            if (match.includes('转账') || match.includes('图片')) return match;
                            return '';
                        })
                        .trim();
        
        // 分句逻辑：支持手动 "/" 分隔以及自然标点
        const sentences = clean.split(/[/／]|(?<=[。！？!?\n])\s*/).filter(s => s.trim().length > 0);
        return sentences.slice(0, 8); // 限制 3-8 句
    }

    // ── 3. 渲染特殊气泡（转账/图片） ──
    function createBubbleElement(text, side) {
        const b = document.createElement('div');
        b.className = `pm-bubble pm-${side}`;

        // 匹配转账：(转账+100)
        const transferMatch = text.match(/[\(（]转账\+(\d+)[\)\）]/);
        if (transferMatch) {
            b.className += ' pm-transfer-bubble';
            b.innerHTML = `<div class="transfer-icon">¥</div><div><div style="font-weight:bold">转账给您</div><div style="font-size:12px">¥${transferMatch[1]}.00</div></div>`;
            return b;
        }

        // 匹配图片：(图片+描述)
        const imgMatch = text.match(/[\(（]图片\+([^)]+)[\)\）]/);
        if (imgMatch) {
            b.className += ' pm-image-bubble';
            b.innerHTML = `<div class="img-placeholder">🖼️ [图片: ${imgMatch[1]}]</div>`;
            return b;
        }

        b.textContent = text;
        return b;
    }

    // ── 4. API 调用（身份硬锁定） ──
    async function fetchSMS(userMsg) {
        const c = getCtx();
        const charData = c.characters[c.characterId];
        conversationHistory.push({ role: 'user', content: userMsg });

        // 核心指令：强制身份隔离 + 读取设定
        const systemPrompt = `[STRICT PROTOCOL: MOBILE_CHAT]
- IDENTITY: You are "${currentPersona}". (Ref: {{persona}})
- LORE: Use info from {{worldbook}}.
- WARNING: NEVER roleplay as {{user}}. NEVER describe {{user}}'s actions.
- FORMAT:
  1. Reply ONLY in short sentences. 
  2. Use "/" to separate different chat bubbles.
  3. Total 3-8 sentences.
  4. Special Actions: Use "(转账+amount)" or "(图片+description)" if needed.
- CURRENT TASK: Reply to {{user}}'s message as ${currentPersona}.`;

        const prompt = `${systemPrompt}\n\n[History]\n${conversationHistory.slice(-4).map(m => m.content).join('\n')}\n\n{{user}}: ${userMsg}\n${currentPersona}:`;

        try {
            let res = await c.generateQuietPrompt(prompt, false, false);
            const sentences = processResponse(res);
            if (sentences.length === 0) sentences.push("...");
            
            conversationHistory.push({ role: 'assistant', content: sentences.join(' / ') });
            saveStore();
            return sentences;
        } catch (e) { return ["发送失败"]; }
    }

    function saveStore() {
        const id = `${getCtx().characterId}_${getCtx().chat_file || 'default'}`;
        if (!window.__pmHistories[id]) window.__pmHistories[id] = {};
        window.__pmHistories[id][currentPersona] = [...conversationHistory.slice(-20)];
    }

    // ── 5. UI 与 拖拽 ──
    function addBubble(text, side) {
        const list = phoneWindow?.querySelector('.pm-msg-list');
        if (!list) return;
        const b = createBubbleElement(text, side);
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
        for (const s of sentenceList) {
            await new Promise(r => setTimeout(r, 600 + Math.random()*400));
            addBubble(s, 'left');
        }
        isGenerating = false;
    };

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
            let dx = e.clientX - startX, dy = e.clientY - startY;
            if (Math.abs(dx) > 5 || Math.abs(dy) > 5) moved = true;
            el.style.left = (startL + dx) + 'px';
            el.style.top = (startT + dy) + 'px';
            el.style.bottom = 'auto'; el.style.right = 'auto';
        };
        document.onmouseup = () => {
            isDragging = false;
            el.style.transition = '0.35s cubic-bezier(0.18, 0.89, 0.32, 1.2)';
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
                <div style="display:flex;justify-content:space-between;margin-bottom:15px"><b>联系人</b><span onclick="this.closest('#pm-overlay').remove()" style="cursor:pointer">×</span></div>
                <div style="max-height:200px;overflow-y:auto">
                    ${list.map(n => `<div class="pm-li"><span onclick="__pmSwitch('${n}')">${n}</span><i onclick="__pmDel('${n}')">×</i></div>`).join('')}
                </div>
                <input id="pm-add" placeholder="新建联系人..." style="width:100%;padding:8px;margin:10px 0;box-sizing:border-box;border-radius:8px;border:1px solid #ddd">
                <div style="display:flex;gap:10px">
                    <button onclick="document.getElementById('pm-overlay').remove()" style="flex:1;padding:8px;border:none;border-radius:8px">取消</button>
                    <button onclick="__pmSwitch(document.getElementById('pm-add').value)" style="flex:1;padding:8px;background:#007aff;color:#fff;border:none;border-radius:8px">添加</button>
                </div>
            </div>`;
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
                const sents = m.content.split(/[/／]|(?<=[。！？!?])\s*/);
                sents.forEach(s => addBubble(s, m.role === 'user' ? 'right' : 'left'));
            });
        }
        document.getElementById('pm-overlay')?.remove();
    };

    window.__pmDel = (n) => { delete window.__pmHistories[`${getCtx().characterId}_${getCtx().chat_file || 'default'}`][n]; __pmShowList(); };
    window.__pmToggleMin = () => { isMinimized = !isMinimized; phoneWindow.classList.toggle('is-min', isMinimized); };
    window.__pmEnd = () => { phoneWindow?.remove(); phoneActive = false; };

    // ── 6. 构造窗口 ──
    window.__pmOpen = () => {
        if (phoneActive) return;
        const c = getCtx();
        const defaultChar = c?.characters?.[c.characterId]?.name ?? '白厄';
        phoneWindow = document.createElement('div');
        phoneWindow.id = 'pm-iphone-v8';
        phoneWindow.innerHTML = `
            <div class="pm-island"></div>
            <div class="pm-main-ui">
                <div class="pm-navbar">
                    <button onclick="__pmShowList()" class="pm-btn">≡</button>
                    <div class="pm-name">${defaultChar}</div>
                    <button onclick="__pmEnd()" class="pm-btn" style="color:red">✕</button>
                </div>
                <div class="pm-msg-list"></div>
                <div class="pm-input-bar">
                    <input class="pm-input" placeholder="iMessage">
                    <button onclick="__pmSend()" class="pm-up-btn">↑</button>
                </div>
            </div>`;
        document.body.appendChild(phoneWindow);
        phoneActive = true;
        bindIsland(phoneWindow, phoneWindow.querySelector('.pm-island'));
        __pmSwitch(defaultChar);
        phoneWindow.querySelector('.pm-input').onkeydown = e => { if(e.key === 'Enter') __pmSend(); };
    };

    // ── 7. 样式（包含转账与图片渲染） ──
    const css = `
        #pm-iphone-v8 {
            position: fixed; bottom: 40px; right: 40px; width: 340px; height: 600px;
            background: #fff; border: 12px solid #111; border-radius: 50px;
            z-index: 100000; display: flex; flex-direction: column; overflow: hidden;
            box-shadow: 0 30px 60px rgba(0,0,0,0.4); transition: 0.35s cubic-bezier(0.18, 0.89, 0.32, 1.2);
        }
        #pm-iphone-v8.is-min { height: 48px; width: 130px; border-radius: 24px; border-width: 6px; }
        #pm-iphone-v8.is-min .pm-main-ui { display: none; }
        .pm-island { width: 100px; height: 26px; background: #000; margin: 10px auto; border-radius: 15px; cursor: move; flex-shrink: 0; }
        .pm-main-ui { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
        .pm-navbar { display: flex; align-items: center; justify-content: space-between; padding: 5px 15px; border-bottom: 0.5px solid #eee; }
        .pm-name { font-weight: 700; color: #000; }
        .pm-btn { background: none; border: none; font-size: 20px; cursor: pointer; }
        .pm-msg-list { flex: 1; overflow-y: auto; padding: 15px; display: flex; flex-direction: column; gap: 6px; background: #fff; }
        .pm-bubble { max-width: 75%; padding: 10px 14px; border-radius: 18px; font-size: 14px; line-height: 1.4; animation: pm-pop 0.25s ease-out; }
        @keyframes pm-pop { from { transform: scale(0.9); opacity: 0; } to { transform: scale(1); opacity: 1; } }
        .pm-right { align-self: flex-end; background: #007aff; color: #fff; border-bottom-right-radius: 4px; }
        .pm-left { align-self: flex-start; background: #e9e9eb; color: #000; border-bottom-left-radius: 4px; }
        /* 特殊气泡 */
        .pm-transfer-bubble { background: #ff9500 !important; color: #fff; display: flex; align-items: center; gap: 10px; min-width: 150px; }
        .transfer-icon { width: 35px; height: 35px; background: #fff; color: #ff9500; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 20px; }
        .pm-image-bubble { background: #f2f2f7 !important; border: 1px solid #ddd; padding: 5px; }
        .img-placeholder { width: 200px; height: 120px; background: #ddd; border-radius: 10px; display: flex; align-items: center; justify-content: center; color: #666; font-size: 12px; }
        
        .pm-input-bar { padding: 10px 15px 35px; display: flex; gap: 10px; border-top: 0.5px solid #eee; align-items: center; }
        .pm-input { flex: 1; background: #f2f2f7 !important; color: #000 !important; border: none; border-radius: 20px; padding: 10px 15px; outline: none; }
        .pm-up-btn { width: 30px; height: 30px; background: #007aff; color: #fff; border: none; border-radius: 50%; cursor: pointer; font-weight: bold; }
        #pm-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 100001; display: flex; align-items: center; justify-content: center; }
        .pm-modal { background: #fff; padding: 20px; border-radius: 25px; width: 260px; font-family: sans-serif; }
        .pm-li { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 0.5px solid #eee; }
        .pm-li span { color: #007aff; cursor: pointer; }
        .pm-li i { color: red; cursor: pointer; font-style: normal; }
    `;

    if (!document.getElementById('pm-v8-css')) {
        const s = document.createElement('style'); s.id = 'pm-v8-css'; s.innerHTML = css; document.head.appendChild(s);
    }

    document.addEventListener('keydown', e => {
        if(e.key === 'Enter' && !e.shiftKey) {
            const ta = document.getElementById('send_textarea');
            if(ta && ta.value.trim() === '/phone') {
                e.preventDefault(); ta.value = ''; __pmOpen();
            }
        }
    }, true);

    console.log("iPhone SMS V8 (Transfer & Identity Locked) Loaded.");
})();
