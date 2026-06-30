import { query, collection, where, onSnapshot, orderBy, limit, doc, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";
import { db } from "./config.js";
import { showToast } from "./ui.js";
import { userData } from "./auth.js";

const escapeHtml = (str) => {
    if (!str && str !== 0) return '';
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

// Formulario Dinámico de Reporte Técnico: Múltiples Trabajos
let subtrabajoCounter = 0;

window.agregarSubtrabajo = (prefillData = null) => {
    const container = document.getElementById('contenedor-subtrabajos');
    const id = subtrabajoCounter++;
    
    const html = `
    <div id="subtrabajo-${id}" style="background: var(--bg-app); padding: 16px; border-radius: 8px; margin-bottom: 16px; border: 1px solid var(--border); position: relative;">
        <button onclick="document.getElementById('subtrabajo-${id}').remove()" class="btn btn-outline" style="position: absolute; top: 10px; right: 10px; padding: 4px 8px; color: var(--danger); border-color: var(--danger);"><i class="fas fa-trash"></i></button>
        
        <label style="font-size: 12px; font-weight: 700; color: var(--text-muted); display: block; margin-bottom: 8px;">TIPO DE TRABAJO</label>
        <select id="tipoTrabajo-${id}" class="input-premium" onchange="cambiarTipoTrabajo(${id})">
            <option value="Mantenimiento">Mantenimiento / Reparación</option>
            <option value="Venta">Venta de Equipo / Insumo</option>
            <option value="Alquiler">Alquiler de Equipo</option>
        </select>

        <!-- Campos comunes a todos -->
        <div style="display: flex; gap: 8px; margin-bottom: 8px;">
            <input type="text" placeholder="ID Equipo" class="input-premium" style="margin-bottom:0; flex:0.6;" id="stIdPropio-${id}" value="${escapeHtml(prefillData?.idPropio || '')}">
            <input type="text" placeholder="Marca / Equipo" class="input-premium" style="margin-bottom:0; flex:1;" id="stMarca-${id}">
            <input type="text" placeholder="Modelo" class="input-premium" style="margin-bottom:0; flex:1;" id="stModelo-${id}" value="${escapeHtml(prefillData?.modelo || '')}">
        </div>
        <div style="display: flex; gap: 8px; margin-bottom: 8px;">
            <input type="text" placeholder="Serial" class="input-premium" style="margin-bottom:0; flex:1;" id="stSerial-${id}" value="${escapeHtml(prefillData?.serial || '')}">
            <input type="text" placeholder="Contador (Opcional)" class="input-premium" style="margin-bottom:0; flex:1;" id="stCont-${id}">
        </div>
        
        <!-- Campos específicos por tipo -->
        <div id="camposEspecificos-${id}">
        </div>
    </div>`;

    container.insertAdjacentHTML('beforeend', html);
    cambiarTipoTrabajo(id); // Para inicializar los campos
};

window.cambiarTipoTrabajo = (id) => {
    const tipo = document.getElementById(`tipoTrabajo-${id}`).value;
    const container = document.getElementById(`camposEspecificos-${id}`);
    
    let html = '';
    if (tipo === 'Mantenimiento') {
        html = `
            <input type="text" placeholder="Diagnóstico Inicial" class="input-premium" id="stDiag-${id}">
            <input type="text" placeholder="Solución Aplicada / Trabajo Realizado" class="input-premium" id="stSol-${id}">
            <input type="text" placeholder="Repuestos / Insumos utilizados (Opcional)" class="input-premium" style="margin-bottom:0;" id="stInsumos-${id}">
        `;
    } else if (tipo === 'Venta') {
        html = `
            <input type="text" placeholder="Descripción de la Venta" class="input-premium" id="stVentaDesc-${id}">
            <div style="display: flex; gap: 8px; margin-bottom: 0;">
                <input type="number" placeholder="Valor Venta ($)" class="input-premium" style="margin-bottom:0; flex:1;" id="stVentaValor-${id}">
                <input type="text" placeholder="Garantía (ej. 3 meses)" class="input-premium" style="margin-bottom:0; flex:1;" id="stVentaGarantia-${id}">
            </div>
        `;
    } else if (tipo === 'Alquiler') {
        html = `
            <input type="text" placeholder="Condiciones del Alquiler" class="input-premium" id="stAlqCond-${id}">
            <div style="display: flex; gap: 8px; margin-bottom: 0;">
                <input type="number" placeholder="Duración en meses" class="input-premium" style="margin-bottom:0; flex:1;" id="stAlqDuracion-${id}">
                <input type="number" placeholder="Valor Mensual ($)" class="input-premium" style="margin-bottom:0; flex:1;" id="stAlqValor-${id}">
            </div>
        `;
    }
    
    container.innerHTML = html;
};

window.abrirReporteOperario = (jobId) => {
    document.getElementById('repJobId').value = jobId;
    document.getElementById('repCedula').value = '';
    document.getElementById('repCostoEmpresa').value = '';
    document.getElementById('repCostoTecnico').value = '';

    // Limpiar contenedor dinámico
    document.getElementById('contenedor-subtrabajos').innerHTML = '';

    const jobActual = allOpJobs.find(j => j.jobId === jobId);

    // Buscar tickets para agrupar (mismo cliente, estado en sitio/retrasado)
    const agrupables = allOpJobs.filter(j => 
        j.jobId !== jobId && 
        j.clienteId === jobActual?.clienteId && 
        (j.estado === 'en_sitio' || j.estado === 'retrasado')
    );

    const contAgrupar = document.getElementById('opAgruparTicketsContainer');
    const listaAgrupar = document.getElementById('opListaTicketsAgrupar');

    // Añadir el trabajo actual por defecto prellenado
    window.agregarSubtrabajo({
        idPropio: jobActual?.maquinaIdPropio || '',
        modelo: jobActual?.maquinaModelo || '',
        serial: jobActual?.maquinaSerial || ''
    });

    if (agrupables.length > 0) {
        contAgrupar.style.display = 'block';
        listaAgrupar.innerHTML = agrupables.map(t => `
            <label style="display: flex; align-items: center; gap: 8px; background: white; padding: 8px 12px; border-radius: 6px; cursor: pointer; border: 1px solid #bae6fd;">
                <input type="checkbox" class="op-agrupar-chk" value="${t.jobId}" data-idpropio="${escapeHtml(t.maquinaIdPropio || '')}" data-modelo="${escapeHtml(t.maquinaModelo || '')}" data-serial="${escapeHtml(t.maquinaSerial || '')}" onchange="manejarCheckAgrupacion(this)">
                <div style="font-size: 13px; color: #0369a1; font-weight: 600;">
                    ${t.maquinaIdPropio ? `[${escapeHtml(t.maquinaIdPropio)}] ` : ''}${escapeHtml(t.maquinaModelo || t.categoria || 'Ticket General')}
                </div>
            </label>
        `).join('');
    } else {
        contAgrupar.style.display = 'none';
        listaAgrupar.innerHTML = '';
    }

    document.getElementById('modal-reporte-tecnico').classList.remove('oculto');
};

window.manejarCheckAgrupacion = (chk) => {
    if (chk.checked) {
        window.agregarSubtrabajo({
            idPropio: chk.dataset.idpropio,
            modelo: chk.dataset.modelo,
            serial: chk.dataset.serial
        });
        showToast("Reporte subtrabajo añadido para la máquina seleccionada.", "success");
    }
};

window.enviarReporteTecnico = async () => {
    if (!userData) return showToast("Error de autenticación.", "error");

    const jobId = document.getElementById('repJobId').value;
    const cedula = document.getElementById('repCedula').value.trim();
    if (!cedula) return showToast("La cédula responsable es obligatoria.", "error");

    const jobInfo = allOpJobs.find(j => j.jobId === jobId);

    // Recolectar Trabajos Dinámicos
    const trabajosReportados = [];
    document.querySelectorAll('[id^="subtrabajo-"]').forEach(row => {
        const id = row.id.split('-')[1];
        const tipo = document.getElementById(`tipoTrabajo-${id}`)?.value;
        const marca = document.getElementById(`stMarca-${id}`)?.value.trim() || '';
        const modelo = document.getElementById(`stModelo-${id}`)?.value.trim() || '';
        const contador = document.getElementById(`stCont-${id}`)?.value.trim() || '';
        const idPropio = document.getElementById(`stIdPropio-${id}`)?.value.trim() || '';
        const serial = document.getElementById(`stSerial-${id}`)?.value.trim() || '';
        
        let trabajo = { tipo, marca, modelo, contador, idPropio, serial };
        
        if (tipo === 'Mantenimiento') {
            const diagnostico = document.getElementById(`stDiag-${id}`)?.value.trim() || '';
            const solucion = document.getElementById(`stSol-${id}`)?.value.trim() || '';
            const insumos = document.getElementById(`stInsumos-${id}`)?.value.trim() || '';
            if (marca || modelo || diagnostico || solucion) {
                trabajo = { ...trabajo, diagnostico, solucion, insumos };
                trabajosReportados.push(trabajo);
            }
        } else if (tipo === 'Venta') {
            const descripcion = document.getElementById(`stVentaDesc-${id}`)?.value.trim() || '';
            const valor = parseFloat(document.getElementById(`stVentaValor-${id}`)?.value.trim()) || 0;
            const garantia = document.getElementById(`stVentaGarantia-${id}`)?.value.trim() || '';
            if (marca || modelo || descripcion || valor) {
                trabajo = { ...trabajo, descripcion, valor, garantia };
                trabajosReportados.push(trabajo);
            }
        } else if (tipo === 'Alquiler') {
            const condiciones = document.getElementById(`stAlqCond-${id}`)?.value.trim() || '';
            const duracion = parseInt(document.getElementById(`stAlqDuracion-${id}`)?.value.trim()) || 0;
            const valor = parseFloat(document.getElementById(`stAlqValor-${id}`)?.value.trim()) || 0;
            if (marca || modelo || condiciones || valor) {
                trabajo = { ...trabajo, condiciones, duracion, valorMensual: valor };
                trabajosReportados.push(trabajo);
            }
        }
    });

    if (trabajosReportados.length === 0) {
        return showToast("Debe agregar al menos un trabajo válido en el reporte.", "error");
    }

    const reporteTecnico = {
        encargadoNombre: userData.nombre,
        encargadoCedula: cedula,
        tipoServicio: jobInfo?.categoria || 'General',
        trabajosReportados: trabajosReportados, // Nuevo arreglo de subtrabajos
        costoEmpresa: parseFloat(document.getElementById('repCostoEmpresa').value.trim()) || 0.0,
        costoTecnico: parseFloat(document.getElementById('repCostoTecnico').value.trim()) || 0.0,
        fechaEmision: serverTimestamp()
    };

    const btn = document.getElementById('btnEnviarReporte');
    const origText = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> ENVIANDO...';
    btn.disabled = true;

    try {
        const batchJobs = [jobId];
        document.querySelectorAll('.op-agrupar-chk:checked').forEach(chk => {
            batchJobs.push(chk.value);
        });

        const promises = batchJobs.map(ticketId => updateDoc(doc(db, "trabajos", ticketId), {
            estado: 'revision_cliente',
            reporteTecnico: reporteTecnico,
            tiempoCompletado: serverTimestamp()
        }));

        await Promise.all(promises);

        document.getElementById('modal-reporte-tecnico').classList.add('oculto');
        showToast(`Reporte guardado exitosamente en ${batchJobs.length} ticket(s).`, "success");
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
