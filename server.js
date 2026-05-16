const express = require("express");
const { parseExpense } = require("./parser");
const { appendToSheet, getResumoMes, getResumoCategoria, verificarAlertaBudget } = require("./sheets");

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const PESSOAS = JSON.parse(process.env.PESSOAS_JSON || "{}");

function identificarPessoa(numeroWhatsapp) {
  return PESSOAS[numeroWhatsapp] || numeroWhatsapp.replace("whatsapp:+", "+");
}

const AJUDA = `🤖 Comandos disponíveis:

💬 *Registrar gasto:*
Mande uma mensagem normal descrevendo o gasto.
Ex: "Almoço 45 reais Nubank crédito"

📊 */resumo*
Resumo completo do mês atual por categoria e pessoa.

📂 */resumo [categoria]*
Detalhes de uma categoria específica.
Ex: /resumo Alimentação

❓ */ajuda*
Mostra esta mensagem.

_Categorias disponíveis:_
Alimentação, Transporte, Saúde, Lazer, Moradia, Compras, Educação, Outro`;

app.get("/", (req, res) => res.send("WhatsApp → Sheets bot rodando ✅"));

app.post("/webhook", async (req, res) => {
  const from = req.body.From || "";
  const body = (req.body.Body || "").trim();
  const pessoa = identificarPessoa(from);

  const twimlReply = (msg) =>
    res.set("Content-Type", "text/xml").send(`<Response><Message>${msg}</Message></Response>`);

  if (!body) return twimlReply(AJUDA);

  try {
    if (body.toLowerCase() === "/ajuda") {
      return twimlReply(AJUDA);
    }

    if (body.toLowerCase() === "/resumo") {
      const resumo = await getResumoMes();
      return twimlReply(resumo);
    }

    if (body.toLowerCase().startsWith("/resumo ")) {
      const categoria = body.slice(8).trim();
      const resumo = await getResumoCategoria(categoria);
      return twimlReply(resumo);
    }

    const expense = await parseExpense(body);
    if (!expense) return twimlReply("❌ Não consegui identificar o gasto. Tente algo como: 'Pizza 60 reais, cartão Inter crédito'\n\nDigite */ajuda* para ver os comandos disponíveis.");

    const valorNumerico = parseFloat(expense.valor.replace(",", "."));
    const alerta = await verificarAlertaBudget(expense.categoria, valorNumerico);

    await appendToSheet(expense, pessoa);

    let reply = `✅ Gasto registrado!\n👤 ${pessoa}\n📅 ${expense.data}\n💰 R$ ${expense.valor}\n🏷️ ${expense.categoria}\n📝 ${expense.descricao}\n💳 ${expense.metodo_pagamento}${expense.cartao ? ` (${expense.cartao})` : ""}`;

    if (alerta) reply += `\n\n${alerta}`;

    return twimlReply(reply);
  } catch (err) {
    console.error("Erro:", err);
    return twimlReply("❌ Erro interno. Tente novamente em instantes.");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor rodando na porta ${PORT}`));
