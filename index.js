const express = require('express');
const { MercadoPagoConfig, Payment, OAuth } = require('mercadopago');
const dotenv = require('dotenv');
const cors = require('cors');
const path = require('path');
const admin = require('firebase-admin');

dotenv.config();

// Initialize Firebase Admin
// Tenta usar o arquivo de credenciais (Recomendado para local)
// Se não existir, tenta as credenciais padrão (Vercel/GCP)
try {
    const serviceAccount = require("./serviceAccountKey.json");
    if (!admin.apps.length) {
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        console.log("Firebase Admin iniciado com serviceAccountKey.json");
    }
} catch (e) {
    console.warn("Aviso: 'serviceAccountKey.json' não encontrado. Tentando credenciais padrão...");
    if (!admin.apps.length) {
        admin.initializeApp();
    }
}

const db = admin.firestore();

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// Configuração do Marketplace
const client = new MercadoPagoConfig({
    accessToken: process.env.MP_ACCESS_TOKEN,
    options: { timeout: 5000 }
});

const oauth = new OAuth(client);

// --- Rotas da API ---

/**
 * Rota: Estatísticas do Dashboard
 */
app.get('/api/stats', async (req, res) => {
    try {
        const paymentsSnapshot = await db.collection('payments').where('status', '==', 'approved').get();
        const sellersSnapshot = await db.collection('sellers').count().get();

        let totalAmount = 0;
        let totalFees = 0;

        paymentsSnapshot.forEach(doc => {
            const p = doc.data();
            totalAmount += (p.amount || 0);
            totalFees += (p.fee || 0);
        });

        res.json({
            total_sellers: sellersSnapshot.data().count,
            total_amount: totalAmount,
            total_fees: totalFees
        });
    } catch (error) {
        console.error('Erro ao buscar stats:', error);
        res.status(500).json({ error: 'Erro ao buscar estatísticas' });
    }
});

/**
 * Rota: Listar Vendedores
 */
app.get('/api/sellers', async (req, res) => {
    try {
        const snapshot = await db.collection('sellers').get();
        const sellers = [];
        if (!snapshot.empty) {
            snapshot.forEach(doc => {
                const data = doc.data();
                sellers.push({
                    id: doc.id,
                    connected_at: data.connected_at
                });
            });
        }
        res.json(sellers);
    } catch (error) {
        console.error('Erro ao listar vendedores:', error);
        res.status(500).json({ error: 'Erro ao listar vendedores', details: error.message });
    }
});

/**
 * Rota: Gerar URL de Autorização (Onboarding)
 */
app.get('/auth/url', (req, res) => {
    const redirectUri = encodeURIComponent(process.env.REDIRECT_URI);
    const authUrl = `https://auth.mercadopago.com.br/authorization?client_id=${process.env.MP_APP_ID}&response_type=code&platform_id=mp&redirect_uri=${redirectUri}`;
    res.json({ url: authUrl });
});

/**
 * Rota: Callback do OAuth
 */
app.get('/callback', async (req, res) => {
    const { code } = req.query;

    if (!code) {
        return res.status(400).send('Código não fornecido.');
    }

    try {
        const response = await oauth.create({
            body: {
                client_secret: process.env.MP_CLIENT_SECRET,
                client_id: process.env.MP_APP_ID,
                grant_type: 'authorization_code',
                code: code.toString(),
                redirect_uri: process.env.REDIRECT_URI
            }
        });

        const sellerData = response;
        const sellerId = sellerData.user_id;

        // Salvar no Firestore
        await db.collection('sellers').doc(sellerId.toString()).set({
            access_token: sellerData.access_token,
            refresh_token: sellerData.refresh_token,
            public_key: sellerData.public_key,
            connected_at: new Date().toISOString()
        });

        console.log(`Vendedor ${sellerId} autenticado e salvo no Firestore!`);

        const html = `
            <!DOCTYPE html>
            <html>
            <body style="background:transparent; display:none;">
                <script>
                    if (window.opener) {
                        try {
                            window.opener.postMessage('seller_connected', '*');
                            window.opener.focus();
                        } catch(e) {}
                        window.close();
                    } else {
                        window.location.href = '/?status=success_connected';
                    }
                </script>
            </body>
            </html>
        `;
        res.send(html);

    } catch (error) {
        console.error('Erro no OAuth:', error);
        res.status(500).send(`<h1>Erro ao conectar</h1><p>${error.message}</p><a href="/">Voltar</a>`);
    }
});

/**
 * Rota: Criar Pagamento com Split
 */
app.post('/pay/split', async (req, res) => {
    const { sellerId, amount, fee, payerEmail } = req.body;

    try {
        // Busca vendedor no Firestore
        const sellerDoc = await db.collection('sellers').doc(sellerId).get();

        if (!sellerDoc.exists) {
            return res.status(404).json({ error: 'Vendedor não encontrado ou não conectado.' });
        }

        const seller = sellerDoc.data();
        const sellerClient = new MercadoPagoConfig({ accessToken: seller.access_token });
        const payment = new Payment(sellerClient);

        const amountValue = parseFloat(amount);
        const feePercentage = parseFloat(fee);
        const applicationFeeValue = (amountValue * feePercentage) / 100;
        const webhookUrl = process.env.REDIRECT_URI.replace('/callback', '/webhook');

        const body = {
            transaction_amount: amountValue,
            description: 'Venda Marketplace com Split (%)',
            payment_method_id: 'pix',
            notification_url: webhookUrl,
            payer: {
                email: payerEmail,
                identification: { type: 'CPF', number: '19119119100' }
            },
            application_fee: parseFloat(applicationFeeValue.toFixed(2))
        };

        const result = await payment.create({ body });

        // Salva pagamento no Firestore
        await db.collection('payments').doc(result.id.toString()).set({
            id: result.id,
            status: result.status,
            amount: amountValue,
            fee: applicationFeeValue,
            seller_id: sellerId,
            created_at: new Date().toISOString()
        });

        res.json({
            id: result.id,
            status: result.status,
            qr_code: result.point_of_interaction.transaction_data.qr_code,
            qr_code_base64: result.point_of_interaction.transaction_data.qr_code_base64,
            detail: "Pagamento criado em nome do vendedor."
        });

    } catch (error) {
        console.error('Erro ao criar pagamento:', error);
        res.status(500).json({ error: 'Erro ao processar pagamento', details: error.message });
    }
});

/**
 * Rota: Webhook
 */
app.post('/webhook', async (req, res) => {
    const { type, data } = req.body;
    res.status(200).send('OK');

    if (type === 'payment' && data && data.id) {
        try {
            console.log('Webhook recebido:', data.id);
            const paymentClient = new Payment(client);
            const info = await paymentClient.get({ id: data.id });

            if (info) {
                // Atualiza Firestore
                await db.collection('payments').doc(data.id.toString()).set({
                    id: info.id,
                    status: info.status,
                    amount: info.transaction_amount,
                    fee: info.application_fee || 0,
                    // seller_id: info.external_reference || null, // Opcional, se salvarmos ref no metadata
                    updated_at: new Date().toISOString()
                }, { merge: true }); // Merge para não sobrescrever dados existentes como seller_id

                console.log(`Pagamento ${data.id} atualizado para ${info.status}`);
            }
        } catch (e) {
            console.error('Erro no Webhook:', e);
        }
    }
});

// --- Rotas de Usuários (Admin) ---

/**
 * Rota: Listar Usuários cadastrados no Firebase Auth
 */
app.get('/api/users', async (req, res) => {
    try {
        const listUsersResult = await admin.auth().listUsers(100);
        const users = listUsersResult.users.map(userRecord => ({
            uid: userRecord.uid,
            email: userRecord.email,
            displayName: userRecord.displayName,
            metadata: userRecord.metadata
        }));
        res.json(users);
    } catch (error) {
        console.error('Erro ao listar usuários:', error);
        res.status(500).json({ error: 'Erro ao buscar usuários' });
    }
});

/**
 * Rota: Criar novo usuário (Admin)
 */
app.post('/api/users', async (req, res) => {
    const { email, password, displayName } = req.body;

    if (!email || !password || password.length < 6) {
        return res.status(400).json({ error: 'Dados inválidos. Senha deve ter pelo menos 6 caracteres.' });
    }

    try {
        const userRecord = await admin.auth().createUser({
            email,
            emailVerified: false,
            password,
            displayName,
            disabled: false
        });

        res.status(201).json({
            message: 'Usuário criado com sucesso!',
            uid: userRecord.uid
        });
    } catch (error) {
        console.error('Erro ao criar usuário:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Rota: Deletar usuário (Admin)
 */
app.delete('/api/users/:uid', async (req, res) => {
    const { uid } = req.params;

    try {
        await admin.auth().deleteUser(uid);
        res.json({ message: 'Usuário deletado com sucesso.' });
    } catch (error) {
        console.error('Erro ao deletar usuário:', error);
        res.status(500).json({ error: 'Erro ao deletar usuário.' });
    }
});

// Para Vercel (Serverless)
module.exports = app;

// Só roda o listen se NÃO estivermos na Vercel ou se formos o script principal
if (require.main === module) {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`Servidor rodando na porta ${PORT}`);
    });
}
