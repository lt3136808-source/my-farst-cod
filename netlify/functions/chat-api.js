// =========================================================================
// Nexus AI PRO Backend - v100 (Dynamic Envs, Media, Moderation, Fallback)
// المسار: netlify/functions/chat-api.js
// =========================================================================

const TIMEOUT_MS = 8500; 
const ALLOWED_ORIGIN = '*';

const AI_MODELS = {
  'g_15_flash': 'gemini-1.5-flash', 'g_15_pro': 'gemini-1.5-pro',
  'g_25_flash': 'gemini-2.5-flash', 'g_25_pro': 'gemini-2.5-pro',
  'o_4o': 'llama-3.3-70b-specdec', 'o_mini': 'llama-3.1-8b-instant'
};

const FALLBACK_MODELS = [
    'google/gemini-2.5-flash:free',
    'meta-llama/llama-3.1-8b-instruct:free'
];

function moderate(text) {
    if (!text) return "";
    const badWords = ['شتم', 'كلمة_مسيئة_هنا']; 
    let cleanText = text;
    badWords.forEach(word => {
        const regex = new RegExp(word, 'gi');
        cleanText = cleanText.replace(regex, '***');
    });
    return cleanText;
}

const fetchWithTimeout = async (url, options) => {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(id);
        if (!response.ok) { let err = await response.text(); throw new Error(err); }
        return await response.json();
    } catch (error) {
        clearTimeout(id);
        throw error;
    }
};

exports.handler = async (event) => {
    const headers = { 'Access-Control-Allow-Origin': ALLOWED_ORIGIN, 'Content-Type': 'application/json' };
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
    if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ reply: '⚠️ طريقة الطلب غير مسموحة.' }) };

    try {
        let bodyParsed;
        try { bodyParsed = JSON.parse(event.body); } catch (e) { throw new Error("صيغة JSON غير صالحة"); }

        let { model, message, history, imageBase64 } = bodyParsed;

        if (imageBase64 && imageBase64.length > 1.5 * 1024 * 1024) throw new Error("الصورة كبيرة جداً، يرجى تقليل حجمها.");
        
        message = moderate(message || "");
        if (!Array.isArray(history)) history = [];

        // استدعاء المفاتيح من متغيرات البيئة في Netlify
        const GOOGLE_KEY = process.env.GOOGLE_API_KEY;
        const GROQ_KEY = process.env.GROQ_API_KEY;
        const OPENAI_KEY = process.env.OPENAI_API_KEY;
        const REPLICATE_KEY = process.env.REPLICATE_API_TOKEN;
        const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;

        let responseData = "";

        // ==========================================
        // مسار توليد الصور (DALL-E 3)
        // ==========================================
        if (message.startsWith('/image ')) {
            if (!OPENAI_KEY) throw new Error("Missing_OpenAI");
            const promptText = message.replace('/image ', '');
            const data = await fetchWithTimeout('https://api.openai.com/v1/images/generations', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
                body: JSON.stringify({ model: "dall-e-3", prompt: promptText, n: 1, size: "1024x1024" })
            });
            responseData = `![صورة مولدة](${data.data[0].url})`;
            return { statusCode: 200, headers, body: JSON.stringify({ reply: responseData }) };
        }

        // ==========================================
        // مسار فحص حالة الفيديو (Webhook Polling)
        // ==========================================
        if (message.startsWith('/check_video ')) {
            const videoId = message.replace('/check_video ', '');
            const checkRes = await fetch(`https://api.replicate.com/v1/predictions/${videoId}`, {
                headers: { 'Authorization': `Token ${REPLICATE_KEY}` }
            });
            const checkData = await checkRes.json();
            
            if (checkData.status === 'succeeded') {
                let finalUrl = Array.isArray(checkData.output) ? checkData.output[0] : checkData.output;
                responseData = `🎥 **الفيديو جاهز:**<br><video src="${finalUrl}" controls style="max-width:100%; border-radius:10px;"></video>`;
            } else if (checkData.status === 'failed') {
                throw new Error("فشل الرندرة في Replicate.");
            } else {
                responseData = "pending"; 
            }
            return { statusCode: 200, headers, body: JSON.stringify({ reply: responseData }) };
        }

        // ==========================================
        // مسار بدء توليد الفيديو (Replicate)
        // ==========================================
        if (message.startsWith('/video ')) {
            if (!REPLICATE_KEY) throw new Error("Missing_Replicate");
            const promptText = message.replace('/video ', '');
            
            const initResponse = await fetch('https://api.replicate.com/v1/models/stability-ai/stable-video-diffusion/predictions', {
                method: 'POST',
                headers: { 'Authorization': `Token ${REPLICATE_KEY}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ input: { prompt: promptText } })
            });

            if (!initResponse.ok) throw new Error("فشل بدء توليد الفيديو في خوادم Replicate.");
            const prediction = await initResponse.json();

            let videoUrl = null;
            let attempts = 0;
            // محاولة انتظار سريعة لـ 6 ثوانٍ فقط (تجنب قطع Netlify)
            while (attempts < 3) {
                await new Promise(r => setTimeout(r, 2000)); 
                let checkRes = await fetch(prediction.urls.get, { headers: { 'Authorization': `Token ${REPLICATE_KEY}` } });
                let checkData = await checkRes.json();
                if (checkData.status === 'succeeded') { videoUrl = checkData.output; break; }
                else if (checkData.status === 'failed') throw new Error("فشل الرندرة.");
                attempts++;
            }

            if (videoUrl) {
                let finalUrl = Array.isArray(videoUrl) ? videoUrl[0] : videoUrl;
                responseData = `🎥 **تم التوليد:**<br><video src="${finalUrl}" controls style="max-width:100%;"></video>`;
            } else {
                responseData = `<div class="system-note">⏳ جاري معالجة الفيديو في الخوادم اللامركزية...<br><button class="vid-check-btn" onclick="checkVideoStatus('${prediction.id}', this)">🔄 تحقق من النتيجة الآن</button></div>`;
            }
            return { statusCode: 200, headers, body: JSON.stringify({ reply: responseData }) };
        }

        // ==========================================
        // المسار الأساسي: النصوص والرؤية (Vision)
        // ==========================================
        const actualModel = AI_MODELS[model];
        if (!actualModel) throw new Error('النموذج غير مدعوم.');

        try {
            if (model.startsWith('g_')) {
                if (!GOOGLE_KEY) throw new Error("Missing_Google");

                let geminiHistory = history.map(m => ({ role: m.role === 'ai' ? 'model' : 'user', parts: [{ text: moderate(m.content) }] }));
                let currentParts = [{ text: message }];
                if (imageBase64) {
                    const base64Data = imageBase64.split(',')[1];
                    currentParts.push({ inlineData: { data: base64Data, mimeType: "image/jpeg" } });
                }
                geminiHistory.push({ role: 'user', parts: currentParts });

                const url = `https://generativelanguage.googleapis.com/v1beta/models/${actualModel}:generateContent?key=${GOOGLE_KEY}`;
                const data = await fetchWithTimeout(url, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ contents: geminiHistory })
                });
                responseData = data.candidates[0].content.parts[0].text;
            } 
            else {
                if (!GROQ_KEY) throw new Error("Missing_Groq");

                let groqHistory = history.map(m => ({ role: m.role === 'ai' ? 'assistant' : 'user', content: moderate(m.content) }));
                groqHistory.push({ role: "user", content: message + (imageBase64 ? " [مرفق صورة - النموذج يدعم نصوص فقط]" : "") });

                const url = 'https://api.groq.com/openai/v1/chat/completions';
                const data = await fetchWithTimeout(url, {
                    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_KEY}` },
                    body: JSON.stringify({ model: actualModel, messages: groqHistory })
                });
                responseData = data.choices[0].message.content;
            }
        } catch (primaryError) {
            console.error("Primary Failed:", primaryError.message);
            
            // ==========================================
            // نظام الـ Fallback الدوار
            // ==========================================
            if (!OPENROUTER_KEY) throw new Error("Missing_OpenRouter");

            let fallbackSuccess = false;
            let openRouterHistory = history.map(m => ({ role: m.role === 'ai' ? 'assistant' : 'user', content: moderate(m.content) }));
            openRouterHistory.push({ role: "user", content: message });

            for (let fallbackModel of FALLBACK_MODELS) {
                try {
                    const data = await fetchWithTimeout('https://openrouter.ai/api/v1/chat/completions', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENROUTER_KEY}` },
                        body: JSON.stringify({ model: fallbackModel, messages: openRouterHistory })
                    });
                    responseData = `*(رد احتياطي عبر: ${fallbackModel})*\n\n` + data.choices[0].message.content;
                    fallbackSuccess = true;
                    break; 
                } catch (e) { continue; }
            }
            if (!fallbackSuccess) throw new Error("جميع خوادم الذكاء الاصطناعي مشغولة حالياً.");
        }

        const safeResponse = moderate(responseData);
        return { statusCode: 200, headers, body: JSON.stringify({ reply: safeResponse }) };

    } catch (error) {
        let userMsg = "حدث خطأ غير متوقع.";
        if (error.message.includes("Missing_Google")) userMsg = "خدمة Google غير مفعلة. تأكد من إضافة GOOGLE_API_KEY في إعدادات Netlify.";
        else if (error.message.includes("Missing_Groq")) userMsg = "خدمة OpenAI/Meta غير مفعلة. تأكد من إضافة GROQ_API_KEY في إعدادات Netlify.";
        else if (error.message.includes("Missing_OpenAI")) userMsg = "توليد الصور معطل. أضف OPENAI_API_KEY في Netlify.";
        else if (error.message.includes("Missing_Replicate")) userMsg = "توليد الفيديو معطل. أضف REPLICATE_API_TOKEN في Netlify.";
        else if (error.message.includes("Missing_OpenRouter")) userMsg = "خوادم الطوارئ معطلة. أضف OPENROUTER_API_KEY في Netlify.";
        else if (error.name === 'AbortError' || error.message.includes("timeout")) userMsg = "الخادم استغرق وقتاً طويلاً. يرجى المحاولة مرة أخرى.";
        else userMsg = error.message;

        return { statusCode: 500, headers, body: JSON.stringify({ reply: `⚠️ عذراً: ${userMsg}` }) };
    }
};
