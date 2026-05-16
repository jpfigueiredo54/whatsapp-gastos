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
    expense.valor.replace(".", ","),
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

async function getGastosMesCategoria(categoria) {
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

  return rows.slice(1)
    .filter(row => {
      if (!row[0] || row[2] !== categoria) return false;
      const partes = row[0].split("/");
      if (partes.length < 3) return false;
      return parseInt(partes[1]) - 1 === mesAtual && parseInt(partes[2]) === anoAtual;
    })
    .reduce((acc, row) => acc + parseFloat((row[1] || "0").replace(",", ".")), 0);
}

async function verificarAlertaBudget(categoria, valorNovoGasto) {
  const budgets = await getBudgets();
  const limite = budgets[categoria];
  if (!limite) return null;

  const gastoAtual = await getGastosMesCategoria(categoria);
  const gastoTotal = gastoAtual + valorNovoGasto;
  const percentual = (gastoTotal / limite) * 100;

  if (percentual >= 100) {
    return `⚠️ Limite de ${categoria} estourado!\nGasto: R$ ${gastoTotal.toFixed(2).replace(".", ",")} de R$ ${limite.toFixed(2).replace(".", ",")}`;
  } else if (percentual >= 80) {
    return `⚠️ Atenção! Você usou ${percentual.toFixed(0)}% do budget de ${categoria}.\nGasto: R$ ${gastoTotal.toFixed(2).replace(".", ",")} de R$ ${limite.toFixed(2).replace(".", ",")}`;
  }
  return null;
}

async function getResumoMes() {
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "Gastos!A:G",
  });

  const rows = res.data.values || [];
  if (rows.length <= 1) return "📊 Nenhum gasto registrado ainda.";

  const agora = new Date();
  const mesAtual = agora.getMonth();
  const anoAtual = agora.getFullYear();

  const gastosMes = rows.slice(1).filter(row => {
    if (!row[0]) return false;
    const partes = row[0].split("/");
    if (partes.length < 3) return false;
    return parseInt(partes[1]) - 1 === mesAtual && parseInt(partes[2]) === anoAtual;
  });

  if (gastosMes.length === 0) return "📊 Nenhum gasto registrado este mês.";

  const totalGeral = gastosMes.reduce((acc, row) => {
    return acc + parseFloat((row[1] || "0").replace(",", "."));
  }, 0);

  const porCategoria = {};
  gastosMes.forEach(row => {
    const cat = row[2] || "Outro";
    const val = parseFloat((row[1] || "0").replace(",", "."));
    porCategoria[cat] = (porCategoria[cat] || 0) + val;
  });

  const porPessoa = {};
  gastosMes.forEach(row => {
    const pessoa = row[6] || "Desconhecido";
    const val = parseFloat((row[1] || "0").replace(",", "."));
    porPessoa[pessoa] = (porPessoa[pessoa] || 0) + val;
  });

  const budgets = await getBudgets();
  const nomeMes = agora.toLocaleDateString("pt-BR", { month: "long" });

  let msg = `📊 Resumo de ${nomeMes}\n`;
  msg += `💰 Total: R$ ${totalGeral.toFixed(2).replace(".", ",")}\n\n`;

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

module.exports = { appendToSheet, getResumoMes, verificarAlertaBudget };
