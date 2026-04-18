import { setAuthListeners, userData } from "./js/auth.js";
import { initAdminModule, stopAdminModule } from "./js/admin.js";
import { escucharMisPedidos, stopClientModule } from "./js/client.js";
import { escucharMisTrabajosOperario, stopOperarioModule } from "./js/operario.js";

// --- ORQUESTACIÓN DE LA APLICACIÓN ---

setAuthListeners({
    onUserLoaded: (data, rol) => {
        // Detener listeners previos para evitar fugas de memoria y costos extra
        stopAdminModule();
        stopClientModule();
        stopOperarioModule();

        if (rol === 'admin') {
            initAdminModule();
        } else if (rol === 'cliente') {
            escucharMisPedidos(data.uid);
        } else if (rol === 'operario') {
            escucharMisTrabajosOperario(data);
        }
    },
    onLogout: () => {
        stopAdminModule();
        stopClientModule();
        stopOperarioModule();
    }
});

console.log("ServiIntel Command Center Initialized (Modular Mode)");