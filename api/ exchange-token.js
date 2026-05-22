// api/exchange-token.js
// Step 2 of Plaid flow — swaps the temporary public_token for a permanent access_token
// Saves the access_token securely to Supabase
// The access_token NEVER goes to the frontend

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
  process.env.SUPABASE_SERVICE_KEY // Use service key (server-side only — never expose this)
);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { public_token, entity_name, institution_name } = req.body;

    if (!public_token) return res.status(400).json({ error: 'public_token required' });

    // Exchange public token for permanent access token
    const exchangeResponse = await plaidClient.itemPublicTokenExchange({ public_token });
    const { access_token, item_id } = exchangeResponse.data;

    // Get account details from Plaid
    const accountsResponse = await plaidClient.accountsGet({ access_token });
    const accounts = accountsResponse.data.accounts;

    // Save to Supabase plaid_items table
    // access_token is stored server-side only
    const { data, error: dbError } = await supabase
      .from('plaid_items')
      .upsert({
        entity_name: entity_name || 'Unknown Entity',
        institution_name: institution_name || 'Bank',
        item_id,
        access_token, // stored in DB, never sent to frontend
        account_count: accounts.length,
        connected_at: new Date().toISOString(),
        last_synced: new Date().toISOString(),
        is_active: true,
      }, {
        onConflict: 'item_id',
      });

    if (dbError) throw new Error(`Supabase error: ${dbError.message}`);

    // Return safe data (NO access_token) to frontend
    res.status(200).json({
      success: true,
      item_id,
      institution_name,
      accounts: accounts.map(a => ({
        account_id: a.account_id,
        name: a.name,
        mask: a.mask, // last 4 digits
        type: a.type,
        subtype: a.subtype,
        balance: a.balances.current,
        available: a.balances.available,
      })),
    });

  } catch (error) {
    console.error('Plaid exchange-token error:', error.response?.data || error.message);
    res.status(500).json({
      error: 'Failed to exchange token',
      details: error.response?.data?.error_message || error.message,
    });
  }
};
