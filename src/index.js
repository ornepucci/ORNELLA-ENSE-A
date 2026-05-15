export default {
    async fetch(request, env) {

        // --- CORS ---
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

        // --- 🔒 Validar token de acceso ---
        const token = request.headers.get('X-App-Token');
        if (token !== 'oe-ornella-2024') {
            return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Access-Control-Allow-Origin': '*' } });
        }

        // --- ENDPOINT: Upload File to Gemini ---
        if (url.pathname === '/api/upload-file' && request.method === 'POST') {
            try {
                const { fileUrl, mimeType } = await request.json();
                if (!fileUrl) throw new Error("fileUrl requerido");

                // 1. Descargar archivo desde Supabase
                const fileRes = await fetch(fileUrl);
                if (!fileRes.ok) throw new Error("No se pudo descargar el archivo de Supabase");
                const arrayBuffer = await fileRes.arrayBuffer();

                // 2. Subir a Gemini File API
                const uploadRes = await fetch(`https://generativelanguage.googleapis.com/upload/v1beta/files?uploadType=media&key=${env.GEMINI_API_KEY}`, {
                    method: 'POST',
                    headers: { 'Content-Type': mimeType || fileRes.headers.get('content-type') || 'application/octet-stream' },
                    body: arrayBuffer
                });

                const uploadData = await uploadRes.json();
                if (!uploadRes.ok) throw new Error(uploadData.error?.message || "Error al subir a Gemini");

                return new Response(JSON.stringify({ gemini_file_uri: uploadData.file.uri }), {
                    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
                });

            } catch (error) {
                console.error("Upload error:", error);
                return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { 'Access-Control-Allow-Origin': '*' } });
            }
        }

        // --- ENDPOINT: Chat ---
        if (url.pathname === '/api/chat' && request.method === 'POST') {
            try {
                const { prompt, files = [] } = await request.json();
                if (!prompt) throw new Error("Prompt requerido");

                if (!env.GEMINI_API_KEY) {
                    return new Response(JSON.stringify({ error: 'Falta configurar GEMINI_API_KEY en Cloudflare' }), { status: 500, headers: { 'Access-Control-Allow-Origin': '*' } });
                }

                // Func helper para mime types
                function getMimeType(filename) {
                    if (!filename) return "application/pdf";
                    const ext = filename.split('.').pop().toLowerCase();
                    const types = {
                        'pdf': 'application/pdf',
                        'png': 'image/png',
                        'jpg': 'image/jpeg',
                        'jpeg': 'image/jpeg',
                        'webp': 'image/webp',
                        'txt': 'text/plain',
                        'csv': 'text/csv',
                        'md': 'text/markdown',
                        'mp3': 'audio/mp3',
                        'mp4': 'video/mp4',
                        'doc': 'application/msword',
                        'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                        'xls': 'application/vnd.ms-excel',
                        'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                        'ppt': 'application/vnd.ms-powerpoint',
                        'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
                    };
                    return types[ext] || 'application/octet-stream';
                }

                let parts = [];
                
                // Agregar archivos usando la File API nativa de Google (gemini_file_uri)
                for (const file of files) {
                    if (file.gemini_file_uri) {
                        parts.push({
                            fileData: {
                                fileUri: file.gemini_file_uri,
                                mimeType: getMimeType(file.nombre_archivo)
                            }
                        });
                    }
                }
                
                // Agregar el texto de la pregunta al final
                parts.push({ text: prompt });

                // Llamada a la API de Gemini
                const geminiResponse = await fetch(
                    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${env.GEMINI_API_KEY}`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            contents: [{ parts: parts }],
                            generationConfig: { temperature: 0.7, maxOutputTokens: 2048 }
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
                    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
                });

            } catch (error) {
                console.error('Worker error:', error.message);
                return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { 'Access-Control-Allow-Origin': '*' } });
            }
        }

        return new Response('Not Found', { status: 404 });
    }
};
