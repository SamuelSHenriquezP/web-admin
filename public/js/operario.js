import { query, collection, where, onSnapshot, orderBy, limit, doc, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";
import { db } from "./config.js";
import { showToast } from "./ui.js";

let unsubOperario = null;
let currentTareas = [];
let mapsInstances = {}; // Para guardar las instancias de Leaflet y no duplicar

export const escucharMisTrabajosOperario = (userData) => {
    if (unsubOperario) { unsubOperario(); unsubOperario = null; }

    const listDiv = document.getElementById('lista-op-pedidos');

    unsubOperario = onSnapshot(
        query(
            collection(db, "trabajos"),
            where("operarioId", "==", userData.uid),
            limit(20)
        ),
        (snap) => {
            // Ordenamiento local por fecha (creadoEn) descendente para evitar errores de índice
            currentTareas = snap.docs.map(d => ({ jobId: d.id, ...d.data() }));
            currentTareas.sort((a, b) => {
                const fa = a.creadoEn?.toMillis ? a.creadoEn.toMillis() : 0;
                const fb = b.creadoEn?.toMillis ? b.creadoEn.toMillis() : 0;
                return fb - fa;
            });

            renderOperario();
            // Inicializar mapas después del renderizado si hay coordenadas
            setTimeout(() => initMapsOperario(), 100);
        },
        (err) => {
            console.error(err);
            showToast("Error al sincronizar tareas operario.", "error");
        }
    );
};

const renderOperario = () => {
    const listDiv = document.getElementById('lista-op-pedidos');
    if (currentTareas.length === 0) {
        listDiv.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 40px 0;">No tienes tareas asignadas por ahora.</div>';
        return;
    }

    listDiv.innerHTML = currentTareas.map(t => {
        const badgeClass = `badge-${t.estado ? t.estado.toLowerCase().split('_')[0] : 'solicitado'}`;
        
        // Determinar botones de acción según el estado
        let botonesAccion = '';
        if (t.estado === 'asignado') {
            botonesAccion = `
                <button onclick="actualizarEstadoOperario('${t.jobId}', 'en_camino')" class="btn btn-primary">
                    <i class="fas fa-route"></i> INICIAR RUTA
                </button>`;
        } else if (t.estado === 'en_camino') {
            botonesAccion = `
                <div style="display: flex; gap: 10px;">
                    <button onclick="abrirModalPin('${t.jobId}')" class="btn btn-secondary" style="flex: 1;">
                        <i class="fas fa-check-circle"></i> CONFIRMAR LLEGADA
                    </button>
                    <button onclick="actualizarEstadoOperario('${t.jobId}', 'retrasado')" class="btn btn-outline" style="flex: 0.5;">
                        <i class="fas fa-clock"></i> RETRASO
                    </button>
                </div>`;
        } else if (t.estado === 'en_sitio' || t.estado === 'retrasado') {
            botonesAccion = `
                <button onclick="abrirModalReporte('${t.jobId}')" class="btn btn-secondary">
                    <i class="fas fa-file-alt"></i> FINALIZAR Y LLENAR REPORTE
                </button>`;
        } else {
            botonesAccion = `<div style="text-align: center; font-weight: 700; color: #22c55e;"><i class="fas fa-check-double"></i> TRABAJO CONCLUIDO</div>`;
        }

        // Seccion de mapa si hay coordenadas
        const mapHtml = (t.lat && t.lng) ? `
            <div id="map-op-${t.jobId}" style="height: 150px; width: 100%; border-radius: 12px; margin-top: 15px; background: #e2e8f0; border: 1px solid var(--border);"></div>
        ` : '';

        return `
        <div class="tarjeta" style="padding: 24px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                <span class="badge ${badgeClass}">${(t.estado || 'ASIGNADO').toUpperCase()}</span>
                <span style="font-size: 12px; color: var(--text-muted); font-weight: 500;">ID: #${t.jobId.slice(-6).toUpperCase()}</span>
            </div>

            <div style="margin-bottom: 20px;">
                <h3 style="font-size: 20px; font-weight: 800; color: var(--text-main); margin-bottom: 4px; letter-spacing: -0.5px;">${t.categoria || t.servicio || 'Servicio'}</h3>
                <div style="display: flex; align-items: center; gap: 8px; color: var(--primary); font-weight: 700; font-size: 14px;">
                    <i class="fas fa-building"></i>
                    <span>${t.clienteNombre || 'Cliente'}</span>
                </div>
            </div>
            
            <div style="background: #f8fafc; padding: 16px; border-radius: 12px; margin-bottom: 20px; border: 1px solid var(--border);">
                <small style="display: block; font-size: 10px; font-weight: 800; color: var(--text-muted); text-transform: uppercase; margin-bottom: 6px; letter-spacing: 0.5px;">Descripción del requerimiento</small>
                <p style="font-size: 14px; color: var(--text-main); line-height: 1.6; margin: 0;">
                    ${t.descripcion || 'Sin descripción adicional.'}
                </p>
            </div>

            ${mapHtml}

            <div style="margin-top: 24px;">
                ${botonesAccion}
            </div>
        </div>`;
    }).join('');
};

const initMapsOperario = () => {
    currentTareas.forEach(t => {
        if (t.lat && t.lng) {
            const containerId = `map-op-${t.jobId}`;
            const container = document.getElementById(containerId);
            if (container && !mapsInstances[containerId]) {
                const map = L.map(containerId, { zoomControl: false, attributionControl: false }).setView([t.lat, t.lng], 15);
                L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
                L.marker([t.lat, t.lng]).addTo(map);
                mapsInstances[containerId] = map;
            }
        }
    });
};

export const actualizarEstadoOperario = async (jobId, nuevoEstado) => {
    try {
        const updateData = { estado: nuevoEstado };
        if (nuevoEstado === 'en_camino') updateData.tiempoEnCamino = serverTimestamp();
        if (nuevoEstado === 'en_sitio') updateData.tiempoEnSitio = serverTimestamp();

        await updateDoc(doc(db, "trabajos", jobId), updateData);
        showToast("Estado actualizado: " + nuevoEstado.replace('_', ' '), "success");
    } catch (err) {
        showToast("Error al actualizar estado.", "error");
    }
};

// --- PIN LOGIC ---
export const abrirModalPin = (jobId) => {
    document.getElementById('pinJobId').value = jobId;
    document.getElementById('inputPinWeb').value = '';
    document.getElementById('modal-verificar-pin').classList.remove('oculto');
};

export const verificarPinWeb = async () => {
    const jobId = document.getElementById('pinJobId').value;
    const pinIngresado = document.getElementById('inputPinWeb').value;
    const tarea = currentTareas.find(t => t.jobId === jobId);

    if (pinIngresado === tarea.pinCode) {
        document.getElementById('modal-verificar-pin').classList.add('oculto');
        await actualizarEstadoOperario(jobId, 'en_sitio');
        showToast("¡PIN Correcto! Has llegado al sitio.", "success");
    } else {
        showToast("PIN incorrecto. Pídele el código al cliente.", "error");
    }
};

// --- REPORTE LOGIC ---
export const abrirModalReporte = (jobId) => {
    document.getElementById('reporteJobId').value = jobId;
    // Limpiar campos
    document.getElementById('repCedula').value = '';
    document.getElementById('repEquipo').value = '';
    document.getElementById('repModelo').value = '';
    document.getElementById('repContador').value = '';
    document.getElementById('repDiagnostico').value = '';
    document.getElementById('repSolucion').value = '';
    document.getElementById('repInsumosDesc').value = '';
    document.getElementById('repInsumosCant').value = '';
    
    document.getElementById('modal-reporte-tecnico').classList.remove('oculto');
};

export const enviarReporteWeb = async () => {
    const jobId = document.getElementById('reporteJobId').value;
    const btn = document.getElementById('btnEnviarReporteWeb');
    const original = btn.innerHTML;

    const reporte = {
        encargadoNombre: document.getElementById('op-nombre-display').innerText,
        encargadoCedula: document.getElementById('repCedula').value,
        tipoServicio: document.getElementById('repTipoServicio').value,
        equipo: document.getElementById('repEquipo').value,
        modelo: document.getElementById('repModelo').value,
        contador: document.getElementById('repContador').value,
        diagnostico: document.getElementById('repDiagnostico').value,
        solucion: document.getElementById('repSolucion').value,
        insumos: document.getElementById('repInsumosDesc').value,
        cantidad: document.getElementById('repInsumosCant').value,
        fechaEmision: serverTimestamp()
    };

    if (!reporte.encargadoCedula || !reporte.diagnostico || !reporte.solucion) {
        return showToast("Por favor completa los campos mínimos del reporte.", "error");
    }

    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> ENVIANDO...';
    btn.disabled = true;

    try {
        await updateDoc(doc(db, "trabajos", jobId), {
            estado: 'revision_cliente',
            reporteTecnico: reporte,
            tiempoCompletado: serverTimestamp()
        });
        showToast("Reporte enviado exitosamente.", "success");
        document.getElementById('modal-reporte-tecnico').classList.add('oculto');
    } catch (err) {
        showToast("Error al enviar el reporte.", "error");
    } finally {
        btn.innerHTML = original;
        btn.disabled = false;
    }
};

export const stopOperarioModule = () => {
    if (unsubOperario) { unsubOperario(); unsubOperario = null; }
    // Limpiar mapas
    Object.values(mapsInstances).forEach(m => m.remove());
    mapsInstances = {};
};

// Global Exposure
window.actualizarEstadoOperario = actualizarEstadoOperario;
window.abrirModalPin = abrirModalPin;
window.verificarPinWeb = verificarPinWeb;
window.abrirModalReporte = abrirModalReporte;
window.enviarReporteWeb = enviarReporteWeb;
