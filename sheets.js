const express = require("express");
const { parseExpense } = require("./parser");
const { appendToSheet } = require("./sheets");

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Mapa de números → nomes
// Formato: "whatsapp:+5511999999999": "João"
// Adicione quantas pessoas quiser
const PESSOAS = JSON.parse(process.env.PESSOAS_JSON || "{}");

function identificarPessoa(numeroWhatsapp) {
  return PESSOAS[numeroWhatsapp] || numeroWhatsapp.replace("whatsapp:+", "+");
}

app.get("/", (req, res) => res.send("WhatsApp → Sheets bot rodando ✅"));

// Webhook do Twilio
app.post("/webhook", async (req, res) => {
  const from = req.body.From || "";
  const body = (req.body.Body || "").trim();
  const pessoa = identificarPessoa(from);

  console.log(`📩 Mensagem de ${from}: "${body}"`);

  // Resposta TwiML vazia por padrão
  const twimlReply = (msg) =>
    res.set("Content-Type", "text/xml").send(`
      <Response>
        <Message>${msg}</Message>
      </Response>
    `);

  if (!body) return twimlReply("Não entendi. Tente: 'Almoço 45 reais no cartão Nubank débito'");

  try {
    const expense = await parseExpense(body);

    if (!expense) {
      return twimlReply("❌ Não consegui identificar o gasto. Tente algo como: 'Pizza 60 reais, cartão Inter crédito'");
    }

    await appendToSheet(expense, pessoa);

    const reply =
      `✅ Gasto registrado!\n` +
      `👤 ${pessoa}\n` +
      `📅 ${expense.data}\n` +
      `💰 R$ ${expense.valor}\n` +
      `🏷️ ${expense.categoria}\n` +
      `📝 ${expense.descricao}\n` +
      `💳 ${expense.metodo_pagamento} ${expense.cartao ? `(${expense.cartao})` : ""}`;

    return twimlReply(reply);
  } catch (err) {
    console.error("Erro:", err);
    return twimlReply("❌ Erro interno. Tente novamente em instantes.");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor rodando na porta ${PORT}`));
