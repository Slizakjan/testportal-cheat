// ==UserScript==
// @name         Auto Answer Helper (Groq API + Ignor + Strict Prompt + Checkboxes)
// @namespace    http://tampermonkey.net/
// @version      1.7
// @author       Slizak_jan
// @description  Automatické získávání odpovědí pomocí Groq API s ignor logikou, striktním promptem a podporou checkboxů
// @match        *://*.testportal.*/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @connect      api.groq.com
// ==/UserScript==


(async () => {
    'use strict';

    const API_URL = "https://api.groq.com/openai/v1/responses";

    // === 🧠 Dotaz AI s web-retrieval
    async function askAI(prompt, API_KEY) {
        try {
            const context = await searchWeb(prompt);

            // Kombinuj kontext jen pokud ho chceš přidat
            const combinedPrompt = `
    ### Web context:
    ${context || "(no relevant context found)"}

    ${prompt}
    `;
            const body = {
                model: "llama-3.3-70b-versatile",
                // temperature: 0.1,
                input: combinedPrompt.trim()
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
                    onload: function (response) {
                        try {
                            const json = JSON.parse(response.responseText);
                            let result = null;

                            // 🧩 Reasoning-style output
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
                            if (!result && json.output && Array.isArray(json.output) && typeof json.output[0]?.content === "string")
                                result = json.output[0].content.trim();
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
        } catch (err) {
            console.error("askAI error:", err);
            return "Bez odpovědi (chyba vyhledávání)";
        }
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
    You are an exam helper AI. Select the single correct answer based on question and options.
    Return only the index (0-based) of the correct answer. Take your time to think about correct answer.

    Do NOT explain.
    Do NOT write any sentences or reasoning.
    Do NOT write anything except a number.
    If you are NOT 100% sure you can take a guess.

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
    Take your time to think about correct answer.
    Return indexes separated by commas (e.g. "0,2,3").

    Do NOT explain.
    Do NOT write any sentences or reasoning.
    Do NOT write anything except a number.
    If you are NOT 100% sure you can take a guess.

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
    Take your time to think about correct answer.
    Return "0" for False, "1" for True.

    Do NOT explain.
    Do NOT write any sentences or reasoning.
    Do NOT write anything except a number.
    If you are NOT 100% sure you can take a guess.

    Question: "${data.question}"
    Answers:
    ${data.answers.map((a, i) => `${i}. ${a.text}`).join("\n")}
    `;
                break;

            // 🟪 Krátká odpověď (tady si můžeš později dopsat custom prompt)
            case "short":
                prompt = `
    You are an exam helper AI. Provide a short, concise written answer to the question.
    Take your time to think about correct answer.
    Do NOT return explanations — only the answer text itself (1 to 5 words).
    If you are not sure or unable to answer because of lack of resources, you may take a reasoned guess using your general knowledge,
    but if the question lacks enough information or you have no confidence at all,
    return exactly the word UNKNOWN.

    Question: "${data.question}"
    ${data.image ? `Image: ${data.image}` : ""}
    `;
                break;

            // 🟫 Popisná otázka (delší odpověď)
            case "descriptive":
                prompt = `
    You are an exam helper AI. Write a descriptive, natural answer in a few sentences.
    Take your time to think about correct answer.
    Keep it factual and clear.

    Question: "${data.question}"
    ${data.image ? `Image: ${data.image}` : ""}
    `;
                break;

            // 🔘 Fallback (pokud neznám typ)
            default:
                prompt = `
    You are an exam helper AI.
    Analyze the question and answer correctly.
    Take your time to think about correct answer.

    Question: "${data.question}"
    ${data.image ? `Image: ${data.image}` : ""}
    Answers:
    ${data.answers.map((a, i) => `${i}. ${a.text || `[IMAGE: ${a.images?.[0]}]`}`).join("\n")}
    `;
                break;
        }

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


    // === 🕵️‍♂️ Jednoduché webové hledání (DuckDuckGo)
    async function searchWeb(query) {
        // dočasně zakázáno, vracíme prázdný string
        return "";
        const url = "https://api.duckduckgo.com/?q=" + encodeURIComponent(query) + "&format=json";
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "GET",
                url,
                onload: (res) => {
                    try {
                        const data = JSON.parse(res.responseText);
                        const snippets = [];
                        if (data.RelatedTopics) {
                            for (const t of data.RelatedTopics) {
                                if (t.Text) snippets.push(t.Text);
                            }
                        }
                        resolve(snippets.join("\n").slice(0, 2000));
                    } catch (err) {
                        console.error("searchWeb error:", err);
                        resolve("");
                    }
                },
                onerror: reject
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


    // --- Hlavní běh
    async function main() {
        const API_KEY = await getApiKey(); // získá nebo vyžádá klíč
        const data = await getQuestionData();
        if (!data.question) return console.warn("Otázka nebyla nalezena");
        if (data.ignor === "True") return console.log("Ignor=True → otázka se neodesílá.");
        // console.log(data);

        const prompt = getPrompt(data);
        console.log("📤 Prompt:", prompt);

        try {
            const aiText = await askAI(prompt, API_KEY);
            console.log("📥 AI odpověď:", aiText);
            if (data.type === "short") {
                applyShortAnswer(aiText);
            } else {
                applyAIResult(aiText); // pro checkbox/radio/long answer
            }

            // applyAIResult(aiText);
        } catch (err) {
            console.error("❌ Chyba při dotazu na AI:", err);
        }
    }

    window.addEventListener('load', main);
})();
