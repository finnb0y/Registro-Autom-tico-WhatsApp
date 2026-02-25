const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const cors = require('cors');

const app = express();

app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
}));
app.use(express.json());

let qrCodeData = null;
let isReady = false;
let clientInfo = null;

// ─── WhatsApp Client ──────────────────────────────────────────────────────────

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: './session' }),
  puppeteer: {
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  },
});

client.on('qr', async (qr) => {
  console.log('QR Code gerado — escaneie no app do WhatsApp');
  qrCodeData = await qrcode.toDataURL(qr);
  isReady = false;
});

client.on('ready', () => {
  console.log('✅ WhatsApp conectado!');
  isReady = true;
  qrCodeData = null;
  clientInfo = client.info;
});

client.on('authenticated', () => {
  console.log('Autenticado com sucesso');
});

client.on('auth_failure', (msg) => {
  console.error('Falha na autenticação:', msg);
  isReady = false;
});

client.on('disconnected', (reason) => {
  console.log('WhatsApp desconectado:', reason);
  isReady = false;
  clientInfo = null;
  // Reinicializa após desconexão
  setTimeout(() => client.initialize(), 3000);
});

client.initialize();

// ─── Rotas ────────────────────────────────────────────────────────────────────

// Verifica se está conectado
app.get('/status', (req, res) => {
  res.json({
    connected: isReady,
    hasQr: !!qrCodeData,
    phone: clientInfo?.wid?.user || null,
  });
});

// Retorna o QR Code em base64 pra exibir no frontend
app.get('/qr', (req, res) => {
  if (qrCodeData) {
    return res.json({ qr: qrCodeData });
  }
  res.status(404).json({ error: 'QR Code não disponível no momento' });
});

// Dispara as mensagens
app.post('/send', async (req, res) => {
  if (!isReady) {
    return res.status(400).json({ error: 'WhatsApp não está conectado' });
  }

  const { contacts } = req.body;

  if (!contacts || !Array.isArray(contacts) || contacts.length === 0) {
    return res.status(400).json({ error: 'Nenhum contato fornecido' });
  }

  const results = [];

  for (const contact of contacts) {
    try {
      const phone = formatPhone(contact.phone);
      const message = buildMessage(contact);

      // Resolve the correct WhatsApp ID (handles both @c.us and @lid accounts)
      const numberId = await client.getNumberId(phone);
      if (!numberId) {
        throw new Error(`Número ${contact.phone} não encontrado no WhatsApp`);
      }

      await client.sendMessage(numberId._serialized, message);

      results.push({ name: contact.name, phone: contact.phone, success: true });
      console.log(`✅ Mensagem enviada para ${contact.name} (${contact.phone})`);

      // Delay entre mensagens para evitar bloqueio (1.5 a 3 segundos)
      const delay = 1500 + Math.random() * 1500;
      await sleep(delay);
    } catch (err) {
      console.error(`❌ Erro ao enviar para ${contact.name}:`, err.message);
      results.push({ name: contact.name, phone: contact.phone, success: false, error: err.message });
    }
  }

  res.json({ results });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatPhone(raw) {
  // Remove tudo que não for número
  let phone = raw.toString().replace(/\D/g, '');

  // Adiciona código do Brasil se não tiver
  if (!phone.startsWith('55')) {
    phone = '55' + phone;
  }

  // Números brasileiros com DDD: 55 + 2 dígitos DDD + 8 ou 9 dígitos
  // Se ficou com 12 dígitos (sem o 9), adiciona o 9 após o DDD
  if (phone.length === 12) {
    phone = phone.slice(0, 4) + '9' + phone.slice(4);
  }

  return phone;
}

function buildMessage({ name, value, balance, type }) {
  const valorFormatado = formatCurrency(value);
  const saldoFormatado = formatCurrency(balance);

  return `Olá, *${name}*! 👋

Aqui está o seu resumo de hoje no clube:

📋 *Tipo de consumo:* ${type}
💰 *Consumo do dia:* R$ ${valorFormatado}
💳 *Saldo disponível:* R$ ${saldoFormatado}

Qualquer dúvida, é só responder esta mensagem. 😊`;
}

function formatCurrency(value) {
  const num = parseFloat(value);
  if (isNaN(num)) return value;
  return num.toFixed(2).replace('.', ',');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Start ────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
