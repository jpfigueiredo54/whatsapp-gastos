const express = require("express");
const path = require("path");
const { parseExpense } = require("./parser");
const { appendToSheet, appendParcela, registrarParcelasMes, verificarAlertaBudget, getCategorias, adicionarCategoria } = require("./sheets");
const { getResumoMes, getResumoCategoria, getRelatorioSemana, getFechamentoMes, getComparativo, getParcelasAbertas, getFaturas, getUltimoLancamento, deletarUltimoLancamento, getApiResumo, getApiParcelas, getApiFaturas, getApiTransacoes, getApiRelatorio, getRitmo, getApiFechamentoMesAnterior } = require("./sheets2");

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const PESSOAS = JSON.parse(process.env.PESSOAS_JSON || "{}");
const pendentes = {};
const editando = {};

function identificarPessoa(numeroWhatsapp) {
  return PESSOAS[numeroWhatsapp] || numeroWhatsapp.replace("whatsapp:+", "+");
}

const FRASES = [
  "💡 Registrado. Seu banco agradece sua contribuição mensal à riqueza deles.",
  "💡 Anotado. Mais um prego no caixão do seu saldo.",
  "💡 Parabéns, você acabou de financiar o iate do CEO do Nubank.",
  "💡 Gasto registrado. Seu eu do futuro já tá chorando, mas ainda não sabe.",
  "💡 Mais um. A qualquer momento seu cartão vai pedir demissão.",
  "💡 Anotado com carinho. Seu saldo, nem tanto.",
  "💡 Registrado. O buraco tá ficando mais fundo, mas pelo menos tá documentado.",
  "💡 Mais um gasto pro histórico. Seu gerente de banco tá sorrindo.",
  "💡 Parabéns pela transparência. Sua conta bancária não compartilha do mesmo entusiasmo.",
  "💡 Registrado. A planilha não julga. Seu extrato, sim.",
  "💡 Anotado. Se o dinheiro pudesse falar, estaria em silêncio constrangedor agora.",
  "💡 Mais um. No ritmo certo pra zerar a conta antes do fim do mês.",
  "💡 Gasto registrado. Pelo menos agora você sabe com o que afundou.",
  "💡 Parabéns, você contribuiu para o PIB nacional. De nada, Brasil.",
  "💡 Anotado. Seu saldo foi embora, mas a memória fica.",
];

function fraseAleatoria() {
  return FRASES[Math.floor(Math.random() * FRASES.length)];
}

const AJUDA = `🤖 Comandos disponíveis:

💬 *Registrar gasto:*
Mande uma mensagem normal descrevendo o gasto.
Ex: "Almoço 45 reais Nubank crédito"

💳 *Registrar parcelado:*
Ex: "TV 12x de 350 reais Nubank"

📊 */resumo*
Resumo completo do mês atual por categoria e pessoa.

📂 */resumo [categoria]*
Detalhes de uma categoria específica.
Ex: /resumo Alimentação

📅 */relatorio*
Resumo da semana anterior.

🏁 */fechamento*
Relatório final do mês atual.

📈 */comparar*
Compara o mês atual com o mês anterior.

💳 */parcelas*
Lista todas as parcelas em aberto.

🧾 */faturas*
Fatura atual de cada cartão com dias restantes.

📊 */ritmo*
Quanto você pode gastar por dia até o fim do mês.

🏷️ */categoria listar*
Lista todas as categorias disponíveis.

🏷️ */categoria adicionar [nome]*
Adiciona uma nova categoria.
Ex: /categoria adicionar Pets

✏️ */editar*
Corrige o último lançamento registrado por você.

❓ */ajuda*
Mostra esta mensagem.`;

app.get("/", (req, res) => res.send("WhatsApp → Sheets bot rodando ✅"));

app.get("/dashboard", (req, res) => {
  res.sendFile(path.join(__dirname, "dashboard.html"));
});

app.get("/manifest.json", (req, res) => {
  res.setHeader("Content-Type", "application/manifest+json");
  res.sendFile(path.join(__dirname, "manifest.json"));
});

app.get("/service-worker.js", (req, res) => {
  res.setHeader("Content-Type", "application/javascript");
  res.sendFile(path.join(__dirname, "service-worker.js"));
});

app.get("/icon-192.png", (req, res) => {
  res.sendFile(path.join(__dirname, "icon-192.png"));
});

app.get("/icon-512.png", (req, res) => {
  res.sendFile(path.join(__dirname, "icon-512.png"));
});

app.get("/api/resumo", async (req, res) => {
  try { res.json(await getApiResumo()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/faturas", async (req, res) => {
  try { res.json(await getApiFaturas()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/parcelas", async (req, res) => {
  try { res.json(await getApiParcelas()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/transacoes", async (req, res) => {
  try {
    const { mes, ano, cartao, pessoa, tipo } = req.query;
    res.json(await getApiTransacoes(mes, ano, cartao, pessoa, tipo));
  }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/relatorio", async (req, res) => {
  try {
    const { meses } = req.query;
    res.json(await getApiRelatorio(meses || 6));
  }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/fechamento-mes-anterior", async (req, res) => {
  try { res.json(await getApiFechamentoMesAnterior()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/parcelas/registrar", async (req, res) => {
  const secret = req.headers["x-cron-secret"];
  if (secret !== process.env.CRON_SECRET) return res.status(401).json({ error: "Não autorizado" });
  try {
    const resultado = await registrarParcelasMes();
    return res.json({ sucesso: true, registradas: resultado });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post("/webhook", async (req, res) => {
  const from = req.body.From || "";
  const body = (req.body.Body || "").trim();
  const pessoa = identificarPessoa(from);

  const twimlReply = (msg) =>
    res.set("Content-Type", "text/xml").send(`<Response><Message>${msg}</Message></Response>`);

  if (!body) return twimlReply(AJUDA);

  try {
    if (editando[from]) {
      if (body.toLowerCase() === "cancelar") { delete editando[from]; return twimlReply("❌ Edição cancelada."); }
      const expense = await parseExpense(body);
      if (!expense) return twimlReply("❌ Não consegui identificar o gasto. Tente novamente ou mande *cancelar* para sair.");
      await deletarUltimoLancamento(pessoa);
      delete editando[from];
      const alerta = await verificarAlertaBudget(expense.categoria, parseFloat(expense.valor.replace(",", ".")));
      await appendToSheet(expense, pessoa);
      const tipo = expense.parcelado ? "Parcelado" : "À vista";
      let reply = `✅ Lançamento atualizado!\n👤 ${pessoa}\n📅 ${expense.data}\n💰 R$ ${expense.valor_parcela || expense.valor}\n🏷️ ${expense.categoria}\n📝 ${expense.descricao}\n💳 ${expense.metodo_pagamento}${expense.cartao ? ` (${expense.cartao})` : ""}\n📌 ${tipo}`;
      if (alerta) reply += `\n\n${alerta}`;
      return twimlReply(reply + `\n\n${fraseAleatoria()}`);
    }

    if (pendentes[from]) {
      const expense = pendentes[from];
      if (body.toLowerCase() === "sim") {
        delete pendentes[from];
        const alerta = await verificarAlertaBudget(expense.categoria, parseFloat((expense.valor_parcela || expense.valor).replace(",", ".")));
        await appendToSheet(expense, pessoa);
        if (expense.parcelado) await appendParcela(expense, pessoa);
        const tipo = expense.parcelado ? "Parcelado" : "À vista";
        let reply = expense.parcelado
          ? `✅ Parcelamento registrado!\n👤 ${pessoa}\n📅 ${expense.data}\n💳 ${expense.total_parcelas}x de R$ ${expense.valor_parcela}\n💰 Total: R$ ${expense.valor}\n🏷️ ${expense.categoria}\n📝 ${expense.descricao}\n📌 Parcelado\n\n📌 Parcela 1/${expense.total_parcelas} lançada. As próximas serão registradas automaticamente todo dia 1º.`
          : `✅ Gasto registrado!\n👤 ${pessoa}\n📅 ${expense.data}\n💰 R$ ${expense.valor}\n🏷️ ${expense.categoria}\n📝 ${expense.descricao}\n💳 ${expense.metodo_pagamento}${expense.cartao ? ` (${expense.cartao})` : ""}\n📌 À vista`;
        if (alerta) reply += `\n\n${alerta}`;
        return twimlReply(reply + `\n\n${fraseAleatoria()}`);
      } else if (body.toLowerCase() === "não" || body.toLowerCase() === "nao") {
        delete pendentes[from];
        return twimlReply("❌ Gasto cancelado. Mande novamente com as correções.");
      } else {
        const preview = expense.parcelado
          ? `💳 ${expense.total_parcelas}x de R$ ${expense.valor_parcela}\n💰 Total: R$ ${expense.valor}\n🏷️ ${expense.categoria}\n📝 ${expense.descricao}`
          : `💰 R$ ${expense.valor}\n🏷️ ${expense.categoria}\n📝 ${expense.descricao}\n💳 ${expense.metodo_pagamento}${expense.cartao ? ` (${expense.cartao})` : ""}`;
        return twimlReply(`Responda *sim* para confirmar ou *não* para cancelar.\n\n📋 Gasto pendente:\n${preview}`);
      }
    }

    if (body.toLowerCase() === "/ajuda") return twimlReply(AJUDA);
    if (body.toLowerCase() === "/resumo") return twimlReply(await getResumoMes());
    if (body.toLowerCase().startsWith("/resumo ")) return twimlReply(await getResumoCategoria(body.slice(8).trim()));
    if (body.toLowerCase() === "/relatorio") return twimlReply(await getRelatorioSemana());
    if (body.toLowerCase() === "/fechamento") return twimlReply(await getFechamentoMes());
    if (body.toLowerCase() === "/comparar") return twimlReply(await getComparativo());
    if (body.toLowerCase() === "/parcelas") return twimlReply(await getParcelasAbertas());
    if (body.toLowerCase() === "/faturas") return twimlReply(await getFaturas());
    if (body.toLowerCase() === "/ritmo") return twimlReply(await getRitmo());

    if (body.toLowerCase() === "/categoria listar") {
      const categorias = await getCategorias();
      return twimlReply(`🏷️ Categorias disponíveis:\n\n${categorias.map(c => `• ${c}`).join("\n")}`);
    }

    if (body.toLowerCase().startsWith("/categoria adicionar ")) {
      const novaCategoria = body.slice(21).trim();
      if (!novaCategoria) return twimlReply("❌ Informe o nome da categoria. Ex: /categoria adicionar Pets");
      const adicionado = await adicionarCategoria(novaCategoria);
      if (adicionado) return twimlReply(`✅ Categoria *${novaCategoria}* adicionada com sucesso!`);
      return twimlReply(`⚠️ A categoria *${novaCategoria}* já existe.`);
    }

    if (body.toLowerCase() === "/editar") {
      const ultimo = await getUltimoLancamento(pessoa);
      if (!ultimo) return twimlReply("❌ Nenhum lançamento encontrado para editar.");
      editando[from] = true;
      return twimlReply(`✏️ Último lançamento:\n📅 ${ultimo.data}\n💰 R$ ${ultimo.valor}\n🏷️ ${ultimo.categoria}\n📝 ${ultimo.descricao}\n💳 ${ultimo.metodo}\n\nMande o gasto corrigido ou *cancelar* para sair.`);
    }

    const expense = await parseExpense(body);
    if (!expense) return twimlReply("❌ Não consegui identificar o gasto. Tente algo como: 'Pizza 60 reais, cartão Inter crédito'\n\nDigite */ajuda* para ver os comandos disponíveis.");

    pendentes[from] = expense;
    const tipo = expense.parcelado ? "Parcelado" : "À vista";
    const preview = expense.parcelado
      ? `💳 ${expense.total_parcelas}x de R$ ${expense.valor_parcela}\n💰 Total: R$ ${expense.valor}\n🏷️ ${expense.categoria}\n📝 ${expense.descricao}\n💳 ${expense.metodo_pagamento}${expense.cartao ? ` (${expense.cartao})` : ""}\n📌 ${tipo}`
      : `💰 R$ ${expense.valor}\n🏷️ ${expense.categoria}\n📝 ${expense.descricao}\n💳 ${expense.metodo_pagamento}${expense.cartao ? ` (${expense.cartao})` : ""}\n📌 ${tipo}`;
    return twimlReply(`📋 Confirmar gasto?\n\n${preview}\n\nResponda *sim* para confirmar ou *não* para cancelar.`);

  } catch (err) {
    console.error("Erro:", err);
    return twimlReply("❌ Erro interno. Tente novamente em instantes.");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor rodando na porta ${PORT}`));
