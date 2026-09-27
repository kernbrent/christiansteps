(function registerDashboardData(global) {
  "use strict";

  const amount = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const yearOf = value => Number(String(value || "").slice(0, 4));
  const completed = row => String(row.status || "").toUpperCase() === "COMPLETED";

  function summarize(data, year) {
    const programs = {
      ChristianSteps: { received: 0, expenses: 0 },
      HopeSojourns: { received: 0, expenses: 0 },
    };
    let sharedIncome = 0;
    let sharedExpenses = 0;
    let contributionFees = 0;
    let jbbReceived = 0;
    let jbbSent = 0;
    let jbbDue = 0;

    for (const row of data.paypal_activity || []) {
      if (!completed(row)) continue;
      if (row.program === "JoshBeyondBorders" && row.accounting_class === "agency_receipt") {
        jbbDue += Math.max(0, amount(row.net));
      } else if (row.program === "JoshBeyondBorders" && row.accounting_class === "agency_disbursement") {
        jbbDue -= Math.abs(amount(row.net));
      }
      if (yearOf(row.transaction_date) !== year) continue;
      const program = programs[row.program];
      if (row.accounting_class === "contribution" && program) {
        program.received += Math.max(0, amount(row.gross));
        contributionFees += Math.abs(amount(row.fee));
      } else if (row.program === "JoshBeyondBorders" && row.accounting_class === "agency_receipt") {
        jbbReceived += Math.max(0, amount(row.net));
      } else if (row.program === "JoshBeyondBorders" && row.accounting_class === "agency_disbursement") {
        jbbSent += Math.abs(amount(row.net));
      }
    }

    const incomeById = new Map((data.income || []).map(row => [row.id, row]));
    for (const payment of data.income_payments || []) {
      if (yearOf(payment.payment_date) !== year) continue;
      const income = incomeById.get(payment.income_id);
      if (!income || income.record_status !== "included" || income.payment_status === "void") continue;
      const value = amount(payment.amount);
      if (programs[income.program]) programs[income.program].received += value;
      else if (income.program === "Shared") sharedIncome += value;
    }

    for (const expense of data.expenses || []) {
      if (Number(expense.tax_year) !== year || expense.record_status !== "included") continue;
      const value = amount(expense.amount);
      if (programs[expense.program]) programs[expense.program].expenses += value;
      else if (expense.program === "Shared") sharedExpenses += value;
    }

    return {
      year,
      csmReceived: programs.ChristianSteps.received + sharedIncome,
      hopeReceived: programs.HopeSojourns.received,
      recordedReceipts: programs.ChristianSteps.received + programs.HopeSojourns.received + sharedIncome,
      csmExpenses: programs.ChristianSteps.expenses + sharedExpenses,
      hopeExpenses: programs.HopeSojourns.expenses,
      recordedOutflow: programs.ChristianSteps.expenses + programs.HopeSojourns.expenses + sharedExpenses + contributionFees,
      jbbReceived,
      jbbSent,
      jbbDue,
    };
  }

  global.CSMDashboardData = Object.freeze({ summarize });
})(window);
