/**
 * Ornella Enseña - Cloudflare Worker
 * Maneja las llamadas a la API de Gemini de forma segura.
 * La GEMINI_API_KEY vive como Secret en Cloudflare, nunca en el código.
 */

export default {
    async fetch(request, env) {

        // --- CORS: manejar preflight OPTIONS ---
        if (request.method === 'OPTIONS') {
            return new Response(null, {
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'POST, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type, X-App-Token',
                }
            });
        }

        const url = new URL(request.url);

        // Solo procesar /api/chat
        if (url.pathname !== '/api/chat') {
            return new Response('Not Found', { status: 404 });
        }

        // --- 🔒 Validar token de acceso ---
        const token = request.headers.get('X-App-Token');
        if (token !== 'oe-ornella-2024') {
            return new Response(JSON.stringify({ error: 'Unauthorized' }), {
                status: 401,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                }
            });
        }

        // --- Procesar la solicitud de chat ---
        try {
            const { prompt } = await request.json();

            if (!prompt) {
                return new Response(JSON.stringify({ error: 'Prompt requerido' }), {
                    status: 400,
                    headers: {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*'
                    }
                });
            }

            if (!env.GEMINI_API_KEY) {
                return new Response(JSON.stringify({ error: 'Falta configurar la variable GEMINI_API_KEY en Cloudflare' }), {
                    status: 500,
                    headers: {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*'
                    }
                });
            }

            // Llamada a la API de Gemini (la key vive como Secret en Cloudflare)
            const geminiResponse = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${env.GEMINI_API_KEY}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: prompt }] }],
                        generationConfig: {
                            temperature: 0.7,
                            maxOutputTokens: 2048,
                        }
                    })
                }
            );

            if (!geminiResponse.ok) {
                const errData = await geminiResponse.json();
                throw new Error(errData.error?.message || `API error ${geminiResponse.status}`);
            }

            const data = await geminiResponse.json();
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text || 'Sin respuesta disponible.';

            return new Response(JSON.stringify({ text }), {
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                }
            });

        } catch (error) {
            console.error('Worker error:', error.message);
            return new Response(JSON.stringify({ error: error.message }), {
                status: 500,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                }
            });
        }
    }
};
