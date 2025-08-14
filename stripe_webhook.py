from sqlalchemy import text
from db import Session

def _activate_plan(s, client_id: int, plan_id: str, amount: int = 0, source: str = "stripe"):
    # Idempotência simples: evita duplicar plano ativo
    exists = s.execute(text("""
        SELECT 1 FROM client_plans
         WHERE client_id=:cid AND plan_id=:pid AND status='A'
         LIMIT 1
    """), {"cid": client_id, "pid": plan_id}).fetchone()
    if not exists:
        s.execute(text("""
            INSERT INTO client_plans (client_id, plan_id, start_date, expiration_date, status)
            VALUES (:cid, :pid, CURRENT_DATE, CURRENT_DATE + INTERVAL '30 days', 'A')
        """), {"cid": client_id, "pid": plan_id})

    s.execute(text("""
        INSERT INTO financeiro (client_id, plan_id, amount, status, created_at, source)
        VALUES (:cid, :pid, :amt, 'Pago', NOW(), :src)
    """), {"cid": client_id, "pid": plan_id, "amt": amount, "src": source})

    s.execute(text("UPDATE usuarios SET status='ativo' WHERE id=:cid"), {"cid": client_id})

def handle_stripe_event(event: dict):
    etype = event.get("type")
    data = event.get("data", {}).get("object", {})

    if etype == "checkout.session.completed":
        client_id = int(data["metadata"]["client_id"])
        plan_id = data["metadata"]["plan_id"]

        s = Session()
        try:
            _activate_plan(s, client_id, plan_id, amount=0, source="stripe_checkout")
            s.commit()
        except Exception:
            s.rollback()
            raise
        finally:
            s.close()

    # Você pode lidar com "invoice.payment_succeeded", "customer.subscription.updated", etc.
