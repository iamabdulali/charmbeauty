const KLAVIYO_API_KEY = process.env.KLAVIYO_PRIVATE_KEY;
const KLAVIYO_EMAIL_LIST_ID = process.env.KLAVIYO_EMAIL_LIST;
const KLAVIYO_SMS_LIST_ID = process.env.KLAVIYO_SMS_LIST;

console.log(KLAVIYO_API_KEY)
const SEGMENT_ID = process.env.KLAVIYO_SEGMENT_ID;
const KLAVIYO_API = "https://a.klaviyo.com/api";
const REVISION = "2024-10-15"; // latest stable revision


// E.164 phone formatter
// Klaviyo rejects anything that isn't E.164 (e.g. +15551234567).
// Strips all non-digits, assumes US (+1) if 10 digits, handles 11-digit
// numbers starting with 1. Returns null if format is unrecognisable.
function toE164(raw) {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

// Helper: upsert a profile and return its ID
// POST to create. On 409 (duplicate), Klaviyo returns the existing profile ID —
// we then PATCH that profile to merge in the new properties.
async function upsertProfile(attributes) {
  const res = await fetch(`${KLAVIYO_API}/profiles/`, {
    method: "POST",
    headers: {
      accept: "application/json",
      revision: REVISION,
      "content-type": "application/json",
      Authorization: `Klaviyo-API-Key ${KLAVIYO_API_KEY}`,
    },
    body: JSON.stringify({
      data: { type: "profile", attributes },
    }),
  });

  // 409 = profile already exists with this email/phone.
  // Klaviyo includes the existing profile ID in the error, PATCH it instead.
  if (res.status === 409) {
    const errJson = await res.json();
    const existingId = errJson?.errors?.[0]?.meta?.duplicate_profile_id;
    if (!existingId) throw new Error("Klaviyo 409 but no duplicate_profile_id returned");

    const patchRes = await fetch(`${KLAVIYO_API}/profiles/${existingId}/`, {
      method: "PATCH",
      headers: {
        accept: "application/json",
        revision: REVISION,
        "content-type": "application/json",
        Authorization: `Klaviyo-API-Key ${KLAVIYO_API_KEY}`,
      },
      body: JSON.stringify({
        data: { type: "profile", id: existingId, attributes },
      }),
    });

    if (!patchRes.ok) {
      const patchErr = await patchRes.text();
      throw new Error(`Klaviyo PATCH profile failed: ${patchRes.status} ${patchErr}`);
    }

    const patchJson = await patchRes.json();
    return patchJson.data.id;
  }

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Klaviyo upsertProfile failed: ${res.status} ${err}`);
  }

  const json = await res.json();
  return json.data.id;
}

// Helper: add a profile to the master list
async function addToList(profileId) {
  const res = await fetch(
    `${KLAVIYO_API}/lists/${KLAVIYO_EMAIL_LIST_ID}/relationships/profiles/`,
    {
      method: "POST",
      headers: {
        accept: "application/json",
        revision: REVISION,
        "content-type": "application/json",
        Authorization: `Klaviyo-API-Key ${KLAVIYO_API_KEY}`,
      },
      body: JSON.stringify({
        data: [{ type: "profile", id: profileId }],
      }),
    }
  );

  // 204 = success (no body), 400 = already on list
  if (!res.ok && res.status !== 400) {
    const err = await res.text();
    throw new Error(`Klaviyo addToList failed: ${res.status} ${err}`);
  }
}

// Helper: subscribe a profile to the email list with MARKETING consent
// This sets status to "Subscribed" — unlike addToList which only creates
// the list relationship without touching consent.
async function subscribeToEmailList(email) {
  const res = await fetch(`${KLAVIYO_API}/profile-subscription-bulk-create-jobs/`, {
    method: "POST",
    headers: {
      accept: "application/json",
      revision: REVISION,
      "content-type": "application/json",
      Authorization: `Klaviyo-API-Key ${KLAVIYO_API_KEY}`,
    },
    body: JSON.stringify({
      data: {
        type: "profile-subscription-bulk-create-job",
        attributes: {
          list_id: KLAVIYO_EMAIL_LIST_ID,
          subscriptions: [
            {
              channels: {
                email: ["MARKETING"],
              },
              email,
            },
          ],
        },
      },
    }),
  });

  // 202 = accepted (async job), anything else is an error
  if (!res.ok && res.status !== 202) {
    const err = await res.text();
    throw new Error(`Klaviyo subscribeToEmailList failed: ${res.status} ${err}`);
  }
}

// Netlify ESM export
export const handler = async (event) => {

  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  // Handle CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  // ── GET: return total profile count ────────────────────────────────────────
if (event.httpMethod === "GET") {
  try {
    // Helper function to handle rate limiting with retry
    const fetchWithRetry = async (url, options, retries = 2) => {
      for (let i = 0; i <= retries; i++) {
        const response = await fetch(url, options);
        
        if (response.status === 429) {
          const errorData = await response.json();
          const retryAfter = errorData.errors?.[0]?.detail?.match(/(\d+) second/)?.[1] || 1;
          
          if (i < retries) {
            console.log(`Rate limited. Retrying after ${retryAfter} seconds...`);
            await new Promise(resolve => setTimeout(resolve, (parseInt(retryAfter) + 0.5) * 1000));
            continue;
          }
        }
        
        return response;
      }
    };

    // Fetch FIRST list
    const emailResponse = await fetchWithRetry(
      `https://a.klaviyo.com/api/lists/${KLAVIYO_EMAIL_LIST_ID}/?additional-fields[list]=profile_count`,
      {
        method: "GET",
        headers: {
          Authorization: `Klaviyo-API-Key ${KLAVIYO_API_KEY}`,
          revision: "2024-10-15",
          accept: "application/json",
        },
      }
    );

    // Wait 1 second between requests to avoid rate limit
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Fetch SECOND list
    const smsResponse = await fetchWithRetry(
      `https://a.klaviyo.com/api/lists/${KLAVIYO_SMS_LIST_ID}/?additional-fields[list]=profile_count`,
      {
        method: "GET",
        headers: {
          Authorization: `Klaviyo-API-Key ${KLAVIYO_API_KEY}`,
          revision: "2024-10-15",
          accept: "application/json",
        },
      }
    );

    // Check for errors
    if (!emailResponse.ok || !smsResponse.ok) {
      const emailError = !emailResponse.ok ? await emailResponse.text() : null;
      const smsError = !smsResponse.ok ? await smsResponse.text() : null;
      
      console.error("Klaviyo API errors:", { emailError, smsError });
      
      return {
        statusCode: emailResponse.status || smsResponse.status,
        body: JSON.stringify({
          error: "Failed to fetch list data from Klaviyo",
          details: { emailError, smsError },
        }),
      };
    }

    // Parse responses
    const [emailData, smsData] = await Promise.all([
      emailResponse.json(),
      smsResponse.json(),
    ]);

    console.log("Email data:", emailData);
    console.log("SMS data:", smsData);

    // Extract profile counts
    const emailCount = emailData.data?.attributes?.profile_count || 0;
    const smsCount = smsData.data?.attributes?.profile_count || 0;

    // Return counts
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({
        email: emailCount,
        sms: smsCount,
        total: emailCount + smsCount,
      }),
    };
  } catch (error) {
    console.error("Error fetching profile counts:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Internal server error",
        message: error.message,
      }),
    };
  }
}

  // Only allow POST
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method Not Allowed" }) };
  }

  // Parse body
  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid JSON" }) };
  }

  const {
    firstName,
    lastName,
    email,
    phone,
    tiktok,
    instagram,
    youtube,
    primaryPlatform,
    bestPost,
    whyJoin,
    heardFrom,
    postsPerMonth,
    besties = [],
    _bestiesOnly = false,
  } = body;

  try {

    // BESTIES-ONLY path
    // Called from the success panel after the main form is already submitted.
    // Creates bestie profiles AND patches bestie_phone_1…5 back onto the applicant.
    if (_bestiesOnly) {
      const bestieResults = await processBesties(besties, email);

      // Patch bestie_phone_1…5 onto the applicant's existing profile
      const created = bestieResults.filter((b) => b.status === "created");
      if (created.length) {
        const bestieProps = {};
        created.forEach((b, i) => {
          bestieProps[`bestie_phone_${i + 1}`] = b.phone;
        });
        await upsertProfile({ email, properties: bestieProps });
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, besties: bestieResults }),
      };
    }

    // FULL SUBMISSION path

    // Format applicant phone — skip if unparseable
    const applicantPhone = toE164(phone);

    // 1. Build the applicant profile
    const applicantProps = {
      email,
      first_name: firstName,
      last_name: lastName,
      ...(applicantPhone && { phone_number: applicantPhone }),
      properties: {
        charm_squad_applicant: true,
        tiktok_handle: tiktok || "",
        instagram_handle: instagram || "",
        youtube_handle: youtube || "",
        primary_platform: primaryPlatform || "",
        best_post_link: bestPost || "",
        why_join: whyJoin || "",
        heard_from: heardFrom || "",
        posts_per_month: postsPerMonth || "",
        application_date: new Date().toISOString(),
      },
    };

    // 2. Upsert applicant + add to master list
    const applicantId = await upsertProfile(applicantProps);
    await subscribeToEmailList(applicantId);

    // 3. Create bestie referral profiles
    const bestieResults = await processBesties(besties, email);

    // 4. Re-upsert applicant with bestie_phone_1…5 populated
    const created = bestieResults.filter((b) => b.status === "created");
    if (created.length) {
      created.forEach((b, i) => {
        applicantProps.properties[`bestie_phone_${i + 1}`] = b.phone;
      });
      await upsertProfile(applicantProps);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        applicantId,
        besties: bestieResults,
      }),
    };

  } catch (err) {
    console.error("Klaviyo integration error:", err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
};

// Helper: process bestie phone numbers into Klaviyo profiles
async function processBesties(besties, referredByEmail) {
  const results = [];
  for (let i = 0; i < besties.length; i++) {
    const rawPhone = besties[i]?.trim();
    const bestiePhone = toE164(rawPhone);

    if (!bestiePhone) {
      console.warn(`Bestie ${i + 1}: could not parse "${rawPhone}", skipping.`);
      results.push({ phone: rawPhone, status: "skipped", reason: "invalid phone format" });
      continue;
    }

    try {
      const bestieId = await upsertProfile({
        phone_number: bestiePhone,
        properties: {
          charm_squad_referral: true,
          referred_by: referredByEmail,
          referral_date: new Date().toISOString(),
        },
      });

      await addToList(bestieId);
      results.push({ phone: bestiePhone, status: "created" });
    } catch (err) {
      console.error(`Bestie ${i + 1} error:`, err.message);
      results.push({ phone: bestiePhone, status: "error", error: err.message });
    }
  }
  return results;
}