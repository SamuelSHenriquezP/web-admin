import { collection, addDoc, query, where, orderBy, limit, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";
import { db } from "./config.js";
import { userData } from "./auth.js";
import { showToast } from "./ui.js";

let unsubCliente = null;
let mapCliente = null;
let markerCliente = null;
let currentCoords = null;

export const escucharMisPedidos = (userId) => {
    if (unsubCliente) { unsubCliente(); unsubCliente = null; }

    // Inicializar mapa de selección si no existe
    setTimeout(() => initMapSelector(), 500);

    unsubCliente = onSnapshot(
        query(
            collection(db, "trabajos"),
            where("clienteId", "==", userId),
            limit(30)
        ),
        (snap) => {
            const listDiv = document.getElementById('lista-cli-pedidos');
            if (snap.empty) {
                listDiv.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 40px 0;">No tienes requerimientos activos.</div>';
                return;
            }

            // Ordenamiento local por fecha (creadoEn) descendente
            const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            docs.sort((a, b) => {
                const fa = a.creadoEn?.toMillis ? a.creadoEn.toMillis() : 0;
                const fb = b.creadoEn?.toMillis ? b.creadoEn.toMillis() : 0;
                return fb - fa;
            });

            listDiv.innerHTML = docs.map(t => {
                const badgeClass = `badge-${t.estado.split('_')[0]}`;
                const pinDisplay = t.pinCode ? `
                    <div style="margin-top: 15px; background: #fefce8; border: 1px solid #fef08a; padding: 12px; border-radius: 12px; display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            <small style="display: block; font-size: 10px; color: #854d0e; font-weight: 700; text-transform: uppercase;">Código PIN de Llegada</small>
                            <span style="font-size: 18px; font-weight: 800; letter-spacing: 2px; color: var(--text-main);">${t.pinCode}</span>
                        </div>
                        <i class="fas fa-shield-alt" style="color: #ca8a04; font-size: 20px;"></i>
                    </div>
                ` : '';
                return `
                <div class="tarjeta" style="padding: 24px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                        <span class="badge ${badgeClass}">${t.estado.toUpperCase()}</span>
                        <small style="font-size: 11px; color: var(--text-muted); font-weight: 500;">Ticket #${t.id ? t.id.slice(-6).toUpperCase() : '---'}</small>
                    </div>

                    <div style="margin-bottom: 20px;">
                        <h3 style="font-size: 18px; font-weight: 800; color: var(--text-main); margin-bottom: 6px; letter-spacing: -0.4px;">${t.categoria}</h3>
                        <p style="font-size: 14px; color: var(--text-muted); line-height: 1.6; margin: 0;">${t.descripcion}</p>
                    </div>

                    ${pinDisplay}

                    <div style="border-top: 1px solid var(--border); padding-top: 16px; margin-top: 20px; display: flex; align-items: center; justify-content: space-between;">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <div style="width: 32px; height: 32px; background: #f1f5f9; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: var(--text-muted);">
                                <i class="fas fa-hard-hat" style="font-size: 14px; color: ${t.operarioNombre ? 'var(--warning)' : 'var(--text-muted)'};"></i>
                            </div>
                            <div>
                                <small style="display: block; font-size: 10px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; line-height: 1;">Especialista</small>
                                <span style="font-size: 13px; font-weight: 600; color: ${t.operarioNombre ? 'var(--text-main)' : 'var(--text-muted)'};">
                                    ${t.operarioNombre || 'Asignando...'}
                                </span>
                            </div>
                        </div>
                        <i class="fas fa-chevron-right" style="font-size: 12px; color: var(--border);"></i>
                    </div>
                </div>`;
            }).join('');
        },
        () => showToast("Error al cargar el historial.", "error")
    );
};

const initMapSelector = () => {
    const container = document.getElementById('map-cliente-selector');
    if (!container || mapCliente) return;

    // Coordenadas iniciales (Bogotá por defecto o una genérica)
    const defaultLat = 4.6097;
    const defaultLng = -74.0817;

    mapCliente = L.map('map-cliente-selector').setView([defaultLat, defaultLng], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
    }).addTo(mapCliente);

    markerCliente = L.marker([defaultLat, defaultLng], { draggable: true }).addTo(mapCliente);
    currentCoords = { lat: defaultLat, lng: defaultLng };

    markerCliente.on('dragend', (e) => {
        const pos = e.target.getLatLng();
        currentCoords = { lat: pos.lat, lng: pos.lng };
    });

    mapCliente.on('click', (e) => {
        const pos = e.latlng;
        markerCliente.setLatLng(pos);
        currentCoords = { lat: pos.lat, lng: pos.lng };
    });
};

export const detectarUbicacionCliente = () => {
    if (!navigator.geolocation) return showToast("Tu navegador no soporta geolocalización.", "error");

    showToast("Detectando ubicación...", "info");
    navigator.geolocation.getCurrentPosition((pos) => {
        const { latitude, longitude } = pos.coords;
        const newPos = [latitude, longitude];
        if (mapCliente && markerCliente) {
            mapCliente.setView(newPos, 16);
            markerCliente.setLatLng(newPos);
            currentCoords = { lat: latitude, lng: longitude };
            showToast("Ubicación detectada correctamente.", "success");
        }
    }, () => {
        showToast("No pudimos obtener tu ubicación. Por favor selecciónala manualmente.", "error");
    });
};

export const enviarPedido = async () => {
    if (!userData) return showToast("No se pudo identificar al usuario.", "error");
    const cat = document.getElementById('cliServicio').value;
    const desc = document.getElementById('cliDesc').value.trim();
    
    if (!cat || !desc) return showToast("Por favor selecciona una categoría y detalla el problema.", "error");
    if (!currentCoords) return showToast("Por favor selecciona tu ubicación en el mapa.", "error");

    const btn = document.querySelector('#view-cliente .btn-secondary');
    const origText = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> ENVIANDO...';

    try {
        await addDoc(collection(db, "trabajos"), {
            clienteId: userData.uid,
            clienteNombre: userData.nombre,
            categoria: cat,
            descripcion: desc,
            lat: currentCoords.lat,
            lng: currentCoords.lng,
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
    if (mapCliente) {
        mapCliente.remove();
        mapCliente = null;
        markerCliente = null;
    }
};

window.enviarPedido = enviarPedido;
window.detectarUbicacionCliente = detectarUbicacionCliente;
