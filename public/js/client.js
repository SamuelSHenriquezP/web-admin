import { collection, addDoc, doc, updateDoc, getDoc, query, where, orderBy, limit, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";
import { db } from "./config.js";
import { showToast } from "./ui.js";
import { userData } from "./auth.js";

const escapeHtml = (str) => {
    if (!str) return '';
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
                const badgeClass = `badge-${t.estado.split('_')[0]}`;
                const hasOp = !!t.operarioNombre;
                const isFinished = t.estado === 'evaluado_cliente' || t.estado === 'cerrado' || t.estado === 'completado';
                
                let extras = '';
                
                // Show Review Button if ready
                if (t.estado === 'revision_cliente') {
                    extras += `
                    <div style="margin-top: 16px;">
                        <button onclick="abrirVistoBueno('${t.jobId}')" class="btn" style="background: var(--primary); color: white; width: 100%;"><i class="fas fa-file-signature"></i> REVISAR Y APROBAR EL SERVICIO</button>
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

    // Generate random 4 digit PIN
    const pinCode = Math.floor(1000 + Math.random() * 9000).toString();

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
    window.actualizarEstrellasVb(5);
    document.getElementById('vbComentario').value = '';
    
    // Render report summary
    const rep = job.reporteTecnico || {};
    let html = `
        <div style="margin-bottom: 8px;"><strong>Técnico Encargado:</strong> ${escapeHtml(rep.encargadoNombre || job.operarioNombre)}</div>
        <div style="margin-bottom: 8px;"><strong>Cédula:</strong> ${escapeHtml(rep.encargadoCedula || 'N/D')}</div>
    `;
    
    if (rep.detallesTecnicos && rep.detallesTecnicos.length > 0) {
        rep.detallesTecnicos.forEach((d, i) => {
            html += `<div style="margin-top: 12px; border-left: 2px solid var(--primary); padding-left: 8px;">
                <div style="font-size: 11px; color: var(--text-muted); font-weight: 700;">DIAGNÓSTICO ${i+1}:</div>
                <div style="margin-bottom: 4px;">${escapeHtml(d.diagnostico)}</div>
                <div style="font-size: 11px; color: var(--text-muted); font-weight: 700;">SOLUCIÓN:</div>
                <div>${escapeHtml(d.solucion)}</div>
            </div>`;
        });
    }

    if (rep.costoEmpresa || rep.costoTecnico) {
         html += `<div style="margin-top: 12px; font-weight: bold;">Costos liquidados: $${escapeHtml(rep.costoEmpresa)} (Empresa) / $${escapeHtml(rep.costoTecnico)} (Técnico)</div>`;
    }
    
    document.getElementById('resumenReporteTecnico').innerHTML = html;
    document.getElementById('modal-visto-bueno').classList.remove('oculto');
};

window.actualizarEstrellasVb = (val) => {
    currentRating = val;
    const stars = document.getElementById('estrellasVb').children;
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
    document.getElementById('estrellasVb')?.addEventListener('click', (e) => {
        if (e.target.tagName === 'I') {
            const val = parseInt(e.target.getAttribute('data-val'));
            window.actualizarEstrellasVb(val);
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
            estado: 'evaluado_cliente',
            reporteAprobado: true,
            evaluacionCliente: {
                estrellas: currentRating,
                comentario: document.getElementById('vbComentario').value.trim(),
                fechaEvaluacion: serverTimestamp()
            }
        });
        showToast("¡Gracias por tu evaluación!", "success");
        document.getElementById('modal-visto-bueno').classList.add('oculto');
    } catch (e) {
        showToast("Error aprobando el reporte: " + e.message, "error");
    } finally {
        btn.innerHTML = origText;
        btn.disabled = false;
    }
};

export const stopClientModule = () => {
    if (unsubCliente) { unsubCliente(); unsubCliente = null; }
};
