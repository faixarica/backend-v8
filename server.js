// ========================
// server.js
// ========================
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcrypt");
const { Pool } = require("pg");
const stripe = require("stripe")(process.env.STRIPE_API_KEY);

const app = express();

// ========================
// Configuração CORS
// ========================
const allowedOrigins = [
  "https://www.faixabet.com.br", // produção
  "http://localhost:3000",       // dev local (React/Next)
  "http://127.0.0.1:5500",       // dev local (HTML + LiveServer)
];

app.use(
  cors({
    origin: function (origin, callback) {
      // Permite requests sem "origin" (ex.: curl, Postman)
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      } else {
        return callback(new Error("CORS não permitido para este domínio: " + origin));
      }
    },
    credentials: true,
  })
);

app.use(express.json());

// ========================
// Configuração Postgres
// ========================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ========================
// Rotas auxiliares
// ========================
app.get("/", (req, res) => {
  res.json({ message: "API online 🚀" });
});

// Rota para expor a chave pública Stripe
app.get("/api/public-key", (req, res) => {
  res.json({ publishableKey: process.env.STRIPE_PUBLISHABLE_KEY });
});

// ========================
// Rota: Checar email
// ========================
app.post("/api/check-email", async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: "Email é obrigatório" });
  }

  try {
    const result = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
    if (result.rows.length > 0) {
      return res.json({ exists: true });
    } else {
      return res.json({ exists: false });
    }
  } catch (err) {
    console.error("Erro no check-email:", err);
    return res.status(500).json({ error: "Erro interno no servidor" });
  }
});

// ========================
// Rota: Registrar usuário + iniciar checkout
// ========================
app.post("/api/register-and-checkout", async (req, res) => {
  const { full_name, username, birthdate, email, phone, password, plan } = req.body;

  if (!full_name || !username || !birthdate || !email || !phone || !password || !plan) {
    return res.status(400).json({ error: "Todos os campos são obrigatórios" });
  }

  try {
    // 1. Checar se email já existe
    const checkUser = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
    if (checkUser.rows.length > 0) {
      return res.status(400).json({ error: "Email já cadastrado" });
    }

    // 2. Criar hash da senha
    const hashedPassword = await bcrypt.hash(password, 10);

    // 3. Inserir usuário
    const insertUser = await pool.query(
      `INSERT INTO users (full_name, username, birthdate, email, phone, password, plan)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [full_name, username, birthdate, email, phone, hashedPassword, plan]
    );

    const userId = insertUser.rows[0].id;

    // 4. Criar sessão de checkout no Stripe
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [
        {
          price: process.env[`STRIPE_PRICE_${plan.toUpperCase()}`], // preço configurado no Stripe
          quantity: 1,
        },
      ],
      success_url: "https://www.faixabet.com.br/sucesso?session_id={CHECKOUT_SESSION_ID}",
      cancel_url: "https://www.faixabet.com.br/cancelado",
      metadata: { userId },
    });

    return res.json({ userId, sessionId: session.id, url: session.url });
  } catch (err) {
    console.error("Erro no register-and-checkout:", err);
    return res.status(500).json({ error: "Erro interno no servidor" });
  }
});

// ========================
// Start Server
// ========================
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
