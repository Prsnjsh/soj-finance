// api/create-link-token.js
const { PlaidApi, PlaidEnvironments, Configuration, Products, CountryCode } = require('plaid');

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

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { entity_name, user_id } = req.body;

    const response = await plaidClient.linkTokenCreate({
      user: {
        client_user_id: user_id || entity_name || 'soj-user',
      },
      client_name: 'SOJ Finance Dashboard',
      products: [Products.Transactions],
      country_codes: [CountryCode.Us],
      language: 'en',
      transactions: {
        days_requested: 730,
      },
    });

    res.status(200).json({
      link_token: response.data.link_token,
      expiration: response.data.expiration,
    });

  } catch (error) {
    console.error('Plaid create-link-token error:', error.response?.data || error.message);
    res.status(500).json({
      error: 'Failed to create link token',
      details: error.response?.data?.error_message || error.message,
    });
  }
};
