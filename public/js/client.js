import { collection, addDoc, doc, updateDoc, getDoc, query, where, orderBy, limit, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";
import { db } from "./config.js";
import { showToast } from "./ui.js";
import { userData } from "./auth.js";

const escapeHtml = (str) => {
    if (!str && str !== 0) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
};

let unsubCliente = null;
let currentClientMap = null;
let currentClientMarker = null; // Fake marker, center crosshair used instead
let clientJobs = [];
let currentVbJobId = null;
let currentRating = 5;

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
                clientJobs = [];
                return;
            }
            clientJobs = snap.docs.map(d => ({ jobId: d.id, ...d.data() }));

            listDiv.innerHTML = clientJobs.map(t => {
                const badgeClass = `badge-${(t.estado || 'solicitado').split('_')[0]}`;
                const hasOp = !!t.operarioNombre;
                const isFinished = t.estado === 'evaluado_cliente' || t.estado === 'cerrado' || t.estado === 'completado';

                let extras = '';

                // Show Review Button if ready
                if (t.estado === 'revision_cliente') {
                    extras += `
                    <div style="margin-top: 16px;">
                        <button onclick="abrirVistoBueno('${t.jobId}')" class="btn" style="background: var(--primary); color: white; width: 100%;"><i class="fas fa-file-signature"></i> REVISAR Y APROBAR EL SERVICIO</button>
                    </div>`;
                } else if (isFinished && t.reporteTecnico) {
                    extras += `
                    <div style="margin-top: 16px;">
                        <button onclick="abrirVistoBueno('${t.jobId}')" class="btn btn-outline" style="width: 100%; border-color: var(--primary); color: var(--primary);"><i class="fas fa-eye"></i> VER DIAGNÓSTICO APROBADO</button>
                    </div>`;
                }

                if ((t.estado === 'completado' || t.estado === 'cerrado') && !t.evaluacionCliente) {
                    extras += `
                    <div style="margin-top: 16px;">
                        <button onclick="abrirCalificacion('${t.jobId}')" class="btn" style="background: #f59e0b; color: white; width: 100%;"><i class="fas fa-star"></i> CALIFICAR SERVICIO</button>
                    </div>`;
                }

                // Show PIN if active
                if (t.pinCode && !isFinished && t.estado !== 'revision_cliente') {
                    extras += `
                    <div style="margin-top: 16px; background: #FEFCE8; border: 1px solid #FEF08A; padding: 12px; border-radius: 12px; display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            <span style="font-size: 10px; font-weight: 800; color: #854D0E; display: block; margin-bottom: 4px;">CÓDIGO PIN SEGURO</span>
                            <span style="font-size: 22px; font-weight: 900; color: #1e293b; letter-spacing: 4px;">${t.pinCode}</span>
                        </div>
                        <i class="fas fa-shield-alt" style="color: #CA8A04; font-size: 24px;"></i>
                    </div>`;
                }

                return `
                <div style="background: white; padding: 24px; border-radius: 16px; margin-bottom: 20px; border: 1px solid var(--border); box-shadow: var(--shadow-sm);">
                    <div style="display: flex; justify-content: space-between; margin-bottom: 12px; align-items: start;">
                        <strong style="color: var(--text-main); font-size: 16px;">${escapeHtml(t.categoria || t.servicio || 'General')}</strong>
                        <span class="badge ${badgeClass}">${t.estado.toUpperCase().replace(/_/g, ' ')}</span>
                    </div>
                    <p style="font-size: 14px; color: var(--text-muted); margin-bottom: 20px; line-height: 1.5;">${escapeHtml(t.descripcion)}</p>
                    <div style="border-top: 1px solid var(--border); padding-top: 16px; display: flex; align-items: center; gap: 8px;">
                        <i class="fas fa-hard-hat" style="color: ${hasOp ? 'var(--warning)' : 'var(--text-muted)'};"></i>
                        <span style="font-size: 13px; font-weight: 600; color: ${hasOp ? 'var(--text-main)' : 'var(--text-muted)'};">
                            ${escapeHtml(t.operarioNombre) || 'Nuestra central está localizando al mejor especialista...'}
                        </span>
                    </div>
                    ${extras}
                </div>`;
            }).join('');
        },
        () => showToast("Error al cargar el historial.", "error")
    );
};

window.abrirMapaCliente = () => {
    const cat = document.getElementById('cliServicio').value;
    const desc = document.getElementById('cliDesc').value.trim();
    if (!cat || !desc) return showToast("Por favor selecciona una categoría y detalla el problema antes de elegir la ubicación.", "error");

    document.getElementById('cliDirTexto').value = '';
    document.getElementById('modal-mapa-cliente').classList.remove('oculto');

    // Initialize map if not yet done
    if (!currentClientMap) {
        currentClientMap = L.map('mapaClienteView').setView([10.3910, -75.4794], 13); // Default Cartagena
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(currentClientMap);

        // Try getting real location
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    currentClientMap.setView([pos.coords.latitude, pos.coords.longitude], 15);
                },
                (err) => console.log('Location not granted or error')
            );
        }
    }
    setTimeout(() => currentClientMap.invalidateSize(), 300);
};

window.confirmarUbicacionCliente = async () => {
    if (!currentClientMap) return;
    const center = currentClientMap.getCenter();
    const lat = center.lat;
    const lng = center.lng;

    const cat = document.getElementById('cliServicio').value;
    const desc = document.getElementById('cliDesc').value.trim();
    const dirTexto = document.getElementById('cliDirTexto').value.trim();

    if (!userData) return showToast("Sesión no válida. Por favor recarga la página.", "error");

    const btn = document.getElementById('btnConfirmarUbiCli');
    const origText = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> ENVIANDO...';
    btn.disabled = true;

    // Generate cryptographically secure 4-digit PIN
    const pinArr = new Uint32Array(1);
    crypto.getRandomValues(pinArr);
    const pinCode = (1000 + (pinArr[0] % 9000)).toString();

    try {
        await addDoc(collection(db, "trabajos"), {
            clienteId: userData.uid,
            clienteNombre: userData.nombre,
            categoria: cat,
            descripcion: desc,
            direccionText: dirTexto,
            lat: lat,
            lng: lng,
            pinCode: pinCode,
            estado: 'solicitado',
            creadoEn: serverTimestamp()
        });
        document.getElementById('cliDesc').value = '';
        document.getElementById('cliServicio').value = '';
        document.getElementById('cliDirTexto').value = '';
        document.getElementById('modal-mapa-cliente').classList.add('oculto');
        showToast("🚀 ¡Solicitud enviada al despacho exitosamente!", "success");
    } catch (e) {
        showToast("Error enviando el ticket: " + e.message, "error");
    } finally {
        btn.innerHTML = origText;
        btn.disabled = false;
    }
};

window.abrirVistoBueno = (jobId) => {
    const job = clientJobs.find(j => j.jobId === jobId);
    if (!job) return;

    currentVbJobId = jobId;
    currentRating = 5;
    document.getElementById('vbComentario').value = '';

    const isEvaluated = job.evaluacionCliente != null || job.estado !== 'revision_cliente';
    if (isEvaluated) {
        document.getElementById('vbSeccionAprobar').classList.add('oculto');
        document.getElementById('vbSeccionSoloLectura').classList.remove('oculto');
        const evalData = job.evaluacionCliente;
        if (evalData) {
            const estrellas = evalData.estrellas || 0;
            let starHtml = '';
            for (let i = 0; i < 5; i++) {
                starHtml += `<i class="${i < estrellas ? 'fas' : 'far'} fa-star"></i>`;
            }
            document.getElementById('vbSoloLecturaEstrellas').innerHTML = starHtml;
            document.getElementById('vbSoloLecturaComentario').innerText = evalData.comentario || 'Sin comentario';
        } else {
            document.getElementById('vbSoloLecturaEstrellas').innerHTML = '<span style="font-size: 14px; color: var(--text-muted);">Aún no calificado</span>';
            document.getElementById('vbSoloLecturaComentario').innerText = '';
        }
    } else {
        document.getElementById('vbSeccionAprobar').classList.remove('oculto');
        document.getElementById('vbSeccionSoloLectura').classList.add('oculto');
    }

    // Render report summary
    const rep = job.reporteTecnico || {};
    let html = `
        <div style="margin-bottom: 8px;"><strong>Técnico Encargado:</strong> ${escapeHtml(rep.encargadoNombre || job.operarioNombre)}</div>
        <div style="margin-bottom: 8px;"><strong>Cédula:</strong> ${escapeHtml(rep.encargadoCedula || 'N/D')}</div>
    `;

    // Nueva Lógica Retrocompatible
    if (rep.trabajosReportados && rep.trabajosReportados.length > 0) {
        rep.trabajosReportados.forEach((t, i) => {
            html += `<div style="margin-top: 12px; background: white; border-left: 3px solid var(--primary); padding: 8px; border-radius: 4px;">`;
            html += `<div style="font-weight: 800; font-size: 13px; color: var(--primary); margin-bottom: 4px;">${i + 1}. Trabajo de ${escapeHtml(t.tipo)}</div>`;
            if (t.marca || t.modelo) {
                html += `<div style="font-size: 12px; color: var(--text-muted); margin-bottom: 4px;"><strong>Equipo:</strong> ${escapeHtml(t.marca)} ${escapeHtml(t.modelo)} ${t.contador ? '(Contador: ' + escapeHtml(t.contador) + ')' : ''}</div>`;
            }

            if (t.tipo === 'Mantenimiento') {
                if (t.diagnostico) html += `<div style="font-size: 12px; margin-top: 4px;"><strong>Diagnóstico:</strong> ${escapeHtml(t.diagnostico)}</div>`;
                if (t.solucion) html += `<div style="font-size: 12px; margin-top: 4px;"><strong>Solución:</strong> ${escapeHtml(t.solucion)}</div>`;
                if (t.insumos) html += `<div style="font-size: 12px; margin-top: 4px;"><strong>Insumos:</strong> ${escapeHtml(t.insumos)}</div>`;
            } else if (t.tipo === 'Venta') {
                if (t.descripcion) html += `<div style="font-size: 12px; margin-top: 4px;"><strong>Detalle Venta:</strong> ${escapeHtml(t.descripcion)}</div>`;
                if (t.valor) html += `<div style="font-size: 12px; margin-top: 4px; color: #16a34a; font-weight: bold;"><strong>Valor Venta:</strong> $${escapeHtml(t.valor)}</div>`;
                if (t.garantia) html += `<div style="font-size: 12px; margin-top: 4px;"><strong>Garantía:</strong> ${escapeHtml(t.garantia)}</div>`;
            } else if (t.tipo === 'Alquiler') {
                if (t.condiciones) html += `<div style="font-size: 12px; margin-top: 4px;"><strong>Condiciones:</strong> ${escapeHtml(t.condiciones)}</div>`;
                if (t.duracion) html += `<div style="font-size: 12px; margin-top: 4px;"><strong>Duración:</strong> ${escapeHtml(t.duracion)} meses</div>`;
                if (t.valorMensual) html += `<div style="font-size: 12px; margin-top: 4px; color: #0284c7; font-weight: bold;"><strong>Canon Mensual:</strong> $${escapeHtml(t.valorMensual)}</div>`;
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

    document.getElementById('resumenReporteTecnico').innerHTML = html;
    document.getElementById('modal-visto-bueno').classList.remove('oculto');
};

window.abrirCalificacion = (jobId) => {
    currentVbJobId = jobId;
    currentRating = 5;
    window.actualizarEstrellasCalif(5);
    document.getElementById('califComentario').value = '';
    document.getElementById('modal-calificacion').classList.remove('oculto');
};

window.actualizarEstrellasCalif = (val) => {
    currentRating = val;
    const stars = document.getElementById('estrellasCalif').children;
    for (let i = 0; i < stars.length; i++) {
        if (i < val) {
            stars[i].classList.replace('fa-star', 'fa-star'); // Solid
            stars[i].style.color = '#FACC15';
            stars[i].classList.remove('far'); // Ensure it's solid
            stars[i].classList.add('fas');
        } else {
            stars[i].style.color = 'var(--border)';
            stars[i].classList.remove('fas');
            stars[i].classList.add('far'); // Outline
        }
    }
};

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('estrellasCalif')?.addEventListener('click', (e) => {
        if (e.target.tagName === 'I') {
            const val = parseInt(e.target.getAttribute('data-val'));
            window.actualizarEstrellasCalif(val);
        }
    });
});

window.enviarAprobacionCliente = async () => {
    if (!currentVbJobId) return;
    const btn = document.getElementById('btnAprobarReporte');
    const origText = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> ENVIANDO...';
    btn.disabled = true;

    try {
        await updateDoc(doc(db, "trabajos", currentVbJobId), {
            estado: 'trabajo_aprobado',
            reporteAprobado: true
        });
        showToast("¡Diagnóstico aprobado! El técnico procederá con el trabajo.", "success");
        document.getElementById('modal-visto-bueno').classList.add('oculto');
    } catch (e) {
        showToast("Error aprobando el reporte: " + e.message, "error");
    } finally {
        btn.innerHTML = origText;
        btn.disabled = false;
    }
};

window.enviarCalificacionCliente = async () => {
    if (!currentVbJobId) return;
    const btn = document.getElementById('btnEnviarCalif');
    const origText = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> ENVIANDO...';
    btn.disabled = true;

    try {
        const docRef = doc(db, "trabajos", currentVbJobId);
        const docSnap = await getDoc(docRef);
        const currentData = docSnap.data();

        const updateData = {
            evaluacionCliente: {
                estrellas: currentRating,
                comentario: document.getElementById('califComentario').value.trim(),
                fechaEvaluacion: serverTimestamp()
            }
        };

        if (currentData.estado !== 'cerrado') {
            updateData.estado = 'evaluado_cliente';
        }

        await updateDoc(docRef, updateData);
        showToast("¡Gracias por tu evaluación!", "success");
        document.getElementById('modal-calificacion').classList.add('oculto');
    } catch (e) {
        showToast("Error guardando la calificación: " + e.message, "error");
    } finally {
        btn.innerHTML = origText;
        btn.disabled = false;
    }
};

window.rechazarReporteCliente = async () => {
    if (!currentVbJobId) return;
    const btn = document.getElementById('btnRechazarReporte');
    const origText = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> RECHAZANDO...';
    btn.disabled = true;

    try {
        await updateDoc(doc(db, "trabajos", currentVbJobId), {
            estado: 'en_sitio',
            reporteRechazado: true
        });
        showToast("Reporte rechazado. El técnico debe generarlo de nuevo.", "success");
        document.getElementById('modal-visto-bueno').classList.add('oculto');
    } catch (e) {
        showToast("Error al rechazar el reporte: " + e.message, "error");
    } finally {
        btn.innerHTML = origText;
        btn.disabled = false;
    }
};

export const stopClientModule = () => {
    if (unsubCliente) { unsubCliente(); unsubCliente = null; }
};
