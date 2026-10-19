const VERSION = "1.0.0";

const GROUPS = [
  { id: "A", title: "1. Accessibility (WCAG 2.0/2.1 AA)", subgroups: [
    "Keyboard navigation & focus", "Screen reader, ARIA, landmarks", "Alt text",
    "Color contrast", "Form labeling & error messaging",
  ] },
  { id: "B", title: "2. Design, UI & Responsive" },
  { id: "C", title: "3. Links, Media & Assets" },
  { id: "D", title: "4. JavaScript & Console Health" },
  { id: "E", title: "5. Core Functionality & Edge Cases" },
  { id: "F", title: "6. Content, Copy & Grammar" },
  { id: "G", title: "7. Frontend & Coding Best Practices" },
];

const VIEWPORTS = [
  { name: "desktop1920", width: 1920, height: 1080, screenshot: "shot-desktop1920.png" },
  { name: "laptop1366", width: 1366, height: 768, screenshot: "shot-laptop1366.png" },
  { name: "tablet768", width: 768, height: 1024, screenshot: "shot-tablet768.png" },
  { name: "mobile375", width: 375, height: 812, screenshot: "shot-mobile375.png" },
];

const check = (id, group, name, how, criteria, extra = {}) => ({ id, group, name, how, criteria, ...extra });
const CHECKLIST = [
  check("load", "E", "Page loads at every viewport", "Navigate with Chromium and record document status and final URL", "Every required viewport returns a successful document and DOM evidence"),
  check("runtime", "D", "Console and uncaught errors", "Listen from before navigation through bounded scrolling", "No browser console errors or uncaught exceptions"),
  check("warnings", "D", "Console warnings", "Listen for browser console warnings at all viewports during load and scroll", "Warnings reviewed in application context"),
  check("network", "C", "Network failures", "Record real browser responses and request failures during load and scroll", "No failed requests or HTTP error responses"),
  check("images", "C", "Images load", "Inspect decoded image sizes after bounded scroll at every viewport", "All visible completed images have nonzero natural dimensions"),
  check("media", "C", "Embedded media inventory", "Inspect rendered audio/video/source/frame/object states and errors without autoplay interaction", "No observed media errors; actual playback remains manual"),
  check("screenshots", "B", "Required viewport screenshots", "Capture full-page PNGs at exact contracted sizes", "All required viewport artifacts exist"),
  check("overflow", "B", "Horizontal overflow", "Compare document scrollWidth and viewport width at every viewport", "Document width does not exceed viewport by more than 2px"),
  check("visual", "B", "Visual fidelity and clipping", "Compare screenshots against approved design and inspect clipped/overlapping content", "No unintended overlap, truncation, broken alignment or unreadable content", { manual: true, reason: "No approved design reference or human visual assessment performed" }),
  check("theme", "B", "Light and dark preference", "Emulate both color preferences in desktop Chromium and retain computed colors and screenshots", "Theme states remain readable; visual judgment remains manual"),
  check("menu", "D", "Safe navigation menu response", "Click only enabled non-form menu toggles controlling a navigation/menu element and restore state", "Expanded state and controlled navigation visibility respond"),
  check("axe", "A", "Automated accessibility audit", "Execute installed axe-core in desktop Chromium with exact WCAG 2.0/2.1 A/AA and best-practice tags", "No WCAG violations; best practices/incomplete rules remain REVIEW", { subgroup: "Screen reader, ARIA, landmarks" }),
  check("contrast", "A", "Desktop color contrast", "Retain full axe color-contrast violations, passes and incomplete nodes", "Measured text contrast meets applicable axe thresholds; unresolved cases remain REVIEW", { subgroup: "Color contrast" }),
  check("keyboard", "A", "Keyboard traversal", "Record 40 real Tab steps plus Shift+Tab without activation", "Reachability measured; logical order and traps require human interpretation", { subgroup: "Keyboard navigation & focus" }),
  check("skip", "A", "Skip-link navigation", "Inventory same-document skip targets and activate only a validated in-page skip link with Enter", "Skip target exists and focus/fragment movement observed", { subgroup: "Keyboard navigation & focus" }),
  check("tabindex", "A", "No positive tabindex", "Inventory positive tabindex values with live visibility and selectors", "No visible positive tabindex", { subgroup: "Keyboard navigation & focus" }),
  check("focus", "A", "Focus visibility", "Record active-element rectangle, focus-visible, outline, shadow and a focus screenshot", "Focus indicator can be identified and is not hidden", { subgroup: "Keyboard navigation & focus" }),
  check("language", "A", "Document language", "Read live documentElement.lang", "A document language is provided", { subgroup: "Screen reader, ARIA, landmarks" }),
  check("headings", "G", "Visible heading hierarchy", "Inventory visible and hidden headings separately and inspect level progression", "One visible h1 and no skipped levels; editorial context reviewed"),
  check("landmarks", "A", "Landmark structure", "Inventory live main/navigation/header/footer landmarks", "One visible main landmark", { subgroup: "Screen reader, ARIA, landmarks" }),
  check("landmark-content", "A", "Outside-landmark content", "Count visible text outside semantic/ARIA landmarks", "Best-practice coverage reviewed in context", { subgroup: "Screen reader, ARIA, landmarks" }),
  check("lists", "A", "List nesting semantics", "Find direct ul/ol children that are not li or allowed script/template", "No directly nested lists outside li", { subgroup: "Screen reader, ARIA, landmarks" }),
  check("duplicate-ids", "A", "Duplicate ID inventory", "Count duplicate IDs and their selectors, correlating axe/ARIA evidence", "No ambiguous referenced IDs; parsing observations are contextual", { subgroup: "Screen reader, ARIA, landmarks" }),
  check("live-regions", "A", "Live-region inventory", "Count live/status/alert regions and their states", "Presence recorded; actual announcements remain NOT TESTED", { subgroup: "Screen reader, ARIA, landmarks" }),
  check("accessible-names", "A", "Button and link accessible names", "Retain axe name/label rules and live button name-source counts", "No measured accessible-name failures", { subgroup: "Screen reader, ARIA, landmarks" }),
  check("frames", "A", "Frame titles", "Inventory iframe/frame title and source attributes with axe evidence", "Frames have meaningful accessible names", { subgroup: "Screen reader, ARIA, landmarks" }),
  check("alt", "A", "Image alternatives", "Read image alt attributes from rendered DOM", "Every image has an alt attribute; suitability is manual", { subgroup: "Alt text" }),
  check("alt-context", "A", "Decorative, descriptive and linked image context", "Inventory all image alt/role/link/dimension observations", "Human review distinguishes decorative images and informative/linked logos", { subgroup: "Alt text" }),
  check("aria", "A", "ARIA references and semantics", "Inventory live roles, aria attributes and ID reference targets; correlate full axe results", "ARIA references resolve and automated role/state/name checks pass", { subgroup: "Screen reader, ARIA, landmarks" }),
  check("labels", "A", "Form control labels", "Read live visible enabled control labels and ARIA name sources; retain axe accessible-name rules", "Every applicable control has an accessible name", { subgroup: "Form labeling & error messaging" }),
  check("form-errors", "A", "Accessible validation and error announcements", "Exercise an approved safe validation flow and verify association/announcements", "Errors are associated, clear and announced by assistive technology", { subgroup: "Form labeling & error messaging", manual: true, reason: "No form submission or real assistive-technology error-announcement testing authorized" }),
  check("screen-reader", "A", "Real screen-reader testing", "Use real VoiceOver/NVDA with a human test flow", "Names, roles, states, live announcements, reading order and tab semantics work", { subgroup: "Screen reader, ARIA, landmarks", manual: true, reason: "No VoiceOver/NVDA operated; real reading order/live announcements/tab semantics are NOT TESTED. Axe/DOM inspection is not screen-reader testing" }),
  check("zoom", "A", "Zoom and text-spacing usability", "Apply browser zoom and WCAG text-spacing adjustments and inspect the complete UI", "Content and functionality remain available", { subgroup: "Keyboard navigation & focus", manual: true, reason: "No human zoom/text-spacing usability assessment performed" }),
  check("links", "C", "Unique link sweep", "Deduplicate links, reject malformed URLs, issue bounded HEAD and browser-confirm ambiguous failures", "No confirmed 404/410 or malformed URLs; 403/429 and uncertainty remain REVIEW"),
  check("external-links", "G", "New-window link inventory", "Read target and rel from live anchors", "Contextual review of external/new-window behavior"),
  check("forms", "E", "Form semantics and safe scope", "Inventory live control labels, required fields, types, autocomplete and form actions without submitting", "Controls have appropriate semantics; application validation remains untested"),
  check("widgets", "D", "Interactive widgets", "Inventory visible enabled menus, dialogs, tabs, details and search", "Absent/disabled components are NOT APPLICABLE; custom flows require safe approval"),
  check("modal-keyboard", "A", "Modal focus trap and Escape", "Inventory dialogs; exercise only an explicitly safe approved modal keyboard flow", "Focus trapping, restoration and Escape close verified or explicitly NOT TESTED", { subgroup: "Keyboard navigation & focus" }),
  check("mega-menu-keyboard", "A", "Mega-menu Enter, Space, Escape and arrows", "Inventory navigation/menu widgets separately from click evidence", "Exact keyboard keys exercised or explicitly NOT TESTED", { subgroup: "Keyboard navigation & focus" }),
  check("faq-keyboard", "A", "FAQ keyboard interaction", "Inventory details/FAQ components and distinguish keyboard behavior from DOM presence", "Actual keyboard expansion/collapse verified or explicitly NOT TESTED", { subgroup: "Keyboard navigation & focus" }),
  check("expand-all", "D", "FAQ Expand All", "Inventory enabled Expand All/Collapse All controls", "Behavior exercised or explicitly NOT TESTED"),
  check("language-dropdown", "D", "Language dropdown journey", "Inventory language/select/listbox components without changing account settings", "Journey exercised or explicitly NOT TESTED"),
  check("search-overlay", "D", "Search overlay journey", "Inventory search components without submitting user data", "Overlay behavior exercised or explicitly NOT TESTED"),
  check("login-modal", "D", "Login modal journey", "Inventory login/password components without authentication", "Modal journey exercised or explicitly NOT TESTED"),
  check("validation-states", "D", "Empty, invalid and valid validation states", "Inventory forms without submitting or authenticating", "Validation states exercised or explicitly NOT TESTED"),
  check("loading-success", "D", "Loading and success states", "Inventory busy/status/alert/progress components without triggering mutations", "Loading/success transitions exercised or explicitly NOT TESTED"),
  check("form-validation", "E", "Form validation and submission", "Use approved empty, invalid and valid input flows without modifying production data", "Validation and submission behavior matches product requirements", { manual: true, reason: "No authentication, form submission, payment, destructive action or data mutation authorized" }),
  check("cls", "B", "Early-session layout stability", "Observe layout shifts before target scripts, using 1s-gap/5s session windows through scroll", "Observed CLS <=0.1; unsupported APIs are NOT TESTED"),
  check("performance", "B", "Field performance", "Measure representative real-user Core Web Vitals with an approved performance methodology", "Product-specific field performance budgets satisfied", { manual: true, reason: "Bounded Chromium smoke timings are not field Core Web Vitals or a load test" }),
  check("copy", "F", "Rendered placeholder candidates", "Read visible text and locate bounded lorem ipsum/TODO/placeholder candidates", "Candidate text is reviewed for production suitability"),
  check("copy-observations", "F", "Headings, capitalization, spacing and duplicate copy", "Inventory rendered headings, repeated lines, double-space candidates and copyright strings", "Contextual editorial review; no old-year compliance rule inferred"),
  check("footer", "F", "Footer content inventory", "Read visible footer text and links", "Legal, copyright and contact copy meets product requirements"),
  check("copy-review", "F", "Copy and editorial quality", "Human review of grammar, spelling, instructions and content consistency", "Copy is accurate, clear and appropriate", { manual: true, reason: "Rendered copy is inventoried but no human editorial judgment performed" }),
  check("devices", "B", "Real device coverage", "Exercise actual supported mobile/tablet/desktop hardware", "Required device/browser matrix verified", { manual: true, reason: "Chromium viewport emulation is not real-device testing" }),
  check("auth", "E", "Login, MFA and session behavior", "Use approved credentials and authorization to exercise login/MFA/session flows", "Authentication and session requirements verified", { manual: true, reason: "No credentials, authentication or session-changing actions authorized" }),
  check("search-inputs", "E", "Search, long/emoji and intrusive inputs", "Exercise separately approved safe search/input journeys", "Application-specific input behavior verified", { manual: true, reason: "Search submissions, long/emoji and intrusive payloads are outside read-only smoke scope" }),
  check("history-session", "E", "Back, forward, refresh and session timeout", "Exercise an approved navigation/session journey without modifying production state", "History and session requirements verified", { manual: true, reason: "No application history/session-timeout journey authorized or exercised" }),
  check("alternate-content", "F", "Toast, error and alternate-language copy", "Trigger approved application states and inspect translated/error/status copy", "State-specific copy is accurate and consistent", { manual: true, reason: "No toast/error/alternate-language state journey exercised" }),
  check("title", "G", "Document title", "Read live document.title", "Nonempty title"),
  check("metadata", "G", "Metadata inventory", "Read live meta elements and canonical link", "Product-specific indexing and social metadata reviewed"),
  check("legacy-metadata", "G", "X-UA-Compatible observation", "Read legacy browser meta directives", "Contextual observation only, not a WCAG requirement"),
  check("image-practices", "C", "Image dimensions, responsive sources and formats", "Inventory intrinsic/rendered sizes, aspect ratios, width/height attributes, loading, srcset, sizes and formats", "Contextually appropriate assets; no lazy/WebP/AVIF-only failure rule"),
  check("active-navigation", "B", "Initial active anchor state", "Compare initial current/active anchor hrefs to the observed URL", "Mismatches reviewed with intended section/navigation semantics"),
  check("https", "G", "Transport security context", "Record actual protocol, secureContext and local-target scope", "Contextual transport assessment; local HTTP is not a production vulnerability"),
  check("mixed-content", "G", "Mixed-content sources", "Inventory HTTP resources on HTTPS documents and correlate network failures", "No unexpected insecure resources"),
  check("outbound-http", "G", "Insecure outbound link inventory", "Record resolved HTTP anchor destinations without activation", "Transport suitability assessed with destination context"),
  check("transport-probes", "E", "HTTP and HTTPS response observations", "Issue bounded read-only HEAD to protocol variants without following unsafe redirects", "Protocol/status/location/header observations retained; local preview excluded"),
  check("page-identity", "E", "Status, protocol, redirects and canonical identity", "Record actual navigation identity, final status/protocol/URL, headers and canonical", "Application-specific redirect/canonical expectations reviewed without additional state changes"),
  check("headers", "G", "Response-header inventory", "Record real navigation headers, redacting cookie values", "Policy suitability assessed with deployment context, not blanket vulnerability claims"),
  check("cookies", "G", "Cookie attribute inventory", "Record cookie names, domain/path, expiry and security flags without values", "Flags assessed with transport and application context"),
  check("security-testing", "G", "Active security testing", "Perform separately approved security testing", "Security requirements verified within authorized scope", { manual: true, reason: "No attack payloads, permission escalation, authentication bypass or state-changing security tests authorized" }),
];

const STATUSES = new Set(["PASS", "FAIL", "REVIEW", "NOT TESTED", "NOT APPLICABLE"]);
function completeChecks(results = [], { reason = "No collector measurement was produced" } = {}) {
  if (!Array.isArray(results)) throw new Error("Smoke results must be an array");
  const byId = new Map();
  for (const result of results) {
    if (!CHECKLIST.some((check) => check.id === result.id) || byId.has(result.id)) throw new Error(`Unknown or duplicate Smoke check: ${result.id}`);
    if (!STATUSES.has(result.status)) throw new Error(`Invalid Smoke status: ${result.status}`);
    byId.set(result.id, result);
  }
  return CHECKLIST.map((definition) => {
    const result = byId.get(definition.id);
    if (definition.manual) return { ...definition, status: "NOT TESTED", observed: "", detail: "", reason: definition.reason };
    return result ? { ...result, ...definition } : { ...definition, status: "NOT TESTED", observed: "", detail: "", reason };
  });
}

module.exports = { VERSION, GROUPS, CHECKLIST, VIEWPORTS, completeChecks };
