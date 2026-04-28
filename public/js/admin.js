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
    actualizarBtnCargarMas();

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
    
    const badge = document.getElementById('detJobPrioridad');
    badge.innerText = (t.prioridad || 'Media').toUpperCase();
    badge.className = `badge badge-${(t.prioridad || 'media').toLowerCase()}`;

    let fechaStr = 'No disponible';
    if (t.creadoEn) {
        const dt = t.creadoEn.toDate ? t.creadoEn.toDate() : new Date(t.creadoEn);
        fechaStr = dt.toLocaleDateString() + ' ' + dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    document.getElementById('detJobFecha').innerText = fechaStr;

    // Control "CERRAR Y FACTURAR" button
    const btnCierre = document.getElementById('btnCierreAdmin');
    if (t.estado === 'reporte_aprobado' || t.estado === 'evaluado_cliente') {
        btnCierre.classList.remove('oculto');
    } else {
        btnCierre.classList.add('oculto');
    }

    // Set map job ID
    document.getElementById('mapaJobId').value = t.id;

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
window.abrirModalNuevoPedido = (id) => {
    const clientData = cacheClientes.find(c => c.id === id);
    const nombre = clientData ? clientData.nombre : '';
    document.getElementById('padminClientId').value = id;
    document.getElementById('padminClientName').innerText = nombre;
    document.getElementById('padminDesc').value = '';

    // Poblar selector de operarios desde el cache
    const select = document.getElementById('padminOperario');
    let options = '<option value="">— Sin asignar por ahora —</option>';
    cacheEquipo.forEach(op => {
        const cert = (Array.isArray(op.capacidades) ? op.capacidades[0] : op.capacidades) === 'Certificado' ? '✅' : '';
        options += `<option value="${op.id}">${cert} ${escapeHtml(op.nombre)}</option>`;
    });
    select.innerHTML = options;

    document.getElementById('modal-nuevo-pedido-admin').classList.remove('oculto');
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

    // Determinar si se asigna operario en este mismo paso
    const opId = opValue || null;
    const opData = opId ? cacheEquipo.find(op => op.id === opId) : null;
    const opNombre = opData ? opData.nombre : null;
    const estaAsignado = !!opId;

    try {
        await addDoc(collection(db, "trabajos"), {
            clienteId: clientId,
            clienteNombre: clientName,
            categoria: servicio,
            servicio: servicio,
            descripcion: desc,
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
                <strong>${user.nombre}</strong>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                <div>
                     <small style="color: var(--text-muted); display: block; margin-bottom: 5px;">Correo</small>
                     <span style="font-size: 13px;">${user.email}</span>
                </div>
                <div>
                     <small style="color: var(--text-muted); display: block; margin-bottom: 5px;">Teléfono</small>
                     <span style="font-size: 13px;">${user.telefono || 'No reg.'}</span>
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

    const payload = {
        nombre: document.getElementById('editNombre').value,
        telefono: document.getElementById('editTelefono').value
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

    const nombre = document.getElementById('opNom').value;
    const email = document.getElementById('opMail').value;
    const password = document.getElementById('opPass').value;
    const capacidades = document.getElementById('opCap').value;
    const telefono = document.getElementById('opTel').value;
    const contrato = document.getElementById('opContrato').value;

    if (!nombre || !email || !password) return showToast("Llena los datos básicos", "error");

    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> PROCESANDO...';
    try {
        const result = await fn({
            nombre, email, password, telefono,
            fechaContratacion: contrato,
            capacidades: [capacidades],
            activo: true
        });
        showToast("Técnico registrado", "success");
        document.getElementById('modal-nuevo-op').classList.add('oculto');

        cacheEquipo.push({
            id: result.data.uid,
            nombre, email, rol: 'operario',
            capacidades: [capacidades],
            telefono, fechaContratacion: contrato,
            activo: true, calificacion: 0, totalVotos: 0, sumaPuntos: 0
        });
        renderEquipo();
    } catch (e) { 
        console.error("Error al crear operario:", e);
        showToast("Error: " + (e.message || "Falla en el servidor"), "error"); 
    }
    finally { btn.innerHTML = originalText; }
};

export const crearClienteAdmin = async () => {
    const fn = httpsCallable(functions, 'crearCliente');
    const btn = document.getElementById('btnCrearCliAdmin');
    const originalText = btn.innerHTML;

    const nombre = document.getElementById('cliNom').value.trim();
    const email = document.getElementById('cliMail').value.trim();
    const password = document.getElementById('cliPass').value;
    const contacto = document.getElementById('cliCont').value.trim();
    const telefono = document.getElementById('cliTel').value.trim();
    const direccion = document.getElementById('cliDir').value.trim();

    if (!nombre || !email || !password) return showToast("Nombre, Email y Contraseña requeridos", "error");

    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> PROCESANDO...';
    try {
        const result = await fn({ nombre, email, password, contacto, telefono, direccion, activo: true });
        showToast("Cliente registrado", "success");
        document.getElementById('modal-nuevo-cliente').classList.add('oculto');

        cacheClientes.push({
            id: result.data.uid,
            nombre, email, rol: 'cliente',
            contacto, telefono, direccion,
            activo: true, totalServicios: 0
        });
        renderClientes();
    } catch (e) { 
        console.error("Error al crear cliente:", e);
        showToast("Error: " + (e.message || "Falla en el servidor"), "error"); 
    }
    finally { btn.innerHTML = originalText; }
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

export const cerrarYFacturarJob = async () => {
    const jobId = document.getElementById('detJobId').innerText; // Using snippet or getting from mapaJobId
    const realJobId = document.getElementById('mapaJobId').value;
    
    if (!confirm("¿Confirma cerrar este trabajo de manera definitiva y enviarlo a facturación?")) return;

    const btn = document.getElementById('btnCierreAdmin');
    const org = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> CERRANDO...';

    try {
        await updateDoc(doc(db, "trabajos", realJobId), {
            estado: 'completado',
            fechaCierreFacturacion: new Date()
        });
        patchCache(cacheTrabajos, realJobId, { estado: 'completado' });
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
