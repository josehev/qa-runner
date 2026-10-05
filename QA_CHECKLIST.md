# Pre-Production QA & Accessibility Checklist

A comprehensive checklist for validating web applications/websites before release. Organized by pillar, with verification criteria for each item.

---

## 1. Accessibility (WCAG 2.1 / 2.0 AA Compliance)

### Keyboard Navigation & Focus
- [ ] All interactive elements (links, buttons, inputs, dropdowns, modals) are reachable via `Tab`/`Shift+Tab`.
  - **How to Test:** Unplug mouse; navigate entire page using only keyboard. Confirm logical tab order matches visual/DOM order.
- [ ] Visible focus indicator on every focusable element (no `outline: none` without replacement).
  - **Criteria:** Focus ring has ≥3:1 contrast against adjacent colors (WCAG 2.4.11/2.4.7).
- [ ] No keyboard traps (e.g., modal that can't be exited with `Esc` or `Tab`).
- [ ] Skip-to-content link present and functional for screen reader/keyboard users.
- [ ] Custom widgets (tabs, accordions, sliders) support expected keys (Arrow keys, `Enter`, `Space`, `Esc`) per ARIA Authoring Practices.

### Screen Reader Compatibility
- [ ] All images have meaningful `alt` text; decorative images use `alt=""`.
  - **How to Test:** Run NVDA/VoiceOver/JAWS; confirm no "unlabeled image" or redundant file-name reads.
- [ ] ARIA landmarks (`banner`, `navigation`, `main`, `contentinfo`) present and uniquely labeled.
- [ ] ARIA attributes (`aria-label`, `aria-labelledby`, `aria-describedby`, `aria-live`) used correctly and not conflicting with native semantics.
- [ ] Dynamic content updates (toasts, live search results) announced via `aria-live="polite"` or `assertive`.
- [ ] Icon-only buttons have accessible names (`aria-label` or visually hidden text).

### Color Contrast
- [ ] Standard text meets ≥4.5:1 contrast ratio against background.
- [ ] Large text (≥18pt / 14pt bold) meets ≥3:1 contrast ratio.
  - **How to Test:** Use axe DevTools, WAVE, or Chrome Lighthouse contrast checker on all text/background combinations, including hover/disabled states.
- [ ] UI components (input borders, icons conveying meaning) meet ≥3:1 contrast against adjacent colors (WCAG 1.4.11).
- [ ] Information is not conveyed by color alone (e.g., error fields also have icon/text).

### Forms & Error Messaging
- [ ] Every input has a programmatically associated `<label>` (not placeholder-only).
- [ ] Required fields indicated both visually and via `aria-required`/`required`.
- [ ] Error messages are descriptive, associated with the field (`aria-describedby`), and announced to screen readers.
  - **Criteria:** Error text explains *what* is wrong and *how* to fix it (not just "Invalid input").
- [ ] Focus moves to first error field on failed submission.
- [ ] Autocomplete attributes (`autocomplete="email"`, etc.) set for common fields.

---

## 2. Design, UI & Responsive Viewports

### Cross-Device Viewport Testing
- [ ] Desktop (1920px+): Layout scales correctly, no excessive whitespace or stretched elements.
- [ ] Laptop (1366px): No horizontal scroll, nav/menu renders correctly.
- [ ] Tablet (768px): Touch targets ≥44x44px, layout reflows without overlap.
- [ ] Mobile (375px): Hamburger menu functions, text remains readable without zoom, no content cut off.
  - **How to Test:** Use Chrome DevTools device toolbar + at least one real device (iOS/Android) per breakpoint.

### Layout & Visual Consistency
- [ ] Consistent padding/margin spacing per design system (use browser inspector to verify spacing tokens).
- [ ] Typography (font family, weight, size, line-height) consistent across pages/components.
- [ ] No unexpected layout shifts (CLS) during page load.
  - **How to Test:** Run Lighthouse/PageSpeed Insights; CLS score should be <0.1.
- [ ] Images/videos maintain correct aspect ratio at all breakpoints (no stretching/squishing).
- [ ] Sticky headers/footers don't overlap content or obscure focus on scroll.

### Dark Mode / Light Mode
- [ ] Toggle switches themes instantly without requiring refresh.
- [ ] All text maintains contrast compliance in both modes.
- [ ] Icons, borders, and images (e.g., logos) have appropriate variants for each theme (no invisible dark-on-dark icons).
- [ ] Theme preference persists across page reloads/sessions (localStorage or user setting).

---

## 3. Links, Media & Asset Integrity

### Link Sweep
- [ ] Zero broken internal links (404s) across all pages, including nav, footer, and legal (Privacy Policy, Terms of Service).
  - **How to Test:** Run automated crawler (Screaming Frog, Dead Link Checker, or `linkinator`) across full sitemap.
- [ ] All external links open correctly and point to intended destination (no stale/redirected URLs).
- [ ] Anchor links (`#section`) scroll to correct section on all breakpoints.
- [ ] Mailto/tel links trigger correct native app behavior.

### Image & Media Rendering
- [ ] No broken images (missing `src`, 404 image assets).
- [ ] Fallback/placeholder images display if primary asset fails to load.
- [ ] All images render at correct aspect ratio without distortion across breakpoints.
- [ ] Video/audio embeds have captions/transcripts where required and don't autoplay with sound.

### Performance & Optimization
- [ ] Images use modern formats (WebP/AVIF) or SVG for icons/logos where applicable.
- [ ] Lazy loading (`loading="lazy"`) applied to below-the-fold images.
- [ ] Image file sizes optimized (no unnecessarily large uncompressed assets).
  - **How to Test:** Lighthouse "Properly size images" and "Serve images in next-gen formats" audits should pass.

---

## 4. JavaScript Functionality & Console Health

### Console & Error Monitoring
- [ ] Zero unhandled JavaScript errors in console during standard user flows (home → navigation → forms → checkout, etc.).
- [ ] No critical warnings (deprecated APIs, CORS issues, mixed content) logged.
  - **How to Test:** Open DevTools Console on every major page/flow; document and triage any red errors.
- [ ] Network tab shows no failed (4xx/5xx) API/asset requests during normal usage.

### Interactive Elements
- [ ] All click/tap event listeners fire as expected (buttons, cards, CTAs).
- [ ] Dropdowns/menus open, close, and close-on-outside-click correctly.
- [ ] Modals trap focus appropriately, close via `Esc`/close button, and restore focus to trigger element on close.
- [ ] Toggles (accordions, tabs, switches) reflect correct state visually and in ARIA attributes (`aria-expanded`).

### Form Handling
- [ ] Client-side validation triggers correctly for required/format-specific fields (email, phone, password strength).
- [ ] Submit button shows loading state (spinner/disabled) to prevent duplicate submissions.
- [ ] Success feedback (toast, redirect, confirmation message) displays after valid submission.
- [ ] Error feedback displays clearly for failed submissions (network failure, server validation errors).
- [ ] Form data persists appropriately on validation failure (user doesn't lose entered input).

---

## 5. General Core Functionality & Edge Cases

### Critical User Journeys
- [ ] Authentication: sign-up, login, logout, password reset, and session expiration all function correctly.
- [ ] Checkout/payment flow (if applicable): cart updates, discount codes, payment processing, order confirmation.
- [ ] Search: returns relevant results, handles empty states, and "no results found" messaging.
- [ ] Filtering/sorting: applies and clears correctly, updates URL params/state as expected.

### State Management
- [ ] Page refresh preserves expected state (logged-in session, cart contents, form progress where applicable).
- [ ] Browser back/forward buttons navigate correctly without breaking app state or causing duplicate submissions.
- [ ] Session timeout behavior: user is warned and/or gracefully redirected to login without data loss.
- [ ] Deep links (direct URL to internal page) load correctly without requiring navigation from home.

### Input Edge Cases
- [ ] SQL injection attempts (`' OR 1=1 --`, etc.) are safely sanitized/rejected, not executed.
- [ ] XSS attempts (`<script>alert(1)</script>`) are escaped/sanitized, not rendered as executable code.
- [ ] Extremely long strings (1000+ characters) don't break layout or crash the input.
- [ ] Special characters and emojis (e.g., `é, ñ, 中文, 🚀`) are accepted and rendered correctly where valid.
- [ ] Empty/whitespace-only submissions are rejected with appropriate validation messaging.

---

## 6. Content, Copy & Grammar

### Proofreading
- [ ] All page copy reviewed for grammar, spelling, and punctuation errors.
- [ ] Formatting consistency (capitalization style, Oxford comma usage, date/number formats) across all pages.
  - **How to Test:** Run copy through Grammarly/LanguageTool, then manual review per style guide.

### Microcopy
- [ ] Button labels are clear, action-oriented, and consistent (e.g., "Submit" vs "Send" used consistently).
- [ ] Tooltips display correctly on hover/focus and contain accurate, concise information.
- [ ] Toast notifications and dynamic error/success text are grammatically correct and user-friendly.

### Placeholder & Dynamic Data
- [ ] No Lorem Ipsum or placeholder text remains in production content.
- [ ] Dynamic placeholders (`{first_name}`, `{{variable}}`) render actual data in all scenarios, with fallback text for missing data.
- [ ] No hardcoded test/dummy data (e.g., "Test User", "asdf@test.com") visible in production.

---

## 7. Frontend & Coding Best Practices

### Semantic HTML & Structure
- [ ] Page uses semantic landmarks: `<header>`, `<nav>`, `<main>`, `<footer>`.
- [ ] Heading hierarchy is logical and sequential (single `H1` per page, no skipped levels like H2 → H4).
  - **How to Test:** Use browser extension (HeadingsMap) to visualize heading outline.
- [ ] Lists use `<ul>`/`<ol>`/`<li>`; tables use proper `<th>`/`<td>` with scope attributes.

### SEO Metadata
- [ ] Unique, descriptive `<title>` tag on every page (50-60 characters).
- [ ] `<meta name="description">` present and unique per page (150-160 characters).
- [ ] Open Graph (`og:title`, `og:description`, `og:image`) and Twitter Card tags present for social sharing.
- [ ] Canonical URLs set to prevent duplicate content issues.
- [ ] `robots.txt` and `sitemap.xml` present and correctly configured.

### Security Basics
- [ ] HTTPS enforced site-wide (HTTP requests redirect to HTTPS, no mixed-content warnings).
- [ ] External links using `target="_blank"` include `rel="noopener noreferrer"`.
- [ ] Sensitive actions (login, payment) protected against CSRF; cookies use `Secure`/`HttpOnly`/`SameSite` flags.
- [ ] No sensitive data (API keys, tokens) exposed in client-side source or console logs.
- [ ] Content Security Policy (CSP) headers configured appropriately.

---

## Sign-Off

| Category | Tester | Status | Notes |
|---|---|---|---|
| Accessibility | | ☐ Pass ☐ Fail | |
| Design & Responsive | | ☐ Pass ☐ Fail | |
| Links & Media | | ☐ Pass ☐ Fail | |
| JS Functionality | | ☐ Pass ☐ Fail | |
| Core Functionality | | ☐ Pass ☐ Fail | |
| Content & Copy | | ☐ Pass ☐ Fail | |
| Frontend Best Practices | | ☐ Pass ☐ Fail | |

**Final Release Approval:** ☐ Approved ☐ Blocked (see notes above)
