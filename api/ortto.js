const DEFAULT_MODEL = "openai/gpt-4o-mini";
const COUNTRY_NAME_FIELD = "str:cm:country-of-residence";

// Parse JSON or URL-encoded body
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

function getFieldValue(payload, key) {
  if (!payload) return null;
  if (payload[key]) return payload[key];
  if (Array.isArray(payload.fields)) {
    for (const field of payload.fields) {
      if (field.field === key || field.key === key) return field.value;
    }
  }
  return null;
}

// Calls OpenRouter to get the country name from code
async function generateCountryName(countryCode) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not configured");

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.OPENROUTER_MODEL || DEFAULT_MODEL,
      messages: [
        { role: "system", content: "Return only the country name." },
        { role: "user", content: `Country code: ${countryCode}` },
      ],
    }),
  });

  const data = await response.json();
  const output = data?.choices?.[0]?.message?.content?.trim();
  if (!output) throw new Error("OpenRouter returned no content");

  return output;
}

module.exports = async function handler(req, res) {
  console.log("Ortto webhook received", {
    method: req.method,
    contentType: req.headers["content-type"],
  });

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const payload = parseBody(req);
  console.log("Parsed payload:", payload);

  const contactId = getFieldValue(payload, "contact_id");
  const countryCode =
    getFieldValue(payload, "country_of_residence_code") ||
    getFieldValue(payload, "str:cm:country-of-residence-code");

  if (!contactId || !countryCode) {
    return res.status(400).json({
      error: "Missing contact_id or country_of_residence_code",
    });
  }

  // Get the country name from OpenRouter
  let countryName;
  try {
    countryName = await generateCountryName(countryCode);
  } catch (err) {
    console.error("OpenRouter generation failed:", err);
    return res.status(500).json({ error: "OpenRouter failure" });
  }

  // Extract email if the webhook provided one
  const contactEmail =
    getFieldValue(payload, "email") ||
    getFieldValue(payload, "str:cm:email-secondary") ||
    getFieldValue(payload, "str::email");

  // Build the Ortto merge request
  const mergeUrl = "https://api.eu.ap3api.com/v1/person/merge";
  const mergePerson = {
    person_id: contactId,
    fields: {
      [COUNTRY_NAME_FIELD]: countryName,
    },
  };

  // Include both possible email field names for Ortto
  if (contactEmail) {
    mergePerson.fields["str::email"] = contactEmail;
    mergePerson.fields["str:cm:email-secondary"] = contactEmail;
  }

  const mergeBody = {
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
    console.error("Ortto merge exception:", err);
    orttoResult = { ok: false, exception: err.toString() };
  }

  return res.status(200).json({
    contact_id: contactId,
    country: countryName,
    ortto_update: orttoResult,
  });
};
