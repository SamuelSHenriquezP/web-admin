import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";
import { getFunctions } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-functions.js";

const firebaseConfig = {
  apiKey: "AIzaSyCRds7bb9spdGN6aiVwKXbDXMRBxMkx9t0",
  authDomain: "gestion-servi-intel-sas.firebaseapp.com",
  projectId: "gestion-servi-intel-sas",
  storageBucket: "gestion-servi-intel-sas.firebasestorage.app",
  messagingSenderId: "948711390857",
  appId: "1:948711390857:web:ce2cef95b0fc383dc39058"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const functions = getFunctions(app);
