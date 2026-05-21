import { query, collection, where, onSnapshot, orderBy, limit, doc, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";
import { db } from "./config.js";
import { showToast } from "./ui.js";
import { userData } from "./auth.js";

const escapeHtml = (str) => {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
};

let unsubOperario = null;
let allOpJobs = [];

export const escucharMisTrabajosOperario = (user) => {
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
        allOpJobs = todas; // Cache para usar en reportes

        if (todas.length === 0) {
            listDiv.innerHTML = `
                <div style="text-align: center; padding: 60px 20px; background: white; border-radius: 16px; border: 2px dashed #e2e8f0;">
                    <div style="width: 72px; height: 72px; border-radius: 50%; background: #f8fafc; color: #94a3b8; display: flex; align-items: center; justify-content: center; font-size: 32px; margin: 0 auto 20px; box-shadow: inset 0 2px 4px rgba(0,0,0,0.02), 0 2px 4px rgba(0,0,0,0.02);">
                        <i class="fas fa-clipboard-check" style="color: #cbd5e1;"></i>
                    </div>
                    <h3 style="color: #1e293b; font-size: 20px; font-weight: 800; margin-bottom: 10px; letter-spacing: -0.5px;">Bandeja al día</h3>
                    <p style="color: #64748b; font-size: 15px; max-width: 300px; margin: 0 auto;">No tienes tareas en curso. El centro de control te asignará nuevas intervenciones cuando sea necesario.</p>
                </div>
            `;
            return;
        }

        listDiv.innerHTML = todas.map(t => {
            const badgeClass = `badge-${t.estado.split('_')[0]}`;
            const esCompletado = t.estado === 'completado';

            // Dynamic styling based on state
            let iconClass = 'fas fa-tools';
            let iconColor = '#ca8a04';
            let accentColor = '#facc15';

            if (esCompletado) {
                iconClass = 'fas fa-check-double'; iconColor = '#16a34a'; accentColor = '#22c55e';
            } else if (t.estado === 'en_camino') {
                iconClass = 'fas fa-truck-fast'; iconColor = '#ea580c'; accentColor = '#f97316';
            } else if (t.estado === 'en_sitio') {
                iconClass = 'fas fa-map-marker-alt'; iconColor = '#0284c7'; accentColor = '#0ea5e9';
            } else if (t.estado === 'retrasado') {
                iconClass = 'fas fa-clock'; iconColor = '#dc2626'; accentColor = '#ef4444';
            } else if (t.estado === 'reporte_aprobado') {
                iconClass = 'fas fa-file-signature'; iconColor = '#4f46e5'; accentColor = '#6366f1';
            }

            let actionButtons = '';

            if (t.estado === 'asignado') {
                actionButtons = `<button onclick="iniciarRutaOperario('${t.jobId}', ${t.lat || null}, ${t.lng || null})" class="btn" style="background: #f59e0b; color: white;"><i class="fas fa-route"></i> INICIAR RUTA</button>`;
            } else if (t.estado === 'en_camino') {
                actionButtons = `
                <div style="display: flex; gap: 10px;">
                    <button onclick="llegadaOperario('${t.jobId}', '${t.pinCode}')" class="btn" style="background: #e71e65; color: white; flex: 1;"><i class="fas fa-location-on"></i> LLEGADA</button>
                    <button onclick="retrasoOperario('${t.jobId}')" class="btn" style="background: #f3e72e; color: #1e293b; flex: 1;"><i class="fas fa-clock"></i> RETRASO</button>
                </div>`;
            } else if (t.estado === 'en_sitio' || t.estado === 'retrasado') {
                actionButtons = `<button onclick="abrirReporteOperario('${t.jobId}')" class="btn" style="background: #f59e0b; color: white;"><i class="fas fa-clipboard-check"></i> FINALIZAR REPORTE</button>`;
            } else if (esCompletado) {
                actionButtons = `<div style="color: #22c55e; font-weight: 700; display: flex; align-items: center; gap: 8px;"><i class="fas fa-check-circle" style="font-size: 18px;"></i> Tarea Completada</div>`;
            } else {
                actionButtons = `<div style="color: var(--primary); font-weight: 600; display: flex; align-items: center; gap: 8px;"><i class="fas fa-spinner fa-spin"></i> En revisión por el cliente...</div>`;
            }

            const estadoFooter = `<div style="margin-top: 16px;">${actionButtons}</div>`;

            return `
            <div style="background: #ffffff; padding: 24px; border-radius: 16px; margin-bottom: 24px; border: 1px solid #e2e8f0; border-left: 6px solid ${accentColor}; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.01); transition: transform 0.2s ease, box-shadow 0.2s ease; cursor: default;" onmouseover="this.style.transform='translateY(-4px)'; this.style.boxShadow='0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)';" onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 10px 25px -5px rgba(0, 0, 0, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.01)';">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; flex-wrap: wrap; gap: 12px;">
                    <div style="display: flex; align-items: center; gap: 16px;">
                        <div style="width: 52px; height: 52px; border-radius: 14px; background: ${accentColor}1A; color: ${iconColor}; display: flex; align-items: center; justify-content: center; font-size: 22px; box-shadow: inset 0 2px 4px rgba(0,0,0,0.05);">
                            <i class="${iconClass}"></i>
                        </div>
                        <div>
                            <strong style="color: #1e293b; font-size: 18px; font-weight: 800; letter-spacing: -0.5px; display: block;">${escapeHtml(t.categoria || t.servicio || 'General')}</strong>
                            <span style="font-size: 13px; color: #64748b; font-weight: 600; display: flex; align-items: center; gap: 6px; margin-top: 6px;"><i class="fas fa-building" style="color: #cbd5e1;"></i> ${escapeHtml(t.clienteNombre) || 'N/A'}</span>
                            ${t.direccionText ? `<span style="font-size: 13px; color: #64748b; font-weight: 600; display: flex; align-items: flex-start; gap: 6px; margin-top: 4px; line-height: 1.4;"><i class="fas fa-map-marker-alt" style="color: #cbd5e1; margin-top: 2px;"></i> ${escapeHtml(t.direccionText)}</span>` : ''}
                        </div>
                    </div>
                    <span class="badge ${badgeClass}" style="box-shadow: 0 2px 4px rgba(0,0,0,0.05);">${t.estado.replace(/_/g, ' ').toUpperCase()}</span>
                </div>
                <div style="font-size: 14px; color: #475569; line-height: 1.6; padding: 16px; background: #f8fafc; border-radius: 12px; border: 1px solid #e2e8f0;">
                    <strong style="font-size: 11px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.8px; display: block; margin-bottom: 8px;">Detalle de Intervención</strong>
                    ${escapeHtml(t.descripcion)}
                </div>
                ${estadoFooter}
            </div>`;
        }).join('');
    };

    const unsubActivos = onSnapshot(
        query(collection(db, "trabajos"), where("operarioId", "==", user.uid), where("estado", "in", ["asignado", "en_camino", "en_sitio", "retrasado", "revision_cliente", "evaluado_cliente", "reporte_aprobado"])),
        (snap) => { tareasActivas = snap.docs.map(d => ({ jobId: d.id, ...d.data() })); renderOperario(); },
        () => showToast("Error al cargar tareas activas.", "error")
    );

    const unsubCompletados = onSnapshot(
        query(collection(db, "trabajos"), where("operarioId", "==", user.uid), where("estado", "==", "completado"), orderBy("creadoEn", "desc"), limit(5)),
        (snap) => { tareasCompletadas = snap.docs.map(d => ({ jobId: d.id, ...d.data() })); renderOperario(); },
        () => { }
    );

    unsubOperario = () => { unsubActivos(); unsubCompletados(); };
};

// Global Operator Actions
window.iniciarRutaOperario = async (jobId, lat, lng) => {
    if (lat && lng) {
        window.open(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`, '_blank');
    } else {
        showToast("No se proveyeron coordenadas precisas para este pedido.", "warning");
    }

    try {
        await updateDoc(doc(db, "trabajos", jobId), {
            estado: 'en_camino',
            tiempoEnCamino: serverTimestamp()
        });
        showToast("Ruta iniciada.", "success");
    } catch (e) {
        showToast("Error: " + e.message, "error");
    }
};

window.llegadaOperario = (jobId, pinCode) => {
    document.getElementById('pinJobId').value = jobId;
    document.getElementById('pinExpected').value = pinCode;
    document.getElementById('pinIngresado').value = '';
    document.getElementById('modal-pin-operario').classList.remove('oculto');
};

window.verificarPinOperario = async () => {
    const input = document.getElementById('pinIngresado').value.trim();
    const expected = document.getElementById('pinExpected').value;
    const jobId = document.getElementById('pinJobId').value;

    if (input !== expected) {
        showToast("PIN Incorrecto. Asegúrate de pedirle el código de 4 dígitos al cliente.", "error");
        return;
    }

    const btn = document.getElementById('btnVerificarPin');
    const origText = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> VERIFICANDO...';
    btn.disabled = true;

    try {
        await updateDoc(doc(db, "trabajos", jobId), {
            estado: 'en_sitio',
            tiempoEnSitio: serverTimestamp()
        });
        document.getElementById('modal-pin-operario').classList.add('oculto');
        showToast("¡Llegada confirmada con éxito!", "success");
    } catch (e) {
        showToast("Error: " + e.message, "error");
    } finally {
        btn.innerHTML = origText;
        btn.disabled = false;
    }
};

window.retrasoOperario = async (jobId) => {
    try {
        await updateDoc(doc(db, "trabajos", jobId), { estado: 'retrasado' });
        showToast("Reportado como retrasado.", "warning");
    } catch (e) { showToast("Error: " + e.message, "error"); }
};

// Formulario Dinámico de Reporte Técnico
let reportRowCounters = { equipos: 0, detalles: 0, insumos: 0 };

window.agregarFila = (tipo) => {
    const container = document.getElementById(`rep${tipo.charAt(0).toUpperCase() + tipo.slice(1)}Container`);
    const id = reportRowCounters[tipo]++;
    let html = '';

    if (tipo === 'equipos') {
        html = `
        <div id="row-${tipo}-${id}" style="display: flex; gap: 8px; margin-bottom: 8px;">
            <input type="text" placeholder="Marca" class="input-premium" style="margin-bottom:0; flex:1;" id="eqMarca-${id}">
            <input type="text" placeholder="Modelo" class="input-premium" style="margin-bottom:0; flex:1;" id="eqModelo-${id}">
            <input type="text" placeholder="Contador" class="input-premium" style="margin-bottom:0; flex:0.8;" id="eqCont-${id}">
            <button onclick="document.getElementById('row-${tipo}-${id}').remove()" class="btn btn-outline" style="width:auto; border-color:var(--secondary); color:var(--secondary); padding: 0 12px;"><i class="fas fa-trash"></i></button>
        </div>`;
    } else if (tipo === 'detalles') {
        html = `
        <div id="row-${tipo}-${id}" style="display: flex; gap: 8px; margin-bottom: 8px;">
            <input type="text" placeholder="Diagnóstico Inicial" class="input-premium" style="margin-bottom:0; flex:1;" id="detDiag-${id}">
            <input type="text" placeholder="Solución Aplicada" class="input-premium" style="margin-bottom:0; flex:1;" id="detSol-${id}">
            <button onclick="document.getElementById('row-${tipo}-${id}').remove()" class="btn btn-outline" style="width:auto; border-color:var(--secondary); color:var(--secondary); padding: 0 12px;"><i class="fas fa-trash"></i></button>
        </div>`;
    } else if (tipo === 'insumos') {
        html = `
        <div id="row-${tipo}-${id}" style="display: flex; gap: 8px; margin-bottom: 8px;">
            <input type="text" placeholder="Descripción del Repuesto o Insumo" class="input-premium" style="margin-bottom:0; flex:2;" id="insDesc-${id}">
            <input type="number" placeholder="Cant." class="input-premium" style="margin-bottom:0; flex:0.5;" id="insCant-${id}">
            <button onclick="document.getElementById('row-${tipo}-${id}').remove()" class="btn btn-outline" style="width:auto; border-color:var(--secondary); color:var(--secondary); padding: 0 12px;"><i class="fas fa-trash"></i></button>
        </div>`;
    }

    container.insertAdjacentHTML('beforeend', html);
};

window.abrirReporteOperario = (jobId) => {
    document.getElementById('repJobId').value = jobId;
    document.getElementById('repCedula').value = '';
    document.getElementById('repCostoEmpresa').value = '';
    document.getElementById('repCostoTecnico').value = '';

    // Clear containers
    document.getElementById('repEquiposContainer').innerHTML = '';
    document.getElementById('repDetallesContainer').innerHTML = '';
    document.getElementById('repInsumosContainer').innerHTML = '';

    // Add 1 default row for each
    window.agregarFila('equipos');
    window.agregarFila('detalles');
    window.agregarFila('insumos');

    document.getElementById('modal-reporte-tecnico').classList.remove('oculto');
};

window.enviarReporteTecnico = async () => {
    if (!userData) return showToast("Error de autenticación.", "error");

    const jobId = document.getElementById('repJobId').value;
    const cedula = document.getElementById('repCedula').value.trim();
    if (!cedula) return showToast("La cédula responsable es obligatoria.", "error");

    const jobInfo = allOpJobs.find(j => j.jobId === jobId);

    // Recolectar Equipos
    const equipos = [];
    document.querySelectorAll('[id^="row-equipos-"]').forEach(row => {
        const id = row.id.split('-')[2];
        const marca = document.getElementById(`eqMarca-${id}`)?.value.trim();
        const modelo = document.getElementById(`eqModelo-${id}`)?.value.trim();
        const contador = document.getElementById(`eqCont-${id}`)?.value.trim();
        if (marca) equipos.push({ equipoMarca: marca, modelo, contador });
    });

    // Recolectar Detalles
    const detallesTecnicos = [];
    document.querySelectorAll('[id^="row-detalles-"]').forEach(row => {
        const id = row.id.split('-')[2];
        const diagnostico = document.getElementById(`detDiag-${id}`)?.value.trim();
        const solucion = document.getElementById(`detSol-${id}`)?.value.trim();
        if (diagnostico || solucion) detallesTecnicos.push({ diagnostico, solucion });
    });

    // Recolectar Insumos
    const insumos = [];
    document.querySelectorAll('[id^="row-insumos-"]').forEach(row => {
        const id = row.id.split('-')[2];
        const descripcion = document.getElementById(`insDesc-${id}`)?.value.trim();
        const cantidad = document.getElementById(`insCant-${id}`)?.value.trim();
        if (descripcion) insumos.push({ descripcion, cantidad });
    });

    const reporteTecnico = {
        encargadoNombre: userData.nombre,
        encargadoCedula: cedula,
        tipoServicio: jobInfo?.categoria || 'General',
        equipos,
        detallesTecnicos,
        insumos,
        costoEmpresa: parseFloat(document.getElementById('repCostoEmpresa').value.trim()) || 0.0,
        costoTecnico: parseFloat(document.getElementById('repCostoTecnico').value.trim()) || 0.0,
        fechaEmision: serverTimestamp()
    };

    const btn = document.getElementById('btnEnviarReporte');
    const origText = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> ENVIANDO...';
    btn.disabled = true;

    try {
        await updateDoc(doc(db, "trabajos", jobId), {
            estado: 'revision_cliente',
            reporteTecnico: reporteTecnico,
            tiempoCompletado: serverTimestamp()
        });
        document.getElementById('modal-reporte-tecnico').classList.add('oculto');
        showToast("Reporte finalizado y enviado al cliente con éxito.", "success");
    } catch (e) {
        showToast("Error: " + e.message, "error");
    } finally {
        btn.innerHTML = origText;
        btn.disabled = false;
    }
};

export const stopOperarioModule = () => {
    if (unsubOperario) { unsubOperario(); unsubOperario = null; }
};
