// ========================
// server.js (corrigido para Stripe Checkout)
// ========================
const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const stripe = require("stripe")(process.env.STRIPE_API_KEY);

const app = express();
app.use(express.json());
app.use(cors());

// Conexão com Postgres
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Retorna a publishable key
app.get("/api/public-key", (req, res) => {
  res.json({ publishableKey: process.env.STRIPE_PUBLISHABLE_KEY });
});

// Registrar usuário e criar sessão do Stripe
app.post("/api/register-and-checkout", async (req, res) => {
  const client = await pool.connect();
  try {
    const { full_name, username, birthdate, email, phone, password, plan } = req.body;

    // Inserir usuário
    const userResult = await client.query(
      `INSERT INTO usuarios (nome, username, email, telefone, senha, nascimento) 
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [full_name, username, email, phone, password, birthdate || null]
    );

    const userId = userResult.rows[0].id;

    // Se plano free → não cria sessão Stripe
    if (plan === "free") {
      return res.json({ userId });
    }

    // Mapear planos → priceId do Stripe
    const priceMap = {
      silver: process.env.STRIPE_PRICE_SILVER,
      gold: process.env.STRIPE_PRICE_GOLD,
    };
    const priceId = priceMap[plan];
    if (!priceId) throw new Error("Plano inválido");

    // Criar sessão de checkout
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"], // somente cartão
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: "https://faixabet.com.br/?session_id={CHECKOUT_SESSION_ID}",
      cancel_url: "https://faixabet.com.br/cancel",
      metadata: { userId, plan },
    });

    res.json({ userId, sessionId: session.id });
  } catch (err) {
    console.error("Erro register-and-checkout:", err.message);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Confirmar pagamento
app.get("/api/payment-success", async (req, res) => {
  try {
    const { session_id } = req.query;
    const session = await stripe.checkout.sessions.retrieve(session_id);

    if (session.payment_status === "paid") {
      const client = await pool.connect();
      try {
        const userId = session.metadata.userId;
        const plan = session.metadata.plan;

        await client.query(
          "UPDATE usuarios SET id_plano=$2 WHERE id=$1",
          [userId, plan]
        );

        await client.query(
          "INSERT INTO client_plans (id_client, id_plano, ativo) VALUES ($1,$2,true) ON CONFLICT (id_client) DO UPDATE SET id_plano=$2, ativo=true",
          [userId, plan]
        );

        await client.query(
          "INSERT INTO financeiro (id_cliente, id_plano, data_pagamento, forma_pagamento, valor, estorno) VALUES ($1,$2,NOW(),'cartao',$3,'N')",
          [userId, plan, session.amount_total / 100]
        );
      } finally {
        client.release();
      }
      res.json({ success: true });
    } else {
      res.status(400).json({ error: "Pagamento não confirmado" });
    }
  } catch (err) {
    console.error("Erro payment-success:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ========================
// Check se email já existe
// ========================
app.post("/api/check-email", async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "Email é obrigatório" });

  const client = await pool.connect();
  try {
    const result = await client.query(
      "SELECT 1 FROM usuarios WHERE email=$1 LIMIT 1",
      [email]
    );
    res.json({ exists: result.rowCount > 0 });
  } catch (err) {
    console.error("Erro check-email:", err.message);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
