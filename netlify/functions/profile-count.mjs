// Docs on request and context https://docs.netlify.com/functions/build/#code-your-function-2
// export const handler =  async (request, context) => {
//   try {
//     const response = await fetch(
//       'https://a.klaviyo.com/api/profiles',
//       {
//         headers: {
//           'Authorization': `Klaviyo-API-Key ${process.env.KLAVIYO_PRIVATE_KEY}`,
//           'revision': '2024-10-15',
//           'accept': 'application/vnd.api+json'
//         }
//       }
//     );

//     const data = await response.json();

//     if (response.ok) {
//       const count = data?.data.length || 0;
//       return {
//         statusCode: 200,
//         headers: {
//           'Content-Type': 'application/json'
//         },
//         body: JSON.stringify({ count })
//       };
//     } else {
//       return {
//         statusCode: response.status,
//         body: JSON.stringify({ error: 'Failed to fetch profiles' })
//       };
//     }
//   } catch (error) {
//     console.error('Error:', error);
//     return {
//       statusCode: 500,
//       body: JSON.stringify({ error: 'Server error' })
//     };
//   }
// }


export const handler = async (request, context) => {
  try {
    // Replace with your actual list ID (the one you're using for email subscriptions)
    const listId = 'Rt6z2E';
    
    const response = await fetch(
      `https://a.klaviyo.com/api/lists/${listId}?additional-fields[list]=profile_count`,
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
      // The profile_count will be in the attributes
      const count = data?.data?.attributes?.profile_count || 0;
      
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
        body: JSON.stringify({ error: 'Failed to fetch list count' })
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