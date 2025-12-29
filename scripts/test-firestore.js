const admin = require('firebase-admin');
const serviceAccount = require('../serviceAccountKey.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

const db = admin.firestore();

async function testFirestore() {
    console.log("Teste de conexão Firestore...");
    try {
        const snapshot = await db.collection('sellers').get();
        console.log(`Sucesso! Encontrados ${snapshot.size} documentos em 'sellers'.`);
    } catch (error) {
        console.error("ERRO DETALHADO FIRESTORE:");
        console.error(error);
        if (error.details) console.error(error.details);
    }
}

testFirestore();
