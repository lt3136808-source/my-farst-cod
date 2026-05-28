// =========================================================================
// Nexus AI PRO Backend - v100 Cosmic (Dynamic Envs, Media, Moderation, Fallbacks)
// المسار: api/chat-api.js 
// =========================================================================

// استدعاء مكتبة dotenv في بيئة التطوير المحلية لجلب المفاتيح من ملف .env
try {
    require('dotenv').config();
} catch (e) {
    // تجاهل الخطأ في بيئة Vercel لأن المتغيرات تُحقن من لوحة التحكم مباشرة
}

const TIMEOUT_MS = 15000; // وقت الانتظار الأقصى: 15 ثانية
const ALLOWED_ORIGIN = '*'; // السماح لملف index.html بالتواصل مع هذا الـ API من أي مكان

// قائمة النماذج المدعومة
const AI_MODELS = {
    'g_15_flash': 'gemini-1.5-flash', 
    'g_15_pro': 'gemini-1.5-pro',
    'g_25_flash': 'gemini-2.5-flash', 
    'g_25_pro': 'gemini-2.5-pro',
    'o_4o': 'llama-3.3-70b-specdec', 
    'o_mini': 'llama-3.1-8b-instant',
    'github_4o': 'gpt-4o'
};

// النماذج الاحتياطية (Fallbacks) عبر OpenRouter
const FALLBACK_MODELS = [
    'google/gemini-pro',
    'meta-llama/llama-3-70b-instruct'
];

// دالة فلترة الكلمات المسيئة
function moderate(text) {
    if (!text) return "";
    const badWords = ['شتم', 'كلمة_مسيئة_هنا']; // أضف الكلمات الممنوعة هنا
    let cleanText = text;
    badWords.forEach(word => {
        const regex = new RegExp(word, 'gi');
        cleanText = cleanText.replace(regex, '***');
    });
    return cleanText;
}

// دالة لجلب البيانات مع حد أقصى للوقت (Timeout)
const fetchWithTimeout = async (url, options) => {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(id);
        if (!response.ok) { 
            let err = await response.text(); 
            throw new Error(err); 
        }
        return await response.json();
    } catch (error) {
        clearTimeout(id);
        throw error;
    }
};

// الدالة الرئيسية التي يتم تشغيلها عند وصول طلب من index.html
exports.handler = async (event) => {
    // إعداد ترويسات الأمان (CORS) للسماح لملف HTML بالتواصل
    const headers = { 
        'Access-Control-Allow-Origin': ALLOWED_ORIGIN, 
        'Access-Control-Allow-Methods': 'OPTIONS, POST',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Content-Type': 'application/json' 
    };
    
    // الرد على طلبات الفحص المسبق (Preflight)
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }
    
    // التأكد من أن الطلب من نوع POST
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers, body: JSON.stringify({ reply: '⚠️ طريقة الطلب غير مسموحة.' }) };
    }

    try {
        // تحليل البيانات القادمة من index.html
        let bodyParsed;
        try { 
            bodyParsed = JSON.parse(event.body); 
        } catch (e) { 
            throw new Error("صيغة البيانات (JSON) المرسلة من الواجهة الأمامية غير صالحة"); 
        }

        let { model, message, history, imageBase64 } = bodyParsed;

        if (imageBase64 && imageBase64.length > 2.5 * 1024 * 1024) {
            throw new Error("الصورة كبيرة جداً، تجاوزت الحد الأقصى (2.5MB).");
        }
        
        message = moderate(message || "");
        if (!Array.isArray(history)) history = [];

        // ==========================================
        // سحب المفاتيح تلقائياً من ملف .env أو بيئة Vercel
        // ==========================================
        const GOOGLE_KEY = process.env.GEMINI_API_KEY; 
        const GROQ_KEY = process.env.GROQ_API_KEY;
        const GITHUB_KEY = process.env.GITHUB_TOKEN; 
        const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
        const OPENAI_KEY = process.env.OPENAI_API_KEY;
        const REPLICATE_KEY = process.env.REPLICATE_API_TOKEN;

        let responseData = "";

        // ==========================================
        // تحديد مسار المعالجة بناءً على النموذج المختار
        // ==========================================
        const actualModel = AI_MODELS[model];
        if (!actualModel && !message.startsWith('/')) {
            throw new Error('النموذج المختار غير مدعوم في المصفوفة الحالية.');
        }

        try {
            // ---> مسار Google Gemini <---
            if (model && model.startsWith('g_')) {
                if (!GOOGLE_KEY) throw new Error("Missing_Google");

                let geminiHistory = history.map(m => ({ 
                    role: m.role === 'ai' ? 'model' : 'user', 
                    parts: [{ text: moderate(m.content) }] 
                }));
                
                let currentParts = [{ text: message }];
                if (imageBase64) {
                    const base64Data = imageBase64.split(',')[1];
                    currentParts.push({ inlineData: { data: base64Data, mimeType: "image/jpeg" } });
                }
                geminiHistory.push({ role: 'user', parts: currentParts });

                const url = `https://generativelanguage.googleapis.com/v1beta/models/${actualModel}:generateContent?key=${GOOGLE_KEY}`;
                const data = await fetchWithTimeout(url, {
                    method: 'POST', 
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ contents: geminiHistory })
                });
                
                if (!data.candidates || !data.candidates[0].content) throw new Error("Google API لم تُرجع استجابة.");
                responseData = data.candidates[0].content.parts[0].text;
            } 
            
            // ---> مسار GitHub Models <---
            else if (model === 'github_4o') {
                if (!GITHUB_KEY) throw new Error("Missing_GitHub");

                let githubHistory = history.map(m => ({ role: m.role === 'ai' ? 'assistant' : 'user', content: moderate(m.content) }));
                githubHistory.push({ role: "user", content: message });

                const url = 'https://models.inference.ai.azure.com/chat/completions';
                const data = await fetchWithTimeout(url, {
                    method: 'POST', 
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GITHUB_KEY}` },
                    body: JSON.stringify({ model: actualModel, messages: githubHistory, temperature: 0.7 })
                });
                responseData = data.choices[0].message.content;
            }

            // ---> مسار Groq السريع <---
            else if (model && !model.startsWith('g_') && model !== 'github_4o') {
                if (!GROQ_KEY) throw new Error("Missing_Groq");

                let groqHistory = history.map(m => ({ role: m.role === 'ai' ? 'assistant' : 'user', content: moderate(m.content) }));
                groqHistory.push({ role: "user", content: message });

                const url = 'https://api.groq.com/openai/v1/chat/completions';
                const data = await fetchWithTimeout(url, {
                    method: 'POST', 
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_KEY}` },
                    body: JSON.stringify({ model: actualModel, messages: groqHistory })
                });
                responseData = data.choices[0].message.content;
            }

        } catch (primaryError) {
            console.error("الخادم الأساسي فشل، جاري تحويل المسار:", primaryError.message);
            
            // ==========================================
            // نظام الطوارئ عبر OpenRouter
            // ==========================================
            if (!OPENROUTER_KEY) throw new Error("Missing_OpenRouter");

            let fallbackSuccess = false;
            let openRouterHistory = history.map(m => ({ role: m.role === 'ai' ? 'assistant' : 'user', content: moderate(m.content) }));
            openRouterHistory.push({ role: "user", content: message });

            for (let fallbackModel of FALLBACK_MODELS) {
                try {
                    const data = await fetchWithTimeout('https://openrouter.ai/api/v1/chat/completions', {
                        method: 'POST',
                        headers: { 
                            'Content-Type': 'application/json', 
                            'Authorization': `Bearer ${OPENROUTER_KEY}`,
                            'HTTP-Referer': 'https://nexus-ai.pro',
                            'X-Title': 'Nexus V100'
                        },
                        body: JSON.stringify({ model: fallbackModel, messages: openRouterHistory })
                    });
                    responseData = `*(تم الإنقاذ عبر خادم الطوارئ: ${fallbackModel})*\n\n` + data.choices[0].message.content;
                    fallbackSuccess = true;
                    break; 
                } catch (e) { 
                    console.error(`Fallback ${fallbackModel} failed:`, e.message); 
                }
            }
            if (!fallbackSuccess) throw new Error("انهيار شامل: جميع الخوادم لا تستجيب حالياً.");
        }

        // إرجاع النتيجة النهائية إلى index.html
        return { statusCode: 200, headers, body: JSON.stringify({ reply: moderate(responseData) }) };

    } catch (error) {
        // إدارة الأخطاء وإرسالها للواجهة الأمامية
        let userMsg = "حدث خطأ غير متوقع في الخادم.";
        
        if (error.message.includes("Missing_Google")) userMsg = "مفتاح Google (Gemini) مفقود في ملف .env";
        else if (error.message.includes("Missing_Groq")) userMsg = "مفتاح Groq مفقود في ملف .env";
        else if (error.message.includes("Missing_GitHub")) userMsg = "مفتاح GitHub مفقود في ملف .env";
        else if (error.message.includes("Missing_OpenRouter")) userMsg = "مفتاح OpenRouter (للطوارئ) مفقود في ملف .env";
        else if (error.name === 'AbortError') userMsg = "انتهى وقت الاتصال (Timeout)، جرب مرة أخرى.";
        else userMsg = error.message;

        return { statusCode: 500, headers, body: JSON.stringify({ reply: `⚠️ خطأ: ${userMsg}` }) };
    }
};
