/* Free scan front-end — consumes POST /api/scan (functions/api/scan.js).
 *
 * RENDERING HARD RULES (docs/BOT_ARCHITECTURE.md, "what it must NOT do"):
 *  - NEVER render a checkmark, "passed", score, grade, or pass/fail indicator —
 *    per check or overall. A zero-findings check renders as a neutral
 *    "Checked: <what>" statement with its evidence. No valence, no green.
 *  - The NAP caveat renders verbatim. The cannotSee block renders on every
 *    successful scan — it IS the honest paywall.
 *  - All API-derived strings are inserted via textContent (never innerHTML):
 *    findings echo text scraped from arbitrary websites — treat as untrusted.
 */
(function () {
  "use strict";

  var form = document.getElementById("scan-form");
  var input = document.getElementById("scan-url");
  var submit = document.getElementById("scan-submit");
  var errorEl = document.getElementById("scan-error");
  var results = document.getElementById("scan-results");
  var optin = document.getElementById("email-optin");
  if (!form) return;

  var PRICE = results.getAttribute("data-price") || "$39";

  var CHECK_LABELS = {
    titleMeta: "title tags and meta description",
    schema: "LocalBusiness structured data",
    nap: "name, address, and phone consistency",
    counters: "placeholder or broken counters",
  };

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text; // textContent ALWAYS — untrusted strings
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function setBusy(busy) {
    submit.disabled = busy;
    submit.textContent = busy ? "Scanning…" : "Run the free scan";
    results.setAttribute("aria-busy", busy ? "true" : "false");
  }

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.hidden = false;
  }

  /* ---- renderers ---- */

  function renderCheck(key, check) {
    var wrap = el("div", "scan-check");
    wrap.appendChild(el("h3", "scan-check__name", "Checked: " + CHECK_LABELS[key]));

    // Neutral evidence lines — shown regardless of findings, so results stay checkable.
    var ev = el("ul", "scan-check__evidence");
    if (key === "titleMeta") {
      if (check.title && check.title.text) ev.appendChild(el("li", null, 'Title found: "' + check.title.text + '"'));
      ev.appendChild(el("li", null, "Title tags: " + check.title.count + " · Meta descriptions: " + check.metaDescription.count));
    }
    if (key === "schema") {
      ev.appendChild(el("li", null, "Structured-data blocks found: " + check.jsonLdBlocks + (check.types.length ? " (types: " + check.types.join(", ") + ")" : "")));
    }
    if (key === "nap") {
      ev.appendChild(el("li", null, "Phone numbers on this page: " + check.distinctPhones + (check.phonesFound.length ? " (" + check.phonesFound.join(", ") + ")" : "")));
      ev.appendChild(el("li", null, "Street addresses on this page: " + check.distinctAddresses + (check.addressesFound.length ? " (" + check.addressesFound.join("; ") + ")" : "")));
    }
    if (key === "counters" && check.matches.length) {
      ev.appendChild(el("li", null, "Counter text found: " + check.matches.join(", ")));
    }
    if (ev.childNodes.length) wrap.appendChild(ev);

    if (check.findings && check.findings.length) {
      var list = el("ul", "scan-check__findings");
      check.findings.forEach(function (f) {
        list.appendChild(el("li", "scan-check__finding", f));
      });
      wrap.appendChild(list);
    }

    if (check.caveat) wrap.appendChild(el("p", "scan-check__caveat", check.caveat));
    return wrap;
  }

  function renderScanned(data) {
    clear(results);
    results.appendChild(el("h2", "scan-results__heading", "What we read on " + (data.finalUrl || data.url)));

    ["titleMeta", "schema", "nap", "counters"].forEach(function (key) {
      if (data.checks && data.checks[key]) results.appendChild(renderCheck(key, data.checks[key]));
    });

    // The honest paywall — the capability boundary, on every successful scan.
    if (data.cannotSee && data.cannotSee.length) {
      var block = el("div", "scan-cannot-see");
      block.appendChild(el("h3", "scan-cannot-see__heading", "What this scan can't see"));
      var list = el("ul", null);
      data.cannotSee.forEach(function (item) {
        list.appendChild(el("li", null, item));
      });
      block.appendChild(list);
      block.appendChild(
        el("p", "scan-cannot-see__pitch",
          "None of that is visible from your website — it lives in search results and your Business Profile. That's what the paid Deep Dive covers: the " + PRICE + " report on the other side of this line.")
      );
      results.appendChild(block);
    }

    optin.hidden = false; // email ask appears ONLY after value is delivered
  }

  function renderUnreadable(data) {
    clear(results);
    var block = el("div", "scan-unreadable");
    block.appendChild(el("h2", "scan-unreadable__heading", "We couldn't read your site — and that is not a finding"));
    block.appendChild(el("p", null, data.message || "We couldn't read your site from here."));
    block.appendChild(
      el("p", "scan-unreadable__next",
        "No check results are shown because none were run — a page we can't read tells us nothing about your business, good or bad. The paid Deep Dive isn't limited to this fetch: it can research a site our scanner can't read, plus everything a website can't show (your profile, reviews, and rankings).")
    );
    results.appendChild(block);
  }

  /* ---- submit ---- */

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    errorEl.hidden = true;
    var url = input.value.trim();
    if (!url) {
      showError("Enter your website address.");
      return;
    }
    setBusy(true);

    fetch("/api/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: url }),
    })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.status === "scanned") renderScanned(data);
        else if (data.status === "unreadable") renderUnreadable(data);
        else showError(data.message || "Something went wrong — check the address and try again.");
      })
      .catch(function () {
        // Network failure ≠ API "error" status: our scanner didn't answer at all.
        showError("We couldn't reach our scanner just now — that's on us, not your site. Give it a minute and try again.");
      })
      .finally(function () { setBusy(false); });
  });

  /* ---- email opt-in stub ----
   * TODO: NO BACKEND EXISTS for email capture. This stub intentionally saves
   * nothing and says so. Do not wire a real endpoint without the mailing-list
   * infrastructure + CAN-SPAM compliance (unsubscribe link, physical address).
   * See docs/PRE_LAUNCH_CHECKLIST.md.
   */
  var optinForm = document.getElementById("optin-form");
  var optinMsg = document.getElementById("optin-msg");
  if (optinForm) {
    optinForm.addEventListener("submit", function (e) {
      e.preventDefault();
      optinMsg.textContent = "Email signup isn't connected yet — nothing was saved.";
    });
  }
})();
