const express = require("express");
const cors = require("cors");
const stripe = require("stripe")("sk_test_51Re2DXIGnSq3aVjyz6bGfgnrCIdej1KFBgimhnVaMUsafC2wz1zkRAEq9v5sdeR5bRsH57dkfkFBRUPkYgdTmSAB003OUjspVp");

const app = express();
app.use(cors());
app.use(express.json());

// Simulação de armazenamento de usuários (em produção, usar banco de dados)
let users = [];
let nextUserId = 1;

// Endpoint para registro de usuário
app.post("/api/register", async (req, res) => {
    const { full_name, username, birthdate, email, phone, password, plan } = req.body;
    
    // Validação básica
    if (!full_name || !username || !email || !password) {
        return res.status(400).json({ error: "Preencha todos os campos obrigatórios." });
    }
    
    // Criar usuário (simulação)
    const newUser = {
        client_id: nextUserId++,
        full_name,
        username,
        birthdate,
        email,
        phone,
        password, // Em produção, hashear a senha!
        plan,
        created_at: new Date()
    };
    
    users.push(newUser);
    
    res.json({ 
        client_id: newUser.client_id,
        message: "Usuário registrado com sucesso!"
    });
});

// Endpoint para ativar plano gratuito
app.post("/api/process-free-plan", async (req, res) => {
    const { client_id, plan, email } = req.body; // Adiciona email

    if (plan !== 'free') {
        return res.status(400).json({ error: "Plano inválido para este endpoint." });
    }

    // Encontrar usuário e atualizar plano (simulação)
    const userIndex = users.findIndex(u => u.client_id == client_id);
    if (userIndex === -1) {
        return res.status(404).json({ error: "Usuário não encontrado." });
    }
    // Simular gravação nas tabelas conforme o fluxo técnico
    // client_plans e financeiro (simulação)
    users[userIndex].plan = 'free';
    users[userIndex].subscribed_at = new Date();
    // Aqui você adicionaria a lógica para salvar em 'client_plans' e 'financeiro'

    res.json({ message: "Plano Free processado e ativado com sucesso!" });
});
// Endpoint para criar sessão de checkout do Stripe
app.post("/api/create-checkout-session", async (req, res) => {
    const { client_id, plan } = req.body;
    
    // Encontrar usuário
    const user = users.find(u => u.client_id == client_id);
    if (!user) {
        return res.status(404).json({ error: "Usuário não encontrado." });
    }
    
    // Definir preços dos planos (em centavos)
    const planPrices = {
        silver: 2990, // R$ 29,90
        gold: 5990    // R$ 59,90
    };
    
    const price = planPrices[plan];
    if (!price) {
        return res.status(400).json({ error: "Plano inválido." });
    }
    
    try {
        // Criar sessão de checkout no Stripe
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{
                price_data: {
                    currency: 'brl',
                    product_data: {
                        name: `Plano ${plan.charAt(0).toUpperCase() + plan.slice(1)}`,
                        description: `Assinatura do plano ${plan}`,
                    },
                    unit_amount: price,
                },
                quantity: 1,
            }],
            mode: 'payment',
            success_url: 'https://faixabet.com.br/success', // Sem espaços
            cancel_url:  'https://faixabet.com.br/cancel',   // Sem espaços
            // success_url: 'https://faixab7.streamlit.app/', // Ou uma página de sucesso específica no seu site
            // cancel_url: 'https://seu-dominio.com/#planos', // URL da seção de planos do seu site 
            metadata: {
                client_id: client_id,
                plan: plan
            }
        });
        
        res.json({ url: session.url });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// verificar email (que está faltando):
app.post("/api/check-email", async (req, res) => {
    const { email } = req.body;
    // Simular verificação no banco de dados
    const emailExists = users.some(u => u.email === email);
    res.json({ exists: emailExists });
});

// Endpoint para criar Payment Intent (mantido para compatibilidade)
app.post("/api/create-payment-intent", async (req, res) => {
    const { amount } = req.body;

    try {
        const paymentIntent = await stripe.paymentIntents.create({
            amount,
            currency: "brl",
        });
        res.json({ clientSecret: paymentIntent.client_secret });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
const PORT = process.env.PORT || 3000; // Usa a porta do Render ou 3000 como fallback
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));