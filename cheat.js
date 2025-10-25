// ==UserScript==
// @name         Auto Answer Helper (Groq API + Ignor + Strict Prompt + Checkboxes)
// @namespace    https://github.com/Slizakjan/testportal-cheat
// @version      1.7
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

        let prompt = "";

        // === Vyber prompt podle typu otázky ===
        switch (data.type) {

            // 🟩 Jedna správná odpověď
            case "radio":
                prompt = `
    You are an exam helper AI. Select the single correct answer based on the question and options.
    Return only the index (0-based) of the correct answer.

    Do NOT write anything except a number.
    If you are NOT 100% sure, you may take a guess or search online.

    Question: "${data.question}"
    ${data.image ? `Image: ${data.image}` : ""}
    Answers:
    ${data.answers.map((a, i) => `${i}. ${a.text || `[IMAGE: ${a.images?.[0]}]`}`).join("\n")}
    `;
                break;

            // 🟦 Více správných odpovědí
            case "checkbox":
                prompt = `
    You are an exam helper AI. Select all correct answers.
    Return indexes separated by commas (e.g. "0,2,3").

    Do NOT write anything except numbers.
    If you are NOT 100% sure, you may take a guess or search online.

    Question: "${data.question}"
    ${data.image ? `Image: ${data.image}` : ""}
    Answers:
    ${data.answers.map((a, i) => `${i}. ${a.text || `[IMAGE: ${a.images?.[0]}]`}`).join("\n")}
    `;
                break;

            // 🟨 Pravda / Nepravda
            case "true_false":
                prompt = `
    You are an exam helper AI. Answer whether the following statement is true or false.
    Return "0" for False, "1" for True.

    Do NOT write anything except a number.
    If you are NOT 100% sure, you may take a guess or search online.

    Question: "${data.question}"
    Answers:
    ${data.answers.map((a, i) => `${i}. ${a.text}`).join("\n")}
    `;
                break;

            // 🟪 Krátká odpověď
            case "short":
                prompt = `
    You are an exam helper AI. Provide a short, concise answer (1–5 words).
    Do NOT return explanations — only the answer text itself.
    If unsure or lacking information, use online search or respond exactly with: UNKNOWN.

    Question: "${data.question}"
    ${data.image ? `Image: ${data.image}` : ""}
    `;
                break;

            // 🟫 Popisná otázka (delší odpověď)
            case "descriptive":
                prompt = `
    You are an exam helper AI. Write a clear, factual descriptive answer in a few sentences.
    Do NOT explain beyond the answer itself.
    If unsure, respond exactly with: UNKNOWN.

    Question: "${data.question}"
    ${data.image ? `Image: ${data.image}` : ""}
    `;
                break;

            // 🔘 Fallback (pokud neznám typ)
            default:
                prompt = `
    You are an exam helper AI. Analyze the question and answer correctly.
    Do NOT explain beyond the answer itself.
    If unsure, respond exactly with: UNKNOWN.

    Question: "${data.question}"
    ${data.image ? `Image: ${data.image}` : ""}
    Answers:
    ${data.answers.map((a, i) => `${i}. ${a.text || `[IMAGE: ${a.images?.[0]}]`}`).join("\n")}
    `;
                break;
        }

        // --- Instrukce pro online search
        prompt += `

    You may request an online search by replying only in JSON format:
    {"search": "your query", "engine": "duckduckgo"}
    or
    {"search": "your query", "engine": "google"}
    and nothing else.

    - "duckduckgo" = instant search (quick abstract / snippets)
    - "google" = full web search using Google Custom Search API

    You have 3 search attempts.
    After all attempts are used, you must answer based on knowledge only.
    If unsure even after that, respond exactly with the word: UNKNOWN.
    If you have the final answer, respond with plain text only (no explanations).

    You have only ${data.remainingSearches} search attempts left.
    `;

        return prompt.trim();
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

    async function processAI(data, API_KEY) {
        if (!data.originalPrompt) {
            data.originalPrompt = getPrompt(data);
        }

        // --- prompt bude obsahovat jen poslední search result
        const promptToSend = data.latestSearchResult
            ? `${data.originalPrompt.replace(
                /You have only .*? search attempts left\./,
                `You have only ${data.remainingSearches} search attempts left.`
            )}\n\n### Web search results:\n${data.latestSearchResult}`
            : data.originalPrompt.replace(
                /You have only .*? search attempts left\./,
                `You have only ${data.remainingSearches} search attempts left.`
            );

        console.log("📤 Prompt to AI:", promptToSend);

        const aiText = await askAI(promptToSend, API_KEY);
        console.log("📥 AI odpověď:", aiText);

        // Zkoušíme JSON výzvu
        try {
            const json = JSON.parse(aiText);

            if (json.search && data.remainingSearches > 0) {

                let searchQuery = json.search.trim().toLowerCase();
                let searchEngine = (json.engine || "duckduckgo").toLowerCase();
                console.log("🔎 AI požaduje vyhledávání:", json.search);

                // --- Bloček proti opakování stejného hledání ---
                if (!data.searchHistory) data.searchHistory = [];

                const searchKey = `${searchEngine}:${searchQuery}`;
                if (data.searchHistory.includes(searchKey)) {
                    console.log("⚠️ Duplicitní search – ignoruji:", searchKey);
                    return await processAI(data, API_KEY);
                }

                data.searchHistory.push(searchKey);

                let searchResult;

                // Zvolíme engine
                if (searchEngine === "google") {
                    searchResult = await googleSearch(searchQuery);
                } else {
                    searchResult = await instantSearch(searchQuery);
                }

                // Uložíme jen poslední search
                data.latestSearchResult = `Search query: ${json.search}\nEngine: ${json.engine || "duckduckgo"}\nResult:\n${searchResult}`;

                data.remainingSearches--;

                // Rekurze = pokračujeme s novým kontextem
                return await processAI(data, API_KEY);
            }
        } catch (e) {
            console.log("ℹ️ AI neposlala JSON výzvu k vyhledávání.");
        }

        // ✅ Finální odpověď
        if (data.type === "short") {
            applyShortAnswer(aiText);
        } else {
            applyAIResult(aiText);
        }

        return aiText;
    }



    // --- Hlavní běh
    async function main() {
        const API_KEY = await getApiKey();
        // Získání Google Custom Search klíčů a CX
        const googleCreds = await getGoogleCredentials();
        if (!googleCreds || !googleCreds.key || !googleCreds.cx) {
            console.warn("Google API Key nebo CX nebyly zadány. Google search nebude dostupná.");
        }
        const data = await getQuestionData();
        if (!data.question) return console.warn("Otázka nebyla nalezena");
        if (data.ignor === "True") return console.log("Ignor=True → otázka se neodesílá.");

        // console.log("📤 Prompt:", getPrompt(data));

        try {
            data.remainingSearches = 3;
            data.context = "";
            data.originalPrompt = getPrompt(data);

            await processAI(data, API_KEY);

        } catch (err) {
            console.error("❌ Chyba při dotazu na AI:", err);
        }
    }

    window.addEventListener('load', main);
})();
