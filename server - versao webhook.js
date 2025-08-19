const express = require("express");
const cors = require("cors");
const bcrypt = require("bcrypt");
const { Pool } = require("pg");

// Secret key do Stripe (sk_...)
const stripe = require("stripe")(process.env.STRIPE_API_KEY);

const app = express();

// ========================
// Configuração Postgres
// ========================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL, // Neon / Render
  ssl: { rejectUnauthorized: false },
});

// ========================
// CORS
// ========================
const allowedOrigins = [
  "https://faixabet.com.br",
  "https://www.faixabet.com.br",
  "http://localhost:3000",
];
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        console.log("CORS bloqueado:", origin);
        callback(new Error("Not allowed by CORS"));
      }
    },
    methods: "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS",
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

// ========================
// WEBHOOK do Stripe (RAW BODY!)
// — precisa vir ANTES do express.json()
// ========================
const endpointSecret = process.env.STRIPE_ENDPOINT_SECRET;

app.post(
  "/api/stripe/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];
    let event;

    try {
      event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    } catch (err) {
      console.error("❌ Falha na verificação do webhook:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
      switch (event.type) {
        case "checkout.session.completed": {
          // Fonte da verdade para ativar o plano
          const session = event.data.object;

          if (session.mode === "subscription") {
            const userId = parseInt(session.metadata?.userId, 10);
            const id_plano = parseInt(session.metadata?.id_plano, 10);
            if (!userId || !id_plano) break;

            // Tentar obter a validade real do ciclo
            let currentPeriodEnd = null;
            try {
              if (session.subscription) {
                const sub = await stripe.subscriptions.retrieve(
                  session.subscription
                );
                if (sub?.current_period_end) {
                  currentPeriodEnd = new Date(sub.current_period_end * 1000);
                }
              }
            } catch (e) {
              console.warn("Não foi possível obter subscription:", e.message);
            }

            const valor =
              (typeof session.amount_total === "number"
                ? session.amount_total
                : 0) / 100;
            const forma =
              (session.payment_method_types || []).join(",") || "card";
            const dataValidade = currentPeriodEnd || null;

            const client = await pool.connect();
            try {
              // Ativa/atualiza plano do cliente
              const upd = await client.query(
                "UPDATE client_plans SET id_plano=$2, ativo=true WHERE id_client=$1",
                [userId, id_plano]
              );
              if (upd.rowCount === 0) {
                await client.query(
                  "INSERT INTO client_plans (id_client, id_plano, ativo) VALUES ($1,$2,true)",
                  [userId, id_plano]
                );
              }

              // Atualiza plano no cadastro do usuário também
              await client.query(
                "UPDATE usuarios SET id_plano=$2 WHERE id=$1",
                [userId, id_plano]
              );

              // Lançamento financeiro (uma vez por cobrança inicial)
              await client.query(
                `INSERT INTO financeiro
                   (id_cliente, id_plano, data_pagamento, forma_pagamento, valor, data_validade, estorno)
                 VALUES
                   ($1, $2, NOW(), $3, $4, COALESCE($5, NOW() + INTERVAL '30 days'), 'N')`,
                [userId, id_plano, forma, valor, dataValidade]
              );
            } finally {
              client.release();
            }
          }
          break;
        }

        // Opcionalmente, trate renovações:
        case "invoice.paid": {
          // Aqui dá para lançar renovação no financeiro se desejar,
          // usando event.data.object (invoice) → amount_paid, subscription etc.
          break;
        }

        case "customer.subscription.deleted": {
          // Pode inativar plano se a assinatura for cancelada:
          // const sub = event.data.object;
          // (Se você guardar subscription id na tabela, dá pra mapear de volta ao usuário)
          break;
        }

        default:
          // Outros eventos podem ser ignorados por ora
          break;
      }

      res.json({ received: true });
    } catch (err) {
      console.error("Erro processando webhook:", err);
      res.status(500).send("Webhook handler failed");
    }
  }
);

// ========================
// Body parser para as DEMAIS rotas
// ========================
app.use(express.json());

// ========================
// Endpoint para o Front pegar a Publishable Key (pk_...)
// ========================
app.get("/api/public-key", (req, res) => {
  const key = process.env.STRIPE_PUBLISHABLE_KEY || "";
  if (!key) {
    return res
      .status(500)
      .json({ error: "STRIPE_PUBLISHABLE_KEY não configurada" });
  }
  res.json({ publishableKey: key });
});

// ========================
// Cadastro + Checkout
// ========================
app.post("/api/register-and-checkout", async (req, res) => {
  const client = await pool.connect();
  try {
    const { full_name, username, birthdate, email, phone, password, plan } =
      req.body;

    const nome_completo = full_name;
    const usuario = username;
    const senha = password;
    const telefone = phone;
    const data_nascimento = birthdate;

    const mapPlano = { free: 1, silver: 2, gold: 3 };
    const id_plano = mapPlano[`${plan}`.toLowerCase()];

    if (!id_plano) {
      return res.status(400).json({ error: "Plano inválido" });
    }

    // Verifica se email já existe
    const check = await client.query("SELECT id FROM usuarios WHERE email=$1", [
      email,
    ]);
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

    // Plano Free → ativa direto e retorna
    if (id_plano === 1) {
      await client.query(
        `INSERT INTO client_plans (id_client, id_plano, ativo) 
         VALUES ($1,$2,true)`,
        [userId, id_plano]
      );
      return res.json({ message: "Plano Free ativado com sucesso", userId });
    }

    // Mapeamento Price IDs (ambiente)
    const priceIds = {
      2: process.env.PRICE_SILVER,
      3: process.env.PRICE_GOLD,
    };
    const priceId = priceIds[id_plano];
    if (!priceId) {
      return res
        .status(400)
        .json({ error: "Price ID do plano não configurado no servidor." });
    }

    // Cria sessão de checkout (subscription)
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url:
        "https://faixabet.com.br/success?session_id={CHECKOUT_SESSION_ID}",
      cancel_url: "https://faixabet.com.br/cancel",
      metadata: { userId, id_plano },
      // opcional: client_reference_id: `${userId}`,
      // automatic_tax: { enabled: false },
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
// Confirmação (apenas para feedback visual ao usuário)
// — A ativação real vem do WEBHOOK
// ========================
app.get("/api/payment-success", async (req, res) => {
  try {
    const { session_id } = req.query;
    if (!session_id) return res.status(400).json({ error: "session_id faltando" });

    const session = await stripe.checkout.sessions.retrieve(session_id);
    if (session.payment_status !== "paid") {
      return res.status(400).json({ error: "Pagamento não confirmado" });
    }
    res.json({ message: "Pagamento confirmado" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
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

    const check = await client.query("SELECT id FROM usuarios WHERE email=$1", [
      email,
    ]);

    return res.json({ exists: check.rows.length > 0 });
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
