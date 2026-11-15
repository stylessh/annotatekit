import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { createStandaloneAuth } from "@annotatekit/auth";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SignedXml } from "xml-crypto";
import { saml } from "../src/index.js";

const SECRET = "test-secret-that-is-at-least-32-bytes-long";
const BASE = "https://ak.example.com/auth";
const CALLBACK = `${BASE}/okta/callback`;
const IDP = "http://www.okta.com/exk1";
const SP = "https://ak.example.com/saml";

interface KeyPair {
  key: string;
  cert: string;
}

let dir: string;
let idpKeys: KeyPair;
let otherKeys: KeyPair;

/** A throwaway self-signed certificate, so no key material lives in the repo. */
function selfSigned(name: string): KeyPair {
  const key = join(dir, `${name}.key`);
  const cert = join(dir, `${name}.crt`);
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-subj",
      `/CN=${name}`,
      "-days",
      "1",
      "-keyout",
      key,
      "-out",
      cert,
    ],
    { stdio: "ignore" },
  );
  return { key: readFileSync(key, "utf8"), cert: readFileSync(cert, "utf8") };
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "annotatekit-saml-"));
  idpKeys = selfSigned("idp");
  otherKeys = selfSigned("other");
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

function iso(offsetSeconds = 0): string {
  return new Date(Date.now() + offsetSeconds * 1000).toISOString();
}

interface AssertionInput {
  requestId: string;
  nameId?: string;
  audience?: string;
  attributes?: Record<string, string[]>;
  keys?: KeyPair;
  id?: string;
}

/** What an IdP POSTs back: a Response wrapping an assertion signed with `keys`. */
function samlResponse(input: AssertionInput): string {
  const attrs = Object.entries(input.attributes ?? {})
    .map(
      ([name, values]) =>
        `<saml:Attribute Name="${name}">${values.map((v) => `<saml:AttributeValue>${v}</saml:AttributeValue>`).join("")}</saml:Attribute>`,
    )
    .join("");
  const assertion = `<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${input.id ?? "_a1"}" Version="2.0" IssueInstant="${iso()}"><saml:Issuer>${IDP}</saml:Issuer><saml:Subject><saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">${input.nameId ?? "dana@acme.com"}</saml:NameID><saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData InResponseTo="${input.requestId}" NotOnOrAfter="${iso(300)}" Recipient="${CALLBACK}"/></saml:SubjectConfirmation></saml:Subject><saml:Conditions NotBefore="${iso(-60)}" NotOnOrAfter="${iso(300)}"><saml:AudienceRestriction><saml:Audience>${input.audience ?? SP}</saml:Audience></saml:AudienceRestriction></saml:Conditions><saml:AuthnStatement AuthnInstant="${iso()}" SessionIndex="_s1"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement><saml:AttributeStatement>${attrs}</saml:AttributeStatement></saml:Assertion>`;
  const xml = `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_r1" Version="2.0" IssueInstant="${iso()}" Destination="${CALLBACK}" InResponseTo="${input.requestId}"><saml:Issuer>${IDP}</saml:Issuer><samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>${assertion}</samlp:Response>`;

  const keys = input.keys ?? idpKeys;
  const sig = new SignedXml({
    privateKey: keys.key,
    publicCert: keys.cert,
    signatureAlgorithm: "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256",
    canonicalizationAlgorithm: "http://www.w3.org/2001/10/xml-exc-c14n#",
  });
  sig.addReference({
    xpath: "//*[local-name(.)='Assertion']",
    transforms: [
      "http://www.w3.org/2000/09/xmldsig#enveloped-signature",
      "http://www.w3.org/2001/10/xml-exc-c14n#",
    ],
    digestAlgorithm: "http://www.w3.org/2001/04/xmlenc#sha256",
  });
  sig.computeSignature(xml, {
    location: {
      reference: "//*[local-name(.)='Assertion']/*[local-name(.)='Issuer']",
      action: "after",
    },
  });
  return Buffer.from(sig.getSignedXml()).toString("base64");
}

function setup() {
  const provider = saml({
    id: "okta",
    entryPoint: "https://acme.okta.com/app/exk1/sso/saml",
    idpCert: idpKeys.cert,
    idpIssuer: IDP,
    spEntityId: SP,
    baseUrl: BASE,
  });
  const auth = createStandaloneAuth({
    providers: [provider],
    sessionSecret: SECRET,
    baseUrl: BASE,
    allowedOrigins: ["https://*.acme.com"],
  });

  async function login() {
    const res = await auth.handler(
      new Request(`${BASE}/okta/login?origin=${encodeURIComponent("https://app.acme.com")}`),
    );
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("location") as string);
    const request = inflateRawSync(
      Buffer.from(location.searchParams.get("SAMLRequest") as string, "base64"),
    ).toString("utf8");
    return {
      location,
      requestXml: request,
      requestId: /ID="([^"]+)"/.exec(request)?.[1] as string,
      relayState: location.searchParams.get("RelayState") as string,
      setCookie: res.headers.get("set-cookie") as string,
      cookie: (res.headers.get("set-cookie") as string).split(";")[0] as string,
    };
  }

  function callback(flow: { cookie: string; relayState: string }, response: string) {
    return auth.handler(
      new Request(CALLBACK, {
        method: "POST",
        headers: { cookie: flow.cookie, "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ SAMLResponse: response, RelayState: flow.relayState }),
      }),
    );
  }

  return { provider, auth, login, callback };
}

describe("saml()", () => {
  it("signs in end to end and issues a verifiable session", async () => {
    const { auth, login, callback } = setup();
    const flow = await login();
    expect(flow.location.origin + flow.location.pathname).toBe(
      "https://acme.okta.com/app/exk1/sso/saml",
    );
    expect(flow.requestXml).toContain(`AssertionConsumerServiceURL="${CALLBACK}"`);
    expect(flow.setCookie).toMatch(/SameSite=None; Secure/);

    const res = await callback(
      flow,
      samlResponse({
        requestId: flow.requestId,
        attributes: { displayName: ["Dana Scully"], groups: ["eng", "annotatekit-admins"] },
      }),
    );
    const html = await res.text();
    expect(html).toContain('"origin":"https://app.acme.com"');
    const token = /"token":"([^"]+)"/.exec(html)?.[1] as string;
    expect(token).toBeTruthy();

    const principal = await auth.verifier.verify(
      new Request("https://x", { headers: { authorization: `Bearer ${token}` } }),
    );
    expect(principal?.actor).toMatchObject({
      kind: "human",
      id: "okta|dana@acme.com",
      name: "Dana Scully",
      email: "dana@acme.com",
      emailVerified: true,
      provider: "saml:okta",
      groups: ["eng", "annotatekit-admins"],
    });
  });

  it("refuses a replayed response", async () => {
    const { login, callback } = setup();
    const flow = await login();
    const response = samlResponse({ requestId: flow.requestId });
    expect(await (await callback(flow, response)).text()).toContain('"token"');
    const again = await (await callback(flow, response)).text();
    expect(again).not.toContain('"token"');
    expect(again).toContain("Sign-in failed");
  });

  it("refuses assertions signed by another key, tampered, or for another audience", async () => {
    const { login, callback } = setup();

    const wrongKey = await login();
    const a = await callback(
      wrongKey,
      samlResponse({ requestId: wrongKey.requestId, keys: otherKeys }),
    );
    expect(await a.text()).toContain("Sign-in failed");

    const tampered = await login();
    const signed = Buffer.from(samlResponse({ requestId: tampered.requestId }), "base64")
      .toString("utf8")
      .replace(/dana@acme\.com/g, "admin@acme.com");
    const b = await callback(tampered, Buffer.from(signed).toString("base64"));
    expect(await b.text()).toContain("Sign-in failed");

    const audience = await login();
    const c = await callback(
      audience,
      samlResponse({ requestId: audience.requestId, audience: "https://someone-else" }),
    );
    expect(await c.text()).toContain("Sign-in failed");
  });

  it("refuses a response to a request it never sent", async () => {
    const { login, callback } = setup();
    const flow = await login();
    const res = await callback(flow, samlResponse({ requestId: "_unsolicited" }));
    expect(await res.text()).toContain("Sign-in failed");
  });

  it("refuses a mismatched RelayState and GET callbacks", async () => {
    const { auth, login, callback } = setup();
    const flow = await login();
    const res = await callback(
      { ...flow, relayState: "forged" },
      samlResponse({ requestId: flow.requestId }),
    );
    expect(await res.text()).not.toContain('"token"');

    const get = await auth.handler(
      new Request(`${CALLBACK}?SAMLResponse=x`, { headers: { cookie: flow.cookie } }),
    );
    expect(get.status).toBeGreaterThanOrEqual(400);
  });

  it("publishes SP metadata with the callback and entity id", () => {
    const { provider } = setup();
    const xml = provider.metadata();
    expect(provider.callbackUrl).toBe(CALLBACK);
    expect(xml).toContain(`entityID="${SP}"`);
    expect(xml).toContain(`Location="${CALLBACK}"`);
  });

  it("rejects ids that would break URLs", () => {
    expect(() =>
      saml({ id: "Okta/1", entryPoint: "x", idpCert: "x", spEntityId: SP, baseUrl: BASE }),
    ).toThrow();
  });
});
