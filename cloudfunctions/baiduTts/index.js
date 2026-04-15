const https = require("https");
const querystring = require("querystring");
const crypto = require("crypto");

const BAIDU_TOKEN_URL = "https://aip.baidubce.com/oauth/2.0/token";
const BAIDU_TTS_URL = "https://tsn.baidu.com/text2audio";

let tokenCache = {
  value: "",
  expiresAt: 0,
};

function getRequiredEnv(name) {
  const value = process.env[name];
  console.log(`Checking environment variable ${name}:`, value ? "Set" : "Not set");
  if (!value) {
    console.error(`${name} is not configured`);
    throw new Error(`${name} is not configured`);
  }
  return value;
}

function requestBuffer(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      const chunks = [];
      res.on("data", (chunk) => {
        chunks.push(chunk);
      });
      res.on("end", () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers || {},
          body: Buffer.concat(chunks),
        });
      });
    });

    req.on("error", reject);

    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

async function getAccessToken() {
  if (tokenCache.value && tokenCache.expiresAt > Date.now()) {
    console.log("Using cached access token");
    return tokenCache.value;
  }

  try {
    // 直接检查环境变量，不使用getRequiredEnv函数，以避免可能的名称问题
    const apiKey = process.env.BAIDU_TTS_API_KEY;
    const secretKey = process.env.BAIDU_TTS_SECRET_KEY;
    const appId = process.env.BAIDU_TTS_APP_ID;
    
    console.log("All environment variables:", process.env);
    console.log("BAIDU_TTS_API_KEY:", apiKey ? "Set" : "Not set");
    console.log("BAIDU_TTS_SECRET_KEY:", secretKey ? "Set" : "Not set");
    console.log("BAIDU_TTS_APP_ID:", appId ? "Set" : "Not set");

    if (!apiKey || !secretKey) {
      throw new Error("API key or secret key not configured");
    }

    const query = querystring.stringify({
      grant_type: "client_credentials",
      client_id: apiKey,
      client_secret: secretKey,
    });
    console.log("Request URL:", `${BAIDU_TOKEN_URL}?${query}`);
    console.log("Requesting access token from Baidu API");
    
    const response = await requestBuffer(`${BAIDU_TOKEN_URL}?${query}`, {
      method: "POST",
    });
    
    console.log("Baidu API response status code:", response.statusCode);
    console.log("Baidu API response headers:", response.headers);
    
    const responseBody = response.body.toString("utf8");
    console.log("Baidu API response body:", responseBody);
    
    const result = JSON.parse(responseBody || "{}");
    console.log("Parsed Baidu API response:", result);

    if (!result.access_token) {
      throw new Error(result.error_description || result.error || "failed to get baidu access token");
    }

    tokenCache = {
      value: result.access_token,
      expiresAt: Date.now() + Math.max((result.expires_in || 0) - 300, 300) * 1000,
    };
    console.log("Access token obtained successfully");

    return tokenCache.value;
  } catch (err) {
    console.error("Error getting access token:", err);
    throw err;
  }
}

function resolvePerson(voiceGender) {
  return voiceGender === "male" ? 1 : 0;
}

function normalizeSpeed(speed) {
  if (!Number.isFinite(Number(speed))) {
    return 5;
  }
  return Math.max(0, Math.min(15, Math.round(Number(speed))));
}

function buildHash(text, voiceGender, speed) {
  return crypto
    .createHash("md5")
    .update(`${voiceGender}|${speed}|${text}`)
    .digest("hex");
}

async function synthesizeSpeech(text, voiceGender, speed) {
  const hash = buildHash(text, voiceGender, speed);
  const token = await getAccessToken();
  const payload = querystring.stringify({
    tex: encodeURIComponent(text),
    tok: token,
    cuid: process.env.BAIDU_TTS_APP_ID || "miniprogram-baidu-tts",
    ctp: 1,
    lan: "zh",
    spd: normalizeSpeed(speed),
    pit: 5,
    vol: 5,
    per: resolvePerson(voiceGender),
    aue: 3,
  });

  const response = await requestBuffer(BAIDU_TTS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Content-Length": Buffer.byteLength(payload),
    },
    body: payload,
  });

  const contentType = String(response.headers["content-type"] || "");
  if (!contentType.includes("audio")) {
    const result = JSON.parse(response.body.toString("utf8") || "{}");
    throw new Error(result.err_msg || "baidu tts synthesize failed");
  }

  return {
    hash,
    audioBase64: response.body.toString("base64"),
    audioFormat: "mp3",
  };
}

exports.main = async (event) => {
  try {
    if (event.type === "getAccessToken") {
      const accessToken = await getAccessToken();
      return {
        success: true,
        accessToken,
        expiresAt: tokenCache.expiresAt,
      };
    }

    if (event.type !== "synthesize") {
      return {
        success: false,
        error: "unsupported type",
      };
    }

    const text = String(event.text || "").trim();
    if (!text) {
      return {
        success: false,
        error: "text is required",
      };
    }

    const result = await synthesizeSpeech(
      text,
      event.voiceGender === "male" ? "male" : "female",
      event.speed
    );

    return {
      success: true,
      ...result,
    };
  } catch (err) {
    return {
      success: false,
      error: err.message || "baidu tts failed",
    };
  }
};
