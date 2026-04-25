import { query, collection, where, onSnapshot, orderBy, limit, doc, updateDoc } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";
import { db } from "./config.js";
import { showToast } from "./ui.js";

const escapeHtml = (str) => {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
};

let unsubOperario = null;

export const escucharMisTrabajosOperario = (userData) => {
    if (unsubOperario) { unsubOperario(); unsubOperario = null; }

    const listDiv = document.getElementById('lista-op-pedidos');
    let tareasActivas = [];
    let tareasCompletadas = [];

    const renderOperario = () => {
        const todas = [
            ...tareasActivas,
            ...tareasCompletadas
                .sort((a, b) => (b.creadoEn?.seconds || 0) - (a.creadoEn?.seconds || 0))
                .slice(0, 5)
        ];

        if (todas.length === 0) {
            listDiv.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 40px 0;">No tienes tareas asignadas.</div>';
            return;
        }

        listDiv.innerHTML = todas.map(t => {
            const badgeClass = `badge-${t.estado.split('_')[0]}`;
            const esCompletado = t.estado === 'completado';
            const estadoFooter = esCompletado
                ? `<div style="margin-top: 16px; color: #22c55e; font-weight: 600;"><i class="fas fa-check-circle"></i> Tarea Completada</div>`
                : `<div style="margin-top: 16px; font-size: 12px; color: var(--text-muted); background: var(--bg-app); padding: 10px 14px; border-radius: 8px;"><i class="fas fa-mobile-alt"></i> Usa la app móvil para actualizar el estado de esta tarea.</div>`;
            return `
            <div style="background: white; padding: 24px; border-radius: 12px; margin-bottom: 20px; border-left: 3px solid ${esCompletado ? '#22c55e' : 'var(--warning)'}; border: 1px solid var(--border); box-shadow: var(--shadow-sm);">
                <div style="display: flex; justify-content: space-between; margin-bottom: 12px;">
                    <div>
                        <strong style="color: var(--text-main); font-size: 16px;">${escapeHtml(t.categoria)}</strong>
                        <span style="font-size: 12px; color: var(--text-muted); display: block;">Cliente: ${escapeHtml(t.clienteNombre) || 'N/A'}</span>
                    </div>
                    <span class="badge ${badgeClass}">${t.estado.toUpperCase()}</span>
                </div>
                <p style="font-size: 14px; color: var(--text-muted); line-height: 1.5; padding: 12px; background: var(--bg-app); border-radius: 8px;">${escapeHtml(t.descripcion)}</p>
                ${estadoFooter}
            </div>`;
        }).join('');
    };

    const unsubActivos = onSnapshot(
        query(collection(db, "trabajos"), where("operarioId", "==", userData.uid), where("estado", "in", ["asignado", "en_camino", "en_sitio", "retrasado", "revision_cliente", "evaluado_cliente", "reporte_aprobado"])),
        (snap) => { tareasActivas = snap.docs.map(d => ({ jobId: d.id, ...d.data() })); renderOperario(); },
        () => showToast("Error al cargar tareas activas.", "error")
    );

    const unsubCompletados = onSnapshot(
        query(collection(db, "trabajos"), where("operarioId", "==", userData.uid), where("estado", "==", "completado"), orderBy("creadoEn", "desc"), limit(5)),
        (snap) => { tareasCompletadas = snap.docs.map(d => ({ jobId: d.id, ...d.data() })); renderOperario(); },
        () => {}
    );

    unsubOperario = () => { unsubActivos(); unsubCompletados(); };
};

export const stopOperarioModule = () => {
    if (unsubOperario) { unsubOperario(); unsubOperario = null; }
};
