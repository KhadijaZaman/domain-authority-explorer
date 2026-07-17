function normalizeDomain(input) {
  let d = (input || "").trim().toLowerCase();
  d = d.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  d = d.split("/")[0].split("?")[0];
  d = d.replace(/^[^@]*@/, "");
  d = d.split(":")[0];
  d = d.replace(/^www\./, "");
  return d;
}

async function getBaseUrl() {
  const { baseUrl } = await chrome.storage.sync.get("baseUrl");
  return (baseUrl || "").replace(/\/+$/, "");
}

function render(html) {
  document.getElementById("main").innerHTML = html;
}

(async () => {
  const baseUrl = await getBaseUrl();
  if (!baseUrl) {
    render(
      '<p class="status">No app URL configured yet. Open <b>Settings</b> and paste the URL of your Domain Authority Explorer deployment.</p>',
    );
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const domain = normalizeDomain(tab && tab.url ? tab.url : "");
  if (!domain || !domain.includes(".")) {
    render('<p class="status">This page has no domain to check.</p>');
    return;
  }

  document.getElementById("open-app").href =
    baseUrl + "/?d=" + encodeURIComponent(domain);

  try {
    const res = await fetch(
      baseUrl + "/api/domain/" + encodeURIComponent(domain),
    );
    if (res.status === 404) {
      render(
        '<div class="domain">' +
          domain +
          '</div><p class="status">Not found in the latest Common Crawl web graph. Usually means the domain is very new, very small, or blocks crawling.</p>',
      );
      return;
    }
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    render(
      '<div class="domain">' +
        domain +
        '</div><div class="scores">' +
        '<div class="card"><div class="label">Authority</div><div class="value">' +
        data.authorityScore.toFixed(1) +
        '</div><div class="rank">#' +
        data.authorityRank.toLocaleString() +
        '</div></div>' +
        '<div class="card"><div class="label">Popularity</div><div class="value">' +
        data.popularityScore.toFixed(1) +
        '</div><div class="rank">#' +
        data.popularityRank.toLocaleString() +
        "</div></div></div>" +
        '<p class="status" style="margin-top:10px">Release: ' +
        data.releaseName +
        "</p>",
    );
  } catch (err) {
    render(
      '<p class="status error">Could not reach the app (' +
        err.message +
        "). Check the URL in Settings and that the app is published.</p>",
    );
  }
})();
