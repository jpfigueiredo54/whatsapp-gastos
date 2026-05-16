const { google } = require("googleapis");

function getAuth() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

async function appendToSheet(expense, pessoa) {
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  const values = [[
    expense.data,
    expense.valor_parcela ? expense.valor_parcela.replace(".", ",") : expense.valor.replace(".", ","),
    expense.categoria,
    expense.descricao,
    expense.metodo_pagamento,
    expense.cartao || "",
    pessoa || "",
  ]];

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: "Gastos!A:G",
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values },
  });
}

async function appendParcela(expense, pessoa) {
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  const values = [[
    expense.descricao,
    expense.valor_parcela.replace(".", ","),
    expense.categoria,
    expense.cartao || "",
    expense.metodo_pagamento,
    pessoa || "",
    expense.total_parcelas,
    1,
  ]];

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: "Parcelas!A:H",
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values },
  });
}

async function getBudgets() {
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "Budget!A:B",
  });

  const rows = res.data.values || [];
  const budgets = {};
  rows.slice(1).forEach(row => {
    if (row[0] && row[1]) {
      budgets[row[0]] = parseFloat(row[1].toString().replace(",", "."));
    }
  });
  return budgets;
}

async function getGastosPorMes(mes, ano) {
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "Gastos!A:G",
  });

  const rows = res.data.values || [];

  const gastos = rows.slice(1).filter(row => {
    if (!row[0]) return false;
    const partes = row[0].split("/");
    if (partes.length < 3) return false;
    return parseInt(partes[1]) - 1 === mes && parseInt(partes[2]) === ano;
  });

  const porCategoria = {};
  let total = 0;
  gastos.forEach(row => {
    const cat = row[2] || "Outro";
    const val = parseFloat((row[1] || "0").replace(",", "."));
    porCategoria[cat] = (porCategoria[cat] || 0) + val;
    total += val;
  });

  return { porCategoria, total };
}

async function getGastosMesCategoria(categoria) {
  const agora = new Date();
  const { porCategoria } = await getGastosPorMes(agora.getMonth(), agora.getFullYear());
  return porCategoria[categoria] || 0;
}

async function verificarAlertaBudget(categoria, valorNovoGasto) {
  const budgets = await getBudgets();
  const limite = budgets[categoria];
  if (!limite) return null;

  const gastoAtual = await getGastosMesCategoria(categoria);
  const gastoTotal = gastoAtual + valorNovoGasto;
  const percentual = (gastoTotal / limite) * 100;

  if (percentual >= 100) {
    return `⚠️ Limite de ${categoria} estourado!\nGasto: R$ ${gastoTotal.toFixed(2).replace(".", ",")} de R$ ${limite.toFixed(2).replace(".", ",")} (${percentual.toFixed(0)}%)`;
  } else if (percentual >= 80) {
    return `⚠️ Atenção! Você usou ${percentual.toFixed(0)}% do budget de ${categoria}.\nGasto: R$ ${gastoTotal.toFixed(2).replace(".", ",")} de R$ ${limite.toFixed(2).replace(".", ",")} (${percentual.toFixed(0)}%)`;
  }
  return null;
}

async function getResumoMes() {
  const agora = new Date();
  const { porCategoria, total } = await getGastosPorMes(agora.getMonth(), agora.getFullYear());

  if (total === 0) return "📊 Nenhum gasto registrado este mês.";

  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "Gastos!A:G",
  });

  const rows = res.data.values || [];
  const mesAtual = agora.getMonth();
  const anoAtual = agora.getFullYear();

  const gastosMes = rows.slice(1).filter(row => {
    if (!row[0]) return false;
    const partes = row[0].split("/");
    if (partes.length < 3) return false;
    return parseInt(partes[1]) - 1 === mesAtual && parseInt(partes[2]) === anoAtual;
  });

  const porPessoa = {};
  gastosMes.forEach(row => {
    const pessoa = row[6] || "Desconhecido";
    const val = parseFloat((row[1] || "0").replace(",", "."));
    porPessoa[pessoa] = (porPessoa[pessoa] || 0) + val;
  });

  const budgets = await getBudgets();
  const nomeMes = agora.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

  let msg = `📊 Resumo de ${nomeMes}\n`;
  msg += `💰 Total: R$ ${total.toFixed(2).replace(".", ",")}\n\n`;

  msg += `📂 Por categoria:\n`;
  Object.entries(porCategoria)
    .sort((a, b) => b[1] - a[1])
    .forEach(([cat, val]) => {
      const limite = budgets[cat];
      if (limite) {
        const pct = ((val / limite) * 100).toFixed(0);
        const emoji = pct >= 100 ? "🔴" : pct >= 80 ? "🟡" : "🟢";
        msg += `${emoji} ${cat}: R$ ${val.toFixed(2).replace(".", ",")} / R$ ${limite.toFixed(2).replace(".", ",")} (${pct}%)\n`;
      } else {
        msg += `• ${cat}: R$ ${val.toFixed(2).replace(".", ",")}\n`;
      }
    });

  msg += `\n👤 Por pessoa:\n`;
  Object.entries(porPessoa)
    .sort((a, b) => b[1] - a[1])
    .forEach(([pessoa, val]) => {
      msg += `• ${pessoa}: R$ ${val.toFixed(2).replace(".", ",")}\n`;
    });

  return msg;
}

async function getResumoCategoria(categoria) {
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "Gastos!A:G",
  });

  const rows = res.data.values || [];
  const agora = new Date();
  const mesAtual = agora.getMonth();
  const anoAtual = agora.getFullYear();

  const gastosMes = rows.slice(1).filter(row => {
    if (!row[0] || row[2]?.toLowerCase() !== categoria.toLowerCase()) return false;
    const partes = row[0].split("/");
    if (partes.length < 3) return false;
    return parseInt(partes[1]) - 1 === mesAtual && parseInt(partes[2]) === anoAtual;
  });

  if (gastosMes.length === 0) return `📂 Nenhum gasto em *${categoria}* este mês.`;

  const total = gastosMes.reduce((acc, row) => acc + parseFloat((row[1] || "0").replace(",", ".")), 0);
  const budgets = await getBudgets();
  const limite = budgets[categoria];
  const nomeMes = agora.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

  let msg = `📂 *${categoria}* — ${nomeMes}\n`;

  if (limite) {
    const pct = ((total / limite) * 100).toFixed(0);
    const emoji = pct >= 100 ? "🔴" : pct >= 80 ? "🟡" : "🟢";
    msg += `${emoji} Total: R$ ${total.toFixed(2).replace(".", ",")} / R$ ${limite.toFixed(2).replace(".", ",")} (${pct}%)\n`;
  } else {
    msg += `💰 Total: R$ ${total.toFixed(2).replace(".", ",")}\n`;
  }

  msg += `\n📋 Lançamentos:\n`;
  gastosMes.forEach(row => {
    msg += `• ${row[0]} — R$ ${parseFloat((row[1] || "0").replace(",", ".")).toFixed(2).replace(".", ",")} — ${row[3] || ""} (${row[6] || ""})\n`;
  });

  return msg;
}

async function getRelatorioSemana() {
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "Gastos!A:G",
  });

  const rows = res.data.values || [];
  if (rows.length <= 1) return "📅 Nenhum gasto registrado ainda.";

  const agora = new Date();
  const diaSemana = agora.getDay();
  const diasAteSeg = diaSemana === 0 ? 6 : diaSemana - 1;

  const inicioSemanaAtual = new Date(agora);
  inicioSemanaAtual.setDate(agora.getDate() - diasAteSeg);
  inicioSemanaAtual.setHours(0, 0, 0, 0);

  const inicioSemanaAnterior = new Date(inicioSemanaAtual);
  inicioSemanaAnterior.setDate(inicioSemanaAtual.getDate() - 7);

  const fimSemanaAnterior = new Date(inicioSemanaAtual);
  fimSemanaAnterior.setDate(inicioSemanaAtual.getDate() - 1);
  fimSemanaAnterior.setHours(23, 59, 59, 999);

  const parsearData = (str) => {
    const p = str.split("/");
    if (p.length < 3) return null;
    return new Date(parseInt(p[2]), parseInt(p[1]) - 1, parseInt(p[0]));
  };

  const gastosSemana = rows.slice(1).filter(row => {
    if (!row[0]) return false;
    const d = parsearData(row[0]);
    if (!d) return false;
    return d >= inicioSemanaAnterior && d <= fimSemanaAnterior;
  });

  const dataInicioStr = inicioSemanaAnterior.toLocaleDateString("pt-BR");
  const dataFimStr = fimSemanaAnterior.toLocaleDateString("pt-BR");

  if (gastosSemana.length === 0) return `📅 Nenhum gasto registrado na semana de ${dataInicioStr} a ${dataFimStr}.`;

  const total = gastosSemana.reduce((acc, row) => acc + parseFloat((row[1] || "0").replace(",", ".")), 0);

  const porCategoria = {};
  gastosSemana.forEach(row => {
    const cat = row[2] || "Outro";
    const val = parseFloat((row[1] || "0").replace(",", "."));
    porCategoria[cat] = (porCategoria[cat] || 0) + val;
  });

  const porPessoa = {};
  gastosSemana.forEach(row => {
    const pessoa = row[6] || "Desconhecido";
    const val = parseFloat((row[1] || "0").replace(",", "."));
    porPessoa[pessoa] = (porPessoa[pessoa] || 0) + val;
  });

  let msg = `📅 Relatório semanal\n`;
  msg += `🗓️ ${dataInicioStr} a ${dataFimStr}\n`;
  msg += `💰 Total: R$ ${total.toFixed(2).replace(".", ",")}\n\n`;

  msg += `📂 Por categoria:\n`;
  Object.entries(porCategoria)
    .sort((a, b) => b[1] - a[1])
    .forEach(([cat, val]) => {
      msg += `• ${cat}: R$ ${val.toFixed(2).replace(".", ",")}\n`;
    });

  msg += `\n👤 Por pessoa:\n`;
  Object.entries(porPessoa)
    .sort((a, b) => b[1] - a[1])
    .forEach(([pessoa, val]) => {
      msg += `• ${pessoa}: R$ ${val.toFixed(2).replace(".", ",")}\n`;
    });

  msg += `\n💡 "A disciplina financeira de hoje é a liberdade de amanhã."`;

  return msg;
}

async function getFechamentoMes() {
  const agora = new Date();
  const { porCategoria, total } = await getGastosPorMes(agora.getMonth(), agora.getFullYear());

  if (total === 0) return "🏁 Nenhum gasto registrado este mês.";

  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "Gastos!A:G",
  });

  const rows = res.data.values || [];
  const mesAtual = agora.getMonth();
  const anoAtual = agora.getFullYear();

  const gastosMes = rows.slice(1).filter(row => {
    if (!row[0]) return false;
    const partes = row[0].split("/");
    if (partes.length < 3) return false;
    return parseInt(partes[1]) - 1 === mesAtual && parseInt(partes[2]) === anoAtual;
  });

  const porPessoa = {};
  gastosMes.forEach(row => {
    const pessoa = row[6] || "Desconhecido";
    const val = parseFloat((row[1] || "0").replace(",", "."));
    porPessoa[pessoa] = (porPessoa[pessoa] || 0) + val;
  });

  const budgets = await getBudgets();
  const nomeMes = agora.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

  let totalBudget = 0;
  let categoriasEstouradas = [];
  let categoriasDentro = [];

  Object.entries(porCategoria).forEach(([cat, val]) => {
    const limite = budgets[cat];
    if (limite) {
      totalBudget += limite;
      if (val > limite) categoriasEstouradas.push(cat);
      else categoriasDentro.push(cat);
    }
  });

  const maiorGasto = Object.entries(porCategoria).sort((a, b) => b[1] - a[1])[0];
  const maiorGastante = Object.entries(porPessoa).sort((a, b) => b[1] - a[1])[0];

  let msg = `🏁 Fechamento de ${nomeMes}\n`;
  msg += `${"─".repeat(25)}\n`;
  msg += `💰 Total gasto: R$ ${total.toFixed(2).replace(".", ",")}\n`;

  if (totalBudget > 0) {
    const pctGeral = ((total / totalBudget) * 100).toFixed(0);
    const emojiGeral = total > totalBudget ? "🔴" : total / totalBudget >= 0.8 ? "🟡" : "🟢";
    msg += `${emojiGeral} Budget total: R$ ${totalBudget.toFixed(2).replace(".", ",")} (${pctGeral}% utilizado)\n`;
  }

  msg += `\n📂 Por categoria:\n`;
  Object.entries(porCategoria)
    .sort((a, b) => b[1] - a[1])
    .forEach(([cat, val]) => {
      const limite = budgets[cat];
      if (limite) {
        const pct = ((val / limite) * 100).toFixed(0);
        const emoji = pct >= 100 ? "🔴" : pct >= 80 ? "🟡" : "🟢";
        msg += `${emoji} ${cat}: R$ ${val.toFixed(2).replace(".", ",")} / R$ ${limite.toFixed(2).replace(".", ",")} (${pct}%)\n`;
      } else {
        msg += `• ${cat}: R$ ${val.toFixed(2).replace(".", ",")}\n`;
      }
    });

  msg += `\n👤 Por pessoa:\n`;
  Object.entries(porPessoa)
    .sort((a, b) => b[1] - a[1])
    .forEach(([pessoa, val]) => {
      const pct = ((val / total) * 100).toFixed(0);
      msg += `• ${pessoa}: R$ ${val.toFixed(2).replace(".", ",")} (${pct}% do total)\n`;
    });

  msg += `\n📌 Destaques:\n`;
  msg += `• Maior gasto: ${maiorGasto[0]} (R$ ${maiorGasto[1].toFixed(2).replace(".", ",")})\n`;
  msg += `• Quem mais gastou: ${maiorGastante[0]} (R$ ${maiorGastante[1].toFixed(2).replace(".", ",")})\n`;

  if (categoriasEstouradas.length > 0) msg += `• Categorias estouradas: ${categoriasEstouradas.join(", ")}\n`;
  if (categoriasDentro.length > 0) msg += `• Dentro do budget: ${categoriasDentro.join(", ")}\n`;

  msg += `\n💡 "Quem controla seus gastos, controla seu futuro."`;

  return msg;
}

async function getComparativo() {
  const agora = new Date();
  const mesAtual = agora.getMonth();
  const anoAtual = agora.getFullYear();

  const mesAnterior = mesAtual === 0 ? 11 : mesAtual - 1;
  const anoAnterior = mesAtual === 0 ? anoAtual - 1 : anoAtual;

  const atual = await getGastosPorMes(mesAtual, anoAtual);
  const anterior = await getGastosPorMes(mesAnterior, anoAnterior);

  if (atual.total === 0 && anterior.total === 0) return "📈 Nenhum dado encontrado para comparar.";

  const nomeAtual = agora.toLocaleDateString("pt-BR", { month: "long" });
  const dataAnterior = new Date(anoAnterior, mesAnterior, 1);
  const nomeAnterior = dataAnterior.toLocaleDateString("pt-BR", { month: "long" });

  const diffTotal = atual.total - anterior.total;
  const diffPct = anterior.total > 0 ? ((diffTotal / anterior.total) * 100).toFixed(0) : 0;
  const emojiTotal = diffTotal > 0 ? "📈" : diffTotal < 0 ? "📉" : "➡️";

  let msg = `📊 Comparativo: ${nomeAnterior} vs ${nomeAtual}\n`;
  msg += `${"─".repeat(25)}\n`;
  msg += `${emojiTotal} Total: R$ ${anterior.total.toFixed(2).replace(".", ",")} → R$ ${atual.total.toFixed(2).replace(".", ",")}\n`;

  const sinal = diffTotal >= 0 ? "+" : "";
  msg += `   ${sinal}R$ ${diffTotal.toFixed(2).replace(".", ",")} (${sinal}${diffPct}%)\n\n`;

  msg += `📂 Por categoria:\n`;

  const todasCategorias = new Set([
    ...Object.keys(atual.porCategoria),
    ...Object.keys(anterior.porCategoria),
  ]);

  Array.from(todasCategorias)
    .sort()
    .forEach(cat => {
      const valAtual = atual.porCategoria[cat] || 0;
      const valAnterior = anterior.porCategoria[cat] || 0;
      const diff = valAtual - valAnterior;
      const emoji = diff > 0 ? "📈" : diff < 0 ? "📉" : "➡️";
      const sinalCat = diff >= 0 ? "+" : "";
      msg += `${emoji} ${cat}: R$ ${valAnterior.toFixed(2).replace(".", ",")} → R$ ${valAtual.toFixed(2).replace(".", ",")}\n`;
      msg += `   (${sinalCat}R$ ${diff.toFixed(2).replace(".", ",")})\n`;
    });

  const economia = diffTotal < 0;
  msg += economia
    ? `\n✅ Parabéns! Você gastou menos este mês.`
    : `\n⚠️ Você gastou mais este mês. Fique de olho!`;

  return msg;
}

async function getUltimoLancamento(pessoa) {
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "Gastos!A:G",
  });

  const rows = res.data.values || [];
  const lancamentos = rows.slice(1);

  for (let i = lancamentos.length - 1; i >= 0; i--) {
    if (lancamentos[i][6] === pessoa) {
      return {
        data: lancamentos[i][0],
        valor: lancamentos[i][1],
        categoria: lancamentos[i][2],
        descricao: lancamentos[i][3],
        metodo: lancamentos[i][4],
        cartao: lancamentos[i][5],
        linha: i + 2,
      };
    }
  }
  return null;
}

async function deletarUltimoLancamento(pessoa) {
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  const ultimo = await getUltimoLancamento(pessoa);
  if (!ultimo) return false;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{
        deleteDimension: {
          range: {
            sheetId: 0,
            dimension: "ROWS",
            startIndex: ultimo.linha - 1,
            endIndex: ultimo.linha,
          },
        },
      }],
    },
  });

  return true;
}

module.exports = { appendToSheet, appendParcela, getResumoMes, getResumoCategoria, getRelatorioSemana, getFechamentoMes, getComparativo, verificarAlertaBudget, getUltimoLancamento, deletarUltimoLancamento };
