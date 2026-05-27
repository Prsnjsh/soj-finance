// api/get-all-entities.js
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

const ENTITIES = [
  { name: 'The Stick of Joseph LLC', short: 'SOJ', color: '#C9963A' },
  { name: 'Plain and Precious Publishing LLC', short: 'PPP', color: '#1E6B45' },
  { name: 'Saint Threads LLC', short: 'ST', color: '#1A4A8A' },
];

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { data: items, error: dbError } = await supabase
      .from('plaid_items')
      .select('entity_name, institution_name, last_synced, is_active, account_count, item_id')
      .eq('is_active', true);

    if (dbError) throw new Error(dbError.message);

    const result = ENTITIES.map(e => {
      const entItems = (items || []).filter(it => it.entity_name === e.name || it.entity_name === e.short);
      return {
        ...e,
        connected: entItems.length > 0,
        bank_count: entItems.length,
        institutions: entItems.map(it => it.institution_name),
        last_synced: entItems.length ? entItems[0].last_synced : null,
      };
    });

    res.status(200).json({ entities: result });
  } catch (error) {
    console.error('get-all-entities error:', error.message);
    res.status(500).json({ error: error.message });
  }
};
