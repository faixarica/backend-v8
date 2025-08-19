// ========================
// server.js
// ========================
require("dotenv").config(); // opcional p/ dev local
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const bcrypt = require("bcryptjs");
const { Pool } = require("pg");
const Stripe = require("stripe");

const STRIPE_SECRET = process.env.STRIPE_API_KEY;             // sk_...
const STRIPE_PUBLISHABLE = process.env.STRIPE_PUBLISHABLE_KEY; // pk_...
const stripe = new Stripe(STRIPE_SECRET, { apiVersion: "2024-06-20" });

const app = express();

// ------------------------
// Segurança básica
// ------------------------
app.use(helmet({
  contentSecurityPolicy: false, // se seu HTML tiver inline scripts; ajuste depois
}));
app.disable("x-powered-by");

// ------------------------
// CORS
// ------------------------
const allowedOrigins = new Set([
  "https://www.faixabet.com.br",
  "https://faixabet.com.br",
  "http://localhost:3000",
  "http://127.0.0.1:5500",
]);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true); // Postman, curl etc.
      if (allowedOrigins.has(origin)) return callback(null, true);
      return callback(new Error("CORS não permitido para: " + origin));
    },
    credentials: false, // não usamos cookies/sessões via navegador
  })
);

app.use(express.json());

// ------------------------
// Postgres
// ------------------------
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ------------------------
// Rotas auxiliares
// ------------------------
app.get("/", (req, res) => {
  res.json({ message: "API online 🚀" });
});

// ✅ Somente a publishable key (pk_...) vai para o front
app.get("/api/public-key", (req, res) => {
  if (!STRIPE_PUBLISHABLE) {
    return res.status(500).json({ error: "Stripe publishable key não configurada" });
  }
  res.json({ publishableKey: STRIPE_PUBLISHABLE });
});

/////
// ------------------------
// Rota: Checar email
// ------------------------
app.post("/api/check-email", async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "Email é obrigatório" });

  try {
    const result = await pool.query("SELECT id FROM usuario WHERE email = $1", [email]);
    return res.json({ exists: result.rows.length > 0 });
  } catch (err) {
    console.error("Erro no check-email:", err);
    return res.status(500).json({ error: "Erro interno no servidor" });
  }
});


// ------------------------
// Rota: Registrar usuário + iniciar checkout
// ------------------------
app.post("/api/register-and-checkout", async (req, res) => {
  const { full_name, username, birthdate, email, phone, password, plan } = req.body;

  if (!full_name || !username || !birthdate || !email || !phone || !password || !plan) {
    return res.status(400).json({ error: "Todos os campos são obrigatórios" });
  }

  // Mapeamento de plano (front → banco)
  const PLANOS = {
    free: { id_plano: 1, stripePrice: null },
    silver: { id_plano: 2, stripePrice: process.env.STRIPE_PRICE_SILVER },
    gold: { id_plano: 3, stripePrice: process.env.STRIPE_PRICE_GOLD },
  };

  const planoKey = String(plan || "").toLowerCase();
  if (!(planoKey in PLANOS)) {
    return res.status(400).json({ error: "Plano inválido" });
  }

  try {
    // 1. Checar se email já existe
    const checkUser = await pool.query("SELECT id FROM usuario WHERE email = $1", [email]);
    if (checkUser.rows.length > 0) {
      return res.status(400).json({ error: "Email já cadastrado" });
    }

    // 2. Criar hash da senha
    const hashedPassword = await bcrypt.hash(password, 10);

    // 3. Inserir usuário na tabela `usuario`
    const insertUser = await pool.query(
      `INSERT INTO usuario 
         (nome_completo, usuario, data_nascimento, email, telefone, senha, id_plano) 
       VALUES ($1,$2,$3,$4,$5,$6,$7) 
       RETURNING id`,
      [full_name, username, birthdate, email, phone, hashedPassword, PLANOS[planoKey].id_plano]
    );

    const userId = insertUser.rows[0].id;

    // 4. Se for plano Free → já retorna sucesso
    if (planoKey === "free") {
      return res.json({ userId });
    }

    // 5. Plano Pago → criar sessão Stripe
    const priceId = PLANOS[planoKey].stripePrice;
    if (!priceId) {
      return res.status(500).json({ error: `Price ID do plano ${planoKey} não configurado` });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: "https://www.faixabet.com.br/sucesso?session_id={CHECKOUT_SESSION_ID}",
      cancel_url: "https://www.faixabet.com.br/cancelado",
      client_reference_id: String(userId),
      customer_email: email,
      metadata: { userId: String(userId), plano: planoKey },
    });

    return res.json({ userId, sessionId: session.id });
  } catch (err) {
    console.error("Erro no register-and-checkout:", err);
    return res.status(500).json({ error: "Erro interno no servidor" });
  }
});



///
// ------------------------
// Rota: Confirmar pagamento (após Stripe)
// ------------------------
app.get("/api/payment-success", async (req, res) => {
  const { session_id } = req.query;
  if (!session_id) return res.status(400).json({ error: "session_id é obrigatório" });

  try {
    const session = await stripe.checkout.sessions.retrieve(session_id);
    // status típico: 'complete' quando o checkout finaliza
    return res.json({
      status: session.status,
      mode: session.mode,
      subscription: session.subscription,
    });
  } catch (err) {
    console.error("Erro ao recuperar sessão:", err);
    return res.status(500).json({ error: "Erro ao verificar sessão" });
  }
});

// ------------------------
// Start
// ------------------------
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
