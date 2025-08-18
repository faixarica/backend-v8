// ========================
// FaixaBet Backend - Stripe + Cadastro
// ========================
const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

// server.js
console.log("=== Iniciando FaixaBet Backend ===");
console.log("__dirname:", __dirname);
console.log("process.cwd():", process.cwd());

// --- Validação de Variáveis de Ambiente Críticas ---
// ... (resto do seu código)

// --- Validação de Variáveis de Ambiente Críticas ---
// Esta seção foi movida para o início para falhar rápido se configs críticas faltarem
const requiredEnvVars = [
  'STRIPE_API_KEY', // Necessário para o backend do Stripe
  'STRIPE_PUBLISHABLE_KEY', // Necessário para o frontend do Stripe
  'DATABASE_URL', // Necessário para conectar ao Postgres
  'PRICE_SILVER', // ID do preço do Stripe para o plano Silver
  'PRICE_GOLD'    // ID do preço do Stripe para o plano Gold
];

const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);

if (missingEnvVars.length > 0) {
  console.error("ERRO CRÍTICO: As seguintes variáveis de ambiente estão faltando:", missingEnvVars.join(', '));
  // Usar console.error e process.exit(1) é uma boa prática para erros de configuração
  process.exit(1); 
}

// --- Fim da Validação Inicial ---

// Inicializar Stripe APÓS validar a chave
const stripe = require("stripe")(process.env.STRIPE_API_KEY);

const app = express();
// A ordem estava correta: cors() antes de express.json()
app.use(cors()); 
app.use(express.json());

// ========================
// Conexão com Postgres
// ========================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // ssl: { rejectUnauthorized: false } // Esta opção pode ser um risco de segurança. 
                                       // Verifique se o certificado do Neon é confiável.
                                       // Se for, você pode removê-la ou configurar o SSL corretamente.
});

// ========================
// Retornar publishableKey para o frontend
// ========================
app.get("/api/public-key", (req, res) => {
  // A chave já foi validada no início
  res.json({ publishableKey: process.env.STRIPE_PUBLISHABLE_KEY });
});

// ========================
// Checar se email já existe
// ========================
app.post("/api/check-email", async (req, res) => {
  const { email } = req.body;
  // Validação básica do input
  if (!email) return res.status(400).json({ error: "Email é obrigatório" });

  // Usar 'try...finally' para garantir que o client seja sempre liberado
  const client = await pool.connect();
  try {
    // Usar parâmetros ($1, $2) previne injeção SQL
    const result = await client.query(
      "SELECT 1 FROM usuarios WHERE email = $1 LIMIT 1",
      [email]
    );
    // rowCount > 0 significa que encontrou o email
    res.json({ exists: result.rowCount > 0 });
  } catch (err) {
    // Log detalhado do erro no servidor
    console.error("Erro check-email:", err.message);
    // Resposta genérica para o cliente
    res.status(500).json({ error: "Erro interno ao verificar email." });
  } finally {
    // Libera o client de volta para o pool
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

    const result = await client.query(
      `INSERT INTO usuarios 
         (nome_completo, usuario, email, telefone, senha, data_nascimento, dt_cadastro, ativo) 
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), true) 
       RETURNING id`,
      [full_name, username, email, phone, password, birthdate || null]
    );
    const userId = result.rows[0].id;
    console.log(`Usuário ${userId} registrado com sucesso.`);

    if (plan === "free") {
      console.log(`Plano Free selecionado para o usuário ${userId}.`);
      return res.json({ userId });
    }

    const priceMap = {
      silver: process.env.PRICE_SILVER,
      gold: process.env.PRICE_GOLD,
    };
    const priceId = priceMap[plan];
    if (!priceId) {
      return res.status(400).json({ error: `Plano inválido: ${plan}` });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: "https://faixabet.com.br/?session_id={CHECKOUT_SESSION_ID}",
      cancel_url: "https://faixabet.com.br/cancel",
      metadata: { userId: String(userId), plan },
      // opcional, mas ajuda no debug:
      // client_reference_id: String(userId),
    });

    console.log(`Sessão Stripe criada para o usuário ${userId}, plano ${plan}. Session ID: ${session.id}`);

    // 💡 DEVOLVER PARA O FRONT
    return res.json({ userId, sessionId: session.id });
  } catch (err) {
    console.error("Erro em /api/register-and-checkout:", err);
    return res.status(500).json({ error: "Falha ao criar sessão de checkout" });
  } finally {
    client.release();
  }
});

// ========================
// Confirmar pagamento (Webhook ou endpoint de verificação)
// ========================
// Nota: Este endpoint pode ser chamado diretamente, mas o ideal é usar Webhooks do Stripe
// para maior segurança e confiabilidade. Vamos mantê-lo por enquanto.
app.get("/api/payment-success", async (req, res) => {
  try {
    const { session_id } = req.query;
    
    if (!session_id) {
       return res.status(400).json({ error: "ID da sessão é obrigatório." });
    }

    // 1. Recuperar a sessão do Stripe
    const session = await stripe.checkout.sessions.retrieve(session_id);

    // 2. Verificar se o pagamento foi confirmado
    if (session.payment_status === "paid") {
      // 3. Extrair dados da metadata
      const userId = session.metadata.userId;
      const plan = session.metadata.plan;

      if (!userId || !plan) {
         console.error("Dados de metadata ausentes na sessão do Stripe:", session.metadata);
         return res.status(400).json({ error: "Dados da sessão inválidos." });
      }

      const client = await pool.connect();
      try {
        // 4. Atualizar plano ativo do usuário
        await client.query("UPDATE usuarios SET id_plano = $2 WHERE id = $1", [
          userId,
          plan,
        ]);
        console.log(`Plano do usuário ${userId} atualizado para ${plan}.`);

        // 5. Registrar no histórico de planos do cliente
        // ON CONFLICT assume que id_client é uma chave primária ou única
        await client.query(
          `INSERT INTO client_plans (id_client, id_plano, ativo) 
           VALUES ($1, $2, true) 
           ON CONFLICT (id_client) 
           DO UPDATE SET id_plano = $2, ativo = true, data_atualizacao = NOW()`,
          [userId, plan]
        );
        console.log(`Registro em client_plans atualizado para o usuário ${userId}.`);

        // 6. Registrar no histórico financeiro
        // amount_total está em centavos, então dividimos por 100
        await client.query(
          `INSERT INTO financeiro 
             (id_cliente, id_plano, data_pagamento, forma_pagamento, valor, estorno) 
           VALUES ($1, $2, NOW(), 'cartao', $3, 'N')`,
          [userId, plan, session.amount_total / 100] 
        );
        console.log(`Registro em financeiro criado para o usuário ${userId}.`);

        // 7. Responder com sucesso
        res.json({ success: true });

      } catch (dbErr) {
         // Erro específico durante a atualização do banco
         console.error("Erro ao atualizar banco de dados após pagamento:", dbErr.message);
         res.status(500).json({ error: "Pagamento confirmado, mas houve um erro ao atualizar seus dados. Entre em contato com o suporte." });
      } finally {
        client.release();
      }
      
    } else {
      // Pagamento não foi pago
      console.warn(`Tentativa de confirmação de pagamento falhou. Status: ${session.payment_status}. Session ID: ${session_id}`);
      res.status(400).json({ error: "Pagamento não confirmado." });
    }
  } catch (err) {
    // Erro ao se comunicar com o Stripe ou outros erros
    console.error("Erro payment-success:", err.message);
    // Mensagem mais amigável para o usuário
    res.status(500).json({ error: "Não foi possível verificar o status do pagamento. Tente novamente mais tarde ou entre em contato com o suporte." });
  }
});

// ========================
// Start server
// ========================
// Usar a porta definida pelo Render ou 3000 como fallback
const PORT = process.env.PORT || 3000; 
app.listen(PORT, '0.0.0.0', () => console.log(`Servidor FaixaBet rodando na porta ${PORT}`));
