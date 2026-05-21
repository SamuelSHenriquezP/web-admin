// --- SISTEMA DE NOTIFICACIONES TOAST ---
export const showToast = (message, type = 'success') => {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icon = type === 'success' ? '<i class="fas fa-check-circle" style="color: #4ade80;"></i>' : '<i class="fas fa-exclamation-circle" style="color: #f87171;"></i>';
    toast.innerHTML = `${icon} <span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.animation = 'toastSlide 0.3s reverse forwards';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
};

// --- CONTROL VISUAL ---
export const showView = (id) => {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const target = document.getElementById(id);
    if (target) target.classList.add('active');

    // Manejo de Temas Dinámicos
    document.body.classList.remove('theme-admin', 'theme-cliente', 'theme-operario');
    if (id === 'view-admin') document.body.classList.add('theme-admin');
    else if (id === 'view-cliente') document.body.classList.add('theme-cliente');
    else if (id === 'view-operario') document.body.classList.add('theme-operario');
};

export const cambiarPestana = (id) => {
    document.querySelectorAll('.pestana').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('activo'));
    const tab = document.getElementById(`tab-${id}`);
    const nav = document.getElementById(`nav-${id}`);
    if (tab) tab.classList.add('active');
    if (nav) nav.classList.add('activo');
    const sidebar = document.getElementById('adminSidebar');
    if (sidebar && sidebar.classList.contains('open')) { sidebar.classList.remove('open'); }
};

export const toggleAuth = () => {
    const loginForm = document.getElementById('form-login');
    const regForm = document.getElementById('form-registro');
    const subtitulo = document.getElementById('auth-subtitle');
    if (loginForm && regForm && subtitulo) {
        if (!loginForm.classList.contains('oculto')) {
            loginForm.classList.add('oculto');
            regForm.classList.remove('oculto');
            subtitulo.innerText = "Registro de Nuevo Cliente";
        } else {
            loginForm.classList.remove('oculto');
            regForm.classList.add('oculto');
            subtitulo.innerText = "Acceso Administrativo Seguro";
        }
    }
};

window.showToast = showToast;
window.showView = showView;
window.cambiarPestana = cambiarPestana;
window.toggleAuth = toggleAuth;
