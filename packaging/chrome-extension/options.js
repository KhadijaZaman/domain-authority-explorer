const input = document.getElementById("baseUrl");
chrome.storage.sync.get("baseUrl").then(({ baseUrl }) => {
  if (baseUrl) input.value = baseUrl;
});
document.getElementById("save").addEventListener("click", async () => {
  await chrome.storage.sync.set({ baseUrl: input.value.trim().replace(/\/+$/, "") });
  document.getElementById("saved").textContent = "Saved.";
  setTimeout(() => (document.getElementById("saved").textContent = ""), 2000);
});
