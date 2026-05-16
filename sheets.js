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

async function registrarParcelasMes() {
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "Parcelas!A:H",
  });

  const rows = res.data.values || [];
  if (rows.length <= 1) return 0;

  const agora = new Date();
  const dataHoje = agora.toLocaleDateString("pt-BR");
  let registradas = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const descricao = row[0] || "";
    const valorParcela = row[1] || "0";
    const categoria = row[2] || "Outro";
    const cartao = row[3] || "";
    const metodo = row[4] || "crédito";
    const pessoa = row[5] || "";
    const totalParcelas = parseInt(row[6] || "0");
    const parcelasPagas = parseInt(row[7] || "0");

    if (parcelasPagas >= totalParcelas) continue;

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "Gastos!A:G",
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: [[
          dataHoje,
          valorParcela,
          categoria,
          `${descricao} (parcela ${parcelasPagas + 1}/${totalParcelas})`,
          metodo,
          cartao,
          pessoa,
        ]],
      },
    });

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `Parcelas!H${i + 1}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[parcelasPagas + 1]] },
    });

    registradas++;
  }

  return registradas;
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

module.exports = { appendToSheet, appendParcela, registrarParcelasMes, getBudgets, getGastosPorMes, getGastosMesCategoria, verificarAlertaBudget };
