// ========================
// FaixaBet Backend - Stripe + Cadastro
// ========================
const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const stripe = require("stripe")(process.env.STRIPE_API_KEY);

const app = express();
app.use(express.json());
app.use(cors());

// ========================
// Conexão com Postgres
// ========================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ========================
// Retornar publishableKey para o frontend
// ========================
app.get("/api/public-key", (req, res) => {
  res.json({ publishableKey: process.env.STRIPE_PUBLISHABLE_KEY });
});

// ========================
// Checar se email já existe
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

// ========================
// Registrar usuário e iniciar checkout
// ========================
app.post("/api/register-and-checkout", async (req, res) => {
  const client = await pool.connect();
  try {
    const { full_name, username, birthdate, email, phone, password, plan } = req.body;

    // Inserir usuário no banco
    const result = await client.query(
      `INSERT INTO usuarios 
         (nome_completo, usuario, email, telefone, senha, data_nascimento, dt_cadastro, ativo) 
       VALUES ($1,$2,$3,$4,$5,$6,NOW(),true) 
       RETURNING id`,
      [full_name, username, email, phone, password, birthdate || null]
    );

    const userId = result.rows[0].id;

    // Se for plano free → não cria sessão no Stripe
    if (plan === "free") {
      return res.json({ userId });
    }

    // Mapear planos → IDs de preços configurados no Stripe
    const priceMap = {
      silver: process.env.PRICE_SILVER,
      gold: process.env.PRICE_GOLD,
    };
    const priceId = priceMap[plan];
    if (!priceId) throw new Error("Plano inválido");

    // Criar sessão de checkout (assinatura mensal)
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
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

// ========================
// Confirmar pagamento
// ========================
app.get("/api/payment-success", async (req, res) => {
  try {
    const { session_id } = req.query;
    const session = await stripe.checkout.sessions.retrieve(session_id);

    if (session.payment_status === "paid") {
      const client = await pool.connect();
      try {
        const userId = session.metadata.userId;
        const plan = session.metadata.plan;

        // Atualizar plano ativo do usuário
        await client.query("UPDATE usuarios SET id_plano=$2 WHERE id=$1", [
          userId,
          plan,
        ]);

        // Registrar no histórico
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
// Start server
// ========================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
