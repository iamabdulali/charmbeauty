// Docs on request and context https://docs.netlify.com/functions/build/#code-your-function-2
export const handler =  async (request, context) => {
  try {
    const response = await fetch(
      'https://a.klaviyo.com/api/profiles',
      {
        headers: {
          'Authorization': `Klaviyo-API-Key ${process.env.KLAVIYO_PRIVATE_KEY}`,
          'revision': '2024-10-15',
          'accept': 'application/vnd.api+json'
        }
      }
    );

    const data = await response.json();

    if (response.ok) {
      const count = data?.data.length || 0;
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ count })
      };
    } else {
      return {
        statusCode: response.status,
        body: JSON.stringify({ error: 'Failed to fetch profiles' })
      };
    }
  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Server error' })
    };
  }
}
