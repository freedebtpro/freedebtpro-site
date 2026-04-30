export default async (req) => {
  try {
    const { email } = await req.json();

    if (!email || !email.includes('@')) {
      return new Response(JSON.stringify({ error: 'Invalid email' }), { status: 400 });
    }

    const response = await fetch('https://services.leadconnectorhq.com/contacts/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Netlify.env.get('GHL_API_KEY')}`,
        'Version': '2021-07-28'
      },
      body: JSON.stringify({
        email: email,
        locationId: 'bD3pD3nuKgprIXEMfdl0',
        tags: ['freedebt-calculadora', 'landing-page', 'plan-gratis'],
        source: 'FreeDebt Pro Landing Page'
      })
    });

    const data = await response.json();
    return new Response(JSON.stringify({ success: true }), { status: 200 });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};

export const config = {
  path: "/api/ghl-contact"
};
