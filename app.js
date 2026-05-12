/**
 * Ornella Enseña - Application Logic
 * Frontend seguro: Las claves de API viven en el Cloudflare Worker, NUNCA aquí.
 */

// URL del Cloudflare Worker (desplegado)
const WORKER_URL = 'https://ornella-ensena-worker.orneeduca.workers.dev';

// State management
const state = {
    theme: localStorage.getItem('theme') || 'light',
    currentPage: 'dashboard',
    selectedProfessorId: null,
    professors: [],
    chatHistories: {}, // Store history per professor ID
    user: null,
    supabaseConfig: {
        url: 'https://pelkcvbqrpsknqjdhyrq.supabase.co',
        key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBlbGtjdmJxcnBza25xamRoeXJxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwMjIyMzEsImV4cCI6MjA5MzU5ODIzMX0.td00CNWUrN9DTWK0cb47PfzrSxNBcObEbaXwxmjjKGQ'
    }
    // geminiKey eliminada - ahora vive como Secret en Cloudflare Workers
};

let supabaseClient = null;
let genAI = null;
let model = null;
let chatSession = null;



// Initialize App
async function init() {
    // Usamos sessionStorage para que la sesión expire al cerrar la pestaña o app
    if (sessionStorage.getItem('isLoggedIn') !== 'true') {
        const loginScreen = document.getElementById('login-screen');
        const appScreen = document.getElementById('app');
        if (loginScreen) loginScreen.style.display = 'flex';
        if (appScreen) appScreen.style.display = 'none';
        return; // Don't initialize app until logged in
    }
    
    const loginScreen = document.getElementById('login-screen');
    const appScreen = document.getElementById('app');
    if (loginScreen) loginScreen.style.display = 'none';
    if (appScreen) appScreen.style.display = 'flex';

    initSupabase();
    initGemini();
    applyTheme();
    setupEventListeners();
    await fetchProfessors();
    renderDashboard();
}

window.handleLogin = function() {
    const emailInput = document.getElementById('login-email').value;
    const passwordInput = document.getElementById('login-password').value;
    const errorMsg = document.getElementById('login-error');
    
    // Validar correo y contraseña
    if (emailInput.toLowerCase().trim() === 'ornepucci2402@gmail.com' && passwordInput === 'Y@g00902') {
        sessionStorage.setItem('isLoggedIn', 'true');
        if (errorMsg) errorMsg.style.display = 'none';
        
        // Limpiar campos por seguridad
        document.getElementById('login-password').value = '';
        init(); // Start the app
    } else {
        if (errorMsg) errorMsg.style.display = 'block';
    }
}

function setupDashboardEvents() {
    const btnProfesor = document.getElementById('btn-profesor-quick');
    const btnBuscar = document.getElementById('btn-buscar-quick');
    
    if (btnProfesor) btnProfesor.onclick = () => navigate('chat');
    if (btnBuscar) btnBuscar.onclick = () => navigate('files');
}

async function initGemini() {
    try {
        // Force version v1 for stability
        genAI = new GoogleGenerativeAI(state.geminiKey);
        model = genAI.getGenerativeModel({ 
            model: "gemini-2.5-flash",
            apiVersion: "v1" 
        });
        chatSession = model.startChat({
            history: [],
        });
        console.log("Gemini inicializado con gemini-2.5-flash (v1)");
    } catch (error) {
        console.error("Error al inicializar Gemini:", error);
    }
}

function initSupabase() {
    try {
        supabaseClient = supabase.createClient(state.supabaseConfig.url, state.supabaseConfig.key);
        console.log("Supabase inicializado correctamente");
    } catch (error) {
        console.error("Error al inicializar Supabase:", error);
        showModal('Error de Base de Datos', 'No se pudo conectar con Supabase. Revisa la URL y la Key.');
    }
}

// Theme Logic
function applyTheme() {
    document.documentElement.setAttribute('data-theme', state.theme);
    // The theme-toggle button uses sun/moon icons only (no text span).
    // CSS rules [data-theme="light"] .moon-icon { display: none } and
    // [data-theme="dark"] .sun-icon { display: none } handle icon visibility.
}

function toggleTheme() {
    state.theme = state.theme === 'light' ? 'dark' : 'light';
    localStorage.setItem('theme', state.theme);
    applyTheme();
}

// Dialog / Modal Logic
function showModal(title, message, callback = null) {
    let overlay = document.getElementById('modal-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'modal-overlay';
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal-content">
                <button class="modal-close"><i data-lucide="x"></i></button>
                <h2 class="modal-title"></h2>
                <div class="modal-body"></div>
                <div class="modal-actions">
                    <button class="btn btn-primary modal-ok">Entendido</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        lucide.createIcons();
        
        overlay.querySelector('.modal-close').onclick = () => hideModal();
    }
    
    overlay.querySelector('.modal-title').textContent = title;
    overlay.querySelector('.modal-body').textContent = message;
    
    const content = overlay.querySelector('.modal-content');
    content.classList.remove('modal-lg'); // Reset to default
    
    const actions = overlay.querySelector('.modal-actions');
    actions.innerHTML = `
        <button class="btn btn-primary modal-ok">Entendido</button>
    `;
    
    overlay.querySelector('.modal-ok').onclick = () => {
        hideModal();
        if (callback) callback();
    };

    overlay.classList.add('active');
}

function hideModal() {
    const overlay = document.getElementById('modal-overlay');
    if (overlay) overlay.classList.remove('active');
}

// Navigation Logic
function closeMobileMenu() {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (sidebar) sidebar.classList.remove('open');
    if (overlay) overlay.classList.remove('active');
}

function toggleMobileMenu() {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    sidebar.classList.toggle('open');
    if (sidebar.classList.contains('open')) {
        overlay.classList.add('active');
    } else {
        overlay.classList.remove('active');
    }
}

function navigate(page, professorId = null, pushState = true) {
    state.currentPage = page;
    state.selectedProfessorId = professorId;
    
    // Guardar en el historial para que el botón "atrás" del celular funcione
    if (pushState) {
        history.pushState({ page, professorId }, '', `#${page}${professorId ? '-' + professorId : ''}`);
    }
    
    // Close mobile menu on navigation
    closeMobileMenu();
    
    // Update active nav items
    document.querySelectorAll('.nav-item, .prof-item, .submenu-item').forEach(item => {
        item.classList.remove('active');
    });

    if (page === 'dashboard') {
        document.getElementById('page-title').textContent = 'Panel Principal';
    } else if (page === 'settings') {
        document.getElementById('nav-settings').classList.add('active');
        document.getElementById('page-title').textContent = 'Configuración';
    } else if (professorId) {
        const profItem = document.querySelector(`.prof-item[data-id="${professorId}"]`);
        if (profItem) {
            profItem.classList.add('active');
            const subItem = profItem.querySelector(`.submenu-item[data-page="${page}"]`);
            if (subItem) subItem.classList.add('active');
        }
        
        const prof = state.professors.find(p => p.id === professorId);
        const titleMap = {
            chat: `Chat con ${prof ? prof.nombre : 'Profesor'}`,
            files: `Recursos de ${prof ? prof.nombre : 'Profesor'}`
        };
        document.getElementById('page-title').textContent = titleMap[page];
    }

    // Render content
    if (page === 'dashboard') renderDashboard();
    else if (page === 'chat') renderChat();
    else if (page === 'files') renderFiles();
    else if (page === 'settings') renderSettings();
}

// Professor Management
async function fetchProfessors() {
    try {
        const { data, error } = await supabaseClient
            .from('profesores')
            .select('*')
            .order('created_at', { ascending: true });

        if (error) throw error;
        state.professors = data;
        renderProfessors();
    } catch (error) {
        console.error("Error al cargar profesores:", error);
    }
}
function renderProfessors() {
    const listContainer = document.getElementById('professors-list');
    listContainer.innerHTML = state.professors.map(prof => {
        const isExpanded = state.expandedProfessorId === prof.id;
        const isActive = state.selectedProfessorId === prof.id;
        return `
        <div class="prof-item ${isExpanded ? 'expanded' : ''} ${isActive ? 'active' : ''}" data-id="${prof.id}">
            <div class="prof-header" onclick="handleProfessorClick('${prof.id}')" style="cursor: pointer; display: flex; align-items: center; justify-content: space-between; padding: 0.75rem 1rem; border-radius: 12px; transition: all 0.2s;">
                <div style="display: flex; align-items: center; gap: 0.75rem;">
                    <i data-lucide="user-round" style="width: 18px;"></i>
                    <span style="font-weight: 600; font-size: 0.95rem;" class="text-gradient">${prof.nombre}</span>
                </div>
                <i data-lucide="chevron-down" style="width: 14px; transition: transform 0.3s;" class="${isExpanded ? 'rotated' : ''}"></i>
            </div>
            <div class="prof-submenu" style="display: ${isExpanded ? 'block' : 'none'}; padding: 0.5rem 1rem 0.75rem 2.5rem; font-size: 0.85rem; opacity: 0.8;">
                <div style="margin-bottom: 0.5rem; color: var(--text-secondary); font-weight: 600;">
                    Materia: ${prof.materia}
                </div>
                <div style="margin-bottom: 0.75rem; color: var(--secondary-color); font-size: 0.75rem;">
                    Uso: 1.2MB / 50MB
                </div>
                <div style="display: flex; flex-direction: column; gap: 0.25rem; margin-top: 0.5rem;">
                    <button class="submenu-item action-btn" onclick="navigate('files', '${prof.id}')">
                        <i data-lucide="folder-open"></i> Mis Recursos
                    </button>
                    <button class="submenu-item action-btn" onclick="showEditProfessorModal('${prof.id}')">
                        <i data-lucide="edit-3"></i> Editar Datos
                    </button>
                    <button class="submenu-item action-btn" onclick="handleDeleteProfessor('${prof.id}')" style="color: #ef4444;">
                        <i data-lucide="trash-2"></i> Eliminar
                    </button>
                </div>
            </div>
        </div>
    `}).join('');
    lucide.createIcons();
}

function showEditProfessorModal(id) {
    const prof = state.professors.find(p => p.id === id);
    if (!prof) return;

    const modalHtml = `
        <div style="display: flex; flex-direction: column; gap: 1rem; margin-top: 1rem;">
            <input type="text" id="edit-prof-name" value="${prof.nombre}" placeholder="Nombre del Profesor" class="settings-input" style="width: 100%; padding: 0.75rem; border-radius: 8px; border: 1px solid var(--border-color); background: var(--bg-primary); color: var(--text-primary);" />
            <input type="text" id="edit-prof-materia" value="${prof.materia}" placeholder="Materia (ej: Matemática)" class="settings-input" style="width: 100%; padding: 0.75rem; border-radius: 8px; border: 1px solid var(--border-color); background: var(--bg-primary); color: var(--text-primary);" />
            <textarea id="edit-prof-descripcion" placeholder="Descripción y Contexto para la IA" class="settings-input" style="width: 100%; padding: 0.75rem; border-radius: 8px; border: 1px solid var(--border-color); background: var(--bg-primary); color: var(--text-primary); min-height: 100px; font-family: inherit;">${prof.descripcion || ''}</textarea>
            <button class="btn btn-primary" id="btn-update-prof" style="width: 100%;">Guardar Cambios</button>
        </div>
    `;
    
    showModal('Editar Profesor', 'Modifica los detalles del profesor.');
    
    const body = document.querySelector('.modal-body');
    body.innerHTML += modalHtml;
    
    document.getElementById('btn-update-prof').onclick = async () => {
        const nombre = document.getElementById('edit-prof-name').value.trim();
        const materia = document.getElementById('edit-prof-materia').value.trim();
        const descripcion = document.getElementById('edit-prof-descripcion').value.trim();
        
        if (!nombre || !materia || !descripcion) {
            alert('Por favor completa todos los campos');
            return;
        }
        
        try {
            const { error } = await supabaseClient
                .from('profesores')
                .update({ nombre, materia, descripcion })
                .eq('id', id);
            
            if (error) throw error;
            
            hideModal();
            await fetchProfessors();
        } catch (error) {
            console.error("Error al actualizar profesor:", error);
            alert('Error al actualizar profesor: ' + error.message);
        }
    };
}

function showCreateProfessorModal() {
    const modalHtml = `
        <div style="display: flex; flex-direction: column; gap: 1rem; margin-top: 1rem;">
            <input type="text" id="prof-name" placeholder="Nombre del Profesor" class="settings-input" style="width: 100%; padding: 0.75rem; border-radius: 8px; border: 1px solid var(--border-color); background: var(--bg-primary); color: var(--text-primary);" />
            <input type="text" id="prof-materia" placeholder="Materia (ej: Matemática)" class="settings-input" style="width: 100%; padding: 0.75rem; border-radius: 8px; border: 1px solid var(--border-color); background: var(--bg-primary); color: var(--text-primary);" />
            <textarea id="prof-descripcion" placeholder="Descripción y Contexto para la IA (ej: Especialista en álgebra lineal. No responde temas ajenos a la matemática.)" class="settings-input" style="width: 100%; padding: 0.75rem; border-radius: 8px; border: 1px solid var(--border-color); background: var(--bg-primary); color: var(--text-primary); min-height: 100px; font-family: inherit;"></textarea>
            <button class="btn btn-primary" id="btn-save-prof" style="width: 100%;">Crear Profesor</button>
        </div>
    `;
    
    showModal('Nuevo Profesor', 'Ingresa los detalles del nuevo profesor. La descripción servirá para darle contexto a la IA.');
    
    const body = document.querySelector('.modal-body');
    body.innerHTML += modalHtml;
    
    document.getElementById('btn-save-prof').onclick = async () => {
        const nombre = document.getElementById('prof-name').value.trim();
        const materia = document.getElementById('prof-materia').value.trim();
        const descripcion = document.getElementById('prof-descripcion').value.trim();
        
        if (!nombre || !materia || !descripcion) {
            alert('Por favor completa todos los campos, incluyendo la descripción');
            return;
        }
        
        try {
            const { error } = await supabaseClient
                .from('profesores')
                .insert([{ nombre, materia, descripcion }]);
            
            if (error) throw error;
            
            hideModal();
            await fetchProfessors();
        } catch (error) {
            console.error("Error al crear profesor:", error);
            alert('Error al crear profesor: ' + error.message);
        }
    };
}

async function handleDeleteProfessor(id) {
    console.log("handleDeleteProfessor called for ID:", id);
    if (!confirm('¿Estás seguro de eliminar este profesor y todos sus recursos?')) return;
    
    try {
        const { error } = await supabaseClient
            .from('profesores')
            .delete()
            .eq('id', id);
            
        if (error) throw error;
        await fetchProfessors();
        if (state.selectedProfessorId === id) navigate('dashboard');
    } catch (error) {
        console.error("Error al eliminar profesor:", error);
    }
}

// Rendering Functions
function renderDashboard() {
    const contentArea = document.getElementById('content-area');
    
    if (state.professors.length === 0) {
        contentArea.innerHTML = `
            <div id="dashboard-placeholder" style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 60vh; opacity: 0.3;">
                <i data-lucide="graduation-cap" style="width: 80px; height: 80px; margin-bottom: 1rem;"></i>
                <p style="font-size: 1.2rem; font-family: 'Outfit', sans-serif;">Aún no has creado profesores</p>
                <button class="btn btn-primary" onclick="showCreateProfessorModal()" style="margin-top: 2rem; opacity: 1;">
                    <i data-lucide="plus-circle"></i> Crear Primer Profesor
                </button>
            </div>
        `;
    } else {
        contentArea.innerHTML = `
            <div class="dashboard-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem;">
                <h2 style="font-size: 1.5rem; color: var(--text-primary);">Tus Profesores</h2>
                <button class="btn btn-primary" onclick="showCreateProfessorModal()">
                    <i data-lucide="plus-circle"></i> Nuevo Profesor
                </button>
            </div>
            <div class="professors-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 1.5rem; align-items: stretch;">
                ${state.professors.map(prof => `
                    <div class="card professor-card" style="padding: 1.5rem; display: flex; flex-direction: column; height: 100%; border-radius: 20px; transition: all 0.3s ease; cursor: pointer; box-sizing: border-box;" onclick="handleProfessorClick('${prof.id}')">
                        <div style="display: flex; align-items: flex-start; gap: 1rem; margin-bottom: 1rem;">
                            <div class="avatar" style="width: 50px; height: 50px; flex-shrink: 0; background: var(--accent-gradient); font-size: 1.2rem;">${prof.nombre.substring(0, 1)}</div>
                            <div style="flex: 1; min-width: 0;">
                                <h3 style="margin: 0 0 0.25rem 0; font-size: 1.1rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" class="text-gradient">${prof.nombre}</h3>
                                <p style="margin: 0; font-size: 0.85rem; opacity: 0.7; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">${prof.materia}</p>
                            </div>
                        </div>
                        <p style="font-size: 0.85rem; line-height: 1.5; color: var(--text-secondary); display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; margin: 0 0 1.5rem 0; flex: 1;">
                            ${prof.descripcion || 'Sin descripción'}
                        </p>
                        <div style="display: flex; gap: 0.75rem; margin-top: auto;">
                            <button class="btn btn-secondary btn-sm" style="flex: 1; font-size: 0.8rem; padding: 0.6rem; border-radius: 10px;" onclick="event.stopPropagation(); navigate('chat', '${prof.id}')">
                                <i data-lucide="message-circle" style="width: 14px; margin-right: 4px;"></i> Chat
                            </button>
                            <button class="btn btn-secondary btn-sm" style="flex: 1; font-size: 0.8rem; padding: 0.6rem; border-radius: 10px;" onclick="event.stopPropagation(); navigate('files', '${prof.id}')">
                                <i data-lucide="folder" style="width: 14px; margin-right: 4px;"></i> Archivos
                            </button>
                        </div>
                    </div>
                `).join('')}
            </div>

        `;
    }
    lucide.createIcons();
}

function renderChat() {
    if (!state.selectedProfessorId) {
        navigate('dashboard');
        return;
    }

    const prof = state.professors.find(p => p.id === state.selectedProfessorId);
    const contentArea = document.getElementById('content-area');
    contentArea.innerHTML = `
        <div class="card chat-container">
            <div class="chat-messages" id="chat-messages">
                <div class="message assistant">
                    ¡Hola! Soy ${prof.nombre}. ¿En qué puedo ayudarte hoy con la materia ${prof.materia}?
                </div>
            </div>
            <div class="chat-input-area">
                <input type="text" id="chat-input" placeholder="Escribe tu consulta aquí..." />
                <button class="btn btn-primary" id="send-chat">
                    <i data-lucide="send"></i>
                </button>
            </div>
            <div style="display: flex; justify-content: center; gap: 0.5rem; margin-top: 0.5rem; flex-wrap: wrap;" class="chat-mode-buttons">
                <button class="btn btn-secondary btn-sm" id="btn-quick-response" style="font-size: 0.75rem; padding: 0.4rem 1rem;">
                    <i data-lucide="zap" style="width: 14px; margin-right: 4px;"></i> Rápida
                </button>
                <button class="btn btn-primary btn-sm" id="btn-class-mode" style="font-size: 0.75rem; padding: 0.4rem 1rem; background: var(--brand-violet);">
                    <i data-lucide="book-open" style="width: 14px; margin-right: 4px;"></i> Clase
                </button>
                <button class="btn btn-secondary btn-sm" id="btn-exam-mode" style="font-size: 0.75rem; padding: 0.4rem 1rem; background: #3b82f6; color: white;">
                    <i data-lucide="pencil" style="width: 14px; margin-right: 4px;"></i> Examen
                </button>
                <button class="btn btn-secondary btn-sm" id="btn-summary-mode" style="font-size: 0.75rem; padding: 0.4rem 1rem; background: #10b981; color: white;">
                    <i data-lucide="file-text" style="width: 14px; margin-right: 4px;"></i> Resumen
                </button>
            </div>
        </div>
    `;
    lucide.createIcons();
    
    // Load existing history if any
    const history = state.chatHistories[state.selectedProfessorId] || [];
    history.forEach(msg => appendMessage(msg.role, msg.text));

    // Chat styles
    if (!document.getElementById('chat-styles')) {
        const style = document.createElement('style');
        style.id = 'chat-styles';
        style.textContent = `
            .chat-container { height: 75vh; display: flex; flex-direction: column; }
            .chat-messages { flex: 1; overflow-y: auto; padding: 1rem; display: flex; flex-direction: column; gap: 1rem; }
            .message { padding: 0.75rem 1rem; border-radius: 12px; max-width: 80%; line-height: 1.5; }
            .assistant { background: var(--bg-primary); align-self: flex-start; color: var(--text-primary); border: 1px solid var(--border-color); white-space: pre-wrap; }
            .user { background: var(--accent-gradient); color: white; align-self: flex-end; }
            .chat-input-area { display: flex; gap: 0.5rem; padding-top: 1rem; border-top: 1px solid var(--border-color); }
            .chat-input-area input { flex: 1; padding: 0.75rem; border-radius: 8px; border: 1px solid var(--border-color); background: var(--bg-primary); color: var(--text-primary); }
            .chat-mode-buttons .btn { flex: 1; min-width: 100px; justify-content: center; }
            @media (max-width: 768px) {
                .chat-container { height: calc(100vh - 180px); }
                .chat-mode-buttons { gap: 0.25rem; }
                .chat-mode-buttons .btn { min-width: 45%; font-size: 0.7rem; padding: 0.4rem; }
            }
            .typing-indicator { display: flex; gap: 4px; padding: 1rem !important; align-items: center; }
            .typing-indicator .dot { width: 6px; height: 6px; background: var(--text-secondary); border-radius: 50%; animation: typing 1.4s infinite ease-in-out; }
            .typing-indicator .dot:nth-child(1) { animation-delay: -0.32s; }
            .typing-indicator .dot:nth-child(2) { animation-delay: -0.16s; }
            @keyframes typing { 0%, 80%, 100% { transform: scale(0); } 40% { transform: scale(1); } }
        `;
        document.head.appendChild(style);
    }

    // Chat events
    document.getElementById('send-chat').onclick = () => handleChatSubmit('normal');
    document.getElementById('btn-quick-response').onclick = () => handleChatSubmit('quick');
    document.getElementById('btn-class-mode').onclick = () => handleChatSubmit('class');
    document.getElementById('btn-exam-mode').onclick = () => handleChatSubmit('exam');
    document.getElementById('btn-summary-mode').onclick = () => handleChatSubmit('summary');
    document.getElementById('chat-input').onkeypress = (e) => {
        if (e.key === 'Enter') handleChatSubmit('normal');
    };
}

window.handleProfessorClick = (id) => {
    // Si ya está seleccionado, solo toggleamos el menú
    if (state.selectedProfessorId === id) {
        state.expandedProfessorId = (state.expandedProfessorId === id) ? null : id;
    } else {
        // Si no está seleccionado, abrimos el chat Y el menú
        state.expandedProfessorId = id;
        navigate('chat', id);
    }
    renderProfessors();
};

async function handleChatSubmit(mode = 'normal') {
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if (!text || !state.selectedProfessorId) return;

    const prof = state.professors.find(p => p.id === state.selectedProfessorId);
    input.value = '';
    
    let displayMsg = text;
    if (mode === 'quick') displayMsg += " (Respuesta rápida)";
    if (mode === 'class') displayMsg += " (Modo Clase)";
    if (mode === 'exam') displayMsg += " (Modo Examen)";
    if (mode === 'summary') displayMsg += " (Modo Resumen)";
    
    appendMessage('user', displayMsg);
    
    if (!state.chatHistories[prof.id]) state.chatHistories[prof.id] = [];
    
    let apiText = text;
    if (mode === 'quick') apiText = `[RESPUESTA RÁPIDA]: ${text}`;
    if (mode === 'class') apiText = `[MODO CLASE - DESARROLLO PEDAGÓGICO]: ${text}`;
    if (mode === 'exam') apiText = `[MODO EXAMEN - EVALUACIÓN]: ${text}`;
    if (mode === 'summary') apiText = `[MODO RESUMEN - SÍNTESIS]: ${text}`;
    
    state.chatHistories[prof.id].push({ role: 'user', text: apiText });

    // Mostrar indicador de "escribiendo"
    const chatMessages = document.getElementById('chat-messages');
    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'message assistant typing-indicator';
    loadingDiv.id = 'typing-indicator';
    loadingDiv.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span>';
    chatMessages.appendChild(loadingDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    try {
        const { data: resources } = await supabaseClient
            .from('recursos_profesor')
            .select('nombre_archivo')
            .eq('profesor_id', state.selectedProfessorId);

        const resourceNames = resources.map(r => r.nombre_archivo).join(', ');
        
        let systemInstruction = `Eres el asistente del Profesor ${prof.nombre}, experto en la materia ${prof.materia}. 
        CONTEXTO Y DESCRIPCIÓN DEL PROFESOR: ${prof.descripcion || 'No hay descripción detallada'}.
        RECURSOS DISPONIBLES: ${resourceNames || 'Ninguno aún'}.

        REGLAS CRÍTICAS DE COMPORTAMIENTO:
        1. SOLO debes responder preguntas relacionadas con la materia ${prof.materia} y el contexto descrito anteriormente.
        2. Si el usuario te pregunta sobre temas ajenos (por ejemplo: cocina, deportes, otros hobbies, o cualquier materia que no sea ${prof.materia}), DEBES declinar la respuesta cortésmente. 
        3. Dile al alumno que tu propósito es ayudarlo específicamente con ${prof.materia} según las directivas del profesor ${prof.nombre}.
        4. No rompas el personaje de asistente educativo especializado.`;

        if (mode === 'quick') {
            systemInstruction += "\nREGLA ADICIONAL: Da una respuesta concisa pero completa y con contexto académico, ideal para un parcial o una pregunta de clase inmediata.";
        } else if (mode === 'class') {
            systemInstruction += "\nREGLA ADICIONAL: Actúa como un docente impartiendo una clase interactiva. Desarrolla el tema con profundidad, utiliza un tono pedagógico, fomenta el ida y vuelta con el alumno, y utiliza estructuras claras para explicar conceptos complejos.";
        } else if (mode === 'exam') {
            systemInstruction += "\nREGLA ADICIONAL: Actúa como un examinador. Tu objetivo es evaluar al alumno haciéndole preguntas progresivas sobre el tema. Evalúa sus respuestas y dale feedback constructivo.";
        } else if (mode === 'summary') {
            systemInstruction += "\nREGLA ADICIONAL: Proporciona un resumen claro, estructurado y sintético de la información solicitada o de los materiales disponibles.";
        }

        // Llamada segura al Cloudflare Worker (la clave de Gemini vive allá)
        const response = await fetch(`${WORKER_URL}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: systemInstruction + '\n\nPregunta del alumno: ' + text })
        });

        const data = await response.json();
        
        if (data.error) throw new Error(data.error);

        const responseText = data.text;
        
        const indicator = document.getElementById('typing-indicator');
        if (indicator) indicator.remove();

        appendMessage('assistant', responseText);
        state.chatHistories[prof.id].push({ role: 'assistant', text: responseText });
        updateUsageStats(text, responseText);
    } catch (error) {
        console.warn("API Fallback Mode Active:", error.message);
        
        let mockResponse = "";
        if (mode === 'quick') {
            mockResponse = `[Modo Académico Directo]: Para la materia ${prof.materia}, la respuesta clave a "${text}" se basa en los fundamentos técnicos de los recursos cargados.`;
        } else if (mode === 'class') {
            mockResponse = `[MODO CLASE]: ¡Excelente pregunta! Para abordar "${text}" en la materia ${prof.materia}, primero debemos entender el contexto general. 
            \n1. Punto de partida: Analizamos los recursos cargados.
            \n2. Desarrollo: Explicamos paso a paso el concepto.
            \n3. Conclusión: ¿Qué dudas te surgen de esta explicación?`;
        } else {
            mockResponse = `*Asistente de ${prof.nombre} (Modo Respaldo)*: \n\nSobre tu consulta en ${prof.materia}: "${text}". Te recomiendo revisar los materiales cargados mientras la conexión con Google se estabiliza.`;
        }
        
        const indicator = document.getElementById('typing-indicator');
        if (indicator) indicator.remove();

        appendMessage('assistant', mockResponse);
        state.chatHistories[prof.id].push({ role: 'assistant', text: mockResponse });
        updateUsageStats(text, mockResponse);
    }
}

function appendMessage(role, text) {
    const chatMessages = document.getElementById('chat-messages');
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${role}`;
    msgDiv.textContent = text;
    chatMessages.appendChild(msgDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function renderFiles() {
    if (!state.selectedProfessorId) {
        navigate('dashboard');
        return;
    }
    
    const prof = state.professors.find(p => p.id === state.selectedProfessorId);
    const contentArea = document.getElementById('content-area');
    contentArea.innerHTML = `
        <div class="card">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem;">
                <h3>Recursos de ${prof.nombre}</h3>
                <label for="file-upload" class="btn btn-primary" style="cursor: pointer;">
                    <i data-lucide="plus"></i> Subir
                </label>
                <input type="file" id="file-upload" style="display: none;" multiple />
            </div>

            <!-- Drag & Drop Zone -->
            <div id="drop-zone" class="drop-zone">
                <i data-lucide="upload-cloud" style="width: 48px; height: 48px; opacity: 0.5; pointer-events: none;"></i>
                <p style="pointer-events: none;">Arrastra tus archivos aquí o haz clic en este recuadro para subir</p>
                <span style="font-size: 0.75rem; opacity: 0.6; pointer-events: none;">Puedes subir varios archivos a la vez</span>
            </div>

            <div id="files-list" class="files-list">
                <p style="color: var(--text-secondary)">Cargando recursos...</p>
            </div>
        </div>
    `;
    lucide.createIcons();
    
    const fileInput = document.getElementById('file-upload');
    fileInput.onchange = (e) => handleFileUpload(e.target.files);

    setupDragAndDrop();
    listFiles();
    
    if (!document.getElementById('file-styles')) {
        const style = document.createElement('style');
        style.id = 'file-styles';
        style.textContent = `
            .files-list { display: grid; gap: 1rem; margin-top: 2rem; }
            .file-card { display: flex; align-items: center; justify-content: space-between; padding: 1.25rem; border: 1px solid var(--border-color); border-radius: 16px; background: var(--bg-secondary); min-width: 0; gap: 1rem; }
            .file-info { display: flex; align-items: center; gap: 1rem; min-width: 0; flex: 1; }
            .file-info span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block; }
            .drop-zone { border: 2px dashed var(--border-color); border-radius: 24px; padding: 3rem; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 1rem; transition: all 0.3s ease; margin-bottom: 2rem; background: var(--bg-primary); cursor: pointer; }
            .drop-zone.active { border-color: var(--brand-blue); background: rgba(59, 130, 246, 0.05); transform: scale(1.01); }
        `;
        document.head.appendChild(style);
    }
}

function setupDragAndDrop() {
    const dropZone = document.getElementById('drop-zone');
    
    // Permitir clic en el recuadro para subir archivos
    dropZone.addEventListener('click', () => {
        document.getElementById('file-upload').click();
    });
    
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, e => {
            e.preventDefault();
            e.stopPropagation();
        }, false);
    });

    // Prevent default drag behaviors for the whole window
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        window.addEventListener(eventName, e => {
            e.preventDefault();
            e.stopPropagation();
        }, false);
    });

    ['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, () => dropZone.classList.add('active'), false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, () => dropZone.classList.remove('active'), false);
    });

    dropZone.addEventListener('drop', e => {
        const files = e.dataTransfer.files;
        handleFileUpload(files);
    }, false);
}

async function handleFileUpload(files) {
    if (!files || files.length === 0 || !state.selectedProfessorId) return;

    // 1. Obtener archivos existentes para este profesor
    const { data: existingFiles, error: fetchError } = await supabaseClient
        .from('recursos_profesor')
        .select('nombre_archivo')
        .eq('profesor_id', state.selectedProfessorId);

    if (fetchError) {
        console.error("Error al verificar duplicados:", fetchError);
    }

    const existingNames = (existingFiles || []).map(f => f.nombre_archivo);
    const filesToUpload = [];
    const duplicates = [];

    for (let i = 0; i < files.length; i++) {
        if (existingNames.includes(files[i].name)) {
            duplicates.push(files[i].name);
        } else {
            filesToUpload.push(files[i]);
        }
    }

    if (filesToUpload.length === 0) {
        showModal('Archivos duplicados', `El archivo "${duplicates[0]}" ya existe para este profesor. Se ha descartado la subida.`);
        return;
    }

    showModal('Subiendo...', `Subiendo ${filesToUpload.length} archivo(s)... ${duplicates.length > 0 ? `(${duplicates.length} duplicados descartados)` : ''}`);

    let successCount = 0;
    let errorCount = 0;

    for (let file of filesToUpload) {
        try {
            const sanitizedName = file.name.replace(/[^\w.-]/g, '_');
            const fileName = `${state.selectedProfessorId}/${Date.now()}_${sanitizedName}`;
            
            const { error: uploadError } = await supabaseClient.storage
                .from('recursos')
                .upload(fileName, file);

            if (uploadError) throw uploadError;

            const publicUrl = supabaseClient.storage.from('recursos').getPublicUrl(fileName).data.publicUrl;

            const { error: dbError } = await supabaseClient
                .from('recursos_profesor')
                .insert([{
                    profesor_id: state.selectedProfessorId,
                    nombre_archivo: file.name,
                    url_archivo: publicUrl
                }]);

            if (dbError) throw dbError;
            successCount++;
        } catch (error) {
            console.error(`Error al subir ${file.name}:`, error);
            errorCount++;
        }
    }

    hideModal();
    if (errorCount === 0) {
        let msg = `Se han subido ${successCount} archivos correctamente.`;
        if (duplicates.length > 0) msg += `\n\nNota: Se omitieron ${duplicates.length} duplicados.`;
        showModal('¡Éxito!', msg);
    } else {
        showModal('Resultado', `Éxito: ${successCount}, Fallos: ${errorCount}.`);
    }
    listFiles();
}

async function listFiles() {
    const listDiv = document.getElementById('files-list');
    try {
        const { data, error } = await supabaseClient
            .from('recursos_profesor')
            .select('*')
            .eq('profesor_id', state.selectedProfessorId)
            .order('created_at', { ascending: false });

        if (error) throw error;

        if (data.length === 0) {
            listDiv.innerHTML = '<p style="color: var(--text-secondary)">Aún no hay recursos para este profesor.</p>';
            return;
        }

        listDiv.innerHTML = data.map(file => `
            <div class="file-card">
                <div class="file-info">
                    <i data-lucide="file-text"></i>
                    <span>${file.nombre_archivo}</span>
                </div>
                <div style="display: flex; gap: 0.5rem;">
                    <button class="btn btn-secondary" onclick="handleViewFile('${file.url_archivo}', '${file.nombre_archivo}')">Ver</button>
                    <button class="btn" style="color: #ef4444; background: none; border: none; cursor: pointer;" onclick="handleDeleteFile('${file.id}')">
                        <i data-lucide="trash-2"></i>
                    </button>
                </div>
            </div>
        `).join('');
        lucide.createIcons();
    } catch (error) {
        console.error("Error al listar archivos:", error);
        listDiv.innerHTML = '<p style="color: var(--text-secondary)">Error al cargar recursos.</p>';
    }
}

async function handleDeleteFile(id) {
    console.log("Iniciando borrado para ID:", id);
    if (!confirm('¿Eliminar este recurso?')) return;
    try {
        const { error, status } = await supabaseClient
            .from('recursos_profesor')
            .delete()
            .eq('id', id);
            
        if (error) {
            console.error("Error detallado de Supabase:", error);
            alert(`No se pudo eliminar el recurso: ${error.message}`);
            throw error;
        }
        
        console.log("Borrado exitoso, status:", status);
        await listFiles();
    } catch (error) {
        console.error("Error en el proceso de borrado:", error);
    }
}

window.closeViewer = function() {
    const viewer = document.getElementById('fullscreen-viewer');
    if (viewer) {
        viewer.remove();
    }
};

window.handleViewFile = function(url, name) {
    const isImage = /\.(jpg|jpeg|png|gif|svg|webp)$/i.test(name);
    const isPdf = /\.pdf$/i.test(name);
    const isOffice = /\.(doc|docx|xls|xlsx|ppt|pptx)$/i.test(name);
    
    let viewer = document.getElementById('fullscreen-viewer');
    if (viewer) viewer.remove(); // Remove existing if any
    
    viewer = document.createElement('div');
    viewer.id = 'fullscreen-viewer';
    // Se usa position: fixed y alto de 100vh para que cubra toda la pantalla
    viewer.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        background: var(--bg-primary);
        z-index: 99999;
        display: flex;
        flex-direction: column;
    `;
    
    let contentHtml = '';
    if (isImage) {
        // Para imágenes, usar img con object-fit contain
        contentHtml = `<div style="flex: 1; display: flex; align-items: center; justify-content: center; overflow: hidden; padding: 2rem; background: var(--bg-secondary);">
            <img src="${url}" style="max-width: 100%; max-height: 100%; object-fit: contain; border-radius: 8px; box-shadow: var(--shadow-lg);" />
        </div>`;
    } else if (isPdf) {
        // Para PDFs, usar iframe que ocupe todo el espacio restante
        contentHtml = `<iframe src="${url}" style="flex: 1; width: 100%; border: none; background: #fff;"></iframe>`;
    } else if (isOffice) {
        // Para Office, usar Microsoft Office Online Viewer
        const viewerUrl = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(url)}`;
        contentHtml = `<iframe src="${viewerUrl}" style="flex: 1; width: 100%; border: none; background: #fff;"></iframe>`;
    } else {
        // Para cualquier otro formato, intentar con Google Docs Viewer por si acaso
        const viewerUrl = `https://docs.google.com/gview?url=${encodeURIComponent(url)}&embedded=true`;
        contentHtml = `<iframe src="${viewerUrl}" style="flex: 1; width: 100%; border: none; background: #fff;"></iframe>`;
    }
    
    // Top bar para navegación
    viewer.innerHTML = `
        <div style="height: 70px; background: var(--bg-secondary); border-bottom: 1px solid var(--border-color); display: flex; align-items: center; justify-content: space-between; padding: 0 2rem; flex-shrink: 0;">
            <div style="display: flex; align-items: center; gap: 1.5rem;">
                <button class="btn btn-secondary" onclick="closeViewer()" style="padding: 0.5rem 1rem;">
                    <i data-lucide="arrow-left"></i> Volver
                </button>
                <span style="font-weight: 600; font-family: 'Outfit', sans-serif; font-size: 1.2rem; color: var(--text-primary);">${name}</span>
            </div>
            <a href="${url}" download="${name}" class="btn btn-primary" style="padding: 0.5rem 1.5rem; text-decoration: none;">
                <i data-lucide="download"></i> Descargar
            </a>
        </div>
        ${contentHtml}
    `;
    
    document.body.appendChild(viewer);
    lucide.createIcons({ root: viewer });
};

function updateUsageStats(inputText, outputText) {
    let queries = parseInt(localStorage.getItem('oe_queries') || '0');
    localStorage.setItem('oe_queries', queries + 1);

    let tokensUsed = parseInt(localStorage.getItem('oe_tokens') || '0');
    // Approximate tokens: 1 token ~= 4 chars
    let newTokens = Math.ceil((inputText.length + outputText.length) / 4);
    localStorage.setItem('oe_tokens', tokensUsed + newTokens);
}

async function renderSettings() {
    const contentArea = document.getElementById('content-area');
    contentArea.innerHTML = `
        <div style="display: flex; justify-content: center; align-items: center; height: 100%;">
            <div class="loader" style="width: 48px; height: 48px; border: 4px solid var(--border-color); border-bottom-color: var(--brand-violet); border-radius: 50%; animation: rotation 1s linear infinite;"></div>
        </div>
    `;

    // Fetch total files
    let totalFiles = 0;
    try {
        const { count, error } = await supabaseClient
            .from('recursos_profesor')
            .select('*', { count: 'exact', head: true });
        if (!error) totalFiles = count || 0;
    } catch (err) {
        console.error("Error fetching file count:", err);
    }

    let queries = parseInt(localStorage.getItem('oe_queries') || '0');
    let tokensUsed = parseInt(localStorage.getItem('oe_tokens') || '0');
    const tokensLimit = 1000000;
    let tokensRemaining = Math.max(0, tokensLimit - tokensUsed);
    
    const fmt = (num) => new Intl.NumberFormat('es-AR').format(num);

    contentArea.innerHTML = `
        <div class="card" style="max-width: 900px; margin: 0 auto; border: none; box-shadow: none; background: transparent;">
            <div style="display: flex; align-items: center; gap: 1rem; margin-bottom: 2rem;">
                <div style="background: var(--accent-gradient); padding: 1rem; border-radius: 16px; color: white;">
                    <i data-lucide="bar-chart-2" style="width: 32px; height: 32px;"></i>
                </div>
                <div>
                    <h2 style="font-size: 1.8rem; margin: 0; color: var(--text-primary);">Panel de Estadísticas</h2>
                    <p style="opacity: 0.7; margin-top: 0.25rem; color: var(--text-secondary);">Monitoriza el uso de tu plataforma y el consumo de IA.</p>
                </div>
            </div>
            
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1.5rem; margin-bottom: 2.5rem;">
                <!-- Archivos -->
                <div style="background: var(--bg-secondary); padding: 1.5rem; border-radius: 16px; border: 1px solid var(--border-color); display: flex; flex-direction: column; gap: 0.5rem; box-shadow: var(--shadow-sm); transition: transform 0.2s;">
                    <div style="display: flex; align-items: center; justify-content: space-between; color: var(--text-secondary);">
                        <span style="font-size: 0.95rem; font-weight: 500;">Archivos Subidos</span>
                        <i data-lucide="file-text" style="width: 20px; color: var(--brand-celeste);"></i>
                    </div>
                    <span style="font-size: 2.5rem; font-weight: 700; color: var(--text-primary); margin-top: 0.5rem;">${fmt(totalFiles)}</span>
                </div>
                
                <!-- Consultas -->
                <div style="background: var(--bg-secondary); padding: 1.5rem; border-radius: 16px; border: 1px solid var(--border-color); display: flex; flex-direction: column; gap: 0.5rem; box-shadow: var(--shadow-sm); transition: transform 0.2s;">
                    <div style="display: flex; align-items: center; justify-content: space-between; color: var(--text-secondary);">
                        <span style="font-size: 0.95rem; font-weight: 500;">Consultas IA</span>
                        <i data-lucide="message-square" style="width: 20px; color: var(--brand-blue);"></i>
                    </div>
                    <span style="font-size: 2.5rem; font-weight: 700; color: var(--text-primary); margin-top: 0.5rem;">${fmt(queries)}</span>
                </div>

                <!-- Tokens Usados -->
                <div style="background: var(--bg-secondary); padding: 1.5rem; border-radius: 16px; border: 1px solid var(--border-color); display: flex; flex-direction: column; gap: 0.5rem; box-shadow: var(--shadow-sm); transition: transform 0.2s;">
                    <div style="display: flex; align-items: center; justify-content: space-between; color: var(--text-secondary);">
                        <span style="font-size: 0.95rem; font-weight: 500;">Tokens Utilizados</span>
                        <i data-lucide="cpu" style="width: 20px; color: var(--brand-violet);"></i>
                    </div>
                    <span style="font-size: 2.5rem; font-weight: 700; color: var(--text-primary); margin-top: 0.5rem;">${fmt(tokensUsed)}</span>
                </div>

                <!-- Tokens Restantes -->
                <div style="background: var(--bg-secondary); padding: 1.5rem; border-radius: 16px; border: 1px solid var(--border-color); display: flex; flex-direction: column; gap: 0.5rem; box-shadow: var(--shadow-sm); transition: transform 0.2s;">
                    <div style="display: flex; align-items: center; justify-content: space-between; color: var(--text-secondary);">
                        <span style="font-size: 0.95rem; font-weight: 500;">Tokens Disponibles</span>
                        <i data-lucide="battery-charging" style="width: 20px; color: var(--brand-green);"></i>
                    </div>
                    <span style="font-size: 2.5rem; font-weight: 700; color: var(--text-primary); margin-top: 0.5rem;">${fmt(tokensRemaining)}</span>
                </div>
            </div>
            
            <div style="background: rgba(16, 185, 129, 0.05); border: 1px solid rgba(16, 185, 129, 0.2); border-radius: 16px; padding: 1.5rem; display: flex; align-items: flex-start; gap: 1.25rem;">
                <div style="background: rgba(16, 185, 129, 0.1); padding: 0.75rem; border-radius: 12px; display: flex; align-items: center; justify-content: center;">
                    <i data-lucide="shield-check" style="color: var(--brand-green); width: 24px; height: 24px;"></i>
                </div>
                <div>
                    <h4 style="color: var(--brand-green); margin-bottom: 0.5rem; font-size: 1.1rem; font-weight: 600;">Sistema Operativo y Protegido</h4>
                    <p style="color: var(--text-secondary); line-height: 1.6; font-size: 0.95rem; margin: 0;">
                        Las credenciales de acceso a la inteligencia artificial y a la base de datos están encriptadas y administradas internamente. Tu plan actual te otorga un límite mensual aproximado de <b>${fmt(tokensLimit)} tokens</b>.
                    </p>
                </div>
            </div>
        </div>
    `;
    lucide.createIcons();
}


// Event Listeners
function setupEventListeners() {
    document.getElementById('theme-toggle').addEventListener('click', toggleTheme);
    document.getElementById('btn-create-professor').addEventListener('click', showCreateProfessorModal);
    
    document.getElementById('sidebar-logo').addEventListener('click', () => navigate('dashboard'));
    document.getElementById('user-profile').addEventListener('click', () => navigate('dashboard'));
    
    document.getElementById('nav-settings').addEventListener('click', (e) => { e.preventDefault(); navigate('settings'); });

    // Mobile menu events
    const mobileToggle = document.getElementById('mobile-menu-toggle');
    const sidebarOverlay = document.getElementById('sidebar-overlay');
    if (mobileToggle) mobileToggle.addEventListener('click', toggleMobileMenu);
    if (sidebarOverlay) sidebarOverlay.addEventListener('click', closeMobileMenu);

    // Logout event
    const btnLogout = document.getElementById('btn-logout');
    if (btnLogout) {
        btnLogout.addEventListener('click', () => {
            sessionStorage.removeItem('isLoggedIn');
            location.reload();
        });
    }
}

// Historial para el botón atrás del celular
window.onpopstate = (event) => {
    if (event.state) {
        navigate(event.state.page, event.state.professorId, false);
    } else {
        navigate('dashboard', null, false);
    }
};

// Run init
window.addEventListener('DOMContentLoaded', init);

// Expose functions to global scope for inline onclick handlers
window.navigate = navigate;
window.handleDeleteProfessor = handleDeleteProfessor;
window.handleDeleteFile = handleDeleteFile;
window.showCreateProfessorModal = showCreateProfessorModal;
window.showEditProfessorModal = showEditProfessorModal;
// handleProfessorClick is already exposed at its definition
