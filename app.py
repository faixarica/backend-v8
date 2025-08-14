import os
import stripe
import bcrypt
from flask import Flask, request, jsonify
from flask_cors import CORS
from sqlalchemy import text
from dotenv import load_dotenv
from db import Session
from stripe_webhook import handle_stripe_event

# Carregar env
load_dotenv()

# Config Stripe
stripe.api_key = os.getenv("STRIPE_API_KEY")
endpoint_secret = os.getenv("STRIPE_ENDPOINT_SECRET")

PRICE_MAP = {
    "silver": os.getenv("PRICE_SILVER"),
    "gold": os.getenv("PRICE_GOLD"),
}

app = Flask(__name__)
CORS(app)

# --- Endpoints ---

@app.route("/api/register", methods=["POST"])
def register_user():
    data = request.get_json()
    for field in ("full_name", "email", "password"):
        if not data.get(field):
            return jsonify({"error": f"{field} é obrigatório"}), 400

    pw_hash = bcrypt.hashpw(data["password"].encode(), bcrypt.gensalt()).decode()
    s = Session()
    try:
        r = s.execute(text("""
            INSERT INTO usuarios (nome, data_nascimento, email, telefone, senha_hash)
            VALUES (:nome, :nasc, :email, :fone, :senha)
            RETURNING id
        """), {
            "nome": data["full_name"],
            "nasc": data.get("birthdate"),
            "email": data["email"],
            "fone": data.get("phone"),
            "senha": pw_hash
        })
        user_id = r.fetchone()[0]
        s.commit()
        return jsonify({"client_id": user_id}), 201
    except Exception as e:
        s.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        s.close()

@app.route("/api/subscribe-free", methods=["POST"])
def subscribe_free():
    data = request.get_json()
    client_id = data.get("client_id")
    if not client_id:
        return jsonify({"error": "client_id ausente"}), 400
    s = Session()
    try:
        s.execute(text("""
            INSERT INTO client_plans (client_id, plan_id, start_date, expiration_date, status)
            VALUES (:cid, 'free', CURRENT_DATE, CURRENT_DATE + INTERVAL '30 days', 'A')
        """), {"cid": client_id})
        s.execute(text("""
            INSERT INTO financeiro (client_id, plan_id, amount, status, created_at)
            VALUES (:cid, 'free', 0, 'Pago', NOW())
        """), {"cid": client_id})
        s.commit()
        return jsonify({"message": "Plano Free ativado"}), 200
    except Exception as e:
        s.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        s.close()

@app.route("/api/create-checkout-session", methods=["POST"])
def create_checkout():
    data = request.get_json()
    client_id = data.get("client_id")
    plan = data.get("plan")
    price_id = PRICE_MAP.get(plan)
    if not client_id or not price_id:
        return jsonify({"error": "Plano inválido"}), 400
    try:
        session = stripe.checkout.Session.create(
            payment_method_types=["card"],
            mode="subscription",
            line_items=[{"price": price_id, "quantity": 1}],
            metadata={"client_id": str(client_id), "plan_id": plan},
            success_url=os.getenv("SUCCESS_URL"),
            cancel_url=os.getenv("CANCEL_URL")
        )
        return jsonify({"url": session.url}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/stripe-webhook", methods=["POST"])
def stripe_webhook():
    payload = request.data
    sig_header = request.headers.get("Stripe-Signature")
    try:
        event = stripe.Webhook.construct_event(payload, sig_header, endpoint_secret)
    except stripe.error.SignatureVerificationError:
        return "Assinatura inválida", 400
    except Exception as e:
        return str(e), 400

    # Processar evento
    handle_stripe_event(event)
    return "ok", 200

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=10000)
