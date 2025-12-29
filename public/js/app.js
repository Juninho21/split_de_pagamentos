// State
let sellers = [];

// Navigation
document.addEventListener('DOMContentLoaded', () => {
    setupNavigation();
    fetchSellers();
    fetchStats();
    setInterval(fetchStats, 10000); // Atualiza stats a cada 10s

    // Check URL params
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('status') === 'success_connected') {
        showToast('Vendedor conectado com sucesso!');
        window.history.replaceState({}, document.title, "/");
    }

    // Garante que sempre comece na Visão Geral
    navigateTo('dashboard');
});

// Listener para fechar popup e recarregar
window.addEventListener('message', (event) => {
    if (event.data === 'seller_connected') {
        showToast('Vendedor conectado via Popup!');
        fetchSellers(); // Atualiza a lista
    }
});

function setupNavigation() {
    const links = document.querySelectorAll('.nav-link');
    links.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const targetId = link.getAttribute('data-target');
            navigateTo(targetId);
        });
    });

    // Logout
    const btnLogout = document.getElementById('btn-logout');
    if (btnLogout) {
        btnLogout.addEventListener('click', async (e) => {
            e.preventDefault();
            try {
                await firebase.auth().signOut();
                // Redirect is handled by onAuthStateChanged in index.html
                window.location.href = '/login.html';
            } catch (error) {
                console.error('Erro ao sair:', error);
                showToast('Erro ao tentar sair.');
            }
        });
    }
}

function navigateTo(sectionId) {
    // Nav Active State
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    document.querySelector(`[data-target="${sectionId}"]`).classList.add('active');

    // Section Visibility
    document.querySelectorAll('.content-section').forEach(s => s.style.display = 'none');
    document.getElementById(`section-${sectionId}`).style.display = 'block';

    // Page Title Update
    const titles = {
        'dashboard': 'Visão Geral',
        'sellers': 'Gerenciar Vendedores',
        'payments': 'Novo Split',
        'users': 'Gerenciar Usuários'
    };
    document.getElementById('page-title').textContent = titles[sectionId];

    // Carregar dados específicos da seção
    if (sectionId === 'users') {
        fetchUsers();
    }
}

// API Calls
async function fetchUsers() {
    try {
        const response = await fetch('/api/users');
        const data = await response.json();
        updateUsersTable(data);
    } catch (error) {
        console.error('Erro ao buscar usuários:', error);
        showToast('Erro ao carregar usuários.');
    }
}

async function fetchSellers() {
    try {
        const response = await fetch('/api/sellers');
        const data = await response.json();
        sellers = data;
        updateSellersTable(data);
        updateSellersCount(data.length);
        populateSellerSelect(data);
    } catch (error) {
        console.error('Erro ao buscar vendedores:', error);
        showToast('Erro ao carregar vendedores.');
    }
}

async function connectSeller() {
    try {
        const response = await fetch('/auth/url');
        const data = await response.json();

        // Abre popup para OAuth
        const width = 600;
        const height = 700;
        const left = (window.innerWidth - width) / 2;
        const top = (window.innerHeight - height) / 2;

        window.open(
            data.url,
            'Conectar Mercado Pago',
            `width=${width},height=${height},top=${top},left=${left}`
        );

        // Em um app real, usaríamos websockets ou polling para detectar quando fechou e atualizar a lista
        showToast('Aguardando conexão do vendedor...');
    } catch (error) {
        console.error('Erro ao gerar URL:', error);
        showToast('Erro ao iniciar conexão.');
    }
}

// User Management
const createUserForm = document.getElementById('create-user-form');
if (createUserForm) {
    createUserForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = e.target.querySelector('button');
        const originalText = btn.textContent;

        btn.textContent = 'Cadastrando...';
        btn.disabled = true;

        const displayName = document.getElementById('new-user-name').value;
        const email = document.getElementById('new-user-email').value;
        const password = document.getElementById('new-user-password').value;

        try {
            const response = await fetch('/api/users', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ displayName, email, password })
            });

            const result = await response.json();

            if (response.ok) {
                showToast('Usuário cadastrado com sucesso!');
                e.target.reset();
                fetchUsers();
            } else {
                showToast(result.error || 'Erro ao criar usuário');
            }
        } catch (error) {
            console.error(error);
            showToast('Erro de conexão ao criar usuário.');
        } finally {
            btn.textContent = originalText;
            btn.disabled = false;
        }
    });
}

// UI Updates
function updateUsersTable(data) {
    const tbody = document.getElementById('users-list');
    tbody.innerHTML = '';

    if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" class="text-center">Nenhum usuário encontrado.</td></tr>';
        return;
    }

    data.forEach(user => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>
                <div style="display: flex; flex-direction: column;">
                    <strong style="color: var(--text-heading);">${user.displayName || 'Sem nome'}</strong>
                    <span style="font-size: 0.8rem; color: var(--text-muted);">Criado em: ${new Date(user.metadata.creationTime).toLocaleDateString()}</span>
                </div>
            </td>
            <td>${user.email}</td>
            <td>
                <button class="btn btn-sm btn-danger" onclick="deleteUser('${user.uid}')" style="background-color: #fee2e2; color: #dc2626; border: none;">
                    Excluir
                </button>
            </td>
        `;
        tbody.appendChild(row);
    });
}

async function deleteUser(uid) {
    if (!confirm('Tem certeza que deseja excluir este usuário?')) return;

    try {
        const response = await fetch(`/api/users/${uid}`, {
            method: 'DELETE'
        });

        if (response.ok) {
            showToast('Usuário excluído.');
            fetchUsers();
        } else {
            showToast('Erro ao excluir usuário.');
        }
    } catch (error) {
        console.error(error);
        showToast('Erro de conexão.');
    }
}

// UI Updates
function updateSellersTable(data) {
    const tbody = document.getElementById('sellers-list');
    tbody.innerHTML = '';

    if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-center">Nenhum vendedor conectado. Clique em "+ Conectar" para começar.</td></tr>';
        return;
    }

    data.forEach(seller => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td><code>${seller.id}</code></td>
            <td><span style="color: var(--success); font-weight: 600;">● Ativo</span></td>
            <td>${new Date(seller.connected_at).toLocaleDateString()}</td>
            <td><button class="btn btn-sm btn-secondary">Ver Detalhes</button></td>
        `;
        tbody.appendChild(row);
    });
}

function updateSellersCount(count) {
    document.getElementById('total-sellers').textContent = count;
}

function populateSellerSelect(data) {
    const select = document.getElementById('seller-select');
    select.innerHTML = '<option value="">Selecione um vendedor...</option>';

    data.forEach(seller => {
        const option = document.createElement('option');
        option.value = seller.id;
        option.textContent = `Vendedor ID: ${seller.id}`;
        select.appendChild(option);
    });
}

// Live Fee Calculation
const amountInput = document.getElementById('amount');
const feeInput = document.getElementById('fee');
const feePreview = document.getElementById('fee-preview');

function updateFeePreview() {
    const amount = parseFloat(amountInput.value) || 0;
    const feePercent = parseFloat(feeInput.value) || 0;
    const items = (amount * feePercent) / 100;

    // Atualiza o texto visual
    feePreview.innerHTML = `Valor retido: <strong style="color: var(--success);">R$ ${items.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>`;
}

amountInput.addEventListener('input', updateFeePreview);
feeInput.addEventListener('input', updateFeePreview);

// Payment Form
document.getElementById('payment-form').addEventListener('submit', async (e) => {
    e.preventDefault();

    const sellerId = document.getElementById('seller-select').value;
    const amount = document.getElementById('amount').value;
    const fee = document.getElementById('fee').value;
    const payerEmail = document.getElementById('payer-email').value;

    if (!sellerId) {
        showToast('Selecione um vendedor!');
        return;
    }

    const btn = e.target.querySelector('button[type="submit"]');
    const originalText = btn.textContent;
    btn.textContent = 'Processando...';
    btn.disabled = true;

    try {
        const response = await fetch('/pay/split', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sellerId, amount, fee, payerEmail })
        });

        const result = await response.json();

        if (response.ok) {
            showPaymentResult(result);
            showToast('Pix gerado com sucesso!');
        } else {
            throw new Error(result.error || 'Erro desconhecido');
        }

    } catch (error) {
        console.error(error);
        showToast('Erro: ' + error.message);
    } finally {
        btn.textContent = originalText;
        btn.disabled = false;
    }
});

function showPaymentResult(data) {
    const resultContainer = document.getElementById('payment-result');
    const formContainer = document.querySelector('.form-container');

    document.getElementById('qr-image').src = `data:image/png;base64,${data.qr_code_base64}`;
    document.getElementById('copy-paste-code').value = data.qr_code;

    resultContainer.classList.remove('hidden');
    // Em telas pequenas, rolar para o resultado
    if (window.innerWidth < 768) {
        resultContainer.scrollIntoView({ behavior: 'smooth' });
    }
}

function copyToClipboard() {
    const copyVx = document.getElementById('copy-paste-code');
    copyVx.select();
    document.execCommand("copy"); // Fallback
    navigator.clipboard.writeText(copyVx.value).then(() => {
        showToast('Código copiado!');
    });
}

// Toast Utils
function showToast(msg) {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.classList.remove('hidden');
    setTimeout(() => {
        toast.classList.add('hidden');
    }, 3000);
}

// Stats
async function fetchStats() {
    try {
        const response = await fetch('/api/stats');
        const data = await response.json();

        // Update stats
        if (document.getElementById('total-sellers'))
            document.getElementById('total-sellers').textContent = data.total_sellers;

        if (document.getElementById('total-amount'))
            document.getElementById('total-amount').textContent = (data.total_amount || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

        if (document.getElementById('total-fees'))
            document.getElementById('total-fees').textContent = (data.total_fees || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

    } catch (error) {
        console.error('Erro ao buscar estatísticas:', error);
    }
}