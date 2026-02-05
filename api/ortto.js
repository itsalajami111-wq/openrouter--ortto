const DEFAULT_MODEL = "openai/gpt-4o-mini";
const COUNTRY_NAME_FIELD = "str:cm:country-of-residence";

function parseBody(req) {
  if (!req.body) return null;
  if (typeof req.body === "object") return req.body;

  const text = Buffer.isBuffer(req.body)
    ? req.body.toString("utf8")
    : String(req.body);

  try { return JSON.parse(text); } catch {}
  try {
    const params = new URLSearchParams(text);
    const obj = {};
    for (const [k, v] of params.entries()) obj[k] = v;
    return obj;
  } catch {}

  return null;
}

async function generateCountryName(code) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY missing");

  const response = await fetch(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.OPENROUTER_MODEL || DEFAULT_MODEL,
        messages: [
          { role: "system", content: "Return only the country name." },
          { role: "user", content: `Country code: ${code}` },
        ],
      }),
    },
  );

  const data = await response.json();
  const output = data?.choices?.[0]?.message?.content?.trim();
  if (!output) throw new Error("No country returned");

  return output;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }

  const payload = parseBody(req);
  console.log("Ortto payload:", payload);

  const contactId = payload?.contact_id;
  const countryCode = payload?.country_of_residence_code;

  if (!contactId || !countryCode) {
    return res.status(400).json({
      error: "Missing contact_id or country_of_residence_code",
    });
  }

  const countryName = await generateCountryName(countryCode);

const mergeUrl = "https://api.eu.ap3api.com/v1/person/merge";

// Build merge person object
// Include email if available in webhook, and always use person_id
const mergePerson = {
  person_id: contactId,
  fields: {
    [COUNTRY_NAME_FIELD]: countryName,
  },
};

// If the webhook payload includes an email field, include it in the merge
if (payload.email) {
  mergePerson.fields.email = payload.email;
}

// Build final merge request
const mergeBody = {
  // Explicitly tell Ortto to merge by person_id
  merge_by: "person_id",
  people: [mergePerson],
};

let orttoResult;
try {
  const resp = await fetch(mergeUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": process.env.ORTTO_API_KEY,
    },
    body: JSON.stringify(mergeBody),
  });

  const text = await resp.text();

  if (!resp.ok) {
    console.error("Ortto merge failed", resp.status, text);
    orttoResult = { ok: false, status: resp.status, body: text };
  } else {
    console.log("Ortto merge success", text);
    orttoResult = { ok: true, status: resp.status, body: text };
  }
} catch (err) {
  console.error("Ortto merge exception", err);
  orttoResult = { ok: false, exception: err.toString() };
}

  const resp = await fetch(mergeUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": orttoKey,
    },
    body: JSON.stringify(mergeBody),
  });

  const text = await resp.text();
  console.log("Ortto response:", text);

  return res.status(200).json({
    contact_id: contactId,
    country: countryName,
    ortto_status: resp.status,
  });
};
