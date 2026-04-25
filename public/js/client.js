import { collection, addDoc, query, where, orderBy, limit, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";
import { db } from "./config.js";
import { showToast } from "./ui.js";
import { userData } from "./auth.js";

const escapeHtml = (str) => {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
};

let unsubCliente = null;

export const escucharMisPedidos = (userId) => {
    if (unsubCliente) { unsubCliente(); unsubCliente = null; }

    unsubCliente = onSnapshot(
        query(
            collection(db, "trabajos"),
            where("clienteId", "==", userId),
            orderBy("creadoEn", "desc"),
            limit(30)
        ),
        (snap) => {
            const listDiv = document.getElementById('lista-cli-pedidos');
            if (snap.empty) {
                listDiv.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 40px 0;">No tienes requerimientos activos.</div>';
                return;
            }
            listDiv.innerHTML = snap.docs.map(d => {
                const t = d.data();
                const badgeClass = `badge-${t.estado.split('_')[0]}`;
                const hasOp = !!t.operarioNombre;
                return `
                <div style="background: white; padding: 24px; border-radius: 16px; margin-bottom: 20px; border: 1px solid var(--border); box-shadow: var(--shadow-sm);">
                    <div style="display: flex; justify-content: space-between; margin-bottom: 12px; align-items: start;">
                        <strong style="color: var(--text-main); font-size: 16px;">${escapeHtml(t.categoria)}</strong>
                        <span class="badge ${badgeClass}">${t.estado.toUpperCase()}</span>
                    </div>
                    <p style="font-size: 14px; color: var(--text-muted); margin-bottom: 20px; line-height: 1.5;">${escapeHtml(t.descripcion)}</p>
                    <div style="border-top: 1px solid var(--border); padding-top: 16px; display: flex; align-items: center; gap: 8px;">
                        <i class="fas fa-hard-hat" style="color: ${hasOp ? 'var(--warning)' : 'var(--text-muted)'};"></i>
                        <span style="font-size: 13px; font-weight: 600; color: ${hasOp ? 'var(--text-main)' : 'var(--text-muted)'};">
                            ${escapeHtml(t.operarioNombre) || 'Nuestra central está localizando al mejor especialista...'}
                        </span>
                    </div>
                </div>`;
            }).join('');
        },
        () => showToast("Error al cargar el historial.", "error")
    );
};

export const enviarPedido = async () => {
    const cat = document.getElementById('cliServicio').value;
    const desc = document.getElementById('cliDesc').value.trim();
    if (!cat || !desc) return showToast("Por favor selecciona una categoría y detalla el problema.", "error");
    if (!userData) return showToast("Sesión no válida. Por favor recarga la página.", "error");

    const btn = document.querySelector('#view-cliente .btn-secondary');
    const origText = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> ENVIANDO...';

    try {
        await addDoc(collection(db, "trabajos"), {
            clienteId: userData.uid,
            clienteNombre: userData.nombre,
            categoria: cat,
            descripcion: desc,
            estado: 'solicitado',
            creadoEn: serverTimestamp()
        });
        document.getElementById('cliDesc').value = '';
        document.getElementById('cliServicio').value = '';
        showToast("🚀 ¡Solicitud enviada a la central exitosamente!", "success");
    } catch (e) {
        showToast("Error enviando el ticket: " + e.message, "error");
    } finally {
        btn.innerHTML = origText;
    }
};

export const stopClientModule = () => {
    if (unsubCliente) { unsubCliente(); unsubCliente = null; }
};

window.enviarPedido = () => enviarPedido();
