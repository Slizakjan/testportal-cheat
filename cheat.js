// ==UserScript==
// @name         Auto Answer Helper (Groq API + Ignor + Strict Prompt + Checkboxes)
// @namespace    https://github.com/Slizakjan/testportal-cheat
// @version      1.9
// @author       Slizak_jan
// @description  Automatické získávání odpovědí pomocí Groq API s ignor logikou, striktním promptem a podporou checkboxů
// @match        https://*.testportal.net/*
// @match        https://*.testportal.pl/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @connect      api.groq.com
// @connect      api.duckduckgo.com
// @connect      duckduckgo.com
// @connect      www.googleapis.com
// @connect      googleapis.com
// @updateURL    https://raw.githubusercontent.com/Slizakjan/testportal-cheat/main/cheat.js
// @downloadURL  https://raw.githubusercontent.com/Slizakjan/testportal-cheat/main/cheat.js
// ==/UserScript==


(async () => {
    'use strict';

    const API_URL = "https://api.groq.com/openai/v1/responses";

    // === 🧠 Dotaz AI s web-retrieval
    async function askAI(prompt, API_KEY) {
        const body = {
            model: "llama-3.3-70b-versatile",
            input: prompt.trim()
        };

        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "POST",
                url: API_URL,
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${API_KEY}`
                },
                data: JSON.stringify(body),
                onload: (response) => {
                    try {
                        const json = JSON.parse(response.responseText);
                        let result = null;

                        if (Array.isArray(json.output)) {
                            const findOutput = (arr) => {
                                for (const item of arr) {
                                    if (item.type === "output_text" && item.text)
                                        return item.text.trim();
                                    if (item.content && Array.isArray(item.content)) {
                                        const nested = findOutput(item.content);
                                        if (nested) return nested;
                                    }
                                }
                                return null;
                            };
                            result = findOutput(json.output);
                        }

                        if (!result && typeof json.output_text === "string")
                            result = json.output_text.trim();
                        if (!result && typeof json.output === "string")
                            result = json.output.trim();

                        resolve(result || "Bez odpovědi");
                    } catch (err) {
                        console.error("Chyba při parsování odpovědi:", err, response.responseText);
                        reject(err);
                    }
                },
                onerror: reject
            });
        });
    }

    // --- Vytvoření promptu
    function getPrompt(data) {
        if (data.ignor === "True") return null;

        const baseRules = `
    ### System
    You are an exam helper AI. Answer the questions provided by user.

    ### Rules
    - Answer format depends on question type (below)
    - NEVER add explanation
    - If you are missing context or not fully sure then you SHOULD request online search
    - To request online search reply ONLY in JSON:
    {"search": "<query>", "engine": "duckduckgo"}
    or
    {"search": "<query>", "engine": "google"}
    - No other text when requesting search
    When search attempts reach 0:
        - Closed questions (radio/checkbox/true_false) you MUST answer (you may guess)
        - Open questions (short/descriptive) if still unsure, respond exactly with UNKNOWN

    You have only ${data.remainingSearches} search attempts left.
    `;

        let answerInstruction = "";

        switch (data.type) {
            case "radio":
                answerInstruction = `Return only one index (0-based).`;
                break;
            case "checkbox":
                answerInstruction = `Return ALL correct indexes (0-based) separated by commas. Example: 0,2`;
                break;
            case "true_false":
                answerInstruction = `Return "0" for False or "1" for True.`;
                break;
            case "short":
                answerInstruction = `Provide a short answer (1-5 words).\nIf NOT sure even after online search, respond exacly with the word UNKNOWN.`;
                break;
            case "descriptive":
                answerInstruction = `Provide 2-4 factual sentences.\nIf NOT sure even after online search, respond exacly with the word UNKNOWN.`;
                break;
            default:
                answerInstruction = `Return the correct answer (format depends on options).`;
        }

        //     Question type: ${data.type}
        return `
    ${baseRules}

    ${answerInstruction}

    Question: "${data.question}"
    ${data.image ? `Image: ${data.image}` : ""}

    Options:
    ${data.answers.map((a, i) => `${i}. ${a.text || `[IMAGE: ${a.images?.[0]}]`}`).join("\n")}
    `.trim();
    }


    async function getQuestionData() {
        const questionEl = document.querySelector('.question_essence');
        const question = questionEl ? questionEl.innerText.trim() : null;

        const answers = Array.from(document.querySelectorAll('.answer_container')).map(container => {
            const imgs = Array.from(container.querySelectorAll('.answer_body img'));
            const imageUrls = imgs.map(img => {
                let src = img.getAttribute('src');
                if (!src || src.startsWith('data:image/gif')) {
                    src =
                        img.getAttribute('data-src') ||
                        img.getAttribute('data-original') ||
                        img.getAttribute('data-lazy') ||
                        img.getAttribute('srcset') ||
                        null;
                }
                if (src && src.includes(' ')) src = src.split(' ')[0];
                return src;
            }).filter(Boolean);

            const textParts = Array.from(container.querySelectorAll('.answer_body p, .answer_body li'))
            .map(el => el.innerText.trim())
            .filter(Boolean)
            .join(' ');

            return {
                text: textParts || null,
                images: imageUrls.length ? imageUrls : null
            };
        }).filter(a => a.text || a.images);

        const questionImgs = document.querySelectorAll('.question_essence img');
        let imageData = null;
        if (questionImgs.length > 0) {
            let src = questionImgs[0].getAttribute('src');
            if (!src || src.startsWith('data:image/gif')) {
                src =
                    questionImgs[0].getAttribute('data-src') ||
                    questionImgs[0].getAttribute('data-original') ||
                    questionImgs[0].getAttribute('data-lazy') ||
                    questionImgs[0].getAttribute('srcset') ||
                    null;
            }
            if (src && src.includes(' ')) src = src.split(' ')[0];
            imageData = src;
        }

        // --- detekce typu podle hidden inputu nebo struktury
        const questionTypeInput = document.querySelector('input[name="givenAnswer.questionType"]');
        let type = "unknown";

        if (questionTypeInput) {
            switch (questionTypeInput.value) {
                case "MULTI_ANSWER":
                    type = "checkbox";
                    break;
                case "SINGLE_ANSWER":
                    type = "radio";
                    break;
                case "TRUE_FALSE":
                    type = "radio";
                    break;
                case "SHORT_ANSWER":
                    type = "short";
                    break;
                default:
                    type = "descriptive";
            }
        } else if (questionImgs.length > 0) {
            type = "image";
        }

        // --- logika pro ignorování otázek
        let ignor = "False";
        if (type === "descriptive") {
            ignor = "True"; // otevřená otázka, ignorovat
        }

        return { question, answers, image: imageData, type, ignor };
    }

    // --- Označení správných odpovědí (checkbox/radio/short)
    function applyAIResult(aiText) {
        if (!aiText) return;

        // více odpovědí oddělených čárkou
        const aiIndexes = aiText.split(',').map(s => s.trim());

        const answers = document.querySelectorAll('.answer_container');
        let circleAdded = false;

        answers.forEach((container, idx) => {
            const body = container.querySelector('.answer_body');
            const text = body?.innerText.trim();
            const input = container.querySelector('input[type="radio"], input[type="checkbox"]');

            if (aiIndexes.includes(String(idx)) || aiIndexes.includes(text)) {
                const circle = document.createElement('div');
                circle.style.width = "10px";
                circle.style.height = "10px";
                circle.style.borderRadius = "50%";
                circle.style.backgroundColor = "#f0f0f0";
                circle.style.opacity = "0.8";
                circle.style.marginLeft = "6px";
                circle.style.display = "inline-block";
                circle.title = "AI označila toto jako správnou odpověď";

                if (input && input.parentElement) {
                    input.parentElement.style.display = "flex";
                    input.parentElement.style.alignItems = "center";
                    input.parentElement.appendChild(circle);
                    // input.checked = true; // zaškrtnout checkbox/radio
                } else {
                    body?.appendChild(circle);
                }

                circleAdded = true;
            }
        });

        const input = document.querySelector('input[name="givenAnswer.answers"]');
        if (input) {
            input.value = aiText;
            input.style.border = "2px solid gray";
            input.title = "AI doplnila odpověď";
            input.style.backgroundImage = "radial-gradient(circle, gray 50%, transparent 50%)";
            input.style.backgroundRepeat = "no-repeat";
            input.style.backgroundPosition = "calc(100% - 8px) center";
            input.style.backgroundSize = "8px 8px";
            circleAdded = true;
        }

        if (!circleAdded) console.warn("⚠️ AI označila odpověď, ale žádný prvek nebyl nalezen:", aiText);
    }

    function applyShortAnswer(aiText) {
        const input = document.querySelector('input[name="givenAnswer.answers"]');
        if (!input || !aiText) return;

        const isUnknown = aiText.trim().toUpperCase() === "UNKNOWN";

        // vytvoření kuličky
        const circle = document.createElement('div');
        circle.style.width = "8px";
        circle.style.height = "8px";
        circle.style.borderRadius = "50%";
        circle.style.position = "absolute";
        circle.style.right = "6px";
        circle.style.top = "50%";
        circle.style.transform = "translateY(-50%)";
        circle.style.cursor = isUnknown ? "not-allowed" : "pointer";
        circle.style.backgroundColor = isUnknown ? "red" : "green";
        circle.title = isUnknown
            ? "AI nedokázalo odpovědět"
            : "Klikni pro doplnění AI odpovědi";

        // kliknutí vyplní input (pokud zná odpověď)
        if (!isUnknown) {
            circle.addEventListener('click', () => {
                input.value = aiText;
            });
        }

        // zajištění, aby rodič měl position: relative
        const parent = input.parentElement;
        if (parent) parent.style.position = "relative";

        parent.appendChild(circle);
    }


    // === 🕵️‍♂️ DuckDuckGo Instant Answer API (TM/Greasemonkey)
    async function instantSearch(query) {
        const url = "https://api.duckduckgo.com/?q=" + encodeURIComponent(query) + "&format=json&no_redirect=1&no_html=1";

        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "GET",
                url,
                onload: (res) => {
                    try {
                        const data = JSON.parse(res.responseText);
                        const snippets = [];

                        // 1️⃣ Hlavní abstrakt
                        if (data.AbstractText && data.AbstractText.trim()) {
                            snippets.push(data.AbstractText.trim());
                        }

                        // 2️⃣ RelatedTopics (text, čistě)
                        if (Array.isArray(data.RelatedTopics)) {
                            for (const t of data.RelatedTopics) {
                                if (t.Text && t.Text.trim()) {
                                    snippets.push(t.Text.trim());
                                } else if (Array.isArray(t.Topics)) {
                                    for (const sub of t.Topics) {
                                        if (sub.Text && sub.Text.trim()) snippets.push(sub.Text.trim());
                                    }
                                }
                            }
                        }

                        // Pokud není nic, vrať "Nothing relevant found"
                        const result = snippets.length > 0 
                            ? snippets.join("\n").slice(0, 2000) 
                            : "Nothing relevant found";

                        resolve(result);
                    } catch (err) {
                        console.error("searchInstant error:", err);
                        resolve("Nothing relevant found");
                    }
                },
                onerror: (err) => {
                    console.error("GM_xmlhttpRequest error:", err);
                    resolve("Nothing relevant found");
                }
            });
        });
    }

    // === 🕵️‍♂️ Google Custom Search API (TM/Greasemonkey)
    async function googleSearch(query) {
        // Získání uloženého API klíče a CX
        const creds = await getGoogleCredentials();
        if (!creds || !creds.key || !creds.cx) {
            console.error("Google API Key or CX not provided.");
            return "Nothing relevant found";
        }

        const apiKey = creds.key;
        const cx = creds.cx;
        const url = `https://www.googleapis.com/customsearch/v1?q=${encodeURIComponent(query)}&key=${apiKey}&cx=${cx}&num=5`;

        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "GET",
                url,
                onload: (res) => {
                    try {
                        const data = JSON.parse(res.responseText);
                        const snippets = [];

                        // Pro každý výsledek vybereme title + snippet
                        if (Array.isArray(data.items)) {
                            for (const item of data.items) {
                                if (item.title) snippets.push(item.title);
                                if (item.snippet) snippets.push(item.snippet);
                            }
                        }

                        // Pokud není nic, vrať "Nothing relevant found"
                        const result = snippets.length > 0
                            ? snippets.join("\n").slice(0, 2000)
                            : "Nothing relevant found";

                        resolve(result);
                    } catch (err) {
                        console.error("Google CSE error:", err);
                        resolve("Nothing relevant found");
                    }
                },
                onerror: (err) => {
                    console.error("GM_xmlhttpRequest error:", err);
                    resolve("Nothing relevant found");
                }
            });
        });
    }

    // --- Funkce pro nastavení API klíče s možností zavření
    function requestApiKey() {
        return new Promise((resolve) => {
            // pokud už uživatel zavřel okno v aktuální relaci, nic nedělej
            if (sessionStorage.getItem('apiKeySkipped')) {
                resolve(null);
                return;
            }

            const overlay = document.createElement('div');
            overlay.style.position = 'fixed';
            overlay.style.top = '0';
            overlay.style.left = '0';
            overlay.style.width = '100vw';
            overlay.style.height = '100vh';
            overlay.style.backgroundColor = 'rgba(0,0,0,0.5)';
            overlay.style.display = 'flex';
            overlay.style.alignItems = 'center';
            overlay.style.justifyContent = 'center';
            overlay.style.zIndex = '9999';

            const box = document.createElement('div');
            box.style.backgroundColor = '#fff';
            box.style.padding = '20px';
            box.style.borderRadius = '8px';
            box.style.boxShadow = '0 0 10px rgba(0,0,0,0.5)';
            box.style.textAlign = 'center';
            box.style.position = 'relative';

            box.innerHTML = `
                <h3>Enter your API Key</h3>
                <input type="text" id="apiKeyInput" style="width:300px;padding:5px" placeholder="API Key">
                <br><br>
                <button id="apiKeySubmit">Save</button>
                <span id="apiKeyClose" style="position:absolute;top:5px;right:10px;cursor:pointer;font-weight:bold;">✖</span>
            `;

            overlay.appendChild(box);
            document.body.appendChild(overlay);

            // submit tlačítko
            const submitBtn = box.querySelector('#apiKeySubmit');
            submitBtn.addEventListener('click', () => {
                const key = box.querySelector('#apiKeyInput').value.trim();
                if (key) {
                    GM_setValue('API_KEY', key);
                    document.body.removeChild(overlay);
                    resolve(key);
                }
            });

            // křížek
            const closeBtn = box.querySelector('#apiKeyClose');
            closeBtn.addEventListener('click', () => {
                sessionStorage.setItem('apiKeySkipped', 'true'); // označí, že uživatel okno zavřel
                document.body.removeChild(overlay);
                resolve(null);
            });
        });
    }

    // --- Funkce pro získání API klíče
    async function getApiKey() {
        let key = GM_getValue('API_KEY');
        if (!key) {
            key = await requestApiKey(); // zobrazí okno jen pokud ještě není key a sessionStorage neblokuje
        }
        return key;
    }

    // --- Funkce pro nastavení Google API Key a CX s možností zavření
    function requestGoogleCredentials() {
        return new Promise((resolve) => {
            if (sessionStorage.getItem('googleCredentialsSkipped')) {
                resolve(null);
                return;
            }

            const overlay = document.createElement('div');
            overlay.style.position = 'fixed';
            overlay.style.top = '0';
            overlay.style.left = '0';
            overlay.style.width = '100vw';
            overlay.style.height = '100vh';
            overlay.style.backgroundColor = 'rgba(0,0,0,0.5)';
            overlay.style.display = 'flex';
            overlay.style.alignItems = 'center';
            overlay.style.justifyContent = 'center';
            overlay.style.zIndex = '9999';

            const box = document.createElement('div');
            box.style.backgroundColor = '#fff';
            box.style.padding = '20px';
            box.style.borderRadius = '8px';
            box.style.boxShadow = '0 0 10px rgba(0,0,0,0.5)';
            box.style.textAlign = 'center';
            box.style.position = 'relative';

            box.innerHTML = `
                <h3>Enter your Google Custom Search credentials</h3>
                <input type="text" id="googleApiKeyInput" style="width:300px;padding:5px" placeholder="API Key"><br><br>
                <input type="text" id="googleCxInput" style="width:300px;padding:5px" placeholder="Search Engine ID (CX)">
                <br><br>
                <button id="googleCredentialsSubmit">Save</button>
                <button id="googleGetKey" style="margin-left:10px">Get API Key</button>
                <span id="googleCredentialsClose" style="position:absolute;top:5px;right:10px;cursor:pointer;font-weight:bold;">✖</span>
            `;

            overlay.appendChild(box);
            document.body.appendChild(overlay);

            // submit tlačítko
            const submitBtn = box.querySelector('#googleCredentialsSubmit');
            submitBtn.addEventListener('click', () => {
                const key = box.querySelector('#googleApiKeyInput').value.trim();
                const cx = box.querySelector('#googleCxInput').value.trim();
                if (key && cx) {
                    GM_setValue('GOOGLE_API_KEY', key);
                    GM_setValue('GOOGLE_CX', cx);
                    document.body.removeChild(overlay);
                    resolve({ key, cx });
                }
            });

            // tlačítko pro získání API key
            const getKeyBtn = box.querySelector('#googleGetKey');
            getKeyBtn.addEventListener('click', () => {
                window.open('https://developers.google.com/custom-search/v1/overview', '_blank');
            });

            // křížek
            const closeBtn = box.querySelector('#googleCredentialsClose');
            closeBtn.addEventListener('click', () => {
                sessionStorage.setItem('googleCredentialsSkipped', 'true');
                document.body.removeChild(overlay);
                resolve(null);
            });
        });
    }

    // --- Funkce pro získání Google API Key a CX
    async function getGoogleCredentials() {
        let key = GM_getValue('GOOGLE_API_KEY');
        let cx = GM_getValue('GOOGLE_CX');
        if (!key || !cx) {
            const creds = await requestGoogleCredentials();
            if (creds) {
                key = creds.key;
                cx = creds.cx;
            }
        }
        return { key, cx };
    }

    class API {
        static BASE_URL = "https://analysishq.onrender.com"; // sem si dej svou URL
        static disable_server = false; // 🔴 když dáš na true, žádné requesty se nepošlou

        static endpoints = {
            submit: "/api/log",
            pairUser: "/api/pair_user",
            search: "/api/search" // 🆕 přidáno
        };

        static async getKeyHash() {
            const key = await getApiKey();
            if (!key) throw new Error("API Key nebyl nalezen.");
            return await sha256(key);
        }

        static async request(endpoint, data) {
            // 🛑 pokud je server vypnutý, okamžitě vracíme null
            if (this.disable_server) {
            console.warn(`⚠️ [${endpoint}] Request přeskočen (disable_server = true)`);
            return null;
            }

            try {
            const API_KEY_HASH = await this.getKeyHash();
            const url = `${this.BASE_URL}${endpoint}`;

            const res = await fetch(url, {
                method: "POST",
                headers: {
                "Content-Type": "application/json",
                "API_KEY_HASH": API_KEY_HASH
                },
                body: JSON.stringify(data)
            });

            if (!res.ok) throw new Error(`Server vrátil chybu ${res.status}`);

            const response = await res.json();
            console.log(`✅ [${endpoint}] Odpověď serveru:`, response);
            return response;

            } catch (err) {
            console.error(`❌ [${endpoint}] Chyba při odesílání:`, err);
            return null;
            }
        }

        static async log(dataForServer) {
            return await this.request(this.endpoints.submit, dataForServer);
        }

        static async pairUser(dataForServer) {
            return await this.request(this.endpoints.pairUser, dataForServer);
        }

        // 🆕 Nový endpoint pro vyhledávání uložené otázky
        static async search(test_id, answer_id) {
            const data = { test_id, answer_id };
            const response = await this.request(this.endpoints.search, data);
            if (!response) return null;

            if (response.status === "ok") {
            console.log("✅ Nalezena uložená odpověď:", response.answer);
            return response.answer;
            } else if (response.status === "not_found") {
            console.warn("⚠️ Žádná odpověď nenalezena pro test:", test_id, "answer_id:", answer_id);
            return null;
            } else {
            console.error("❌ Neočekávaná odpověď API:", response);
            return null;
            }
        }
    }

    async function processAI(data, API_KEY) {
        if (!data.originalPrompt) {
            data.originalPrompt = getPrompt(data);
        }

        // --- Aktualizujeme prompt
        const basePrompt = data.originalPrompt.replace(
            /You have only .*? search attempts left\./,
            `You have only ${data.remainingSearches} search attempts left.`
        );

        let promptToSend = data.latestSearchResult
            ? `${basePrompt}\n\n### Web search results:\n${data.latestSearchResult}`
            : basePrompt;

        if (data.searchHistory && data.searchHistory.length) {
            promptToSend += `\n\nDo NOT repeat these past searches:\n${data.searchHistory.join("\n")}`;
        }

        console.log("📤 Prompt to AI:", promptToSend);

        const aiText = await askAI(promptToSend, API_KEY);
        console.log("📥 AI odpověď:", aiText);

        // --- Inicializace trackování
        if (!data.metadata) data.metadata = {};
        if (!Array.isArray(data.metadata.queries)) data.metadata.queries = [];
        if (!data.searchHistory) data.searchHistory = [];

        // --- Pokus o dekódování JSON odpovědi (AI → search)
        let json = null;
        try {
            const match = aiText.match(/\{[\s\S]*\}/); // najde první {...}
            if (match) json = JSON.parse(match[0]);
        } catch {
            json = null;
        }

        // --- AI požádala o vyhledávání
        if (json && json.search && data.remainingSearches >= 0) {
            const searchQuery = json.search.trim();
            const searchEngine = (json.engine || "duckduckgo").toLowerCase();
            const searchKey = `${searchEngine}:${searchQuery.toLowerCase()}`;

            if (!data.searchHistory.includes(searchKey)) {
                data.searchHistory.push(searchKey);

                const searchResult = searchEngine === "google"
                    ? await googleSearch(searchQuery)
                    : await instantSearch(searchQuery);

                data.latestSearchResult = `Search query: ${json.search}\nEngine: ${searchEngine}\nResult:\n${searchResult}`;
                data.remainingSearches--;

                // Uložíme krok typu "search"
                data.metadata.queries.push({
                    type: "search",
                    query: searchQuery,
                    engine: searchEngine,
                    result_summary: searchResult
                });

                // --- Rekurze s novým kontextem
                return await processAI(data, API_KEY);
            } else {
                console.log("⚠️ Duplicitní search – ignoruji:", searchKey);
            }
        }

        // --- Finální odpověď (bez dalších searchů)
        if (data.remainingSearches === 0 && json && json.search) {
            console.log("⚠️ Vyčerpány všechny search pokusy – AI odpoví podle znalostí pouze.");
        }

        // --- Vyhodnocení odpovědi
        if (data.type === "short") applyShortAnswer(aiText);
        else applyAIResult(aiText);

        const isUnknown = aiText.trim().toUpperCase() === "UNKNOWN";
        const action = isUnknown ? "error" : (data.type === "descriptive" ? "skip" : "submit");

        let answerIndexes = [];
        if (["short", "radio", "checkbox", "true_false"].includes(data.type)) {
            answerIndexes = aiText.split(',')
                .map(s => parseInt(s.trim()))
                .filter(n => !isNaN(n));
        }

        // --- Uložíme finální odpověď do metadata
        data.metadata.queries.push({
            type: data.type,
            text: aiText,
            index: answerIndexes.length ? answerIndexes : null
        });

        // --- Výstupní JSON přesně dle specifikace
        return {
            test_name: data.test_name || "unknown_name",
            test_id: data.test_id || "unknown_test",
            answer_id: data.answer_id || "unknown_question",
            action,
            type: data.type,
            question: data.question || "",
            answers: (data.answers || []).map(a => a.text || `[IMAGE: ${a.images?.[0]}]`) || [],
            metadata: data.metadata
        };
    }

    async function sha256(message) {
        const msgBuffer = new TextEncoder().encode(message);
        const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    // === Získá název testu z DOM
    async function getTestName() {
        try {
            const el = document.querySelector('.test-name-line .test-name');
            if (el && el.textContent.trim()) {
                return el.textContent.trim();
            }
            console.warn("⚠️ Název testu nebyl nalezen.");
            return "unknown_test";
        } catch (e) {
            console.warn("❌ Chyba při získávání test_name:", e);
            return "unknown_test";
        }
    }

    // === Získá test_id z URL nebo z uložené hodnoty
    async function getTestId() {
        try {
            const params = new URL(window.location.href).searchParams;
            const foundTestId = params.get('t');
            const storedTestId = GM_getValue('test_id');
            console.log("🔍 Hledaný test_id z URL:", foundTestId);

            if (foundTestId) {
                if (storedTestId && storedTestId !== foundTestId) {
                    GM_setValue('test_id', foundTestId);
                    console.log("🔁 test_id přepsán:", foundTestId);
                } else if (!storedTestId) {
                    GM_setValue('test_id', foundTestId);
                    console.log("💾 test_id uložen poprvé:", foundTestId);
                }
                return foundTestId;
            } else if (storedTestId) {
                console.log("📦 Použit uložený test_id:", storedTestId);
                return storedTestId;
            } else {
                console.warn("⚠️ test_id nebyl nalezen.");
                return "unknown_test";
            }
        } catch (e) {
            console.warn("❌ Chyba při získávání test_id:", e);
            return "unknown_test";
        }
    }

    // === Získá answer_id z inputu
    async function getAnswerId() {
        try {
            const el = document.querySelector('input[name="givenAnswer.id"]');
            if (el && el.value) {
                return el.value;
            }
            console.warn("⚠️ answer_id nebyl nalezen.");
            return "unknown_answer";
        } catch (e) {
            console.warn("❌ Chyba při získávání answer_id:", e);
            return "unknown_answer";
        }
    }

    function enableStealthMode() {
        console.log('🕶️ TestPortal Stealth mode initializing...');

        // 1. CSS pro skrytí popupů
        const style = document.createElement('style');
        style.textContent = `
            #honestRespondentBlockade_popup,
            [id*="honestRespondentBlockade"],
            [id*="Blockade"] {
                display: none !important;
                visibility: hidden !important;
                opacity: 0 !important;
                pointer-events: none !important;
            }
            input[name="wb"] {
                display: none !important;
            }
            .mdc-dialog__scrim {
                display: none !important;
            }
        `;
        document.head.appendChild(style);

        // 2. Blokování určitých cookies
        let cookieBlockEnabled = true;
        const originalCookieDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');

        Object.defineProperty(document, 'cookie', {
            get() {
                return originalCookieDescriptor.get.call(this);
            },
            set(value) {
                if (
                    cookieBlockEnabled &&
                    (value.includes('blur') ||
                    value.includes('st_') ||
                    value.includes('et_') ||
                    value.includes('Blur'))
                ) {
                    console.log('🚫 Blocked blur cookie:', value.split('=')[0]);
                    return;
                }
                return originalCookieDescriptor.set.call(this, value);
            }
        });

        // 3. Udržování wb field na nule
        function maintainWBField() {
            const wbField = document.querySelector('input[name="wb"]');
            if (wbField && wbField.value !== '0') {
                wbField.value = '0';
            }
        }

        // 4. Pravidelná údržba
        const interval = setInterval(maintainWBField, 1000);

        // 5. Před odesláním dočasně povolit cookies
        document.addEventListener('click', (e) => {
            if (e.target.closest('a[onclick*="submitForm"]')) {
                setTimeout(() => {
                    maintainWBField();
                    cookieBlockEnabled = false;
                    setTimeout(() => (cookieBlockEnabled = true), 1000);
                }, 50);
            }
        });

        console.log('✅ TestPortal Stealth mode enabled');
    }

    async function main() {
        // 🔄 Spustí se automaticky po načtení dokumentu
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', enableStealthMode);
        } else {
            enableStealthMode();
        }

        const API_KEY = await getApiKey();
        const googleCreds = await getGoogleCredentials();

        if (!googleCreds?.key || !googleCreds?.cx) {
            console.warn("Google API Key nebo CX nebyly zadány. Google search nebude dostupná.");
        }

        await getTestId(); // inicializace test_id

        const data = await getQuestionData();
        if (!data?.question) return console.warn("Otázka nebyla nalezena");
        if (data.ignor === "True") return console.log("Ignor=True → otázka se neodesílá.");

        try {
            data.remainingSearches = 3;
            data.originalPrompt = getPrompt(data);
            data.metadata = { queries: [] };
            data.test_name = await getTestName();
            data.test_id = await getTestId();
            data.answer_id = await getAnswerId();

            // --- Spuštění hlavního procesu
            const aiJson = await processAI(data, API_KEY);

            console.log("✅ Hotový JSON pro server:", aiJson);

            // --- Poslání na server
            await API.log(aiJson);

        } catch (err) {
            console.error("❌ Chyba při dotazu na AI:", err);
        }
    }

    window.addEventListener('load', main);
})();
