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
app.post("/api/subscribe-free", async (req, res) => {
    const { client_id, plan } = req.body;
    
    if (plan !== 'free') {
        return res.status(400).json({ error: "Plano inválido para este endpoint." });
    }
    
    // Encontrar usuário e atualizar plano (simulação)
    const user = users.find(u => u.client_id == client_id);
    if (!user) {
        return res.status(404).json({ error: "Usuário não encontrado." });
    }
    
    user.plan = 'free';
    user.subscribed_at = new Date();
    
    res.json({ message: "Plano Free ativado com sucesso!" });
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
            success_url: 'https://seusite.com/success',
            cancel_url: 'https://seusite.com/cancel',
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

app.listen(3000, () => console.log("Servidor rodando na porta 3000"));