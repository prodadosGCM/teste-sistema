# GCM Cabo Frio — sistema web mobile-first

Módulos: login, ocorrências, ponto, escala, viaturas e equipamentos, gestão de equipe.
Perfis: **agente** (registra ocorrências, bate ponto, vê a própria escala, atualiza status da frota) e **admin** (tudo isso + escala, cadastros e usuários).

## Instalar na VPS (Ubuntu/Debian)

```bash
# 1. Node 20+, Nginx e PM2
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs nginx build-essential python3
sudo npm i -g pm2

# 2. Enviar o projeto (ex.: /var/www/gcm) e instalar dependências
cd /var/www/gcm
npm install --omit=dev

# 3. Configurar o segredo
cp .env.example .env
nano .env     # cole um JWT_SECRET gerado com:
              # node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

# 4. Criar o primeiro administrador
node seed.js 0001 "Nome do Administrador" "SenhaForte123"

# 5. Subir com PM2 (reinicia sozinho)
pm2 start ecosystem.config.js
pm2 save && pm2 startup

# 6. Nginx + HTTPS
sudo cp nginx.conf.exemplo /etc/nginx/sites-available/gcm
sudo nano /etc/nginx/sites-available/gcm      # troque o server_name
sudo ln -s /etc/nginx/sites-available/gcm /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d seu-dominio.com.br
```

Acesse `https://seu-dominio.com.br` no celular e use “Adicionar à tela inicial”.

## Segurança já incluída
- Senhas com bcrypt; sessão em cookie httpOnly, SameSite=Strict e Secure (em produção); expira em 12 h
- Limite de 10 tentativas de login por 15 min; cabeçalhos do Helmet; escape de HTML na tela
- Servidor escuta só em 127.0.0.1 (acesso externo apenas via Nginx)
- **Use HTTPS**: sem ele o cookie seguro não funciona

## Backup
O banco é um arquivo: `data/gcm.db`. Agende uma cópia diária, por exemplo:
`0 3 * * * cp /var/www/gcm/data/gcm.db /var/backups/gcm-$(date +\%F).db`

## Observações
- Todos os agentes veem todas as ocorrências; só o autor ou o admin altera o status.
- Por tratar de dados de segurança pública, observe a LGPD e as normas internas da Guarda.
