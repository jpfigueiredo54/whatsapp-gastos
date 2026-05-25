const express = require("express");
const path = require("path");
const { parseExpense, parseReceita } = require("./parser");
const { appendToSheet, appendParcela, appendReceita, registrarParcelasMes, verificarAlertaBudget, getCategorias, adicionarCategoria } = require("./sheets");
const { getResumoMes, getResumoCategoria, getRelatorioSemana, getFechamentoMes, getComparativo, getParcelasAbertas, getFaturas, getUltimoLancamento, deletarUltimoLancamento, getApiResumo, getApiParcelas, getApiFaturas, getApiTransacoes, getApiRelatorio, getRitmo, getApiFechamentoMesAnterior, getApiReceitas, getApiFluxoCaixa, getApiSaldoIndividual } = require("./sheets2");

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const PESSOAS = JSON.parse(process.env.PESSOAS_JSON || "{}");
const pendentes = {};
const pendentesReceita = {};
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

const FRASES_RECEITA = [
  "💰 Dinheiro entrou! Agora tenta não gastar tudo até amanhã.",
  "💰 Receita registrada. O saldo respira aliviado por enquanto.",
  "💰 Entrou grana! Aproveita que dura pouco.",
  "💰 Registrado. O seu eu do futuro agradece (por enquanto).",
  "💰 Receita anotada. Agora é não deixar ir embora rápido demais.",
];

function fraseAleatoria() {
  return FRASES[Math.floor(Math.random() * FRASES.length)];
}

function fraseReceitaAleatoria() {
  return FRASES_RECEITA[Math.floor(Math.random() * FRASES_RECEITA.length)];
}

const AJUDA = `🤖 Comandos disponíveis:

💬 *Registrar gasto:*
Mande uma mensagem normal descrevendo o gasto.
Ex: "Almoço 45 reais Nubank crédito"

💳 *Registrar parcelado:*
Ex: "TV 12x de 350 reais Nubank"

💰 *Registrar receita:*
Ex: "recebi 5000 salário"
Ex: "Isabella recebeu 3000"

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
  try {
    const { mes, ano } = req.query;
    res.json(await getApiResumo(
      mes !== undefined ? parseInt(mes) : undefined,
      ano !== undefined ? parseInt(ano) : undefined
    ));
  }
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

app.get("/api/receitas", async (req, res) => {
  try { res.json(await getApiReceitas()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/fluxo", async (req, res) => {
  try {
    const { meses } = req.query;
    res.json(await getApiFluxoCaixa(meses || 6));
  }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/saldo-individual", async (req, res) => {
  try { res.json(await getApiSaldoIndividual()); }
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
    // Fluxo de edição
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

    // Confirmação de receita pendente
    if (pendentesReceita[from]) {
      const receita = pendentesReceita[from];
      if (body.toLowerCase() === "sim") {
        delete pendentesReceita[from];
        await appendReceita(receita);
        return twimlReply(`✅ Receita registrada!\n👤 ${receita.pessoa}\n📅 ${receita.data}\n💰 R$ ${receita.valor}\n📝 ${receita.descricao}\n\n${fraseReceitaAleatoria()}`);
      } else if (body.toLowerCase() === "não" || body.toLowerCase() === "nao") {
        delete pendentesReceita[from];
        return twimlReply("❌ Receita cancelada.");
      } else {
        return twimlReply(`Responda *sim* para confirmar ou *não* para cancelar.\n\n📋 Receita pendente:\n👤 ${receita.pessoa}\n💰 R$ ${receita.valor}\n📝 ${receita.descricao}`);
      }
    }

    // Confirmação de gasto pendente
    if (pendentes[from]) {
      const expense = pendentes[from];
      if (body.toLowerCase() === "sim") {
        delete pendentes[from];
        const alerta = await verificarAlertaBudget(expense.categoria, parseFloat((expense.valor_parcela || expense.valor).replace(",", ".")));
        const pessoaFinal = (expense.cartao || "").toLowerCase().includes("latampass") ? "Ambos" : pessoa;
        await appendToSheet(expense, pessoaFinal);
        if (expense.parcelado) await appendParcela(expense, pessoaFinal);
        const tipo = expense.parcelado ? "Parcelado" : "À vista";
        let reply = expense.parcelado
          ? `✅ Parcelamento registrado!\n👤 ${pessoaFinal}\n📅 ${expense.data}\n💳 ${expense.total_parcelas}x de R$ ${expense.valor_parcela}\n💰 Total: R$ ${expense.valor}\n🏷️ ${expense.categoria}\n📝 ${expense.descricao}\n📌 Parcelado\n\n📌 Parcela 1/${expense.total_parcelas} lançada. As próximas serão registradas automaticamente todo dia 1º.`
          : `✅ Gasto registrado!\n👤 ${pessoaFinal}\n📅 ${expense.data}\n💰 R$ ${expense.valor}\n🏷️ ${expense.categoria}\n📝 ${expense.descricao}\n💳 ${expense.metodo_pagamento}${expense.cartao ? ` (${expense.cartao})` : ""}\n📌 À vista`;
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

    // Comandos
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

    // Detectar receita antes de tentar gasto
    const receitaKeywords = ["recebi", "recebeu", "receita", "salário", "salario", "entrada de", "caiu o"];
    const isReceita = receitaKeywords.some(kw => body.toLowerCase().includes(kw));

    if (isReceita) {
      const receita = await parseReceita(body);
      if (receita) {
        pendentesReceita[from] = receita;
        return twimlReply(`📋 Confirmar receita?\n\n👤 ${receita.pessoa}\n📅 ${receita.data}\n💰 R$ ${receita.valor}\n📝 ${receita.descricao}\n\nResponda *sim* para confirmar ou *não* para cancelar.`);
      }
    }

    // Tentar parsear como gasto
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
