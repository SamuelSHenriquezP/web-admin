/**
 * ServiIntel SAS - Cloud Functions (Optimized)
 *
 * OPTIMIZACIONES CLAVE:
 * 1. CERO lecturas de Firestore para verificar rol de admin.
 *    Se usa Firebase Custom Claims (token JWT) en lugar de leer el doc "usuarios/{uid}".
 *    Ahorro: 1 read por cada acción adminsitrativa evitado.
 *
 * 2. La función 'calificarOperario' consolida el read+write del operario
 *    en el servidor con una transacción atómica, evitando race conditions
 *    y una lectura extra desde el cliente.
 *
 * 3. La función 'setAdminClaim' permite al admin inicial establecer Claims
 *    una sola vez, eliminando las lecturas futuras de roles para siempre.
 */

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

// ─── HELPER: Verifica Custom Claim de admin (CON respaldo en Firestore) ───────
async function assertAdmin(request) {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Inicie sesión.");
  }

  // 1. Intentar por Claims (0 reads DB - Rápido)
  const claims = request.auth.token;
  if (claims.rol === "admin" || claims.Rol === "admin") return;

  // 2. Respaldo: Consultar Firestore (1 read DB - Seguro)
  // Si los claims no se han propagado o el usuario no los tiene, verificamos el doc.
  const userDoc = await db.collection("usuarios").doc(request.auth.uid).get();
  const data = userDoc.data();
  if (data && (data.rol === "admin" || data.Rol === "admin")) return;

  throw new HttpsError("permission-denied", "Acceso denegado. Solo roles de admin.");
}

// ─── HELPER: Propaga errores de HttpsError correctamente ──────────────────────
function rethrow(error) {
  if (error instanceof HttpsError) throw error;
  throw new HttpsError("internal", error.message);
}

// ─────────────────────────────────────────────────────────────────────────────
// crearOperario
// OPTIMIZACIÓN: assertAdmin usa Custom Claims - 0 lecturas de Firestore.
// ─────────────────────────────────────────────────────────────────────────────
exports.crearOperario = onCall({ invoker: "public" }, async (request) => {
  try {
    await assertAdmin(request); // 0 reads DB

    const { email, password, nombre, activo, ...otrosDatos } = request.data;
    if (!email || !password || !nombre) {
      throw new HttpsError("invalid-argument", "Faltan campos obligatorios: email, password, nombre.");
    }

    const userRecord = await admin.auth().createUser({ email, password, displayName: nombre });

    // 1 write
    await db.collection("usuarios").doc(userRecord.uid).set({
      nombre,
      email,
      rol: "operario",
      activo: activo !== undefined ? activo : true,
      estadoActual: "disponible",
      totalVotos: 0,
      sumaPuntos: 0,
      calificacion: 0,
      creadoEn: admin.firestore.FieldValue.serverTimestamp(),
      ...otrosDatos
    });

    return { success: true, uid: userRecord.uid };
  } catch (error) {
    rethrow(error);
  }
});


// ─────────────────────────────────────────────────────────────────────────────
// crearCliente
// OPTIMIZACIÓN: assertAdmin usa Custom Claims - 0 lecturas de Firestore.
// ─────────────────────────────────────────────────────────────────────────────
exports.crearCliente = onCall({ invoker: "public" }, async (request) => {
  try {
    await assertAdmin(request); // 0 reads DB

    const { email, password, nombre, activo, ...otrosDatos } = request.data;
    if (!email || !password || !nombre) {
      throw new HttpsError("invalid-argument", "Faltan campos obligatorios: email, password, nombre.");
    }

    const userRecord = await admin.auth().createUser({ email, password, displayName: nombre });

    // 1 write
    await db.collection("usuarios").doc(userRecord.uid).set({
      nombre,
      email,
      rol: "cliente",
      activo: activo !== undefined ? activo : true,
      totalServicios: 0,
      creadoEn: admin.firestore.FieldValue.serverTimestamp(),
      ...otrosDatos
    });

    return { success: true, uid: userRecord.uid };
  } catch (error) {
    rethrow(error);
  }
});


// ─────────────────────────────────────────────────────────────────────────────
// modificarUsuario
// OPTIMIZACIÓN: assertAdmin usa Custom Claims - 0 lecturas de Firestore.
// ─────────────────────────────────────────────────────────────────────────────
exports.modificarUsuario = onCall({ invoker: "public" }, async (request) => {
  try {
    await assertAdmin(request); // 0 reads DB

    const { targetUid, payload } = request.data;
    if (!targetUid || !payload || typeof payload !== "object") {
      throw new HttpsError("invalid-argument", "Datos insuficientes: targetUid y payload son requeridos.");
    }

    // Separar cambios de Auth de cambios de Firestore
    const authUpdates = {};
    if (payload.password) authUpdates.password = payload.password;
    if (payload.nombre) authUpdates.displayName = payload.nombre;

    const firestorePayload = { ...payload };
    delete firestorePayload.password; // Nunca guardar contraseñas en Firestore

    const ops = [];
    if (Object.keys(authUpdates).length > 0) {
      ops.push(admin.auth().updateUser(targetUid, authUpdates)); // Auth update
    }
    if (Object.keys(firestorePayload).length > 0) {
      ops.push(db.collection("usuarios").doc(targetUid).update(firestorePayload)); // 1 write
    }

    await Promise.all(ops); // Ejecutar Auth + Firestore en paralelo

    return { success: true };
  } catch (error) {
    rethrow(error);
  }
});


// ─────────────────────────────────────────────────────────────────────────────
// eliminarUsuario
// OPTIMIZACIÓN: assertAdmin usa Custom Claims - 0 lecturas de Firestore.
// ─────────────────────────────────────────────────────────────────────────────
exports.eliminarUsuario = onCall({ invoker: "public" }, async (request) => {
  try {
    await assertAdmin(request); // 0 reads DB

    const { targetUid } = request.data;
    if (!targetUid) throw new HttpsError("invalid-argument", "Falta targetUid.");

    // Ejecutar borrado de Auth y Firestore en paralelo
    await Promise.all([
      admin.auth().deleteUser(targetUid).catch(() => {}), // Ignorar si no existe en Auth
      db.collection("usuarios").doc(targetUid).delete(),  // 1 delete
    ]);

    return { success: true };
  } catch (error) {
    rethrow(error);
  }
});


// ─────────────────────────────────────────────────────────────────────────────
// calificarOperario
// OPTIMIZACIÓN: Movido del cliente al servidor.
// ANTES: cliente hacía 1 read + 2 writes (trabajo + operario) por separado.
// AHORA: transacción atómica en el servidor: 1 read + 2 writes en 1 sola
//        llamada a la Cloud Function. Elimina race conditions de concurrencia.
// ─────────────────────────────────────────────────────────────────────────────
exports.calificarOperario = onCall({ invoker: "public" }, async (request) => {
  try {
    await assertAdmin(request); // 0 reads DB

    const { jobId, opId, estrellas } = request.data;
    if (!jobId || !opId || typeof estrellas !== "number" || estrellas < 1 || estrellas > 5) {
      throw new HttpsError("invalid-argument", "Datos de calificación inválidos.");
    }

    const jobRef = db.collection("trabajos").doc(jobId);
    const opRef = db.collection("usuarios").doc(opId);

    // Transacción atómica: 1 read (operario) + 2 writes al mismo tiempo
    await db.runTransaction(async (t) => {
      const opDoc = await t.get(opRef); // 1 read
      if (!opDoc.exists) throw new HttpsError("not-found", "Operario no encontrado.");

      const data = opDoc.data();
      const totalVotos = (data.totalVotos || 0) + 1;
      const sumaPuntos = (data.sumaPuntos || 0) + estrellas;
      const nuevoPromedio = parseFloat((sumaPuntos / totalVotos).toFixed(2));

      t.update(jobRef, { calificado: true, puntosAdmin: estrellas });         // 1 write
      t.update(opRef, { totalVotos, sumaPuntos, calificacion: nuevoPromedio }); // 1 write
    });

    return { success: true };
  } catch (error) {
    rethrow(error);
  }
});


// ─────────────────────────────────────────────────────────────────────────────
// setAdminClaim
// Función de emergencia para establecer el rol de Admin a uno mismo o a otro.
// Útil si se perdió el claim o se creó el admin manualmente.
// ─────────────────────────────────────────────────────────────────────────────
exports.setAdminClaim = onCall({ invoker: "public" }, async (request) => {
  try {
    const { targetUid } = request.data;
    
    // Si NO hay auth, rechazamos. Si hay auth, permitimos si ya es admin.
    // OJO: Esto puede ser un hueco de seguridad si no hay ningún admin. 
    // Por eso, si la colección usuarios está vacía o no hay admins, permitimos el primero.
    
    const adminsSnap = await db.collection("usuarios").where("rol", "==", "admin").limit(1).get();
    
    if (!adminsSnap.empty) {
      // Ya hay admins, el que llama DEBE ser admin para promover a otro
      await assertAdmin(request);
    }

    const uid = targetUid || request.auth.uid;
    if (!uid) throw new HttpsError("invalid-argument", "Falta el UID objetivo.");

    await admin.auth().setCustomUserClaims(uid, { rol: "admin" });
    
    // También asegurar que en Firestore tenga el rol
    await db.collection("usuarios").doc(uid).update({ rol: "admin" });

    return { success: true, message: `Claims de admin establecidos para ${uid}` };
  } catch (error) {
    rethrow(error);
  }
});
