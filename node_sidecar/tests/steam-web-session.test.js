const assert = require("node:assert/strict");
const EventEmitter = require("node:events");
const path = require("node:path");

function stubHttpsRequest({responseJson}) {
  const https = require("https");
  const originalRequest = https.request;
  const requests = [];

  https.request = (options, callback) => {
    const req = new EventEmitter();
    req.body = "";
    req.write = (chunk) => {
      req.body += String(chunk || "");
    };
    req.end = () => {
      requests.push({
        options: {...options},
        body: req.body
      });
      const res = new EventEmitter();
      res.statusCode = 200;
      res.headers = {};
      process.nextTick(() => {
        callback(res);
        res.emit("data", JSON.stringify(responseJson));
        res.emit("end");
      });
    };
    req.setTimeout = () => {};
    req.destroy = () => {};
    return req;
  };

  return {
    requests,
    restore() {
      https.request = originalRequest;
    }
  };
}

function loadSteamWebSessionWithSteamSessionStub(stubExports) {
  const modulePath = path.resolve(__dirname, "../src/steamWebSession.js");
  const steamSessionPath = require.resolve("steam-session", {
    paths: [path.resolve(__dirname, "..")]
  });
  const originalSteamSession = require.cache[steamSessionPath];

  delete require.cache[modulePath];
  require.cache[steamSessionPath] = {
    id: steamSessionPath,
    filename: steamSessionPath,
    loaded: true,
    exports: stubExports
  };

  return {
    module: require(modulePath),
    restore() {
      delete require.cache[modulePath];
      if (originalSteamSession) {
        require.cache[steamSessionPath] = originalSteamSession;
      } else {
        delete require.cache[steamSessionPath];
      }
    }
  };
}

async function test_refresh_web_cookie_from_token_prefers_steam_session_and_enhances_cookie() {
  const httpsStub = stubHttpsRequest({
    responseJson: {
      response: {
        access_token: "fresh_access_token"
      }
    }
  });
  const sessionInstances = [];
  const sessionStub = loadSteamWebSessionWithSteamSessionStub({
    EAuthTokenPlatformType: {
      MobileApp: "mobile"
    },
    LoginSession: class FakeLoginSession {
      constructor(platformType) {
        this.platformType = platformType;
        this.refreshToken = "";
        this.accessToken = "";
        sessionInstances.push(this);
      }

      async getWebCookies() {
        return [
          "steamLoginSecure=upstream_cookie",
          "sessionid=upstream_session"
        ];
      }
    }
  });
  const {refreshWebCookieFromToken} = sessionStub.module;

  try {
    const result = await refreshWebCookieFromToken("refresh.jwt", "76561198000000000");

    assert.equal(sessionInstances.length, 1);
    assert.equal(sessionInstances[0].platformType, "mobile");
    assert.equal(sessionInstances[0].refreshToken, "refresh.jwt");
    assert.equal(sessionInstances[0].accessToken, "fresh_access_token");

    assert.equal(result.accessToken, "fresh_access_token");
    assert.equal(result.isFallbackCookie, false);
    assert.deepEqual(result.cookieArray, [
      "steamLoginSecure=upstream_cookie",
      "sessionid=upstream_session"
    ]);
    assert.equal(result.sessionid, "upstream_session");
    assert.equal(result.steamLoginSecure, "upstream_cookie");
    assert.match(result.cookieString, /steamLoginSecure=upstream_cookie/);
    assert.match(result.cookieString, /sessionid=upstream_session/);
    assert.match(result.cookieString, /steamCountry=CN%7C0/);
    assert.match(result.cookieString, /Steam_Language=schinese/);
    assert.match(result.cookieString, /timezoneOffset=28800,0/);
    assert.match(result.cookieString, /browserid=[0-9a-f]{16}/);

    assert.equal(httpsStub.requests.length, 1);
    assert.match(httpsStub.requests[0].body, /refresh_token=refresh\.jwt/);
    assert.match(httpsStub.requests[0].body, /steamid=76561198000000000/);
  } finally {
    sessionStub.restore();
    httpsStub.restore();
  }
}

async function test_refresh_web_cookie_from_token_falls_back_when_steam_session_fails() {
  const httpsStub = stubHttpsRequest({
    responseJson: {
      response: {
        access_token: "fresh_access_token"
      }
    }
  });
  const sessionStub = loadSteamWebSessionWithSteamSessionStub({
    EAuthTokenPlatformType: {
      MobileApp: "mobile"
    },
    LoginSession: class FakeLoginSession {
      async getWebCookies() {
        throw new Error("steam-session unavailable");
      }
    }
  });
  const {refreshWebCookieFromToken} = sessionStub.module;

  try {
    const result = await refreshWebCookieFromToken("refresh.jwt", "76561198000000000");

    assert.equal(result.accessToken, "fresh_access_token");
    assert.equal(result.isFallbackCookie, true);
    assert.equal(Array.isArray(result.cookieArray), true);
    assert.equal(result.cookieArray.length, 2);
    assert.match(result.cookieArray[0], /^steamLoginSecure=76561198000000000%7C%7Cfresh_access_token$/);
    assert.match(result.cookieArray[1], /^sessionid=[0-9a-f]{24}$/);
    assert.match(result.cookieString, /steamCountry=CN%7C0/);
    assert.match(result.cookieString, /Steam_Language=schinese/);
    assert.match(result.cookieString, /timezoneOffset=28800,0/);
    assert.match(result.cookieString, /browserid=[0-9a-f]{16}/);
    assert.match(result.cookieString, /sessionid=[0-9a-f]{24}/);
    assert.match(result.steamLoginSecure, /^76561198000000000%7C%7Cfresh_access_token$/);
  } finally {
    sessionStub.restore();
    httpsStub.restore();
  }
}

async function main() {
  await test_refresh_web_cookie_from_token_prefers_steam_session_and_enhances_cookie();
  await test_refresh_web_cookie_from_token_falls_back_when_steam_session_fails();
  console.log("steam-web-session tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
