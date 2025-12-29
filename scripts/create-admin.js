const admin = require('firebase-admin');
const serviceAccount = require('../serviceAccountKey.json'); // Ajuste o caminho se necessário

// Inicializa o Admin SDK
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

const auth = admin.auth();

const user = {
    email: 'admin@splitpay.com',
    password: 'admin123456', // Senha deve ter pelo menos 6 caracteres
    displayName: 'Administrador'
};

async function createOrUpdateAdmin() {
    try {
        try {
            // Tenta buscar o usuário
            const userRecord = await auth.getUserByEmail(user.email);
            console.log('Usuário já existe. Atualizando senha...');

            await auth.updateUser(userRecord.uid, {
                password: user.password,
                displayName: user.displayName
            });
            console.log(`Senha atualizada para: ${user.password}`);

        } catch (error) {
            if (error.code === 'auth/user-not-found') {
                // Cria se não existir
                console.log('Criando novo usuário...');
                await auth.createUser(user);
                console.log(`Usuário criado com sucesso!`);
                console.log(`Email: ${user.email}`);
                console.log(`Senha: ${user.password}`);
            } else {
                throw error;
            }
        }
    } catch (e) {
        console.error('Erro ao gerenciar usuário:', e);
    } finally {
        process.exit();
    }
}

createOrUpdateAdmin();
