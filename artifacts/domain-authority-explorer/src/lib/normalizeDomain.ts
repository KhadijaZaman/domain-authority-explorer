/**
 * Normalize user input into a bare domain: strips scheme, path, query,
 * credentials, port, and a leading "www.". Mirrors the server-side
 * normalization so URLs pasted into the search box just work.
 */
export function normalizeDomain(input: string): string {
  let d = input.trim().toLowerCase();
  d = d.replace(/^[a-z][a-z0-9+.-]*:\/\//, ""); // scheme
  d = d.split("/")[0]?.split("?")[0] ?? "";
  d = d.replace(/^[^@]*@/, ""); // credentials
  d = d.split(":")[0] ?? ""; // port
  d = d.replace(/^www\./, "");
  d = d.replace(/\.+$/, ""); // trailing dot(s) in FQDN-style input
  return d;
}
