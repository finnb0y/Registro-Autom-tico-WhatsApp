# 📊 Clube — Envio de Resumos Diários via WhatsApp

Sistema para envio automatizado de resumos de consumo diário via WhatsApp, com painel web para funcionários.

---

## 🏗️ Estrutura do projeto

```
/
├── server/      → Servidor Node.js (hospedado no Railway)
│   └── server.js
└── frontend/    → Interface web Next.js (hospedado no Vercel)
    └── app/page.tsx
```

---

## 🚀 Passo a passo completo

### 1. Crie o repositório no GitHub

1. Acesse [github.com](https://github.com) e crie um novo repositório
2. Clone ele no seu computador:
   ```bash
   git clone https://github.com/SEU_USUARIO/SEU_REPOSITORIO.git
   cd SEU_REPOSITORIO
   ```
3. Copie todos os arquivos deste projeto para dentro do repositório
4. Faça o push:
   ```bash
   git add .
   git commit -m "primeiro commit"
   git push
   ```

---

### 2. Deploy do servidor no Railway

O servidor precisa ficar rodando 24h para manter o WhatsApp conectado.

1. Acesse [railway.app](https://railway.app) e crie uma conta (pode entrar com GitHub)
2. Clique em **New Project → Deploy from GitHub repo**
3. Selecione seu repositório
4. Railway vai detectar os arquivos. Configure para apontar para a pasta `server/`:
   - Vá em **Settings → Root Directory** e coloque `server`
5. Adicione a variável de ambiente:
   - Vá em **Variables** e adicione:
     ```
     FRONTEND_URL=https://seu-site.vercel.app
     ```
     (você preenche isso depois que tiver a URL do Vercel)
6. Clique em **Deploy**
7. Após o deploy, copie a URL gerada (ex: `https://seu-servidor.up.railway.app`)

> ⚠️ O Railway tem um plano gratuito com 500h/mês. Para rodar 24/7, você precisará do plano Hobby (~$5/mês). Vale a pena.

---

### 3. Deploy do frontend no Vercel

1. Acesse [vercel.com](https://vercel.com) e entre com GitHub
2. Clique em **New Project → Import** e selecione seu repositório
3. Configure o projeto:
   - **Root Directory:** `frontend`
   - **Framework:** Next.js (detectado automaticamente)
4. Adicione a variável de ambiente:
   - Em **Environment Variables**, adicione:
     ```
     NEXT_PUBLIC_SERVER_URL=https://seu-servidor.up.railway.app
     ```
     (substitua pela URL do Railway do passo anterior)
5. Clique em **Deploy**
6. Copie a URL do Vercel e volte no Railway para preencher o `FRONTEND_URL`

---

### 4. Conecte o WhatsApp

1. Abra o site no Vercel
2. Na tela inicial, um QR Code vai aparecer
3. No celular: abra o WhatsApp → Menu (⋮) → **Aparelhos conectados** → **Conectar aparelho**
4. Escaneie o QR Code
5. O status no topo do site vai mudar para **"WhatsApp conectado"** ✅

> A sessão fica salva no servidor. Você só precisa escanear de novo se o WhatsApp for desconectado manualmente ou o servidor reiniciar.

---

### 5. Usando no dia a dia

1. Acesse o site
2. Arraste ou selecione a planilha `.xlsx` do dia
3. O sistema vai ler os dados e mostrar a tabela
4. Remova qualquer pessoa que não deve receber mensagem clicando no **×**
5. Clique em **Enviar mensagens**
6. Acompanhe o resultado (✅ enviado / ❌ erro) em tempo real

---

## 📋 Formato da planilha

A planilha deve ter colunas com os seguintes nomes (não diferencia maiúsculas/minúsculas):

| Coluna | Nomes aceitos |
|--------|--------------|
| Nome do cliente | `Nome`, `Name`, `Cliente` |
| Telefone | `Telefone`, `Fone`, `Celular`, `Phone`, `Numero`, `WhatsApp` |
| Valor consumido | `Valor`, `Consumo`, `Valor Consumido`, `Consumo do Dia` |
| Saldo | `Saldo`, `Balance`, `Saldo Disponível` |
| Tipo | `Tipo`, `Type`, `Tipo de Consumo`, `Categoria` |

**Exemplo de planilha:**

| Nome | Telefone | Valor | Saldo | Tipo |
|------|----------|-------|-------|------|
| João Silva | 81999998888 | 45.50 | 320.00 | Restaurante |
| Maria Costa | 81988887777 | 120.00 | 580.00 | Bar |

> Os números podem ser no formato `81999998888`, `(81) 99999-8888` ou `5581999998888` — o sistema normaliza automaticamente.

---

## 💬 Modelo de mensagem enviada

```
Olá, *João Silva*! 👋

Aqui está o seu resumo de hoje no clube:

📋 *Tipo de consumo:* Restaurante
💰 *Consumo do dia:* R$ 45,50
💳 *Saldo disponível:* R$ 320,00

Qualquer dúvida, é só responder esta mensagem. 😊
```

Para alterar o texto, edite a função `buildMessage` em `server/server.js`.

---

## 🛠️ Rodando localmente (desenvolvimento)

**Servidor:**
```bash
cd server
npm install
npm run dev
# Servidor rodando em http://localhost:3001
```

**Frontend:**
```bash
cd frontend
npm install
# Crie o arquivo .env.local com o conteúdo:
# NEXT_PUBLIC_SERVER_URL=http://localhost:3001
npm run dev
# Site em http://localhost:3000
```
