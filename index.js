(async function () {
    try {
        await new Promise(function(r) { setTimeout(r, 1000); });

        // ── 1. 状态与本地数据库 ──
        let phoneActive = false;
        let phoneWindow = null;
        let currentPersona = '';
        let conversationHistory = [];
        let isGenerating = false;
        let isMinimized = false;

        function getCtx() {
            if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
                return SillyTavern.getContext();
            }
            return null;
        }

        function getChatId() {
            const c = getCtx();
            if (c && c.characterId) {
                return c.characterId + '_' + (c.chat_file || 'default');
            }
            return 'global';
        }

        function loadHistories() {
            try { 
                const data = localStorage.getItem('ST_SMS_DATA_V2');
                return data ? JSON.parse(data) : {}; 
            } catch(e) { return {}; }
        }

        function saveHistories(dataObj) {
            localStorage.setItem('ST_SMS_DATA_V2', JSON.stringify(dataObj));
        }

        // ── 2. 绝对安全的文本净化器 ──
        function processResponse(text) {
            if (!text) return [];
            
            let clean = text.replace(/&lt;/g, '<').replace(/&gt;/g, '>');
            clean = clean.replace(//g, '');
            clean = clean.replace(/<(thinking|thought|思考|写作指导|前文回顾)[\s\S]*?<\/\1>/gi, '');
            clean = clean.replace(/\[(?:CHAP|TITLE|CP|LOC|TAGS|风格)[^\]]*\]/gi, '');
            clean = clean.replace(/<[^>]+>/g, '');
            clean = clean.replace(/\*[^*]+\*/g, '');
            clean = clean.replace(/[\(（](?!(转账|图片))[^\)）]+[\)\）]/g, '');
            clean = clean.replace(/^(.*?)(: |：)/gm, '');
            clean = clean.trim();
            
            let chunks = clean.split(/[/／]/);
            let filteredChunks = [];
            for (let i = 0; i < chunks.length; i++) {
                let s = chunks[i].trim();
                if (s.length > 0) filteredChunks.push(s);
            }
            
            // 原始标点切分法 (绝无高级正则)
            if (filteredChunks.length === 1 && clean.length > 15) {
                let parts = clean.split(/([。！？!?\n]+)/);
                filteredChunks = [];
                for (let i = 0; i < parts.length; i += 2) {
                    let s = parts[i] ? parts[i].trim() : '';
                    let p = parts[i + 1] ? parts[i + 1].trim() : '';
                    if (s || p) filteredChunks.push(s + p);
                }
            }
            
            return filteredChunks.slice(0, 8);
        }

        // ── 3. UI 气泡 ──
        function createBubbleElement(text, side) {
            const b = document.createElement('div');
            b.className = 'pm-bubble pm-' + side;
            let html = text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
            
            html = html.replace(/[\(（]转账\+(\d+)[\)\）]/g, 
                '<div class="pm-transfer-card"><div class="pm-t-icon">¥</div><div class="pm-t-info"><b>收到转账</b><span>¥$1.00</span></div></div>');
            html = html.replace(/[\(（]图片\+([^)]+)[\)\）]/g, '<div class="pm-img-card">🖼️ 图片：$1</div>');
            
            b.innerHTML = html;
            if (text.match(/^[\(（](转账|图片)\+[^)]+[\)\）]$/)) {
                b.style.background = 'transparent'; b.style.boxShadow = 'none'; b.style.padding = '0';
            }
            return b;
        }

        // ── 4. API (高压系统指令) ──
        async function fetchSMS(userMsg) {
            const c = getCtx();
            if (!c || !c.generateQuietPrompt) return ["（系统模块未准备好）"];

            conversationHistory.push({ role: 'user', content: userMsg });

            const systemPrompt = `【最高系统指令：强制切入短信模式】
你必须完全抛弃现有的ECoT、写作指导和小说体格式。当前身份："${currentPersona}"。
要求：
1. 绝对不输出任何 或 [TAGS] 等元数据。
2. 绝不输出心理活动和动作描写。
3. 只发给 {{user}} 纯文本短信，必须限制在 3-8 句。
4. 必须使用 "/" 分隔你的每句话。
5. 允许使用 (图片+内容) 或 (转账+数字)。`;

            let historyStr = "";
            const sliceStart = Math.max(0, conversationHistory.length - 4);
            for (let i = sliceStart; i < conversationHistory.length; i++) {
                historyStr += conversationHistory[i].content + "\n";
            }

            const prompt = systemPrompt + "\n\n【历史短信】\n" + historyStr + "\n\n{{user}}: " + userMsg + "\n" + currentPersona + ":";

            try {
                let res = await c.generateQuietPrompt(prompt, false, false);
                let sentences = processResponse(res);
                if (sentences.length === 0) sentences = ["（对方没有回复）"];
                
                conversationHistory.push({ role: 'assistant', content: sentences.join(' / ') });
                
                const db = loadHistories();
                const chatId = getChatId();
                if (!db[chatId]) db[chatId] = {};
                
                const storeHist = [];
                const hStart = Math.max(0, conversationHistory.length - 20);
                for(let i = hStart; i < conversationHistory.length; i++){
                    storeHist.push(conversationHistory[i]);
                }
                db[chatId][currentPersona] = storeHist;
                saveHistories(db);
                
                return sentences;
            } catch (e) { return ["（发送失败）"]; }
        }

        // ── 5. 全平台拖拽 ──
        function bindIsland(el, handle) {
            let isDragging = false, startX, startY, startL, startT, moved = false;
            const getCoord = function(e) {
                return e.touches ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : { x: e.clientX, y: e.clientY };
            };

            const onStart = function(e) {
                if (e.target.tagName === 'BUTTON') return;
                isDragging = true; moved = false;
                const coords = getCoord(e);
                startX = coords.x; startY = coords.y;
                startL = el.offsetLeft; startT = el.offsetTop;
                el.style.transition = 'none';
            };
            const onMove = function(e) {
                if (!isDragging) return;
                const coords = getCoord(e);
                let dx = coords.x - startX, dy = coords.y - startY;
                if (Math.abs(dx) > 5 || Math.abs(dy) > 5) { moved = true; if(e.cancelable) e.preventDefault(); }
                el.style.left = (startL + dx) + 'px'; el.style.top = (startT + dy) + 'px';
                el.style.bottom = 'auto'; el.style.right = 'auto';
            };
            const onEnd = function() {
                if (!isDragging) return;
                isDragging = false;
                el.style.transition = '0.35s cubic-bezier(0.18, 0.89, 0.32, 1.2)';
                if (!moved) window.__pmToggleMin();
            };

            handle.addEventListener('mousedown', onStart); window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onEnd);
            handle.addEventListener('touchstart', onStart, { passive: false }); window.addEventListener('touchmove', onMove, { passive: false }); window.addEventListener('touchend', onEnd);
        }

        // ── 6. UI 控制 ──
        function addBubble(text, side) {
            if (!phoneWindow) return;
            const list = phoneWindow.querySelector('.pm-msg-list');
            if (!list) return;
            list.appendChild(createBubbleElement(text, side));
            list.scrollTop = list.scrollHeight;
        }

        window.__pmSend = async function() {
            if (isGenerating) return;
            const input = phoneWindow.querySelector('.pm-input');
            const val = input.value.trim();
            if (!val) return;
            input.value = '';
            addBubble(val, 'right');
            isGenerating = true;
            
            const sentenceList = await fetchSMS(val);
            for (let i = 0; i < sentenceList.length; i++) {
                await new Promise(function(r) { setTimeout(r, 600); });
                addBubble(sentenceList[i], 'left');
            }
            isGenerating = false;
        };

        window.__pmShowList = function() {
            const db = loadHistories();
            const chatId = getChatId();
            const listData = db[chatId] || {};
            const list = Object.keys(listData);
            const ov = document.createElement('div');
            ov.id = 'pm-overlay';
            
            let htmlList = '';
            for(let i=0; i<list.length; i++){
                htmlList += '<div class="pm-li"><span onclick="window.__pmSwitch(\'' + list[i] + '\')">' + list[i] + '</span><i onclick="window.__pmDel(\'' + list[i] + '\')">清除</i></div>';
            }

            ov.innerHTML = 
                '<div class="pm-modal">' +
                    '<div style="display:flex;justify-content:space-between;margin-bottom:15px;align-items:center">' +
                        '<b style="font-size:16px">联系人记录</b><span onclick="this.closest(\'#pm-overlay\').remove()" style="font-size:20px;cursor:pointer">×</span>' +
                    '</div>' +
                    '<div style="max-height:200px;overflow-y:auto;margin-bottom:10px">' + htmlList + '</div>' +
                    '<input id="pm-add" placeholder="新联系人名字..." style="width:100%;padding:10px;box-sizing:border-box;border:1px solid #ddd;border-radius:10px;margin-bottom:10px;outline:none">' +
                    '<div style="display:flex;gap:10px">' +
                        '<button onclick="document.getElementById(\'pm-overlay\').remove()" style="flex:1;padding:10px;border:none;border-radius:10px;background:#f2f2f7;cursor:pointer">取消</button>' +
                        '<button onclick="window.__pmSwitch(document.getElementById(\'pm-add\').value)" style="flex:2;padding:10px;background:#007aff;color:#fff;border:none;border-radius:10px;cursor:pointer">新建</button>' +
                    '</div>' +
                '</div>';
            document.body.appendChild(ov);
        };

        window.__pmSwitch = function(name) {
            if (!name) return;
            currentPersona = name;
            const db = loadHistories();
            const chatId = getChatId();
            conversationHistory = (db[chatId] && db[chatId][name]) ? db[chatId][name] : [];
            
            if (phoneWindow) {
                phoneWindow.querySelector('.pm-name').textContent = name;
                const list = phoneWindow.querySelector('.pm-msg-list');
                list.innerHTML = '';
                
                // 完全重写历史记录渲染逻辑，避开所有高级正则
                for(let i=0; i<conversationHistory.length; i++){
                    const m = conversationHistory[i];
                    const cleanText = m.content.replace(/&lt;/g, '<').replace(/&gt;/g, '>');
                    
                    let chunks = cleanText.split(/[/／]/);
                    let sents = [];
                    for(let j=0; j<chunks.length; j++){
                        if(chunks[j].trim().length > 0) sents.push(chunks[j].trim());
                    }
                    
                    if (sents.length === 1 && cleanText.length > 15) {
                        let parts = cleanText.split(/([。！？!?\n]+)/);
                        sents = [];
                        for (let k = 0; k < parts.length; k += 2) {
                            let s = parts[k] ? parts[k].trim() : '';
                            let p = parts[k + 1] ? parts[k + 1].trim() : '';
                            if (s || p) sents.push(s + p);
                        }
                    }
                    
                    for(let j=0; j<sents.length; j++){
                        addBubble(sents[j], m.role === 'user' ? 'right' : 'left');
                    }
                }
            }
            const ov = document.getElementById('pm-overlay');
            if(ov) ov.remove();
        };

        window.__pmDel = function(n) { 
            const db = loadHistories();
            const chatId = getChatId();
            if (db[chatId] && db[chatId][n]) {
                delete db[chatId][n];
                saveHistories(db);
            }
            window.__pmShowList(); 
        };

        window.__pmToggleMin = function() { 
            isMinimized = !isMinimized; 
            if(phoneWindow) {
                if(isMinimized) phoneWindow.classList.add('is-min');
                else phoneWindow.classList.remove('is-min');
            }
        };
        
        window.__pmEnd = function() { 
            if(phoneWindow) phoneWindow.remove(); 
            phoneActive = false; 
        };

        // ── 7. 初始化与唤起 ──
        window.__pmOpen = function() {
            if (phoneActive) return;
            const c = getCtx();
            let defaultChar = '白厄';
            if (c && c.characters && c.characters[c.characterId]) {
                defaultChar = c.characters[c.characterId].name || '白厄';
            }
            
            phoneWindow = document.createElement('div');
            phoneWindow.id = 'pm-iphone-v13';
            phoneWindow.innerHTML = 
                '<div class="pm-island"></div>' +
                '<div class="pm-main-ui">' +
                    '<div class="pm-navbar">' +
                        '<button onclick="window.__pmShowList()" class="pm-nav-btn">≡</button>' +
                        '<div class="pm-name">' + defaultChar + '</div>' +
                        '<button onclick="window.__pmEnd()" class="pm-nav-btn" style="color:#ff3b30">✕</button>' +
                    '</div>' +
                    '<div class="pm-msg-list"></div>' +
                    '<div class="pm-input-bar">' +
                        '<input class="pm-input" placeholder="iMessage">' +
                        '<button onclick="window.__pmSend()" class="pm-up-btn">↑</button>' +
                    '</div>' +
                '</div>';
            document.body.appendChild(phoneWindow);
            phoneActive = true;
            bindIsland(phoneWindow, phoneWindow.querySelector('.pm-island'));
            window.__pmSwitch(defaultChar);
            phoneWindow.querySelector('.pm-input').addEventListener('keydown', function(e) { 
                if(e.key === 'Enter') window.__pmSend(); 
            });
        };

        // ── 8. 样式 ──
        const css = 
            '#pm-iphone-v13 { position: fixed; bottom: 40px; right: 40px; width: 330px; height: 580px; background: #fff; border: 10px solid #111; border-radius: 45px; z-index: 100000; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 20px 50px rgba(0,0,0,0.4); transition: 0.35s cubic-bezier(0.18, 0.89, 0.32, 1.2); font-family: -apple-system, BlinkMacSystemFont, sans-serif; touch-action: none; } ' +
            '#pm-iphone-v13.is-min { height: 48px; width: 130px; border-radius: 24px; border-width: 6px; } ' +
            '#pm-iphone-v13.is-min .pm-main-ui { display: none; } ' +
            '.pm-island { width: 100px; height: 26px; background: #000; margin: 10px auto; border-radius: 15px; cursor: move; flex-shrink: 0; touch-action: none; z-index: 10; } ' +
            '.pm-main-ui { flex: 1; display: flex; flex-direction: column; overflow: hidden; } ' +
            '.pm-navbar { display: flex; align-items: center; justify-content: space-between; padding: 5px 15px; border-bottom: 1px solid #f2f2f7; } ' +
            '.pm-name { font-weight: 700; color: #000; font-size: 15px; } ' +
            '.pm-nav-btn { background: none; border: none; font-size: 22px; cursor: pointer; color:#007aff; } ' +
            '.pm-msg-list { flex: 1; overflow-y: auto; padding: 15px; display: flex; flex-direction: column; gap: 8px; background: #fff; } ' +
            '.pm-bubble { max-width: 75%; padding: 10px 15px; border-radius: 18px; font-size: 14px; line-height: 1.4; animation: pm-pop 0.3s ease-out; word-wrap: break-word; } ' +
            '@keyframes pm-pop { from { transform: translateY(10px); opacity: 0; } to { transform: translateY(0); opacity: 1; } } ' +
            '.pm-right { align-self: flex-end; background: #007aff; color: #fff; border-bottom-right-radius: 4px; } ' +
            '.pm-left { align-self: flex-start; background: #e9e9eb; color: #000; border-bottom-left-radius: 4px; } ' +
            '.pm-transfer-card { background: #ff9500; color: #fff; border-radius: 18px; padding: 12px 15px; display: flex; align-items: center; gap: 12px; min-width: 160px; box-shadow: 0 4px 10px rgba(255,149,0,0.3); } ' +
            '.pm-t-icon { width: 36px; height: 36px; background: #fff; color: #ff9500; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 20px; font-weight: 800; } ' +
            '.pm-t-info { display: flex; flex-direction: column; } ' +
            '.pm-img-card { background: #f2f2f7; border: 1px solid #ddd; padding: 15px; border-radius: 18px; color: #666; font-size: 13px; text-align: center; } ' +
            '.pm-input-bar { padding: 10px 15px 35px; display: flex; gap: 10px; border-top: 1px solid #f2f2f7; align-items: center; background: #fff; } ' +
            '.pm-input { flex: 1; background: #f2f2f7 !important; color: #000 !important; border: none; border-radius: 20px; padding: 10px 15px; outline: none; font-size: 14px; } ' +
            '.pm-up-btn { width: 32px; height: 32px; background: #007aff; color: #fff; border: none; border-radius: 50%; cursor: pointer; font-weight: bold; font-size: 16px; display: flex; align-items: center; justify-content: center; } ' +
            '#pm-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 100001; display: flex; align-items: center; justify-content: center; } ' +
            '.pm-modal { background: #fff; padding: 20px; border-radius: 25px; width: 280px; box-shadow: 0 20px 40px rgba(0,0,0,0.3); font-family: sans-serif; } ' +
            '.pm-li { display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #f2f2f7; font-size: 15px; } ' +
            '.pm-li span { color: #000; cursor: pointer; font-weight: 500; flex: 1; } ' +
            '.pm-li i { color: #ff3b30; cursor: pointer; font-style: normal; font-size: 13px; }';
            
        if (!document.getElementById('pm-v13-css')) {
            const s = document.createElement('style'); s.id = 'pm-v13-css'; s.innerHTML = css; document.head.appendChild(s);
        }

        document.addEventListener('keydown', function(e) {
            if(e.key === 'Enter' && !e.shiftKey) {
                const ta = document.getElementById('send_textarea');
                if(ta && ta.value.trim() === '/phone') {
                    e.preventDefault(); ta.value = ''; window.__pmOpen();
                }
            }
        }, true);

        console.log("iPhone SMS V13 (Syntax Fixed) Loaded.");

    } catch(err) {
        console.error("Phone Mode Extension Error:", err);
    }
})();
