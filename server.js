const express = require("express");
const cors = require("cors");
const bcrypt = require("bcrypt");
const { Pool } = require("pg");
const stripe = require("stripe")(process.env.STRIPE_API_KEY);

const app = express();

// ========================
// Configuração Postgres
// ========================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL, // Neon ou Render
  ssl: { rejectUnauthorized: false }
});

// ========================
// CORS
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
      console.log("CORS bloqueado:", origin);
      callback(new Error("Not allowed by CORS"));
    }
  },
  methods: "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS",
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true
}));

app.use(express.json());

// ========================
// Cadastro + Checkout
// ========================
app.post("/api/register-and-checkout", async (req, res) => {
  const client = await pool.connect();
  try {
    const { full_name, username, birthdate, email, phone, password, plan } = req.body;

    const nome_completo = full_name;
    const usuario = username;
    const senha = password; 
    const telefone = phone;
    const data_nascimento = birthdate;

    const mapPlano = { free: 1, silver: 2, gold: 3 };
    const id_plano = mapPlano[plan];


    // Verifica se email já existe
    const check = await client.query("SELECT id FROM usuarios WHERE email=$1", [email]);
    if (check.rows.length > 0) {
      return res.status(400).json({ error: "Email já cadastrado" });
    }

    // Criptografa senha
    const hashedPassword = await bcrypt.hash(senha, 10);

    // Salva usuário
    const insertUser = await client.query(
      `INSERT INTO usuarios 
        (nome_completo, email, usuario, senha, telefone, data_nascimento, id_plano) 
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [nome_completo, email, usuario, hashedPassword, telefone, data_nascimento, id_plano]
    );

    const userId = insertUser.rows[0].id;

    // Se plano Free → ativa direto
    if (id_plano === 1) {
      await client.query(
        `INSERT INTO client_plans (id_client, id_plano, ativo) 
         VALUES ($1,$2,true)`,
        [userId, id_plano]
      );
      return res.json({ message: "Plano Free ativado com sucesso", userId });
    }

    // Mapeamento para Price IDs
    const priceIds = {
      2: process.env.PRICE_SILVER,
      3: process.env.PRICE_GOLD
    };

    if (!priceIds[id_plano]) {
      return res.status(400).json({ error: "Plano inválido ou não configurado" });
    }

    // Cria sessão de pagamento
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "subscription",
      line_items: [
        {
          price: priceIds[id_plano],
          quantity: 1
        }
      ],
      success_url: "https://faixabet.com.br/success?session_id={CHECKOUT_SESSION_ID}",
      cancel_url: "https://faixabet.com.br/cancel",
      metadata: { userId, id_plano }
    });

    res.json({ sessionId: session.id });
  } catch (err) {
    console.error("Erro no checkout:", err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ========================
// Confirmação de pagamento
// ========================
app.get("/api/payment-success", async (req, res) => {
  const client = await pool.connect();
  try {
    const { session_id } = req.query;
    const session = await stripe.checkout.sessions.retrieve(session_id);

    if (session.payment_status !== "paid") {
      return res.status(400).json({ error: "Pagamento não confirmado" });
    }

    const userId = session.metadata.userId;
    const id_plano = session.metadata.id_plano;
    const valor = session.amount_total / 100;
    const forma_pagamento = session.payment_method_types.join(",");

    // Ativa plano
    await client.query(
      `INSERT INTO client_plans (id_client, id_plano, ativo) 
       VALUES ($1,$2,true)`,
      [userId, id_plano]
    );

    // Grava financeiro
    await client.query(
      `INSERT INTO financeiro (id_cliente, id_plano, data_pagamento, forma_pagamento, valor, data_validade, estorno) 
       VALUES ($1,$2,NOW(),$3,$4,(NOW() + '30 days'::interval),'N')`,
      [userId, id_plano, forma_pagamento, valor]
    );

    res.json({ message: "Pagamento confirmado e plano ativado!" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});
// ========================
// Verificar se email já existe
// ========================
app.post("/api/check-email", async (req, res) => {
  const client = await pool.connect();
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email não informado" });

    const check = await client.query("SELECT id FROM usuarios WHERE email=$1", [email]);

    if (check.rows.length > 0) {
      return res.json({ exists: true });
    } else {
      return res.json({ exists: false });
    }
  } catch (err) {
    console.error("Erro em /check-email:", err);
    res.status(500).json({ error: "Erro interno" });
  } finally {
    client.release();
  }
});

// ========================
// Start
// ========================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
