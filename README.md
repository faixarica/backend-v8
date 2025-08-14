# backend-v8 (Stripe + Neon + Flask)

## Rodar local (dev)
1. python -m venv .venv && source .venv/bin/activate
2. pip install -r requirements.txt
3. cp .env.example .env  # edite com suas chaves de teste
4. python app.py

## Testar webhook com Stripe CLI (opcional)
stripe listen --forward-to localhost:10000/api/stripe-webhook
stripe trigger checkout.session.completed

## Deploy no Render
- Conecte este repositório
- Build Command: `pip install -r requirements.txt`
- Start Command: `gunicorn app:app`
- Configure as env vars (DATABASE_URL, STRIPE_API_KEY, STRIPE_ENDPOINT_SECRET, PRICE_* etc.)
- Acesse `https://<seuservico>.onrender.com/` → deve responder `ok`
