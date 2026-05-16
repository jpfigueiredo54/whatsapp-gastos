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
    return `⚠️ Limite de ${categoria}
