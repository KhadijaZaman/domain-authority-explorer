/**
 * Domain Authority Explorer — Google Sheets custom functions.
 *
 * Install: Extensions > Apps Script, paste this file, set APP_URL below to
 * your published app URL, save. Then use in any cell:
 *
 *   =DOMAIN_AUTHORITY("example.com")        -> Authority Score (0-100)
 *   =DOMAIN_POPULARITY("example.com")       -> Popularity Score (0-100)
 *   =DOMAIN_AUTHORITY_FULL("example.com")   -> row: authority, popularity, authority rank, popularity rank, release
 *
 * Works on ranges too: =DOMAIN_AUTHORITY(A2:A50)
 */
var APP_URL = "https://your-app.replit.app"; // <-- change to your published app URL

function fetchDomain_(domain) {
  var d = String(domain || "")
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
    .split("/")[0]
    .split("?")[0]
    .replace(/^[^@]*@/, "")
    .split(":")[0]
    .replace(/^www\./, "");
  if (!d) return null;
  var res = UrlFetchApp.fetch(
    APP_URL.replace(/\/+$/, "") + "/api/domain/" + encodeURIComponent(d),
    { muteHttpExceptions: true },
  );
  if (res.getResponseCode() !== 200) return null;
  return JSON.parse(res.getContentText());
}

function mapInput_(input, fn) {
  if (Array.isArray(input)) {
    return input.map(function (row) {
      return (Array.isArray(row) ? row : [row]).map(fn);
    });
  }
  return fn(input);
}

/** @customfunction */
function DOMAIN_AUTHORITY(domain) {
  return mapInput_(domain, function (d) {
    var r = fetchDomain_(d);
    return r ? r.authorityScore : "NOT FOUND";
  });
}

/** @customfunction */
function DOMAIN_POPULARITY(domain) {
  return mapInput_(domain, function (d) {
    var r = fetchDomain_(d);
    return r ? r.popularityScore : "NOT FOUND";
  });
}

/** @customfunction */
function DOMAIN_AUTHORITY_FULL(domain) {
  var r = fetchDomain_(domain);
  if (!r) return [["NOT FOUND", "", "", "", ""]];
  return [[
    r.authorityScore,
    r.popularityScore,
    r.authorityRank,
    r.popularityRank,
    r.releaseName,
  ]];
}
