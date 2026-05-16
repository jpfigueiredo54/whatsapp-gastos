const express = require("express");
const { parseExpense } = require("./parser");
const { appendToSheet, getResumoMes, getResumoCategoria, verificarAlertaBudget, getUltimoLancamento, deletarUltimoLancamento } = require("./sheets");

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const PESSOAS = JSON.parse(process.env.PESSOAS_JSON || "{}");
const pendentes = {};
const editando = {};

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

✏️ */editar*
Corrige o último lançamento registrado por você.

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

    // PRIORIDADE 1: fluxo de edição
    if (editando[from]) {
      if (body.toLowerCase() === "cancelar") {
        delete editando[from];
        return twimlReply("❌ Edição cancelada.");
      }

      const expense = await parseExpense(body);
      if (!expense) return twimlReply("❌ Não consegui identificar o gasto. Tente novamente ou mande *cancelar* para sair.");

      await deletarUltimoLancamento(pessoa);
      delete editando[from];

      const valorNumerico = parseFloat(expense.valor.replace(",", "."));
      const alerta = await verificarAlertaBudget(expense.categoria, valorNumerico);
      await appendToSheet(expense, pessoa);

      let reply = `✅ Lançamento atualizado!\n👤 ${pessoa}\n📅 ${expense.data}\n💰 R$ ${expense.valor}\n🏷️ ${expense.categoria}\n📝 ${expense.descricao}\n💳 ${expense.metodo_pagamento}${expense.cartao ? ` (${expense.cartao})` : ""}`;
      if (alerta) reply += `\n\n${alerta}`;
      return twimlReply(reply);
    }

    // PRIORIDADE 2: fluxo de confirmação
    if (pendentes[from]) {
      const expense = pendentes[from];
      if (body.toLowerCase() === "sim") {
        delete pendentes[from];
        const valorNumerico = parseFloat(expense.valor.replace(",", "."));
        const alerta = await verificarAlertaBudget(expense.categoria, valorNumerico);
        await appendToSheet(expense, pessoa);
        let reply = `✅ Gasto registrado!\n👤 ${pessoa}\n📅 ${expense.data}\n💰 R$ ${expense.valor}\n🏷️ ${expense.categoria}\n📝 ${expense.descricao}\n💳 ${expense.metodo_pagamento}${expense.cartao ? ` (${expense.cartao})` : ""}`;
        if (alerta) reply += `\n\n${alerta}`;
        return twimlReply(reply);
      } else if (body.toLowerCase() === "não" || body.toLowerCase() === "nao") {
        delete pendentes[from];
        return twimlReply("❌ Gasto cancelado. Mande novamente com as correções.");
      } else {
        return twimlReply(`Responda *sim* para confirmar ou *não* para cancelar.\n\n📋 Gasto pendente:\n💰 R$ ${expense.valor}\n🏷️ ${expense.categoria}\n📝 ${expense.descricao}\n💳 ${expense.metodo_pagamento}${expense.cartao ? ` (${expense.cartao})` : ""}`);
      }
    }

    // PRIORIDADE 3: comandos
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

    if (body.toLowerCase() === "/editar") {
      const ultimo = await getUltimoLancamento(pessoa);
      if (!ultimo) return twimlReply("❌ Nenhum lançamento encontrado para editar.");
      editando[from] = true;
      return twimlReply(`✏️ Último lançamento:\n📅 ${ultimo.data}\n💰 R$ ${ultimo.valor}\n🏷️ ${ultimo.categoria}\n📝 ${ultimo.descricao}\n💳 ${ultimo.metodo}\n\nMande o gasto corrigido ou *cancelar* para sair.`);
    }

    // PRIORIDADE 4: novo gasto
    const expense = await parseExpense(body);
    if (!expense) return twimlReply("❌ Não consegui identificar o gasto. Tente algo como: 'Pizza 60 reais, cartão Inter crédito'\n\nDigite */ajuda* para ver os comandos disponíveis.");

    pendentes[from] = expense;
    return twimlReply(
      `📋 Confirmar gasto?\n\n💰 R$ ${expense.valor}\n🏷️ ${expense.categoria}\n📝 ${expense.descricao}\n💳 ${expense.metodo_pagamento}${expense.cartao ? ` (${expense.cartao})` : ""}\n\nResponda *sim* para confirmar ou *não* para cancelar.`
    );

  } catch (err) {
    console.error("Erro:", err);
    return twimlReply("❌ Erro interno. Tente novamente em instantes.");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor rodando na porta ${PORT}`));
