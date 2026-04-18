/**
 * SCRIPT DE USO ÚNICO — Establece el Custom Claim "admin" para un usuario.
 * 
 * Uso:
 *   1. Obtén el UID del admin desde Firebase Console → Authentication
 *   2. Pon tu archivo de credenciales de servicio en este directorio
 *      (Firebase Console → Configuración → Cuentas de servicio → Generar nueva clave privada)
 *   3. Ejecuta: node scripts/set-admin-claim.js
 */

const admin = require("firebase-admin");
const serviceAccount = require("./serviceAccountKey.json"); // descarga desde Firebase Console

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// ⬇️ CAMBIA ESTO por el UID real del administrador (cópialo de Firebase Console → Auth)
const ADMIN_UID = "PEGA_AQUI_EL_UID_DEL_ADMIN";

async function main() {
  await admin.auth().setCustomUserClaims(ADMIN_UID, { rol: "admin" });
  console.log(`✅ Custom Claim 'admin' establecido correctamente para UID: ${ADMIN_UID}`);
  console.log("   El usuario deberá cerrar sesión y volver a iniciarla para que el token se actualice.");
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});
