/** A web component with an open shadow root, to show the inspector reaching inside one. */
class AcmeNewsletter extends HTMLElement {
  connectedCallback() {
    if (this.shadowRoot) return;
    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>
        :host { display: block; margin: 0 2rem; padding: 1.5rem; border-radius: 12px;
          background: var(--surface, #fff); border: 1px solid #e2e8f0; }
        h3 { margin: 0 0 0.75rem; font: 600 1.1rem/1.3 system-ui, sans-serif; }
        form { display: flex; gap: 0.5rem; }
        input { flex: 1; padding: 0.5rem 0.75rem; border: 1px solid #cbd5e1; border-radius: 8px; }
        button { padding: 0.5rem 1rem; border: 0; border-radius: 8px; background: #4f46e5;
          color: #fff; font-weight: 600; }
      </style>
      <h3>Get product updates</h3>
      <form>
        <input type="email" placeholder="you@example.com" aria-label="Email" />
        <button type="submit" class="subscribe">Subscribe</button>
      </form>`;
    root.querySelector("form")?.addEventListener("submit", (e) => e.preventDefault());
  }
}

if (!customElements.get("acme-newsletter"))
  customElements.define("acme-newsletter", AcmeNewsletter);
