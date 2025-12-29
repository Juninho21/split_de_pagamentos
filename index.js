const express = require('express');
const { MercadoPagoConfig, Payment, OAuth } = require('mercadopago');
const dotenv = require('dotenv');
const cors = require('cors');

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static('public')); // Servir arquivos do Dashboard

// Configuração do Marketplace (Sua aplicação)
// OBS: Para chamadas de OAuth, usamos as credenciais do Marketplace.
const client = new MercadoPagoConfig({
    accessToken: process.env.MP_ACCESS_TOKEN, // Token do Marketplace (opcional aqui se for só OAuth)
    options: { timeout: 5000 }
});

const oauth = new OAuth(client);

// Banco de dados simulado para armazenar tokens dos vendedores
// Em produção, use um banco de dados real (MySQL, MongoDB, Postgres, etc.)
const sellersDb = {};

/**
 * Rota 1: Gerar URL de Autorização (Onboarding)
 * O vendedor acessa essa URL para conceder permissão ao Marketplace.
 */
app.get('/auth/url', (req, res) => {
    // Parâmetros para a URL de autorização
    // redirect_uri deve ser idêntica à cadastrada no painel do MP
    const authUrl = `https://auth.mercadopago.com.br/authorization?client_id=${process.env.MP_APP_ID}&response_type=code&platform_id=mp&redirect_uri=${process.env.REDIRECT_URI}`;

    res.json({ url: authUrl });
});

/**
 * Rota 2: Callback do OAuth
 * O Mercado Pago redireciona para cá com o 'code'.
 * Trocamos o 'code' pelo 'access_token' do vendedor.
 */
app.get('/callback', async (req, res) => {
    const { code } = req.query;

    if (!code) {
        return res.status(400).send('Código não fornecido.');
    }

    try {
        // Troca o código pelo token do vendedor
        // OBS: Aqui usamos as credenciais do Marketplace (client_secret) para validar a troca
        // A SDK V2 simplifica isso se configurada corretamente, mas a chamada direta é:
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

        // Armazenar o token do vendedor vinculado ao ID dele (user_id do MP ou seu ID interno)
        // Exemplo: sellersDb[seller_id_interno] = sellerData.access_token;
        const sellerId = sellerData.user_id; // ID do vendedor no Mercado Pago
        sellersDb[sellerId] = {
            access_token: sellerData.access_token,
            refresh_token: sellerData.refresh_token,
            public_key: sellerData.public_key
        };

        console.log(`Vendedor ${sellerId} autenticado com sucesso!`);

        // Retorna script para fechar popup ou redirecionar
        const html = `
            <!DOCTYPE html>
            <html>
            <body style="background:transparent; display:none;">
                <script>
                    if (window.opener) {
                        try {
                            window.opener.postMessage('seller_connected', '*');
                            window.opener.focus(); // Tenta trazer o dashboard para frente
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
        res.status(500).send(`
            <h1>Erro ao conectar</h1>
            <p>${error.message}</p>
            <a href="/">Voltar para Home</a>
        `);
    }
});

/**
 * Rota 4: Listar Vendedores (Para o Dashboard)
 */
app.get('/api/sellers', (req, res) => {
    // Retorna apenas dados seguros (ID e mascarados)
    const safeSellers = Object.keys(sellersDb).map(id => ({
        id,
        connected_at: new Date().toISOString() // Simulação
    }));
    res.json(safeSellers);
});

/**
 * Rota 3: Criar Pagamento com Split (Pix Automático)
 * O cliente paga R$ 100,00. 
 * O Marketplace fica com R$ 10,00 (application_fee).
 * O Vendedor recebe o restante (R$ 90,00 - taxas MP).
 */
app.post('/pay/split', async (req, res) => {
    const {
        sellerId, // ID do vendedor que vai receber (deve estar no nosso banco)
        amount,   // Valor total da transação
        fee,      // Valor da comissão do Marketplace
        payerEmail
    } = req.body;

    const seller = sellersDb[sellerId];

    if (!seller) {
        return res.status(404).json({ error: 'Vendedor não encontrado ou não conectado.' });
    }

    try {
        // IMPORTANTE: Criamos uma instância do cliente USANDO O TOKEN DO VENDEDOR
        const sellerClient = new MercadoPagoConfig({
            accessToken: seller.access_token
        });

        const payment = new Payment(sellerClient);

        const amountValue = parseFloat(amount);
        const feePercentage = parseFloat(fee);

        // Calcula o valor da comissão com base na porcentagem
        // Ex: R$ 100 * 10% = R$ 10.00
        const applicationFeeValue = (amountValue * feePercentage) / 100;

        const body = {
            transaction_amount: amountValue,
            description: 'Venda Marketplace com Split (%)',
            payment_method_id: 'pix',
            payer: {
                email: payerEmail,
                identification: {
                    type: 'CPF',
                    // Em produção, colete o CPF real do pagador
                    number: '19119119100'
                }
            },
            // O campo mágico para o Split: application_fee
            // Define quanto o Marketplace (dono do Client ID original) vai reter.
            application_fee: parseFloat(applicationFeeValue.toFixed(2))
        };

        const result = await payment.create({ body });

        // Retorna os dados do Pix (Copia e Cola e QR Code)
        res.json({
            id: result.id,
            status: result.status,
            qr_code: result.point_of_interaction.transaction_data.qr_code,
            qr_code_base64: result.point_of_interaction.transaction_data.qr_code_base64,
            detail: "Pagamento criado em nome do vendedor. Comissão retida automaticamente."
        });

    } catch (error) {
        console.error('Erro ao criar pagamento:', error);
        res.status(500).json({ error: 'Erro ao processar pagamento', details: error });
    }
});

// Para Vercel (Serverless)
module.exports = app;

// Só roda o listen se NÃO estivermos na Vercel ou se formos o script principal
if (require.main === module) {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`Servidor rodando na porta ${PORT}`);
        console.log(`Callback URL esperada: ${process.env.REDIRECT_URI}`);
    });
}
