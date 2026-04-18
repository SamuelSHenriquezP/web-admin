import { signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import { doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";
import { auth, db } from "./config.js";
import { showToast, showView, cambiarPestana } from "./ui.js";

export let userData = null;

// --- LISTENERS EXTERNOS ---
let onUserLoaded = null;
let onLogout = null;

export const setAuthListeners = (callbacks) => {
    onUserLoaded = callbacks.onUserLoaded;
    onLogout = callbacks.onLogout;
};

onAuthStateChanged(auth, async (user) => {
    if (user) {
        try {
            const tokenResult = await user.getIdTokenResult();
            const claimRol = String(tokenResult.claims.rol || '').trim().toLowerCase();

            const d = await getDoc(doc(db, "usuarios", user.uid));
            if (!d.exists()) throw new Error("Datos de usuario no encontrados.");

            userData = { uid: user.uid, ...d.data() };
            const rolAsignado = claimRol || String(userData.rol || userData.Rol || '').trim().toLowerCase();

            if (rolAsignado === 'admin') {
                showView('view-admin');
                if (onUserLoaded) onUserLoaded(userData, 'admin');
                showToast(`Bienvenido Admin, ${userData.nombre || ''}`, 'success');
            } else {
                if (userData.activo === false) {
                    showToast("Tu cuenta está pendiente de aprobación por el administrador.", "error");
                    signOut(auth);
                    return;
                }
                if (rolAsignado === 'cliente') {
                    showView('view-cliente');
                    document.getElementById('cliente-nombre-display').innerText = userData.nombre || 'Portal del Cliente';
                    if (onUserLoaded) onUserLoaded(userData, 'cliente');
                    showToast(`Hola ${userData.nombre || ''}`, 'success');
                } else if (rolAsignado === 'operario') {
                    showView('view-operario');
                    document.getElementById('op-nombre-display').innerText = userData.nombre || 'Técnico';
                    if (onUserLoaded) onUserLoaded(userData, 'operario');
                    showToast(`Modo Operario activado`, 'success');
                } else {
                    showToast(`El rol de esta cuenta no es válido ("${rolAsignado || 'sin rol'}").`, "error");
                    signOut(auth);
                }
            }
        } catch (err) {
            console.error("Auth Error:", err);
            showToast("Error validando la sesión: " + err.message, "error");
            signOut(auth);
        }
    } else {
        userData = null;
        showView('view-auth');
        if (onLogout) onLogout();
        
        const btnLogin = document.querySelector('#form-login .btn-primary');
        if (btnLogin) btnLogin.innerHTML = '<i class="fas fa-sign-in-alt"></i> INGRESAR';
        const btnReg = document.querySelector('#form-registro .btn-secondary');
        if (btnReg) btnReg.innerHTML = '<i class="fas fa-crown"></i> REGISTRO';
    }
});

export const login = () => {
    const e = document.getElementById('logEmail').value;
    const p = document.getElementById('logPass').value;
    if (!e || !p) return showToast("Por favor, ingresa correo y contraseña.", "error");
    const btn = document.querySelector('#form-login .btn-primary');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> ACCEDIENDO...';
    signInWithEmailAndPassword(auth, e, p).catch(() => {
        showToast("Credenciales incorrectas o usuario no existe.", "error");
        btn.innerHTML = originalText;
    });
};

export const logout = () => {
    signOut(auth).then(() => {
        showToast("Sesión cerrada exitosamente", "success");
        document.getElementById('logEmail') && (document.getElementById('logEmail').value = '');
        document.getElementById('logPass') && (document.getElementById('logPass').value = '');
    });
};

export const registrarCliente = async () => {
    const email = document.getElementById('regEmail').value.trim();
    const pass = document.getElementById('regPass').value;
    const nombre = document.getElementById('regNombre').value.trim();
    const contacto = document.getElementById('regContacto').value.trim();
    const telefono = document.getElementById('regTelefono').value.trim();
    const direccion = document.getElementById('regDireccion').value.trim();

    if (!email || !pass || !nombre) return showToast("Faltan datos básicos obligatorios", "error");
    if (pass.length < 6) return showToast("La contraseña debe tener al menos 6 caracteres", "error");

    const btn = document.querySelector('#form-registro .btn-secondary');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> CREANDO CUENTA...';

    try {
        const res = await createUserWithEmailAndPassword(auth, email, pass);
        await setDoc(doc(db, "usuarios", res.user.uid), {
            nombre, email, rol: "cliente", contacto, telefono, direccion,
            activo: false,
            creadoEn: serverTimestamp(),
            totalServicios: 0
        });
        showToast("¡Registro exitoso! Tu cuenta está bajo revisión del administrador.", "success");
        signOut(auth);
    } catch (e) {
        showToast("Error de registro: " + e.message, "error");
        btn.innerHTML = originalText;
    }
};

window.login = login;
window.logout = logout;
window.registrarCliente = registrarCliente;
