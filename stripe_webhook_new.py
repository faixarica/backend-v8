from sqlalchemy import text
from db import Session

def handle_stripe_event(event):
    if event["type"] == "checkout.session.completed":
        session = event["data"]["object"]
        client_id = session["metadata"]["client_id"]
        plan_id = session["metadata"]["plan_id"]

        s = Session()
        try:
            s.execute(text("""
                INSERT INTO client_plans (client_id, plan_id, start_date, expiration_date, status)
                VALUES (:cid, :pid, CURRENT_DATE, CURRENT_DATE + INTERVAL '30 days', 'A')
            """), {"cid": client_id, "pid": plan_id})
            s.execute(text("""
                INSERT INTO financeiro (client_id, plan_id, amount, status, created_at)
                VALUES (:cid, :pid, 0, 'Pago', NOW())
            """), {"cid": client_id, "pid": plan_id})
            s.commit()
        except Exception:
            s.rollback()
            raise
        finally:
            s.close()
