/**
 * Build the Sophos XML POST body.
 *
 * The XG XML API embeds credentials in EVERY request (no token, no
 * session). Multiple `<Get>` blocks per request are allowed — this
 * lets us fetch firmware + license in one round-trip.
 *
 * Critical: usernames/passwords with XML-meta-characters MUST be
 * escaped, otherwise `<` in a password breaks parsing.
 *
 * @module @domains/msp-bridges/sophos/xml-builder
 */

const XML_ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
};

export function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => XML_ENTITIES[c] ?? c);
}

export interface GetRequestOpts {
  readonly username: string;
  readonly password: string;
  /** XML tag-names to GET (e.g. ['Firmware', 'LicenseInformation']). */
  readonly getTags: readonly string[];
}

export function buildGetRequest(opts: GetRequestOpts): string {
  const gets = opts.getTags.map((t) => `<Get><${t}></${t}></Get>`).join('');
  return (
    `<Request>` +
    `<Login><Username>${escapeXml(opts.username)}</Username>` +
    `<Password>${escapeXml(opts.password)}</Password></Login>` +
    gets +
    `</Request>`
  );
}
