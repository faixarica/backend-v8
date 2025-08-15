const express = require("express");
const cors = require("cors");
const stripe = require("stripe")("sk_test_51Re2DXIGnSq3aVjyz6bGfgnrCIdej1KFBgimhnVaMUsafC2wz1zkRAEq9v5sdeR5bRsH57dkfkFBRUPkYgdTmSAB003OUjspVp");

const app = express();

// Configuração de CORS para aceitar chamadas do seu site e localmente
// CORS — permitir tanto com www quanto sem
// CORS — permitir tanto com www quanto sem

const allowedOrigins = [
  "https://faixabet.com.br",
  "https://www.faixabet.com.br",
  "http://localhost:3000"
];

//app.use(cors({
 // origin: function (origin, callback) {
//    if (!origin || allowedOrigins.includes(origin)) {
//      callback(null, true);
//    } else {
//      console.log("CORS bloqueado para origem:", origin);
//      callback(new Error("Not allowed by CORS"));/
//    }
//  },
//  methods: "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS",
//  allowedHeaders: ["Content-Type", "Authorization"],
//  credentials: true
//}));
app.use(cors({
  origin: "*",
  methods: "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS",
  allowedHeaders: ["Content-Type", "Authorization"]
}));
app.options("*", cors());


// Habilita resposta ao preflight
app.options("*", cors());

app.use(express.json());

// Simulação de armazenamento de usuários (em produção, usar banco de dados)
let users = [];
let nextUserId = 1;

// Registro de usuário
app.post("/api/register", async (req, res) => {
  const { full_name, username, birthdate, email, phone, password, plan } = req.body;

  if (!full_name || !username || !email || !password) {
    return res.status(400).json({ error: "Preencha todos os campos obrigatórios." });
  }

  const newUser = {
    client_id: nextUserId++,
    full_name,
    username,
    birthdate,
    email,
    phone,
    password, // Em produção: hashear a senha
    plan,
    created_at: new Date()
  };

  users.push(newUser);

  res.json({
    client_id: newUser.client_id,
    message: "Usuário registrado com sucesso!"
  });
});

// Plano gratuito
app.post("/api/process-free-plan", async (req, res) => {
  const { client_id, plan, email } = req.body;

  if (plan !== "free") {
    return res.status(400).json({ error: "Plano inválido para este endpoint." });
  }

  const userIndex = users.findIndex(u => u.client_id == client_id);
  if (userIndex === -1) {
    return res.status(404).json({ error: "Usuário não encontrado." });
  }

  users[userIndex].plan = "free";
  users[userIndex].subscribed_at = new Date();

  res.json({ message: "Plano Free processado e ativado com sucesso!" });
});

// Criar sessão de checkout Stripe
app.post("/api/create-checkout-session", async (req, res) => {
  const { client_id, plan } = req.body;

  const user = users.find(u => u.client_id == client_id);
  if (!user) {
    return res.status(404).json({ error: "Usuário não encontrado." });
  }

  const planPrices = {
    silver: 2990,
    gold: 5990
  };

  const price = planPrices[plan];
  if (!price) {
    return res.status(400).json({ error: "Plano inválido." });
  }

  try {
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

// Verificar email
app.post("/api/check-email", async (req, res) => {
  const { email } = req.body;
  const emailExists = users.some(u => u.email === email);
  res.json({ exists: emailExists });
});

// Payment Intent (compatibilidade)
app.post("/api/create-payment-intent", async (req, res) => {
  const { amount } = req.body;

  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency: "brl"
    });
    res.json({ clientSecret: paymentIntent.client_secret });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
