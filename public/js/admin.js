import { collection, query, where, orderBy, limit, onSnapshot, getDocs, startAfter, doc, updateDoc, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-functions.js";
import { db, functions } from "./config.js";
import { showToast, cambiarPestana } from "./ui.js";

// ─── VARIABLES DE ESTADO ──────────────────────────────────────────────────────
let cacheTrabajos = [];
let cacheEquipo = [];
let cacheClientes = [];
const PAGE_SIZE = 25;
let lastVisibleTrabajo = null;
let lastVisibleCliente = null;
let lastVisibleEquipo = null;
let hayMasTrabajos = false;
let hayMasClientes = false;
let hayMasEquipo = false;
let modoConsultaActivo = 'todos'; // 'todos' | 'estado:X' | 'busqueda:X'
let unsubDashboard = null;

// ─── ESTADO TEMPORAL DE MÁQUINAS (modal nuevo cliente) ───────────────────────
let maquinasTemp = [];
let maqLatTemp = null;
let maqLngTemp = null;
let _maqMapaLeaflet = null;

// ─── HELPER XSS ─────────────────────────────────────────────────────────────
function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// ─── HELPERS DE CACHÉ LOCAL ───────────────────────────────────────────────────
function patchCache(cache, id, changes) {
    const idx = cache.findIndex(x => x.id === id);
    if (idx !== -1) Object.assign(cache[idx], changes);
}
function removeFromCache(cache, id) {
    const idx = cache.findIndex(x => x.id === id);
    if (idx !== -1) cache.splice(idx, 1);
}

// ─── MÓDULO ADMINISTRADOR ─────────────────────────────────────────────────────
export const initAdminModule = () => {
    cargarDatosBase();
};

export const stopAdminModule = () => {
    if (unsubDashboard) { unsubDashboard(); unsubDashboard = null; }
};

export const cargarDatosBase = async () => {
    const btnSync = document.getElementById('btnSync');
    if (btnSync) btnSync.innerHTML = '<i class="fas fa-spinner fa-spin"></i> <span>Sincronizando...</span>';

    lastVisibleTrabajo = null;
    lastVisibleCliente = null;
    lastVisibleEquipo = null;
    cacheTrabajos = [];
    cacheClientes = [];
    cacheEquipo = [];
    modoConsultaActivo = 'todos';

    // Limpiar buscadores
    const bTrabajos = document.getElementById('buscadorTrabajos');
    if (bTrabajos) bTrabajos.value = '';
    const bClientes = document.getElementById('buscadorClientes');
    if (bClientes) bClientes.value = '';
    const bEquipo = document.getElementById('buscadorEquipo');
    if (bEquipo) bEquipo.value = '';

    document.getElementById('filtroAdmin').value = 'todos';

    try {
        // Cargar 25 clientes y 25 operarios iniciales (Paginación eficiente)
        const [cSnap, eSnap] = await Promise.all([
            getDocs(query(collection(db, "usuarios"), where("rol", "==", "cliente"), orderBy("creadoEn", "desc"), limit(PAGE_SIZE))),
            getDocs(query(collection(db, "usuarios"), where("rol", "==", "operario"), orderBy("creadoEn", "desc"), limit(PAGE_SIZE)))
        ]);

        cacheClientes = cSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        lastVisibleCliente = cSnap.docs[cSnap.docs.length - 1] || null;
        hayMasClientes = cSnap.docs.length === PAGE_SIZE;

        cacheEquipo = eSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        lastVisibleEquipo = eSnap.docs[eSnap.docs.length - 1] || null;
        hayMasEquipo = eSnap.docs.length === PAGE_SIZE;

        renderClientes();
        renderEquipo();
        actualizarBtnCargarMasUsers();

        // Iniciar Dashboard en Tiempo Real (últimos 25)
        escucharDashboard();

        showToast("Panel administrativo listo", "success");
    } catch (e) {
        showToast("Error al sincronizar datos", "error");
        console.error(e);
    } finally {
        if (btnSync) {
            btnSync.innerHTML = '<i class="fas fa-check"></i> <span>Actualizado</span>';
            setTimeout(() => { btnSync.innerHTML = '<i class="fas fa-sync-alt"></i> <span>Sincronizar Datos</span>'; }, 2000);
        }
    }
};

const escucharDashboard = () => {
    if (unsubDashboard) unsubDashboard();

    // ✅ Listener en tiempo real limitado a la página actual para ahorrar reads
    unsubDashboard = onSnapshot(
        query(collection(db, "trabajos"), orderBy("creadoEn", "desc"), limit(PAGE_SIZE)),
        (snap) => {
            cacheTrabajos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            lastVisibleTrabajo = snap.docs[snap.docs.length - 1] || null;
            hayMasTrabajos = snap.docs.length === PAGE_SIZE;

            actualizarBtnCargarMas();
            actualizarContador();
            renderTrabajos();
        },
        (err) => {
            console.error("Dashboard error:", err);
            showToast("Error en tiempo real", "error");
        }
    );
};

export const cargarMasTrabajos = async () => {
    if (!lastVisibleTrabajo || modoConsultaActivo !== 'todos') return;
    const btn = document.getElementById('btnCargarMas');
    const orig = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Cargando...';
    try {
        const snap = await getDocs(query(
            collection(db, "trabajos"),
            orderBy("creadoEn", "desc"),
            startAfter(lastVisibleTrabajo),
            limit(PAGE_SIZE)
        ));
        const nuevos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        cacheTrabajos = [...cacheTrabajos, ...nuevos];
        lastVisibleTrabajo = snap.docs[snap.docs.length - 1] || lastVisibleTrabajo;
        hayMasTrabajos = snap.docs.length === PAGE_SIZE;
        actualizarBtnCargarMas();
        actualizarContador();
        renderTrabajos();
    } catch (e) {
        showToast("Error al cargar más trabajos", "error");
    } finally {
        btn.innerHTML = orig;
    }
};

export const filtrarTrabajosPorEstado = async () => {
    const filtro = document.getElementById('filtroAdmin').value;
    if (unsubDashboard) { unsubDashboard(); unsubDashboard = null; }

    if (filtro === 'todos') { escucharDashboard(); return; }

    modoConsultaActivo = `estado:${filtro}`;
    lastVisibleTrabajo = null;
    hayMasTrabajos = false;

    try {
        const snap = await getDocs(query(
            collection(db, "trabajos"),
            where("estado", "==", filtro),
            orderBy("creadoEn", "desc"),
            limit(PAGE_SIZE)
        ));
        cacheTrabajos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        lastVisibleTrabajo = snap.docs[snap.docs.length - 1] || null;
        hayMasTrabajos = snap.docs.length === PAGE_SIZE;

        actualizarContador();
        actualizarBtnCargarMas();
        renderTrabajos();
    } catch (e) {
        showToast("Error al filtrar", "error");
    }
};

// ─ PAGINACIÓN ADICIONAL PARA USUARIOS ─

export const cargarMasClientes = async () => {
    if (!lastVisibleCliente) return;
    const btn = document.getElementById('btnCargarMasClientes');
    const orig = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Cargando...';
    try {
        const snap = await getDocs(query(
            collection(db, "usuarios"),
            where("rol", "==", "cliente"),
            orderBy("creadoEn", "desc"),
            startAfter(lastVisibleCliente),
            limit(PAGE_SIZE)
        ));
        const nuevos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        cacheClientes = [...cacheClientes, ...nuevos];
        lastVisibleCliente = snap.docs[snap.docs.length - 1] || lastVisibleCliente;
        hayMasClientes = snap.docs.length === PAGE_SIZE;
        renderClientes();
        actualizarBtnCargarMasUsers();
    } catch (e) {
        showToast("Error al cargar más clientes", "error");
    } finally { btn.innerHTML = orig; }
};

export const cargarMasEquipo = async () => {
    if (!lastVisibleEquipo) return;
    const btn = document.getElementById('btnCargarMasEquipo');
    const orig = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Cargando...';
    try {
        const snap = await getDocs(query(
            collection(db, "usuarios"),
            where("rol", "==", "operario"),
            orderBy("creadoEn", "desc"),
            startAfter(lastVisibleEquipo),
            limit(PAGE_SIZE)
        ));
        const nuevos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        cacheEquipo = [...cacheEquipo, ...nuevos];
        lastVisibleEquipo = snap.docs[snap.docs.length - 1] || lastVisibleEquipo;
        hayMasEquipo = snap.docs.length === PAGE_SIZE;
        renderEquipo();
        actualizarBtnCargarMasUsers();
    } catch (e) {
        showToast("Error al cargar más operarios", "error");
    } finally { btn.innerHTML = orig; }
};

const actualizarBtnCargarMasUsers = () => {
    const btnC = document.getElementById('btnCargarMasClientes');
    if (btnC) btnC.style.display = hayMasClientes ? 'inline-flex' : 'none';
    const btnE = document.getElementById('btnCargarMasEquipo');
    if (btnE) btnE.style.display = hayMasEquipo ? 'inline-flex' : 'none';
};

// ─ RENDERS ─
const actualizarContador = () => {
    const el = document.getElementById('trabajos-contador');
    if (el) el.textContent = `${cacheTrabajos.length} trabajo(s) visualizados`;
};

const actualizarBtnCargarMas = () => {
    const btn = document.getElementById('btnCargarMas');
    if (btn) btn.style.display = (hayMasTrabajos && modoConsultaActivo === 'todos') ? 'inline-flex' : 'none';
};

export const renderTrabajos = (lista = null) => {
    const table = document.getElementById('tabla-admin-trabajos');
    if (!table) return;

    const data = lista ?? cacheTrabajos;

    table.innerHTML = data.length === 0 ?
        '<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 20px;">No hay requerimientos.</td></tr>'
        : data.map(t => {
            let accion = '';
            // Botón de Ver Detalle (Ojo) siempre presente
            const btnVer = `<button class="btn btn-outline btn-small" onclick="verDetalleTrabajo('${t.id}')" title="Ver Detalles"><i class="fas fa-eye"></i></button>`;

            if (t.estado === 'solicitado') {
                accion = `<button class="btn btn-primary btn-small" onclick="abrirModalAsignar('${t.id}')">Asignar</button>`;
            } else if (t.estado === 'esperando_cierre') {
                accion = `<button class="btn btn-small" style="background:#0d9488;color:white;" onclick="marcarCompletado('${t.id}')"><i class="fas fa-check-double"></i> Completar</button>`;
            } else if (t.estado === 'completado' && !t.calificado) {
                accion = `<button class="btn btn-warning btn-small" onclick="abrirModalCalificar('${t.id}', '${t.operarioId}')"><i class="fas fa-star"></i> Calificar</button>`;
            } else if (t.calificado) {
                accion = `<span style="font-size: 11px; color: #fbbf24;">${'⭐'.repeat(t.puntosAdmin)}</span>`;
            } else {
                accion = `<span style="font-size: 12px; color: var(--text-muted);"><i class="fas fa-lock"></i> Gestionando</span>`;
            }

            return `
            <tr>
                <td><span class="badge badge-${t.estado ? t.estado.toLowerCase().split('_')[0] : 'solicitado'}">${escapeHtml((t.estado || 'SOLICITADO').toUpperCase())}</span></td>
                <td style="font-weight: 700;">${escapeHtml(t.clienteNombre) || 'Sin Registro'}</td>
                <td style="color: var(--primary); font-weight: 600;">${escapeHtml(t.servicio || t.categoria) || 'General'}</td>
                <td>
                    <span style="display: flex; align-items: center; gap: 8px;">
                        <i class="fas fa-hard-hat" style="color: ${t.operarioNombre ? 'var(--warning)' : 'var(--border)'};"></i>
                        <span style="color: ${t.operarioNombre ? 'inherit' : 'var(--text-muted)'}">${escapeHtml(t.operarioNombre) || 'Pendiente...'}</span>
                    </span>
                </td>
                <td style="text-align: center;">${btnVer}</td>
                <td style="text-align: center;">${accion}</td>
            </tr>`;
        }).join('');
};

export const renderClientes = (lista = null) => {
    const data = lista ?? cacheClientes;
    const table = document.getElementById('tabla-admin-clientes');
    if (!table) return;

    table.innerHTML = data.length === 0 ?
        '<tr><td colspan="5" style="text-align: center; padding: 20px;">No hay clientes.</td></tr>'
        : data.map(c => `
        <tr>
            <td>
                <div style="font-weight: 700;">${escapeHtml(c.nombre)}</div>
                <div style="font-size: 11px; margin-top: 4px;">
                    ${c.activo === false ? '<span style="color: var(--danger);">● PENDIENTE</span>' : '<span style="color: #22c55e;">● ACTIVO</span>'}
                </div>
            </td>
            <td style="font-size: 13px;">${escapeHtml(c.contacto) || 'N/A'}</td>
            <td style="text-align: center;">
                <span style="background: var(--bg-app); padding: 4px 12px; border-radius: 8px; font-weight: 700; color: var(--secondary);">${c.totalServicios || 0}</span>
            </td>
            <td style="text-align: center;">
                <button class="btn btn-outline btn-small" onclick="verDetalleUsuario('${c.id}', 'cliente')" title="Ver Expediente"><i class="fas fa-eye"></i></button>
            </td>
            <td style="text-align: center;">
                <button class="btn btn-outline btn-small" onclick="abrirModalNuevoPedido('${c.id}')" title="Crear Pedido"><i class="fas fa-ticket-alt" style="color: var(--primary);"></i></button>
            </td>
        </tr>
    `).join('');
};

export const renderEquipo = (lista = null) => {
    const data = lista ?? cacheEquipo;
    const table = document.getElementById('tabla-admin-equipo');
    if (!table) return;

    table.innerHTML = data.length === 0 ?
        '<tr><td colspan="4" style="text-align: center; padding: 20px;">Fuerza operativa vacía.</td></tr>'
        : data.map(o => {
            const statusColor = o.activo === false ? 'var(--danger)' : '#22c55e';
            return `
            <tr>
                <td style="font-weight: 700;">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <i class="fas fa-id-badge" style="color: var(--warning);"></i>
                        <div>
                            <div>${escapeHtml(o.nombre)}</div>
                            <div style="font-size: 11px; color: #fbbf24;">${'⭐'.repeat(Math.round(o.calificacion || 0)) || 'Sin calificar'}</div>
                        </div>
                    </div>
                </td>
                <td style="font-weight: 600; font-size: 13px;">
                    ${(Array.isArray(o.capacidades) ? o.capacidades[0] : o.capacidades) === 'Certificado'
                    ? '<span style="color: #22c55e; background: #22c55e15; padding: 4px 8px; border-radius: 6px;">✅ CERTIFICADO</span>'
                    : '<span style="color: var(--text-muted); background: var(--bg-app); padding: 4px 8px; border-radius: 6px;">❌ SIN CERT.</span>'}
                </td>
                <td style="text-align: center;">
                    <button class="btn btn-outline btn-small" onclick="verDetalleUsuario('${o.id}', 'operario')" title="Ver Ficha"><i class="fas fa-eye"></i></button>
                </td>
                <td style="text-align: center;">
                    <span class="badge" style="background: ${statusColor}20; color: ${statusColor}; border: 1px solid ${statusColor}40;">${o.activo === false ? 'SUSPENDIDO' : 'ACTIVO'}</span>
                </td>
            </tr>`;
        }).join('');
};

// ─ BÚSQUEDA ─
let _searchTimerTrabajos = null;
let _searchTimerClientes = null;
let _searchTimerEquipo = null;

export const buscarTrabajosServidor = (texto) => {
    clearTimeout(_searchTimerTrabajos);
    const term = texto.trim();
    if (!term) { filtrarTrabajosPorEstado(); return; }

    _searchTimerTrabajos = setTimeout(async () => {
        if (unsubDashboard) { unsubDashboard(); unsubDashboard = null; }
        modoConsultaActivo = `busqueda:${term}`;
        try {
            const snap = await getDocs(query(
                collection(db, "trabajos"),
                where("clienteNombre", ">=", term),
                where("clienteNombre", "<=", term + "\uf8ff"),
                limit(50)
            ));
            cacheTrabajos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            actualizarContador();
            renderTrabajos();
            document.getElementById('btnCargarMas').style.display = 'none';
        } catch (e) { showToast("Error en la búsqueda", "error"); }
    }, 400);
};

export const buscarClientesServidor = (texto) => {
    clearTimeout(_searchTimerClientes);
    const term = texto.trim();
    if (!term) {
        renderClientes();
        document.getElementById('btnCargarMasClientes').style.display = hayMasClientes ? 'inline-flex' : 'none';
        return;
    }

    _searchTimerClientes = setTimeout(async () => {
        try {
            const snap = await getDocs(query(
                collection(db, "usuarios"),
                where("rol", "==", "cliente"),
                where("nombre", ">=", term),
                where("nombre", "<=", term + "\uf8ff"),
                limit(50)
            ));
            const resultados = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            renderClientes(resultados);
            document.getElementById('btnCargarMasClientes').style.display = 'none';
        } catch (e) { console.error(e); }
    }, 400);
};

export const buscarEquipoServidor = (texto) => {
    clearTimeout(_searchTimerEquipo);
    const term = texto.trim();
    if (!term) {
        renderEquipo();
        document.getElementById('btnCargarMasEquipo').style.display = hayMasEquipo ? 'inline-flex' : 'none';
        return;
    }

    _searchTimerEquipo = setTimeout(async () => {
        try {
            const snap = await getDocs(query(
                collection(db, "usuarios"),
                where("rol", "==", "operario"),
                where("nombre", ">=", term),
                where("nombre", "<=", term + "\uf8ff"),
                limit(50)
            ));
            const resultados = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            renderEquipo(resultados);
            document.getElementById('btnCargarMasEquipo').style.display = 'none';
        } catch (e) { console.error(e); }
    }, 400);
};

// ─ JOB ACTIONS ─
export const verDetalleTrabajo = (id) => {
    const t = cacheTrabajos.find(item => item.id === id);
    if (!t) return showToast("No se encontró el requerimiento.", "error");

    document.getElementById('detJobId').innerText = t.id.substring(0, 8);
    document.getElementById('detJobDesc').innerText = t.descripcion || 'Sin descripción detallada.';
    document.getElementById('detJobCliente').innerText = t.clienteNombre || 'Anónimo';
    document.getElementById('detJobServicio').innerText = t.servicio || t.categoria || 'General';
    document.getElementById('detJobOperario').innerText = t.operarioNombre || 'Sin técnico asignado';
    
    const dirTextoElem = document.getElementById('detJobDireccion');
    if (dirTextoElem) dirTextoElem.innerText = t.direccionText || 'No se especificó dirección escrita.';

    const badge = document.getElementById('detJobPrioridad');
    badge.innerText = (t.prioridad || 'Media').toUpperCase();
    badge.className = `badge badge-${(t.prioridad || 'media').toLowerCase()}`;

    let fechaStr = 'No disponible';
    if (t.creadoEn) {
        const dt = t.creadoEn.toDate ? t.creadoEn.toDate() : new Date(t.creadoEn);
        fechaStr = dt.toLocaleDateString() + ' ' + dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    document.getElementById('detJobFecha').innerText = fechaStr;

    // Calcular tiempo de trabajo del operario
    // Calcular tiempo de trabajo del operario
    let tiempoTrabajoStr = 'N/A';
    if (t.tiempoInicioTrabajo && (t.tiempoFinTrabajo || t.fechaCierreFacturacion)) {
        const d1 = t.tiempoInicioTrabajo.toDate ? t.tiempoInicioTrabajo.toDate() : new Date(t.tiempoInicioTrabajo);
        const tf = t.tiempoFinTrabajo || t.fechaCierreFacturacion;
        const d2 = tf.toDate ? tf.toDate() : new Date(tf);
        const diffMs = d2 - d1;
        if (diffMs >= 0) {
            const diffMin = Math.floor(diffMs / 60000);
            const hours = Math.floor(diffMin / 60);
            const mins = diffMin % 60;
            tiempoTrabajoStr = `${hours}h ${mins}m`;
        }
    } else if (t.tiempoInicioTrabajo && !t.tiempoFinTrabajo && !t.fechaCierreFacturacion) {
        tiempoTrabajoStr = 'Trabajando...';
    }
    const detJobTiempo = document.getElementById('detJobTiempo');
    if (detJobTiempo) detJobTiempo.innerText = tiempoTrabajoStr;

    // Control "MARCAR COMPLETADO" y "CERRAR Y FACTURAR" buttons
    const btnCierre = document.getElementById('btnCierreAdmin');
    const btnCompletar = document.getElementById('btnCompletarAdmin');
    if (t.estado === 'esperando_cierre') {
        if (btnCompletar) btnCompletar.classList.remove('oculto');
        if (btnCierre) btnCierre.classList.add('oculto');
    } else if (t.estado === 'completado' || t.estado === 'evaluado_cliente') {
        if (btnCompletar) btnCompletar.classList.add('oculto');
        if (btnCierre) btnCierre.classList.remove('oculto');
    } else {
        if (btnCompletar) btnCompletar.classList.add('oculto');
        if (btnCierre) btnCierre.classList.add('oculto');
    }

    // Set map job ID
    document.getElementById('mapaJobId').value = t.id;



    const containerReporte = document.getElementById('detJobReporteContainer');
    const contenidoReporte = document.getElementById('detJobReporteContenido');

    if (t.reporteTecnico) {
        if (containerReporte) containerReporte.classList.remove('oculto');
        const rep = t.reporteTecnico;
        let html = `
            <div style="margin-bottom: 8px;"><strong>Técnico Encargado:</strong> ${escapeHtml(rep.encargadoNombre || t.operarioNombre)}</div>
            <div style="margin-bottom: 8px;"><strong>Cédula:</strong> ${escapeHtml(rep.encargadoCedula || 'N/D')}</div>
        `;

        // Nueva Lógica Retrocompatible
        if (rep.trabajosReportados && rep.trabajosReportados.length > 0) {
            rep.trabajosReportados.forEach((trabajo, i) => {
                html += `<div style="margin-top: 12px; background: white; border-left: 3px solid var(--primary); padding: 8px; border-radius: 4px;">`;
                html += `<div style="font-weight: 800; font-size: 13px; color: var(--primary); margin-bottom: 4px;">${i + 1}. Trabajo de ${escapeHtml(trabajo.tipo)}</div>`;
                if (trabajo.marca || trabajo.modelo || trabajo.idPropio || trabajo.serial) {
                    html += `<div style="font-size: 12px; color: var(--text-muted); margin-bottom: 4px;"><strong>Equipo:</strong> `;
                    if (trabajo.idPropio) html += `[${escapeHtml(trabajo.idPropio)}] `;
                    html += `${escapeHtml(trabajo.marca)} ${escapeHtml(trabajo.modelo)} `;
                    if (trabajo.serial) html += `(SN: ${escapeHtml(trabajo.serial)}) `;
                    if (trabajo.contador) html += `(Contador: ${escapeHtml(trabajo.contador)})`;
                    html += `</div>`;
                }

                if (trabajo.tipo === 'Mantenimiento') {
                    if (trabajo.diagnostico) html += `<div style="font-size: 12px; margin-top: 4px;"><strong>Diagnóstico:</strong> ${escapeHtml(trabajo.diagnostico)}</div>`;
                    if (trabajo.solucion) html += `<div style="font-size: 12px; margin-top: 4px;"><strong>Solución:</strong> ${escapeHtml(trabajo.solucion)}</div>`;
                    if (trabajo.insumos) html += `<div style="font-size: 12px; margin-top: 4px;"><strong>Insumos:</strong> ${escapeHtml(trabajo.insumos)}</div>`;
                } else if (trabajo.tipo === 'Venta') {
                    if (trabajo.descripcion) html += `<div style="font-size: 12px; margin-top: 4px;"><strong>Detalle Venta:</strong> ${escapeHtml(trabajo.descripcion)}</div>`;
                    if (trabajo.valor) html += `<div style="font-size: 12px; margin-top: 4px; color: #16a34a; font-weight: bold;"><strong>Valor Venta:</strong> $${escapeHtml(trabajo.valor)}</div>`;
                    if (trabajo.garantia) html += `<div style="font-size: 12px; margin-top: 4px;"><strong>Garantía:</strong> ${escapeHtml(trabajo.garantia)}</div>`;
                } else if (trabajo.tipo === 'Alquiler') {
                    if (trabajo.condiciones) html += `<div style="font-size: 12px; margin-top: 4px;"><strong>Condiciones:</strong> ${escapeHtml(trabajo.condiciones)}</div>`;
                    if (trabajo.duracion) html += `<div style="font-size: 12px; margin-top: 4px;"><strong>Duración:</strong> ${escapeHtml(trabajo.duracion)} meses</div>`;
                    if (trabajo.valorMensual) html += `<div style="font-size: 12px; margin-top: 4px; color: #0284c7; font-weight: bold;"><strong>Canon Mensual:</strong> $${escapeHtml(trabajo.valorMensual)}</div>`;
                }
                html += `</div>`;
            });
        } else {
            // Lógica Antigua (Retrocompatibilidad)
            if (rep.equipos && rep.equipos.length > 0) {
                html += `<div style="margin-top: 12px; font-weight: bold; border-bottom: 1px solid var(--border); padding-bottom: 4px;">Equipos Intervenidos:</div>`;
                rep.equipos.forEach(e => {
                    html += `<div style="font-size: 12px; margin-top: 4px;">• ${escapeHtml(e.equipoMarca)} ${escapeHtml(e.modelo)} (Contador: ${escapeHtml(e.contador)})</div>`;
                });
            }

            if (rep.detallesTecnicos && rep.detallesTecnicos.length > 0) {
                html += `<div style="margin-top: 12px; font-weight: bold; border-bottom: 1px solid var(--border); padding-bottom: 4px;">Detalles de la Intervención:</div>`;
                rep.detallesTecnicos.forEach((d, i) => {
                    html += `<div style="margin-top: 8px; border-left: 2px solid var(--primary); padding-left: 8px;">
                        <div style="font-size: 11px; color: var(--text-muted); font-weight: 700;">DIAGNÓSTICO ${i + 1}:</div>
                        <div style="margin-bottom: 4px;">${escapeHtml(d.diagnostico)}</div>
                        <div style="font-size: 11px; color: var(--text-muted); font-weight: 700;">SOLUCIÓN:</div>
                        <div>${escapeHtml(d.solucion)}</div>
                    </div>`;
                });
            }

            if (rep.insumos && rep.insumos.length > 0) {
                html += `<div style="margin-top: 12px; font-weight: bold; border-bottom: 1px solid var(--border); padding-bottom: 4px;">Repuestos e Insumos:</div>`;
                rep.insumos.forEach(ins => {
                    html += `<div style="font-size: 12px; margin-top: 4px;">• ${escapeHtml(ins.cantidad)}x ${escapeHtml(ins.descripcion)}</div>`;
                });
            }
        }

        if (rep.costoEmpresa || rep.costoTecnico) {
            html += `<div style="margin-top: 12px; font-weight: bold;">Costos liquidados: $${escapeHtml(rep.costoEmpresa || 0)} (Empresa) / $${escapeHtml(rep.costoTecnico || 0)} (Técnico)</div>`;
        }

        if (t.evaluacionCliente) {
            const evalData = t.evaluacionCliente;
            let starHtml = '';
            for (let i = 0; i < 5; i++) {
                starHtml += `<i class="${i < evalData.estrellas ? 'fas' : 'far'} fa-star"></i>`;
            }
            html += `<div style="margin-top: 16px; border-top: 1px dashed var(--border); padding-top: 12px;">
                 <div style="font-size: 12px; font-weight: bold; margin-bottom: 4px;">CALIFICACIÓN DEL CLIENTE:</div>
                 <div style="color: #f59e0b; margin-bottom: 4px;">${starHtml}</div>
                 <div style="font-style: italic; color: var(--text-muted);">"${escapeHtml(evalData.comentario || 'Sin comentario')}"</div>
             </div>`;
        } else if (t.estado === 'revision_cliente') {
            html += `<div style="margin-top: 16px; padding: 8px; background: #FEFCE8; color: #854D0E; border-radius: 6px; font-size: 12px; font-weight: 600;">
                 <i class="fas fa-clock"></i> Pendiente de aprobación por el cliente...
             </div>`;
        } else if (t.reporteRechazado) {
            html += `<div style="margin-top: 16px; padding: 8px; background: #FEF2F2; color: #991B1B; border-radius: 6px; font-size: 12px; font-weight: 600;">
                 <i class="fas fa-times-circle"></i> El cliente ha rechazado este reporte. El técnico debe generarlo de nuevo.
             </div>`;
        }

        if (contenidoReporte) contenidoReporte.innerHTML = html;
    } else {
        if (containerReporte) containerReporte.classList.add('oculto');
        if (contenidoReporte) contenidoReporte.innerHTML = '';
    }

    document.getElementById('modal-detalle-trabajo').classList.remove('oculto');
};

export const abrirModalAsignar = (jobId) => {
    const input = document.getElementById('asigJobId');
    if (input) input.value = jobId;
    const select = document.getElementById('asigSelectOp');
    if (select) {
        let options = '<option value="">Selecciona al técnico...</option>';
        cacheEquipo.forEach(op => {
            options += `<option value="${op.id}">${escapeHtml(op.nombre)}</option>`;
        });
        select.innerHTML = options;
    }
    document.getElementById('modal-asignar').classList.remove('oculto');
};

export const confirmarAsignacion = async () => {
    const jobId = document.getElementById('asigJobId').value;
    const sValue = document.getElementById('asigSelectOp').value;
    if (!sValue) return showToast("Por favor selecciona un técnico.", "error");

    const opId = sValue;
    const opData = cacheEquipo.find(op => op.id === opId);
    const opNombre = opData ? opData.nombre : '';
    const btn = document.getElementById('btnAsigarTicket');
    const originText = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> PROCESANDO...';

    try {
        await updateDoc(doc(db, "trabajos", jobId), {
            estado: 'asignado', operarioId: opId, operarioNombre: opNombre
        });
        showToast("Técnico asignado", "success");
        document.getElementById('modal-asignar').classList.add('oculto');
    } catch (err) {
        showToast("Error al asignar", "error");
    } finally {
        btn.innerHTML = originText;
    }
};

// Exponer globalmente para onclick
window.cargarMasTrabajos = cargarMasTrabajos;
window.cargarMasClientes = cargarMasClientes;
window.cargarMasEquipo = cargarMasEquipo;
window.filtrarTrabajosPorEstado = filtrarTrabajosPorEstado;
window.buscarTrabajosServidor = buscarTrabajosServidor;
window.buscarClientesServidor = buscarClientesServidor;
window.buscarEquipoServidor = buscarEquipoServidor;
window.verDetalleTrabajo = verDetalleTrabajo;
window.confirmarAsignacion = confirmarAsignacion;
window.abrirModalAsignar = abrirModalAsignar;
window.cargarDatosBase = cargarDatosBase;
let adminCrearMap = null;

window.abrirModalNuevoPedido = (id) => {
    const clientData = cacheClientes.find(c => c.id === id);
    const nombre = clientData ? clientData.nombre : '';
    document.getElementById('padminClientId').value = id;
    document.getElementById('padminClientName').innerText = nombre;
    document.getElementById('padminDesc').value = '';
    document.getElementById('padminDirTexto').value = '';

    // Poblar selector de operarios desde el cache
    const select = document.getElementById('padminOperario');
    let options = '<option value="">— Sin asignar por ahora —</option>';
    cacheEquipo.forEach(op => {
        const cert = (Array.isArray(op.capacidades) ? op.capacidades[0] : op.capacidades) === 'Certificado' ? '✅' : '';
        options += `<option value="${op.id}">${cert} ${escapeHtml(op.nombre)}</option>`;
    });
    select.innerHTML = options;

    document.getElementById('modal-nuevo-pedido-admin').classList.remove('oculto');
    
    // Initialize map
    if (!adminCrearMap) {
        setTimeout(() => {
            adminCrearMap = L.map('mapaAdminCrearView').setView([10.3910, -75.4794], 13); // Default Cartagena
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(adminCrearMap);
            if (navigator.geolocation) {
                navigator.geolocation.getCurrentPosition(pos => {
                    adminCrearMap.setView([pos.coords.latitude, pos.coords.longitude], 15);
                }, () => {});
            }
        }, 300);
    } else {
        setTimeout(() => adminCrearMap.invalidateSize(), 300);
    }

    // Renderizar máquinas del cliente
    const container = document.getElementById('padminMaquinasContainer');
    const lista = document.getElementById('padminListaMaquinas');
    
    if (clientData && Array.isArray(clientData.maquinas) && clientData.maquinas.length > 0) {
        container.style.display = 'block';
        lista.innerHTML = clientData.maquinas.map((m, index) => `
            <div style="background: var(--bg-app); border: 1px solid var(--border); border-radius: 8px; margin-bottom: 8px; overflow: hidden;">
                <label style="display: flex; align-items: flex-start; gap: 10px; cursor: pointer; padding: 12px; transition: background 0.2s;" onmouseover="this.style.background='#f1f5f9'" onmouseout="this.style.background='transparent'">
                    <input type="checkbox" class="admin-maq-checkbox" data-index="${index}" onchange="toggleAdminMaqCheckbox(this, ${index})" style="margin-top: 3px; accent-color: var(--primary);">
                    <div style="flex: 1;">
                        <div style="font-weight: 700; color: var(--text-main); font-size: 13px;">
                            ${m.idPropio ? `[${escapeHtml(m.idPropio)}] ` : ''}${escapeHtml(m.modelo || 'Sin modelo')}
                        </div>
                        ${m.serial ? `<div style="font-size: 11px; color: var(--text-muted);">Serie: ${escapeHtml(m.serial)}</div>` : ''}
                        ${m.ubicacionLocal ? `<div style="font-size: 11px; color: var(--text-muted);"><i class="fas fa-map-pin"></i> ${escapeHtml(m.ubicacionLocal)}</div>` : ''}
                    </div>
                    ${m.lat ? `<div style="font-size: 10px; color: #16a34a; background: #dcfce7; padding: 2px 6px; border-radius: 4px;"><i class="fas fa-map-marker-alt"></i> GPS</div>` : ''}
                </label>
                <textarea id="adminMaqDesc_${index}" placeholder="Describa qué problema presenta esta máquina específica..." class="input-premium" style="display: none; height: 70px; resize: vertical; width: calc(100% - 24px); margin: 0 12px 12px 12px; font-size: 13px;"></textarea>
            </div>
        `).join('');
    } else {
        container.style.display = 'none';
        lista.innerHTML = '';
    }
};

window.toggleAdminMaqCheckbox = (chk, index) => {
    const txtArea = document.getElementById(`adminMaqDesc_${index}`);
    if (chk.checked) {
        txtArea.style.display = 'block';
        txtArea.focus();
    } else {
        txtArea.style.display = 'none';
        txtArea.value = '';
    }

    const anyChecked = document.querySelectorAll('.admin-maq-checkbox:checked').length > 0;
    const globalDesc = document.getElementById('padminDescGlobalContainer');
    if (globalDesc) {
        globalDesc.style.display = anyChecked ? 'none' : 'block';
    }
};

window.crearPedidoAdmin = async () => {
    const clientId = document.getElementById('padminClientId').value;
    const clientName = document.getElementById('padminClientName').innerText;
    const servicio = document.getElementById('padminServicio').value;
    const desc = document.getElementById('padminDesc').value;
    const urgency = document.getElementById('padminUrgency').value;
    const opValue = document.getElementById('padminOperario').value;

    if (!desc.trim()) return showToast("Por favor describe el requerimiento.", "error");

    const btn = document.getElementById('btnCrearPedidoAdmin');
    const original = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> PROCESANDO...';
    btn.disabled = true;

    const opId = opValue || null;
    const opData = opId ? cacheEquipo.find(op => op.id === opId) : null;
    const opNombre = opData ? opData.nombre : null;
    const estaAsignado = !!opId;
    const dirTexto = document.getElementById('padminDirTexto').value.trim();

    // Comprobar checkboxes
    const checkboxes = document.querySelectorAll('.admin-maq-checkbox:checked');
    const clientData = cacheClientes.find(c => c.id === clientId);

    if (checkboxes.length > 0 && clientData) {
        // FLUJO LOTE (Múltiples Máquinas)
        let todasTienenDesc = true;
        for (let chk of checkboxes) {
            const index = chk.dataset.index;
            const descMaq = document.getElementById(`adminMaqDesc_${index}`).value.trim();
            if (!descMaq) { todasTienenDesc = false; break; }
        }

        if (!todasTienenDesc) {
            btn.innerHTML = original;
            btn.disabled = false;
            return showToast("Debes describir el problema para cada máquina seleccionada.", "error");
        }

        try {
            const promesasLote = [];
            for (let chk of checkboxes) {
                const index = chk.dataset.index;
                const m = clientData.maquinas[parseInt(index)];
                if (!m) continue; // Guard: índice inválido o datos desactualizados
                const descMaq = document.getElementById(`adminMaqDesc_${index}`)?.value.trim();
                if (!descMaq) continue;
                
                const descripcionTicket = `${m.idPropio ? `[${m.idPropio}] ` : ''}${m.modelo}:\n${descMaq}`;
                const direccionBase = [m.ubicacionLocal, m.direccion, m.barrio, m.ciudad].filter(Boolean).join(', ');

                // Fallback a mapa manual si no hay GPS de la maq
                let mLat = m.lat || 10.3910;
                let mLng = m.lng || -75.4794;
                if (!m.lat && adminCrearMap) {
                    const center = adminCrearMap.getCenter();
                    mLat = center.lat;
                    mLng = center.lng;
                }

                promesasLote.push(addDoc(collection(db, "trabajos"), {
                    clienteId: clientId,
                    clienteNombre: clientName,
                    categoria: servicio,
                    servicio: servicio,
                    descripcion: descripcionTicket,
                    direccionText: direccionBase || dirTexto,
                    lat: mLat,
                    lng: mLng,
                    urgencia: urgency,
                    estado: estaAsignado ? 'asignado' : 'solicitado',
                    operarioId: opId || null,
                    operarioNombre: opNombre || null,
                    maquinaIdPropio: m.idPropio || null,
                    maquinaModelo: m.modelo || null,
                    maquinaSerial: m.serial || null,
                    creadoEn: serverTimestamp(),
                    creadoPor: 'Administrador'
                }));
            }
            await Promise.all(promesasLote);
            showToast(`¡Tickets generados para ${checkboxes.length} máquinas!`, "success");
            document.getElementById('modal-nuevo-pedido-admin').classList.add('oculto');
        } catch (e) {
            console.error(e);
            showToast("Error al crear pedidos múltiples.", "error");
        } finally {
            btn.innerHTML = original;
            btn.disabled = false;
        }
        return;
    }

    // FLUJO NORMAL (1 Ticket General)

    let lat = 10.3910, lng = -75.4794;
    if (adminCrearMap) {
        const center = adminCrearMap.getCenter();
        lat = center.lat;
        lng = center.lng;
    }

    try {
        await addDoc(collection(db, "trabajos"), {
            clienteId: clientId,
            clienteNombre: clientName,
            categoria: servicio,
            servicio: servicio,
            descripcion: desc,
            direccionText: dirTexto,
            lat: lat,
            lng: lng,
            urgencia: urgency,
            estado: estaAsignado ? 'asignado' : 'solicitado',
            operarioId: opId || null,
            operarioNombre: opNombre || null,
            creadoEn: serverTimestamp(),
            creadoPor: 'Administrador'
        });

        const msg = estaAsignado
            ? `Ticket creado y asignado a ${opNombre}.`
            : "Ticket creado. Puedes asignar un técnico desde el tablero.";
        showToast(msg, "success");
        document.getElementById('modal-nuevo-pedido-admin').classList.add('oculto');
    } catch (e) {
        console.error(e);
        showToast("Error al crear el pedido.", "error");
    } finally {
        btn.innerHTML = original;
        btn.disabled = false;
    }
};

// ─── CRM & CRUD LOGIC ─────────────────────────────────────────────────────────

export const verDetalleUsuario = (uid, rol) => {
    const user = (rol === 'cliente' ? cacheClientes : cacheEquipo).find(u => u.id === uid);
    if (!user) return;

    const modal = document.getElementById('modal-detalle-usuario');
    const titulo = document.getElementById('detalle-titulo');
    const contenido = document.getElementById('detalle-contenido');

    titulo.innerText = rol === 'cliente' ? 'Expediente del Cliente' : 'Ficha de Operativo';

    let html = `
        <div style="display: grid; gap: 15px;">
            <div style="background: var(--bg-app); padding: 15px; border-radius: 12px;">
                <small style="color: var(--text-muted); display: block; margin-bottom: 5px;">Nombre / Razón Social</small>
                <strong>${escapeHtml(user.nombre)}</strong>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                <div>
                     <small style="color: var(--text-muted); display: block; margin-bottom: 5px;">Correo</small>
                     <span style="font-size: 13px;">${escapeHtml(user.email)}</span>
                </div>
                <div>
                     <small style="color: var(--text-muted); display: block; margin-bottom: 5px;">Teléfono</small>
                     <span style="font-size: 13px;">${escapeHtml(user.telefono || 'No reg.')}</span>
                </div>
            </div>
    `;

    if (rol === 'operario') {
        const cap = (Array.isArray(user.capacidades) ? user.capacidades[0] : user.capacidades) === 'Certificado';
        html += `
            <div style="background: var(--bg-app); padding: 15px; border-radius: 12px;">
                <small style="color: var(--text-muted); display: block; margin-bottom: 5px;">Estado de Certificación</small>
                <strong style="color: ${cap ? '#22c55e' : 'var(--text-muted)'}">${cap ? '✅ Técnico Certificado Profesional' : '❌ Pendiente de Certificación'}</strong>
            </div>
            <div style="background: var(--bg-app); padding: 15px; border-radius: 12px;">
                <small style="color: var(--text-muted); display: block; margin-bottom: 5px;">Fecha Inicio de Labores</small>
                <span>${user.fechaContratacion || 'No registrada'}</span>
            </div>
        `;
    } else {
        html += `
            <div style="background: var(--bg-app); padding: 15px; border-radius: 12px;">
                <small style="color: var(--text-muted); display: block; margin-bottom: 5px;">Dirección de Servicio</small>
                <span>${user.direccion || 'No registrada'}</span>
            </div>
        `;

        // Máquinas registradas del cliente
        const maqsArr = Array.isArray(user.maquinas) ? user.maquinas : [];
        if (maqsArr.length > 0) {
            html += `<div style="background: var(--bg-app); padding: 15px; border-radius: 12px;">
                <small style="color: var(--text-muted); display: block; margin-bottom: 10px; font-weight: 700; text-transform: uppercase; font-size: 11px;">
                    <i class="fas fa-print" style="color: var(--secondary);"></i> Máquinas Registradas (${maqsArr.length})
                </small>
                <div style="display: flex; flex-direction: column; gap: 8px;">
                    ${maqsArr.map((m) => `
                        <div style="background: white; border: 1px solid var(--border); border-left: 3px solid var(--secondary); border-radius: 8px; padding: 10px;">
                            <div style="font-weight: 700; font-size: 13px; color: var(--text-main); margin-bottom: 4px;">
                                <i class="fas fa-print" style="color: var(--secondary);"></i> ${m.idPropio ? `[${escapeHtml(m.idPropio)}] ` : ''}${escapeHtml(m.modelo || 'Sin modelo')}
                            </div>
                            ${m.serial ? `<div style="font-size: 11px; color: var(--text-muted);">Serie: ${escapeHtml(m.serial)}</div>` : ''}
                            ${m.ubicacionLocal ? `<div style="font-size: 11px; color: var(--text-muted);"><i class="fas fa-map-pin"></i> ${escapeHtml(m.ubicacionLocal)}</div>` : ''}
                            ${(m.ciudad || m.barrio || m.direccion) ? `<div style="font-size: 11px; color: var(--text-muted);">${[m.ciudad, m.barrio, m.direccion].filter(Boolean).map(v => escapeHtml(v)).join(', ')}</div>` : ''}
                        </div>
                    `).join('')}
                </div>
            </div>`;
        } else {
            html += `<div style="background: var(--bg-app); padding: 15px; border-radius: 12px;">
                <small style="color: var(--text-muted); display: block; margin-bottom: 5px; font-size: 11px; font-weight: 700; text-transform: uppercase;">
                    <i class="fas fa-print" style="color: var(--secondary);"></i> Máquinas Registradas
                </small>
                <span style="color: var(--text-muted); font-size: 13px;">Sin máquinas registradas</span>
            </div>`;
        }
    }

    html += `</div>`;
    contenido.innerHTML = html;

    const btnStatus = document.createElement('button');
    btnStatus.className = 'btn ' + (user.activo === false ? 'btn-warning' : 'btn-outline');
    btnStatus.style.width = '100%';
    btnStatus.style.marginTop = '15px';
    btnStatus.innerHTML = user.activo === false ? '<i class="fas fa-user-check"></i> Activar Cuenta' : '<i class="fas fa-user-slash"></i> Suspender Cuenta';
    btnStatus.onclick = (event) => toggleEstadoUsuario(uid, user.activo !== false, event);
    contenido.appendChild(btnStatus);

    document.getElementById('btnEliminarUsuario').onclick = () => eliminarUsuario(uid);
    document.getElementById('btnEditarUsuario').onclick = () => abrirEdicion(user, rol);

    modal.classList.remove('oculto');
};

export const toggleEstadoUsuario = async (uid, currentStatus, event) => {
    const btn = event.target;
    const original = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> PROCESANDO...';
    try {
        const fn = httpsCallable(functions, 'modificarUsuario');
        const nuevoEstado = !currentStatus;
        await fn({ targetUid: uid, payload: { activo: nuevoEstado } });

        patchCache(cacheClientes, uid, { activo: nuevoEstado });
        patchCache(cacheEquipo, uid, { activo: nuevoEstado });
        renderClientes();
        renderEquipo();
        showToast("Estado de cuenta actualizado.", "success");
        document.getElementById('modal-detalle-usuario').classList.add('oculto');
    } catch (e) {
        showToast("Error al cambiar estado.", "error");
    } finally {
        btn.innerHTML = original;
    }
};

export const eliminarUsuario = async (uid) => {
    if (!confirm("¿Estás seguro de eliminar este usuario?")) return;
    const btn = document.getElementById('btnEliminarUsuario');
    const original = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Eliminando...';
    try {
        const fn = httpsCallable(functions, 'eliminarUsuario');
        await fn({ targetUid: uid });
        removeFromCache(cacheClientes, uid);
        removeFromCache(cacheEquipo, uid);
        renderClientes();
        renderEquipo();
        showToast("Usuario eliminado correctamente.", "success");
        document.getElementById('modal-detalle-usuario').classList.add('oculto');
    } catch (e) {
        showToast("Error al eliminar: " + e.message, "error");
    } finally {
        btn.innerHTML = original;
    }
};

export const abrirEdicion = (user, rol) => {
    document.getElementById('modal-detalle-usuario').classList.add('oculto');
    const modal = document.getElementById('modal-editar-usuario');

    document.getElementById('editUid').value = user.id;
    document.getElementById('editRol').value = rol;
    document.getElementById('editNombre').value = user.nombre;
    document.getElementById('editTelefono').value = user.telefono || '';
    document.getElementById('editPass').value = '';

    const extraCli = document.getElementById('editExtraCliente');
    const extraOp = document.getElementById('editExtraOperario');
    extraCli.style.display = (rol === 'cliente') ? 'block' : 'none';
    extraOp.style.display = (rol === 'operario') ? 'block' : 'none';

    if (rol === 'cliente') {
        document.getElementById('editContacto').value = user.contacto || '';
        document.getElementById('editDireccion').value = user.direccion || '';
    } else {
        const capVal = Array.isArray(user.capacidades) ? user.capacidades[0] : user.capacidades;
        document.getElementById('editCap').value = capVal === 'Certificado' ? 'Certificado' : 'Sin Certificado';
    }

    modal.classList.remove('oculto');
};

export const guardarEdicion = async () => {
    const uid = document.getElementById('editUid').value;
    const rol = document.getElementById('editRol').value;
    const btn = document.getElementById('btnGuardarEdit');
    const original = btn.innerHTML;

    const nombre = document.getElementById('editNombre').value.trim();
    if (!nombre) return showToast("El nombre no puede estar vacío.", "error");

    const payload = {
        nombre,
        telefono: document.getElementById('editTelefono').value.trim()
    };
    const pass = document.getElementById('editPass').value;
    if (pass) payload.password = pass;

    if (rol === 'cliente') {
        payload.contacto = document.getElementById('editContacto').value;
        payload.direccion = document.getElementById('editDireccion').value;
    } else {
        payload.capacidades = [document.getElementById('editCap').value];
    }

    const localChanges = { ...payload };
    delete localChanges.password;

    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando...';
    try {
        const fn = httpsCallable(functions, 'modificarUsuario');
        await fn({ targetUid: uid, payload });
        patchCache(rol === 'cliente' ? cacheClientes : cacheEquipo, uid, localChanges);
        renderClientes();
        renderEquipo();
        showToast("Datos actualizados correctamente.", "success");
        document.getElementById('modal-editar-usuario').classList.add('oculto');
    } catch (e) {
        showToast("Error al actualizar: " + e.message, "error");
    } finally {
        btn.innerHTML = original;
    }
};

// --- RATING SYSTEM ---

export const abrirModalCalificar = (jobId, opId) => {
    document.getElementById('califJobId').value = jobId;
    document.getElementById('califOpId').value = opId;
    document.getElementById('modal-calificar').classList.remove('oculto');
};

export const guardarCalificacion = async () => {
    const jobId = document.getElementById('califJobId').value;
    const opId = document.getElementById('califOpId').value;
    const estrellas = parseInt(document.getElementById('califEstrellas').value);
    const btn = document.getElementById('btnGuardarCalif');
    const original = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando...';

    try {
        const fn = httpsCallable(functions, 'calificarOperario');
        await fn({ jobId, opId, estrellas });

        patchCache(cacheTrabajos, jobId, { calificado: true, puntosAdmin: estrellas });
        const op = cacheEquipo.find(o => o.id === opId);
        if (op) {
            const totalVotos = (op.totalVotos || 0) + 1;
            const sumaPuntos = (op.sumaPuntos || 0) + estrellas;
            patchCache(cacheEquipo, opId, {
                totalVotos, sumaPuntos,
                calificacion: parseFloat((sumaPuntos / totalVotos).toFixed(2))
            });
        }
        renderTrabajos();
        renderEquipo();
        showToast("Evaluación registrada", "success");
        document.getElementById('modal-calificar').classList.add('oculto');
    } catch (e) {
        showToast("Error al calificar: " + e.message, "error");
    } finally {
        btn.innerHTML = original;
    }
};

// Crear Usuarios
export const crearOperario = async () => {
    const fn = httpsCallable(functions, 'crearOperario');
    const btn = document.getElementById('btnCrearOp');
    const originalText = btn.innerHTML;

    const nombre = document.getElementById('opNom').value.trim();
    const email = document.getElementById('opMail').value.trim();
    const password = document.getElementById('opPass').value;
    
    // Nuevos campos operario
    const cedula = document.getElementById('opCedula').value.trim();
    const telefono1 = document.getElementById('opTel1').value.trim();
    const telefono2 = document.getElementById('opTel2').value.trim();
    const tipoContrato = document.getElementById('opTipoContrato').value; // 'Por servicio' o 'Fijo'
    
    let fechaContratacion = "";
    let horarioTrabajo = "";
    if (tipoContrato === 'Fijo') {
        fechaContratacion = document.getElementById('opContrato').value;
        horarioTrabajo = document.getElementById('opHorario').value.trim();
    }

    const capacidades = document.getElementById('opCap').value;

    if (!nombre || !email || !password) return showToast("Nombre, Email y Contraseña requeridos", "error");

    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> PROCESANDO...';
    try {
        const payload = {
            nombre, email, password,
            cedula, 
            telefono1, 
            telefono2,
            telefono: telefono1, // Fallback legacy
            tipoContrato,
            fechaContratacion,
            horarioTrabajo,
            capacidades: [capacidades],
            activo: true
        };

        const result = await fn(payload);
        showToast("Técnico registrado", "success");
        document.getElementById('modal-nuevo-op').classList.add('oculto');

        cacheEquipo.push({
            id: result.data.uid,
            rol: 'operario',
            calificacion: 0, totalVotos: 0, sumaPuntos: 0,
            ...payload
        });
        renderEquipo();
    } catch (e) {
        console.error("Error al crear operario:", e);
        showToast("Error: " + (e.message || "Falla en el servidor"), "error");
    }
    finally { btn.innerHTML = originalText; }
};

// ─── CONTROL DE MÁQUINAS (MODAL REGISTRO CLIENTES) ───────────────────────────

export const toggleFormMaquina = () => {
    const form = document.getElementById('formMaquinaInline');
    const btn = document.getElementById('btnToggleFormMaquina');
    if (!form) return;

    const isVisible = form.style.display === 'block';
    if (isVisible) {
        _cerrarFormMaquina();
    } else {
        form.style.display = 'block';
        if (btn) btn.innerHTML = '<i class="fas fa-minus"></i> Ocultar Formulario';
    }
};

const _cerrarFormMaquina = () => {
    const form = document.getElementById('formMaquinaInline');
    const btn = document.getElementById('btnToggleFormMaquina');
    if (form) form.style.display = 'none';
    if (btn) btn.innerHTML = '<i class="fas fa-plus"></i> Agregar Máquina';
    // Reset GPS temporal
    maqLatTemp = null;
    maqLngTemp = null;
    const gpsInd = document.getElementById('maqGpsIndicator');
    if (gpsInd) gpsInd.innerHTML = '<i class="fas fa-map-marker-alt" style="opacity: 0.4;"></i> Sin coordenadas GPS';
    limpiarFormMaquina();
};

export const abrirMapaMaquina = () => {
    document.getElementById('modal-mapa-maquina').classList.remove('oculto');

    // Inicializar mapa la primera vez o reusar
    if (!_maqMapaLeaflet) {
        // Si hay coords guardadas temporalmente, centrar en ellas; si no, usar Cartagena
        const lat = maqLatTemp || 10.3910;
        const lng = maqLngTemp || -75.4794;
        _maqMapaLeaflet = L.map('mapaMaquinaView').setView([lat, lng], 15);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors'
        }).addTo(_maqMapaLeaflet);

        // Intentar geolocalizar si no hay coords previas
        if (!maqLatTemp && navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                (pos) => _maqMapaLeaflet.setView([pos.coords.latitude, pos.coords.longitude], 15),
                () => {} // Silenciar error de geolocalización
            );
        }
    } else {
        // Reutilizar mapa existente, centrar si hay coords
        if (maqLatTemp && maqLngTemp) {
            _maqMapaLeaflet.setView([maqLatTemp, maqLngTemp], 15);
        }
    }

    setTimeout(() => _maqMapaLeaflet.invalidateSize(), 300);
};

export const confirmarUbicacionMaquina = () => {
    if (!_maqMapaLeaflet) return;
    const center = _maqMapaLeaflet.getCenter();
    maqLatTemp = center.lat;
    maqLngTemp = center.lng;

    // Actualizar indicador GPS en el formulario
    const gpsInd = document.getElementById('maqGpsIndicator');
    if (gpsInd) {
        gpsInd.innerHTML = `<i class="fas fa-map-marker-alt" style="color: #22c55e;"></i> <strong style="color: #22c55e;">GPS confirmado</strong> <span style="opacity:0.7;">(${maqLatTemp.toFixed(5)}, ${maqLngTemp.toFixed(5)})</span>`;
    }

    document.getElementById('modal-mapa-maquina').classList.add('oculto');
    showToast('Ubicación GPS de la máquina confirmada.', 'success');
};

const limpiarFormMaquina = () => {
    const inputs = ['maqIdPropio', 'maqModelo', 'maqSerial', 'maqCiudad', 'maqBarrio', 'maqDireccion', 'maqUbicacionLocal'];
    inputs.forEach(id => {
        const input = document.getElementById(id);
        if (input) input.value = '';
    });
};

export const agregarMaquina = () => {
    const idPropio = document.getElementById('maqIdPropio').value.trim();
    const modelo = document.getElementById('maqModelo').value.trim();
    const serial = document.getElementById('maqSerial').value.trim();
    const ciudad = document.getElementById('maqCiudad').value.trim();
    const barrio = document.getElementById('maqBarrio').value.trim();
    const direccion = document.getElementById('maqDireccion').value.trim();
    const ubicacionLocal = document.getElementById('maqUbicacionLocal').value.trim();

    if (!modelo) {
        return showToast("El modelo de la máquina es obligatorio.", "error");
    }

    const nueva = {
        id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
        idPropio,
        modelo,
        serial,
        ciudad,
        barrio,
        direccion,
        ubicacionLocal,
        lat: maqLatTemp || null,
        lng: maqLngTemp || null
    };

    maquinasTemp.push(nueva);
    renderMaquinasAdmin();
    _cerrarFormMaquina(); // Siempre cierra directamente, sin depender del estado del toggle
    showToast("Máquina añadida.", "success");
};

export const eliminarMaquina = (id) => {
    maquinasTemp = maquinasTemp.filter(m => m.id !== id);
    renderMaquinasAdmin();
    showToast("Máquina removida.", "warning");
};

export const renderMaquinasAdmin = () => {
    const lista = document.getElementById('listaMaquinasAdmin');
    if (!lista) return;

    if (maquinasTemp.length === 0) {
        lista.innerHTML = `
            <div style="text-align: center; padding: 20px; color: var(--text-muted); font-size: 13px; border: 1px dashed var(--border); border-radius: 10px;" id="maquinasEmptyState">
                <i class="fas fa-print" style="font-size: 24px; display: block; margin-bottom: 8px; opacity: 0.3;"></i>
                Sin máquinas registradas aún
            </div>`;
        return;
    }

    lista.innerHTML = maquinasTemp.map((m) => `
        <div style="background: white; border: 1px solid var(--border); border-radius: 10px; padding: 14px; display: flex; justify-content: space-between; align-items: start; gap: 12px; border-left: 3px solid ${m.lat ? '#22c55e' : 'var(--secondary)'}; margin-bottom: 6px;">
            <div style="flex: 1;">
                <div style="font-weight: 700; color: var(--text-main); font-size: 14px; margin-bottom: 4px;">
                    <i class="fas fa-print" style="color: var(--secondary); margin-right: 6px;"></i>
                    ${m.idPropio ? `[${escapeHtml(m.idPropio)}] ` : ''}${escapeHtml(m.modelo)}
                </div>
                ${m.serial ? `<div style="font-size: 11px; color: var(--text-muted); margin-bottom: 6px;"><i class="fas fa-barcode" style="width: 14px;"></i> Serie: <strong>${escapeHtml(m.serial)}</strong></div>` : ''}
                <div style="display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px;">
                    ${m.lat ? `<span style="font-size: 11px; background: #dcfce7; padding: 3px 8px; border-radius: 6px; color: #16a34a;"><i class="fas fa-map-marker-alt"></i> GPS ✓</span>` : ''}
                    ${m.ubicacionLocal ? `<span style="font-size: 11px; background: var(--bg-app); padding: 3px 8px; border-radius: 6px; color: var(--text-main);"><i class="fas fa-map-pin" style="color: var(--secondary);"></i> ${escapeHtml(m.ubicacionLocal)}</span>` : ''}
                    ${m.ciudad ? `<span style="font-size: 11px; background: var(--bg-app); padding: 3px 8px; border-radius: 6px; color: var(--text-muted);"><i class="fas fa-city"></i> ${escapeHtml(m.ciudad)}</span>` : ''}
                    ${m.barrio ? `<span style="font-size: 11px; background: var(--bg-app); padding: 3px 8px; border-radius: 6px; color: var(--text-muted);"><i class="fas fa-map-marker-alt"></i> ${escapeHtml(m.barrio)}</span>` : ''}
                    ${m.direccion ? `<span style="font-size: 11px; background: var(--bg-app); padding: 3px 8px; border-radius: 6px; color: var(--text-muted);">${escapeHtml(m.direccion)}</span>` : ''}
                </div>
            </div>
            <button type="button" onclick="eliminarMaquina('${m.id}')" title="Eliminar máquina" style="background: none; border: none; color: #ef4444; cursor: pointer; padding: 4px; font-size: 16px; flex-shrink: 0;">
                <i class="fas fa-trash-alt"></i>
            </button>
        </div>
    `).join('');
};

export const cerrarModalNuevoCliente = () => {
    maquinasTemp = [];
    _cerrarFormMaquina(); // Limpia inputs + oculta form + resetea botón
    renderMaquinasAdmin(); // Reinicia lista al estado vacío
    document.getElementById('modal-nuevo-cliente').classList.add('oculto');
};

export const crearClienteAdmin = async () => {
    const fn = httpsCallable(functions, 'crearCliente');
    const btn = document.getElementById('btnCrearCliAdmin');
    const originalText = btn.innerHTML;

    const tipoPersona = document.getElementById('cliTipoPersona').value; // 'Empresa' o 'Natural'
    let nombre = "";
    let razonSocial = "";
    let nit = "";
    let repLegal = "";
    let cedulaRep = "";
    let cedulaNatural = "";

    if (tipoPersona === 'Empresa') {
        razonSocial = document.getElementById('cliRazonSocial').value.trim();
        nit = document.getElementById('cliNit').value.trim();
        repLegal = document.getElementById('cliRepLegal').value.trim();
        cedulaRep = document.getElementById('cliCedulaRep').value.trim();
        nombre = razonSocial; 
    } else {
        nombre = document.getElementById('cliNombreCompleto').value.trim();
        cedulaNatural = document.getElementById('cliCedula').value.trim();
    }

    const email = document.getElementById('cliMail').value.trim();
    const password = document.getElementById('cliPass').value;
    const contacto = document.getElementById('cliCont').value.trim();
    const telefono1 = document.getElementById('cliTel1').value.trim();
    const telefono2 = document.getElementById('cliTel2').value.trim();
    
    // Ubicación
    const ciudad = document.getElementById('cliCiudad').value.trim();
    const barrio = document.getElementById('cliBarrio').value.trim();
    const direccionDetallada = document.getElementById('cliDir').value.trim();
    const direccionLegacy = `${ciudad}, ${barrio}, ${direccionDetallada}`;

    // Relación
    const tipoRelacion = document.getElementById('cliTipoRelacion').value; // 'Demanda' o 'Alquiler'
    let equiposAlquilados = "";
    let valorMensual = "";
    let copiasFavor = "";
    let valorCopiaExtra = "";
    let estadoCuenta = "";

    if (tipoRelacion === 'Alquiler') {
        equiposAlquilados = document.getElementById('cliEquiposAlquilados').value.trim();
        valorMensual = parseFloat(document.getElementById('cliValorMensual').value) || 0;
        copiasFavor = parseInt(document.getElementById('cliCopiasFavor').value) || 0;
        valorCopiaExtra = parseFloat(document.getElementById('cliValorCopiaExtra').value) || 0;
        estadoCuenta = document.getElementById('cliEstadoCuenta').value;
    }

    if (!nombre || !email || !password) return showToast("Nombre/Razón Social, Email y Contraseña requeridos", "error");

    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> PROCESANDO...';
    btn.disabled = true;
    try {
        const payload = {
            nombre, email, password,
            tipoPersona,
            razonSocial, nit, repLegal, cedulaRep, cedulaNatural,
            contacto, telefono1, telefono2, telefono: telefono1, // legacy
            ciudad, barrio, direccionDetallada, direccion: direccionLegacy, // legacy
            tipoRelacion,
            equiposAlquilados, valorMensual, copiasFavor, valorCopiaExtra, estadoCuenta,
            maquinas: maquinasTemp.map(({ id, ...rest }) => rest), // Omitimos el id local
            activo: true
        };

        const result = await fn(payload);
        showToast("Cliente registrado", "success");
        cerrarModalNuevoCliente();

        cacheClientes.push({
            id: result.data.uid,
            rol: 'cliente',
            totalServicios: 0,
            ...payload
        });
        renderClientes();
    } catch (e) {
        console.error("Error al crear cliente:", e);
        showToast("Error: " + (e.message || "Falla en el servidor"), "error");
    }
    finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
};

// --- MÓDULO MAPAS LEAFLET ---
let leafletMap = null;
let currentMarker = null;

export const abrirMapaAdmin = () => {
    const jobId = document.getElementById('mapaJobId').value;
    const job = cacheTrabajos.find(j => j.id === jobId);
    if (!job) return showToast("Trabajo no encontrado", "error");

    document.getElementById('modal-detalle-trabajo').classList.add('oculto');
    document.getElementById('modal-mapa').classList.remove('oculto');

    const lat = job.lat || 4.5709; // Default Colombia o valor GPS
    const lng = job.lng || -74.2973;

    if (!leafletMap) {
        leafletMap = L.map('mapaAdminView').setView([lat, lng], 14);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors'
        }).addTo(leafletMap);
    } else {
        leafletMap.setView([lat, lng], 14);
    }

    if (currentMarker) {
        leafletMap.removeLayer(currentMarker);
    }

    currentMarker = L.marker([lat, lng], { draggable: true }).addTo(leafletMap);

    // Fix leaflet grey box if inside disabled/hidden modal
    setTimeout(() => {
        leafletMap.invalidateSize();
    }, 200);
};

export const guardarUbicacionMapa = async () => {
    const jobId = document.getElementById('mapaJobId').value;
    if (!currentMarker) return;

    const { lat, lng } = currentMarker.getLatLng();
    const btn = document.getElementById('btnGuardarMapa');
    const original = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> GUARDANDO...';

    try {
        await updateDoc(doc(db, "trabajos", jobId), {
            lat: lat,
            lng: lng,
            ubicacion_validada: true,
            ubicacionActualizadaPorAdminEn: new Date()
        });
        patchCache(cacheTrabajos, jobId, { lat, lng, ubicacion_validada: true });
        showToast("Ubicación validada y guardada.", "success");
        document.getElementById('modal-mapa').classList.add('oculto');
        document.getElementById('modal-detalle-trabajo').classList.remove('oculto');
    } catch (e) {
        showToast("Error al guardar ubicación.", "error");
    } finally {
        btn.innerHTML = original;
    }
};

export const marcarCompletado = async (jobId) => {
    if (!jobId) return;
    if (!confirm('¿Confirma marcar este trabajo como COMPLETADO? El técnico ya no podrá modificarlo.')) return;

    try {
        await updateDoc(doc(db, 'trabajos', jobId), {
            estado: 'completado',
            tiempoCompletado: new Date()
        });
        patchCache(cacheTrabajos, jobId, { estado: 'completado' });
        renderTrabajos();
        showToast('Trabajo marcado como COMPLETADO.', 'success');
        document.getElementById('modal-detalle-trabajo').classList.add('oculto');
    } catch (e) {
        showToast('Error al completar el trabajo: ' + e.message, 'error');
    }
};

export const cerrarYFacturarJob = async () => {
    const realJobId = document.getElementById('mapaJobId').value;

    if (!confirm("¿Confirma cerrar este trabajo de manera definitiva y enviarlo a facturación?")) return;

    const btn = document.getElementById('btnCierreAdmin');
    const org = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> CERRANDO...';

    try {
        await updateDoc(doc(db, "trabajos", realJobId), {
            estado: 'cerrado',
            fechaCierreFacturacion: new Date()
        });
        patchCache(cacheTrabajos, realJobId, { estado: 'cerrado' });
        renderTrabajos();
        showToast("TRABAJO CERRADO DEFINITIVAMENTE.", "success");
        document.getElementById('modal-detalle-trabajo').classList.add('oculto');
    } catch (e) {
        showToast("Error al procesar el cierre.", "error");
    } finally {
        btn.innerHTML = org;
    }
};

// Global Exposure
window.verDetalleUsuario = verDetalleUsuario;
window.toggleEstadoUsuario = toggleEstadoUsuario;
window.eliminarUsuario = eliminarUsuario;
window.abrirEdicion = abrirEdicion;
window.guardarEdicion = guardarEdicion;
window.abrirModalCalificar = abrirModalCalificar;
window.guardarCalificacion = guardarCalificacion;
window.crearOperario = crearOperario;
window.crearClienteAdmin = crearClienteAdmin;
window.abrirMapaAdmin = abrirMapaAdmin;
window.guardarUbicacionMapa = guardarUbicacionMapa;
window.cerrarYFacturarJob = cerrarYFacturarJob;
window.marcarCompletado = marcarCompletado;
window.toggleFormMaquina = toggleFormMaquina;
window.agregarMaquina = agregarMaquina;
window.eliminarMaquina = eliminarMaquina;
window.cerrarModalNuevoCliente = cerrarModalNuevoCliente;
window.abrirMapaMaquina = abrirMapaMaquina;
window.confirmarUbicacionMaquina = confirmarUbicacionMaquina;
