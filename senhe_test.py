from passlib.hash import pbkdf2_sha256

# Hash que veio do banco
hash_banco = "pbkdf2_sha256$260000$979c768faa7d4ad0b14cd76c0a991fd3$791V6Zbuc3JMT6kpR7rO+nNoMaSbBSKF8d3TTTO+SEA="

# Digite aqui a senha que você cadastrou para esse usuário
senha_input = input("Digite a senha original: ")

try:
    if pbkdf2_sha256.verify(senha_input, hash_banco):
        print("\n✅ A senha confere com o hash do banco!")
    else:
        print("\n❌ Senha incorreta (não bate com o hash).")
except Exception as e:
    print(f"\n⚠️ Erro durante a verificação: {e}")
