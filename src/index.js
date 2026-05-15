/**
 * Ornella Enseña - Cloudflare Worker
 * Maneja las llamadas a la API de Gemini de forma segura.
 * La GEMINI_API_KEY vive como Secret en Cloudflare, nunca en el código.
 */

import { Buffer } from 'node:buffer';

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
            const { prompt, files = [] } = await request.json();

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

            let parts = [{ text: prompt }];

            // Func helper para mime types soportados por Gemini inlineData
            function getMimeType(filename) {
                const ext = filename.split('.').pop().toLowerCase();
                const types = {
                    'pdf': 'application/pdf',
                    'png': 'image/png',
                    'jpg': 'image/jpeg',
                    'jpeg': 'image/jpeg',
                    'webp': 'image/webp',
                    'txt': 'text/plain',
                    'mp3': 'audio/mp3'
                };
                return types[ext] || null;
            }

            // Procesar hasta 5 archivos como máximo para no exceder memoria del Worker
            const filesToProcess = files.slice(0, 5);

            for (const file of filesToProcess) {
                const mimeType = getMimeType(file.nombre_archivo);
                if (!mimeType) continue; // Si no es compatible (ej. docx), lo ignoramos

                try {
                    const fileRes = await fetch(file.url_archivo);
                    if (!fileRes.ok) continue;

                    if (mimeType === 'text/plain') {
                        const textContent = await fileRes.text();
                        parts.push({ text: `\n--- Archivo Adjunto: ${file.nombre_archivo} ---\n${textContent}\n--- Fin de archivo ---` });
                    } else {
                        const arrayBuffer = await fileRes.arrayBuffer();
                        const base64Data = Buffer.from(arrayBuffer).toString('base64');

                        parts.push({
                            inlineData: {
                                mimeType: mimeType,
                                data: base64Data
                            }
                        });
                    }
                } catch (e) {
                    console.error('Error fetching file context:', e);
                }
            }

            // Llamada a la API de Gemini (la key vive como Secret en Cloudflare)
            const geminiResponse = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${env.GEMINI_API_KEY}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: parts }],
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
