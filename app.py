import os
import logging
from dotenv import load_dotenv
from flask import Flask, request, jsonify
from flask_cors import CORS
from sqlalchemy import text
import stripe

from db import Session
from stripe_webhook import handle_stripe_event

# ---- Configuração base
load_dotenv()  # útil para rodar local. No Render use env vars do painel.

stripe.api_key = os.getenv("STRIPE_API_KEY")
STRIPE_ENDPOINT_SECRET = os.getenv("STRIPE_ENDPOINT_SECRET")

PRICE_MAP = {
    "silver": os.getenv("PRICE_SILVER"),  # ex.: price_123
    "gold": os.getenv("PRICE_GOLD"),      # ex.: price_456
}

SUCCESS_URL = os.getenv("SUCCESS_URL", "https://faixabet.com.br/sucesso")
CANCEL_URL  = os.getenv("CANCEL_URL",  "https://faixabet.com.br/cancelado")

# ---- App
app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": "*"}})  # ajuste origins depois
logging.basicConfig(level=logging.INFO)
log = app.logger

# ---- Health
@app.get("/")
def health():
    return "ok", 200

# ---- Cadastro
@app.post("/api/register")
def register_user():
    data = request.get_json(force=True)
    # Validação simples
    for field in ("full_name", "email", "password"):
        if not data.get(field):
            return jsonify({"error": f"{field} é obrigatório"}), 400

    # Hash de senha com bcrypt no DB ou aqui? Aqui optamos por hash no app.
    import bcrypt
    pw_hash = bcrypt.hashpw(data["password"].encode(), bcrypt.gensalt()).decode()

    s = Session()
    try:
        # Ajuste os nomes de colunas conforme seu schema real
        r = s.execute(text("""
            INSERT INTO usuarios (nome, data_nascimento, email, telefone, senha_hash, status)
            VALUES (:nome, :nasc, :email, :fone, :hash, 'pendente_pagamento')
            RETURNING id
        """), {
            "nome":   data["full_name"],
            "nasc":   data.get("birthdate"),
            "email":  data["email"],
            "fone":   data.get("phone"),
            "hash":   pw_hash
        })
        user_id = r.fetchone()[0]
        s.commit()
        return jsonify({"client_id": user_id}), 201
    except Exception as e:
        s.rollback()
        log.exception("Erro /api/register")
        return jsonify({"error": "Erro ao registrar usuário"}), 500
    finally:
        s.close()
# ---- Plano Free
@app.post("/api/subscribe-free")
def subscribe_free():
    data = request.get_json(force=True)
    client_id = data.get("client_id")
    if not client_id:
        return jsonify({"error": "client_id ausente"}), 400

    s = Session()
    try:
        # Idempotência: não duplica plano ativo
        exists = s.execute(text("""
            SELECT 1 FROM client_plans
             WHERE client_id=:cid AND plan_id='free' AND status='A'
             LIMIT 1
        """), {"cid": client_id}).fetchone()

        if exists:
            return jsonify({"message": "Plano Free já ativo"}), 200

        s.execute(text("""
            INSERT INTO client_plans (client_id, plan_id, start_date, expiration_date, status)
            VALUES (:cid, 'free', CURRENT_DATE, CURRENT_DATE + INTERVAL '30 days', 'A')
        """), {"cid": client_id})

        s.execute(text("""
            INSERT INTO financeiro (client_id, plan_id, amount, status, created_at, source)
            VALUES (:cid, 'free', 0, 'Pago', NOW(), 'manual')
        """), {"cid": client_id})

        # Marca usuário como ativo
        s.execute(text("""
            UPDATE usuarios SET status='ativo' WHERE id=:cid
        """), {"cid": client_id})

        s.commit()
        return jsonify({"message": "Plano Free ativado"}), 200
    except Exception:
        s.rollback()
        log.exception("Erro /api/subscribe-free")
        return jsonify({"error": "Erro ao ativar plano Free"}), 500
    finally:
        s.close()

# ---- Checkout Stripe (Silver/Gold)
@app.post("/api/create-checkout-session")
def create_checkout_session():
    data = request.get_json(force=True)
    client_id = data.get("client_id")
    # Forçar plano em minúsculo antes de buscar no PRICE_MAP
    plan = data.get("plan", "").strip().lower()

    if plan not in PRICE_MAP or not PRICE_MAP[plan]:
        return jsonify({"error": "Plano inválido ou PRICE_ID ausente"}), 400

    try:
        session = stripe.checkout.Session.create(
            mode="subscription",  # para recorrência. Use "payment" se for avulso
            payment_method_types=["card"],
            line_items=[{"price": PRICE_MAP[plan], "quantity": 1}],
            success_url=SUCCESS_URL + "?session_id={CHECKOUT_SESSION_ID}",
            cancel_url=CANCEL_URL,
            metadata={"client_id": str(client_id), "plan_id": plan},
            # Good practice:
            allow_promotion_codes=True
        )
        return jsonify({"url": session.url}), 200
    except Exception as e:
        log.exception("Erro /api/create-checkout-session")
        return jsonify({"error": "Falha ao criar sessão de checkout"}), 500

# ---- Webhook Stripe
@app.post("/api/stripe-webhook")
def stripe_webhook():
    payload = request.data
    sig_header = request.headers.get("Stripe-Signature")
    if not STRIPE_ENDPOINT_SECRET:
        log.error("STRIPE_ENDPOINT_SECRET não configurado")
        return "Webhook Secret ausente", 500

    try:
        event = stripe.Webhook.construct_event(
            payload=payload,
            sig_header=sig_header,
            secret=STRIPE_ENDPOINT_SECRET
        )
    except stripe.error.SignatureVerificationError:
        log.warning("Assinatura Stripe inválida")
        return "Assinatura inválida", 400
    except Exception as e:
        log.exception("Erro ao construir evento Stripe")
        return "Bad request", 400

    try:
        handle_stripe_event(event)  # toda lógica de DB fica centralizada lá
    except Exception:
        log.exception("Erro processando evento Stripe")
        return "error", 500

    return "ok", 200

if __name__ == "__main__":
    # Para rodar local (dev). No Render use: gunicorn app:app
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", 10000)))
