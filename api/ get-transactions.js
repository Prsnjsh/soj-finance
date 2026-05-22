// api/get-transactions.js
// Fetches transactions + balances for a given entity
// Called by the dashboard to refresh data

const { PlaidApi, PlaidEnvironments, Configuration } = require('plaid');
const { createClient } = require('@supabase/supabase-js');

const plaidConfig = new Configuration({
  basePath: PlaidEnvironments[process.env.PLAID_ENV || 'sandbox'],
  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
      'PLAID-SECRET': process.env.PLAID_SECRET,
    },
  },
});

const plaidClient = new PlaidApi(plaidConfig);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { entity_name, days = 90 } = req.body;

    // Get access token from Supabase (never from frontend)
    const { data: item, error: dbError } = await supabase
      .from('plaid_items')
      .select('access_token, institution_name, item_id')
      .eq('entity_name', entity_name)
      .eq('is_active', true)
      .single();

    if (dbError || !item) {
      return res.status(404).json({ error: `No connected bank found for ${entity_name}` });
    }

    const { access_token } = item;

    // Date range
    const endDate = new Date().toISOString().split('T')[0];
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
      .toISOString().split('T')[0];

    // Fetch transactions and balances in parallel
    const [transactionsRes, balancesRes] = await Promise.all([
      plaidClient.transactionsGet({
        access_token,
        start_date: startDate,
        end_date: endDate,
        options: { count: 500, offset: 0 },
      }),
      plaidClient.accountsBalanceGet({ access_token }),
    ]);

    const transactions = transactionsRes.data.transactions;
    const accounts = balancesRes.data.accounts;

    // Update last_synced timestamp
    await supabase
      .from('plaid_items')
      .update({ last_synced: new Date().toISOString() })
      .eq('entity_name', entity_name);

    // Calculate summary stats
    const income = transactions
      .filter(t => t.amount < 0) // Plaid: negative = money IN
      .reduce((sum, t) => sum + Math.abs(t.amount), 0);

    const expenses = transactions
      .filter(t => t.amount > 0) // Plaid: positive = money OUT
      .reduce((sum, t) => sum + t.amount, 0);

    const totalBalance = accounts.reduce((sum, a) => sum + (a.balances.current || 0), 0);

    // Group transactions by category for P&L
    const byCategory = {};
    transactions.forEach(t => {
      const cat = t.personal_finance_category?.primary || t.category?.[0] || 'Other';
      if (!byCategory[cat]) byCategory[cat] = { income: 0, expenses: 0, count: 0 };
      if (t.amount < 0) byCategory[cat].income += Math.abs(t.amount);
      else byCategory[cat].expenses += t.amount;
      byCategory[cat].count++;
    });

    res.status(200).json({
      entity_name,
      institution: item.institution_name,
      last_synced: new Date().toISOString(),
      date_range: { start: startDate, end: endDate },
      summary: {
        total_balance: totalBalance,
        income,
        expenses,
        net: income - expenses,
      },
      accounts: accounts.map(a => ({
        account_id: a.account_id,
        name: a.name,
        mask: a.mask,
        type: a.type,
        subtype: a.subtype,
        balance: a.balances.current,
        available: a.balances.available,
      })),
      transactions: transactions.map(t => ({
        id: t.transaction_id,
        date: t.date,
        name: t.merchant_name || t.name,
        amount: t.amount,
        category: t.personal_finance_category?.primary || t.category?.[0] || 'Other',
        account_id: t.account_id,
        pending: t.pending,
        logo_url: t.logo_url,
      })),
      by_category: byCategory,
    });

  } catch (error) {
    console.error('Plaid get-transactions error:', error.response?.data || error.message);

    // Handle expired/invalid token gracefully
    if (error.response?.data?.error_code === 'ITEM_LOGIN_REQUIRED') {
      return res.status(401).json({
        error: 'Bank connection needs to be refreshed',
        error_code: 'ITEM_LOGIN_REQUIRED',
        entity_name,
      });
    }

    res.status(500).json({
      error: 'Failed to fetch transactions',
      details: error.response?.data?.error_message || error.message,
    });
  }
};
