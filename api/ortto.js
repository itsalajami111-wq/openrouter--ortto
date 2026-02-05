const DEFAULT_MODEL = "openai/gpt-4o-mini";

const COUNTRY_CODE_FIELD = "str:cm:country-of-residence-code";
const PROMPT_FIELD = "str:cm:prompt";
const COUNTRY_NAME_FIELD = "str:cm:country-of-residence";
const CONTACT_ID_FIELD = "contact_id";

const COUNTRY_CODE_ALIASES = [
  COUNTRY_CODE_FIELD,
  "country_of_residence_code",
  "country_code",
  "country",
];

const PROMPT_ALIASES = [PROMPT_FIELD, "prompt"];

const CONTACT_ID_ALIASES = [
  CONTACT_ID_FIELD,
  "contactId",
  "str:cm:contact-id",
];

function parseBody(req) {
  if (!req.body) return null;

  if (Buffer.isBuffer(req.body)) {
    const text = req.body.toString("utf8").trim();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  if (typeof req.body === "object") return req.body;

  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return null;
    }
  }

  return null;
}

function getFieldValue(payload, fieldName) {
  if (!payload || typeof payload !== "object") return null;

  const direct = payload[fieldName];
  if (direct !== undefined && direct !== null && direct !== "") return direct;

  const nestedSources = [
    payload.fields,
    payload.data,
    payload.data?.fields,
    payload.attributes,
    payload.attributes?.fields,
  ];

  for (const source of nestedSources) {
    if (source && typeof source === "object") {
      const v = source[fieldName];
      if (v !== undefined && v !== null && v !== "") return v;
    }
  }

  return null;
}

function getFieldValueFromList(payload, fieldNames) {
  for (const name of fieldNames) {
    const value = getFieldValue(payload, name);
    if (value !== null && value !== undefined && value !== "") return value;
  }
  return null;
}

function extractFields(payload) {
  if (!payload || typeof payload !== "object") {
    return { countryCode: null, prompt: null, contactId: null };
  }

  return {
    countryCode: getFieldValueFromList(payload, COUNTRY_CODE_ALIASES),
    prompt: getFieldValueFromList(payload, PROMPT_ALIASES),
    contactId: getFieldValueFromList(payload, CONTACT_ID_ALIASES),
  };
}

async function updateOrttoContact({ contactId, countryName }) {
  const updateUrl = process.env.ORTTO_UPDATE_URL;
  const apiKey = process.env.ORTTO_API_KEY;

  // Optional: only run if configured
  if (!updateUrl || !apiKey) {
    console.log("Ortto update skipped (missing ORTTO_UPDATE_URL or ORTTO_API_KEY).");
    return { skipped: true };
  }

  console.log("Updating Ortto contact", { contactId });

  const resp = await fetch(updateUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contact_id: contactId,
      [COUNTRY_NAME_FIELD]: countryName,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Ortto update failed (${resp.status}): ${text}`);
  }

  try {
    return await resp.json();
  } catch {
    return {};
  }
}

module.exports = async function handler(req, res) {
  console.log("Ortto webhook received", {
    method: req.method,
    contentType: req.headers["content-type"],
    contentLength: req.headers["content-length"],
    userAgent: req.headers["user-agent"],
  });

  // Connection tests / browser hits
  if (req.method === "GET" || req.method === "HEAD") {
    res.setHeader("Allow", "POST");
    console.log("Connection test request received");
    if (req.method === "HEAD") return res.status(200).end();
    return res.status(200).json({ status: "ok" });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const payload = parseBody(req);

  if (!payload) {
    console.warn("Missing or invalid JSON body", { bodyType: typeof req.body });
    // Treat as test request so Ortto can connect
    return res.status(200).json({ status: "ok" });
  }

  console.log("Ortto payload keys", Object.keys(payload));

  const { countryCode, prompt, contactId } = extractFields(payload);

  // If Ortto sends an empty-ish test POST, don’t fail it
  const isEmptyTestRequest = !countryCode && !prompt && !contactId;
  if (isEmptyTestRequest) {
    console.log("Test POST detected (no fields). Returning 200.");
    return res.status(200).json({ status: "ok" });
  }

  // Require only the two fields needed for OpenRouter
  // contactId is useful, but not always present depending on Ortto test payload
  if (!countryCode || !prompt) {
    const missing = [];
    if (!countryCode) missing.push(COUNTRY_CODE_FIELD);
    if (!prompt) missing.push(PROMPT_FIELD);

    console.warn("Missing required fields", { missing, contactIdPresent: Boolean(contactId) });

    return res.status(400).json({
      error: "Missing required fields",
      required: [COUNTRY_CODE_FIELD, PROMPT_FIELD],
      missing,
    });
  }

  const openrouterKey = process.env.OPENROUTER_API_KEY;
  if (!openrouterKey) {
    return res.status(500).json({ error: "OPENROUTER_API_KEY is not configured" });
  }

  const model = process.env.OPENROUTER_MODEL || DEFAULT_MODEL;
  console.log("Calling OpenRouter", { model });

  const requestBody = {
    model,
    messages: [
      {
        role: "system",
        content:
          "You receive a country code and a prompt. Use the prompt instructions and interpret the country code as needed. Return only the final country name.",
      },
      {
        role: "user",
        content: `Prompt: ${prompt}\nCountry code: ${countryCode}`,
      },
    ],
  };

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openrouterKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("OpenRouter request failed", { status: response.status, details: errorText });
      return res.status(502).json({
        error: "OpenRouter request failed",
        status: response.status,
        details: errorText,
      });
    }

    const data = await response.json();
    const output = data?.choices?.[0]?.message?.content?.trim();

    if (!output) {
      console.error("OpenRouter returned empty content", { data });
      return res.status(502).json({ error: "OpenRouter returned no content" });
    }

    // Optional Ortto API update (only if env vars exist)
    let orttoUpdate = null;
    if (contactId) {
      try {
        orttoUpdate = await updateOrttoContact({ contactId, countryName: output });
      } catch (e) {
        console.error("Ortto update failed", e);
        // Don’t block returning the response to Ortto
        orttoUpdate = { error: e instanceof Error ? e.message : String(e) };
      }
    }

    return res.status(200).json({
      [COUNTRY_NAME_FIELD]: output,
      contact_id: contactId || null,
      ortto_update: orttoUpdate,
    });
  } catch (error) {
    console.error("Unexpected error", error);
    return res.status(500).json({
      error: "Unexpected error calling OpenRouter",
      details: error instanceof Error ? error.message : String(error),
    });
  }
};
