from flask import Flask, request, jsonify
from flask_cors import CORS
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
import smtplib, os

app = Flask(__name__)
CORS(app, origins=["https://faixabet.com.br", "http://127.0.0.1:5500"])

# -----------------------------------------
# Inicializa o Flask
# -----------------------------------------
#app = Flask(__name__)
#CORS(app, origins=["https://faixabet.com.br"])

# -----------------------------------------
# Função principal de envio de e-mail
# -----------------------------------------
def send_palpite_email(email_destino, sorteio, ai, jogador):
    EMAIL_HOST = os.getenv("EMAIL_HOST", "email-ssl.com.br")
    EMAIL_PORT = int(os.getenv("EMAIL_PORT", 587))
    EMAIL_USER = os.getenv("EMAIL_USER")
    EMAIL_PASS = os.getenv("EMAIL_PASS")

    if not all([EMAIL_USER, EMAIL_PASS]):
        print("❌ Variáveis de e-mail não configuradas corretamente!")
        return False

    msg = MIMEMultipart("alternative")
    msg["Subject"] = "🎯 Palpite gerado pelo simulador fAIxaBet"
    msg["From"] = EMAIL_USER
    msg["To"] = email_destino

    # Escolha o modelo de e-mail (neon ou profissional)
    corpo_html = gerar_email_faixabet_neon(email_destino, sorteio, ai, jogador)
    # corpo_html = gerar_email_profissional(email_destino, sorteio, ai, jogador)

    msg.attach(MIMEText(corpo_html, "html"))

    try:
        with smtplib.SMTP(EMAIL_HOST, EMAIL_PORT) as smtp:
            smtp.starttls()
            smtp.login(EMAIL_USER, EMAIL_PASS)
            smtp.send_message(msg)
        print(f"✅ E-mail enviado para {email_destino}")
        return True
    except Exception as e:
        print(f"❌ Erro ao enviar e-mail: {e}")
        return False

# -----------------------------------------
# Modelo 1 — Estilo Profissional
# -----------------------------------------
def gerar_email_profissional(email, sorteio, ai, jogador):
    return f"""
    <html>
    <body style="font-family: Poppins, sans-serif; background-color:#f8fafc; color:#222; padding:20px;">
      <div style="max-width:600px;margin:auto;background:#fff;border-radius:10px;box-shadow:0 4px 15px rgba(0,0,0,0.1);overflow:hidden;">
        <div style="background:#00d4ff;color:#fff;text-align:center;padding:15px 0;font-size:20px;font-weight:700;">
          fAIxaBet — Resultado do Simulador AI
        </div>
        <div style="padding:20px;">
          <p>Olá <strong>{email}</strong>,</p>
          <p>Confira abaixo o resultado da sua simulação entre o Jogador e a Inteligência Artificial:</p>

          <h3 style="color:#00d4ff;">🎯 Sorteio Simulado</h3>
          <div>{' '.join(f'<span style="display:inline-block;margin:3px;padding:6px 10px;background:#e2e8f0;border-radius:6px;">{n:02d}</span>' for n in sorteio)}</div>

          <h3 style="color:#8a2be2;">🤖 Palpite da IA</h3>
          <div>{' '.join(f'<span style="display:inline-block;margin:3px;padding:6px 10px;background:#dbeafe;border-radius:6px;">{n:02d}</span>' for n in ai)}</div>

          <h3 style="color:#22c55e;">👤 Palpite do Jogador</h3>
          <div>{' '.join(f'<span style="display:inline-block;margin:3px;padding:6px 10px;background:#dcfce7;border-radius:6px;">{n:02d}</span>' for n in jogador)}</div>

          <hr style="margin:25px 0;border:none;border-top:1px solid #ddd;">
          <p style="font-size:13px;color:#555;text-align:center;">
            Este é um e-mail automático do simulador fAIxaBet.<br>
            © 2025 fAIxaBet — Todos os direitos reservados.
          </p>
        </div>
      </div>
    </body>
    </html>
    """

# -----------------------------------------
# Modelo 2 — Estilo Verde-Neon (IA)
# -----------------------------------------
def gerar_email_faixabet_neon(email, sorteio, ai, jogador):
    return f"""
    <html>
    <body style="font-family:'Orbitron',sans-serif;background:#0b0c10;color:#e0e0ff;padding:20px;">
      <div style="max-width:650px;margin:auto;border-radius:12px;background:linear-gradient(145deg,#1f1b3a,#2b2a4a);box-shadow:0 0 25px rgba(0,212,255,0.3);padding:25px;">
        <h1 style="text-align:center;color:#00ffcc;text-shadow:0 0 10px #00ffcc;">⚡ fAIxaBet — Palpite IA ⚡</h1>
        <p style="text-align:center;font-size:14px;color:#9ca3af;">Desafio entre a Inteligência Artificial e o Jogador</p>

        <div style="margin-top:20px;">
          <h3 style="color:#22c55e;">🎯 Sorteio Simulado</h3>
          <div style="margin:8px 0;">{' '.join(f'<span style="display:inline-block;margin:3px;padding:8px 10px;border-radius:50%;background:#374151;color:#e5e7eb;">{n:02d}</span>' for n in sorteio)}</div>

          <h3 style="color:#8b5cf6;">🤖 Palpite da IA</h3>
          <div>{' '.join(f'<span style="display:inline-block;margin:3px;padding:8px 10px;border-radius:50%;background:#3b0764;color:#a78bfa;">{n:02d}</span>' for n in ai)}</div>

          <h3 style="color:#86efac;">👤 Palpite do Jogador</h3>
          <div>{' '.join(f'<span style="display:inline-block;margin:3px;padding:8px 10px;border-radius:50%;background:#064e3b;color:#bbf7d0;">{n:02d}</span>' for n in jogador)}</div>
        </div>

        <div style="margin-top:25px;text-align:center;">
          <a href="https://faixabet.com.br" style="display:inline-block;background:linear-gradient(90deg,#00d4ff,#8a2be2);padding:12px 30px;border-radius:30px;color:#fff;text-decoration:none;font-weight:700;box-shadow:0 0 10px #8a2be2;">Abrir fAIxaBet</a>
        </div>

        <p style="text-align:center;margin-top:25px;font-size:12px;color:#9ca3af;">
          Este é um envio automático do simulador fAIxaBet.<br>
          © 2025 fAIxaBet — Inteligência aplicada à sorte.
        </p>
      </div>
    </body>
    </html>
    """

# -----------------------------------------
# Endpoint da API
# -----------------------------------------
@app.route("/send_palpite", methods=["POST"])
def send_palpite():
    try:
        data = request.get_json()
        email = data["email"]
        sorteio = data["sorteio"]
        ai = data["ai"]
        jogador = data["jogador"]

        print(f"📨 Requisição recebida de {email}")
        sucesso = send_palpite_email(email, sorteio, ai, jogador)

        if sucesso:
            return jsonify({"status": "ok", "message": "E-mail enviado com sucesso!"})
        else:
            return jsonify({"status": "erro", "message": "Falha no envio."}), 500
    except Exception as e:
        return jsonify({"status": "erro", "message": str(e)}), 500

# -----------------------------------------
# Inicialização
# -----------------------------------------
if __name__ == "__main__":
    print("🚀 Servidor Flask iniciado na porta 5000...")
    app.run(host="0.0.0.0", port=5000, debug=True)
