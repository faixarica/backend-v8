const express = require("express");
const cors = require("cors");
const stripe = require("stripe")("sk_test_51Re2DXIGnSq3aVjyz6bGfgnrCIdej1KFBgimhnVaMUsafC2wz1zkRAEq9v5sdeR5bRsH57dkfkFBRUPkYgdTmSAB003OUjspVp");
const express = require("express");
const bcrypt = require("bcrypt");

// ========================
// Configuração de CORS
// ========================
const allowedOrigins = [
  "https://faixabet.com.br",
  "https://www.faixabet.com.br",
  "http://localhost:3000"
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.log("CORS bloqueado para origem:", origin);
      callback(new Error("Not allowed by CORS"));
    }
  },
  methods: "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS",
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true
}));

app.options("*", cors());

// ========================
// Body parser
// ========================
app.use(express.json());

// ========================
// Armazenamento temporário de usuários
// ========================
let users = [];
let nextUserId = 1;

// ========================
// Registro de usuário
// ========================
app.post("/api/register", async (req, res) => {
  try {
    const { full_name, username, birthdate, email, phone, password, plan } = req.body;

    if (!full_name || !username || !email || !password) {
      return res.status(400).json({ error: "Preencha todos os campos obrigatórios." });
    }

    // Hash da senha
    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = {
      client_id: nextUserId++,
      full_name,
      username,
      birthdate,
      email,
      phone,
      password: hashedPassword,
      plan,
      created_at: new Date()
    };

    users.push(newUser);

    res.json({
      client_id: newUser.client_id,
      message: "Usuário registrado com sucesso!"
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========================
// Plano gratuito
// ========================
app.post("/api/process-free-plan", (req, res) => {
  const { client_id, plan } = req.body;

  if (plan !== "free") {
    return res.status(400).json({ error: "Plano inválido para este endpoint." });
  }

  const user = users.find(u => u.client_id == client_id);
  if (!user) return res.status(404).json({ error: "Usuário não encontrado." });

  user.plan = "free";
  user.subscribed_at = new Date();

  res.json({ message: "Plano Free processado e ativado com sucesso!" });
});

// ========================
// Criar sessão de checkout Stripe
// ========================
app.post("/api/create-checkout-session", async (req, res) => {
  try {
    const { client_id, plan } = req.body;
    const user = users.find(u => u.client_id == client_id);
    if (!user) return res.status(404).json({ error: "Usuário não encontrado." });

    const planPrices = {
      silver: 2990,
      gold: 5990
    };

    const price = planPrices[plan];
    if (!price) return res.status(400).json({ error: "Plano inválido." });

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [{
        price_data: {
          currency: "brl",
          product_data: {
            name: `Plano ${plan.charAt(0).toUpperCase() + plan.slice(1)}`,
            description: `Assinatura do plano ${plan}`
          },
          unit_amount: price
        },
        quantity: 1
      }],
      mode: "payment",
      success_url: "https://faixabet.com.br/success",
      cancel_url: "https://faixabet.com.br/cancel",
      metadata: { client_id, plan }
    });

    res.json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========================
// Verificar email
// ========================
app.post("/api/check-email", (req, res) => {
  const { email } = req.body;
  const emailExists = users.some(u => u.email === email);
  res.json({ exists: emailExists });
});

// ========================
// Payment Intent (compatibilidade)
// ========================
app.post("/api/create-payment-intent", async (req, res) => {
  try {
    const { amount } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: "Amount inválido." });
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency: "brl"
    });

    res.json({ clientSecret: paymentIntent.client_secret });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========================
// Start do servidor
// ========================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
